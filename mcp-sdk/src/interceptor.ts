import { randomBytes } from "node:crypto";
import { formatUnits, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BatchManager } from "./batch";
import { ChannelManager } from "./channel.js";
import { ContractService } from "./contracts.js";
import type {
  InterceptorOptions,
  PaymentRequest,
  PaymentResult,
} from "./types.js";
import { UsageTracker } from "./usage.js";
import { deriveSessionId } from "./utils/session-id.js";

interface X402Offer {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  resource: string;
  description?: string;
  merchantName?: string;
}

interface PaymentRequirements {
  offers: X402Offer[];
  version: number;
}

function parseX402Response(body: string): PaymentRequirements | null {
  try {
    const parsed = JSON.parse(body);
    if (parsed.accepts && Array.isArray(parsed.accepts)) {
      return {
        offers: parsed.accepts as X402Offer[],
        version: parsed.x402Version || 1,
      };
    }
  } catch {}
  return null;
}

function selectOffer(offers: X402Offer[]): X402Offer {
  const preferredAsset = process.env.SETTLEMENT_TOKEN_ADDRESS?.toLowerCase();
  if (preferredAsset) {
    const preferred = offers.find(
      (offer) => offer.asset.toLowerCase() === preferredAsset,
    );
    if (preferred) return preferred;
  }

  return [...offers].sort(
    (a, b) => {
      const aAmount = BigInt(a.maxAmountRequired);
      const bAmount = BigInt(b.maxAmountRequired);
      if (aAmount < bAmount) return -1;
      if (aAmount > bAmount) return 1;
      return 0;
    },
  )[0];
}

export class PaymentInterceptor {
  private readonly channelManager: ChannelManager;
  private readonly contractService: ContractService;
  private readonly usage: UsageTracker;
  private readonly agentId: string;
  private readonly privateKey: Uint8Array;
  private readonly signerAddress: string;
  private readonly defaultOptions: InterceptorOptions;
  private readonly providerChannels: Map<string, `0x${string}`> = new Map();
  private batchManager: BatchManager | null = null;

  constructor(
    channelManager: ChannelManager,
    contractService: ContractService,
    usage: UsageTracker,
    agentId: string,
    privateKey: Uint8Array,
    signerAddress: string,
    defaultOptions: InterceptorOptions = {},
  ) {
    this.channelManager = channelManager;
    this.contractService = contractService;
    this.usage = usage;
    this.agentId = agentId;
    this.privateKey = privateKey;
    this.signerAddress = signerAddress;
    this.defaultOptions = defaultOptions;
  }

  setBatchManager(batchManager: BatchManager): void {
    this.batchManager = batchManager;
  }

  getBatchManager(): BatchManager | null {
    return this.batchManager;
  }

  setChannelForProvider(provider: string, channelId: `0x${string}`): void {
    this.providerChannels.set(provider.toLowerCase(), channelId);
  }

  removeChannelForProvider(provider: string): void {
    this.providerChannels.delete(provider.toLowerCase());
  }

  async fetch(
    url: string,
    init?: RequestInit,
    options?: InterceptorOptions,
  ): Promise<Response> {
    const opts = { ...this.defaultOptions, ...options };
    const mode = opts.paymentMode || "auto";

    const response = await globalThis.fetch(url, init);

    if (response.status !== 402) {
      return response;
    }

    // If auto-pay is explicitly disabled, return the raw 402
    if (opts.autoPayEnabled === false && !opts.onPaymentRequired) {
      return response;
    }

    const body = await response.text();
    const requirements = parseX402Response(body);

    if (!requirements || requirements.offers.length === 0) {
      throw new Error(`402 but could not parse payment requirements: ${body}`);
    }

    const offer = selectOffer(requirements.offers);
    const offerAmount = BigInt(offer.maxAmountRequired);
    const price = Number(formatUnits(offerAmount, 18));

    if (opts.maxPaymentPerCall && offerAmount > opts.maxPaymentPerCall) {
      throw new Error(
        `Price ${offerAmount.toString()} exceeds max ${opts.maxPaymentPerCall.toString()}`,
      );
    }

    // If onPaymentRequired callback is set, ask before paying
    if (opts.onPaymentRequired) {
      const paymentRequest: PaymentRequest = {
        url,
        price,
        asset: offer.asset,
        payTo: offer.payTo,
        scheme: offer.scheme,
        description: offer.description,
        merchantName: offer.merchantName,
      };
      console.log({ paymentRequest });
      const approved = await opts.onPaymentRequired(paymentRequest);
      if (!approved) {
        return response;
      }
    } else if (opts.autoPayEnabled === false) {
      return response;
    }

    // Decide: batch, channel (if one exists for this provider), or x402 direct
    const hasChannel = this.providerChannels.has(offer.payTo.toLowerCase());
    const hasBatch =
      this.batchManager?.hasActiveSession(offer.payTo.toLowerCase()) ?? false;
    const shouldUseBatch = mode === "batch" || (mode === "auto" && hasBatch);
    const shouldUseChannel =
      !shouldUseBatch &&
      (mode === "channel" || (mode === "auto" && hasChannel));

    let result: PaymentResult;

    if (shouldUseBatch) {
      result = await this.payViaBatch(offer, opts);
    } else if (shouldUseChannel) {
      result = await this.payViaChannel(offer, opts);
    } else {
      result = await this.payViaX402(offer, opts);
    }

    console.log({ result });
    opts.onPayment?.(result);

    this.usage.log({
      agentId: this.agentId,
      serviceUrl: url,
      method: init?.method || "GET",
      amount: result.amount,
      timestamp: Date.now(),
      channelId: result.receipt?.sessionId,
      receiptSequence: result.receipt?.nonce,
      txHash: result.txHash,
    });

    // Retry with payment proof
    const retryHeaders = new Headers(init?.headers);
    if (result.method === "perCall") {
      // x402 programmable settlement: base64-encoded signed authorization payload
      retryHeaders.set("X-PAYMENT", result.x402Payload || "");
      console.log(
        `  [interceptor] Retrying with X-PAYMENT header (${result.x402Payload?.length} chars)`,
      );
    } else if (result.method === "channel") {
      // For channel mode the deposit IS the payment commitment; include the
      // channel ID so the provider knows which channel to debit.  Also
      // forward the last receipt (if any) so the provider can validate
      // continuity of the cumulative cost.
      const channelId =
        result.receipt?.sessionId ||
        opts.channelId ||
        this.providerChannels.get(offer.payTo.toLowerCase()) ||
        "";
      retryHeaders.set("X-Payment-Mode", "channel");
      retryHeaders.set("X-Channel-Id", channelId);
      if (result.receipt?.nonce) {
        retryHeaders.set("X-Last-Receipt-Seq", String(result.receipt.nonce));
        retryHeaders.set(
          "X-Last-Receipt-Cost",
          String(result.receipt.cumulativeCost),
        );
        retryHeaders.set("X-Last-Receipt-Sig", result.receipt.signature || "");
        retryHeaders.set(
          "X-Last-Receipt-Timestamp",
          String(result.receipt.timestamp),
        );
      }
    } else if (result.method === "batch" && result.receipt) {
      retryHeaders.set("X-SESSION-ID", result.receipt.sessionId || "");
      retryHeaders.set("X-RECEIPT-NONCE", String(result.receipt.nonce));
      retryHeaders.set("X-RECEIPT-COST", String(result.receipt.cumulativeCost));
      retryHeaders.set("X-RECEIPT-SIG", result.receipt.signature || "");
    }

    return await globalThis.fetch(url, { ...init, headers: retryHeaders });
  }

  private async payViaX402(
    offer: X402Offer,
    opts?: InterceptorOptions,
  ): Promise<PaymentResult> {
    const amount = BigInt(offer.maxAmountRequired);
    const sessionKey = opts?.sessionKey || this.defaultOptions.sessionKey;

    // x402 programmable settlement requires a KiteAAWallet session key.
    // The interceptor must be initialised with the session key's private key;
    // this.signerAddress is the session key address.
    if (!sessionKey) {
      throw new Error(
        "x402 perCall payment requires a KiteAAWallet session key. " +
          "Initialise PaymentInterceptor with the session key's private key and " +
          "pass sessionKey in InterceptorOptions.",
      );
    }
    if (sessionKey.toLowerCase() !== this.signerAddress.toLowerCase()) {
      throw new Error(
        `Session key mismatch: opts.sessionKey=${sessionKey} but interceptor ` +
          `signerAddress=${this.signerAddress}. The interceptor must be initialised ` +
          "with the session key's private key for programmable settlement.",
      );
    }

    const chainId = this.contractService.getChainId();
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const validAfter = 0n;
    const validBefore = nowSec + 300n;

    const session = (await this.contractService.validateSession(
      sessionKey,
    )) as readonly [boolean, bigint, `0x${string}`, `0x${string}`, bigint];
    const [active, agentId, _user, walletContract, validUntil] = session;
    if (!active) {
      throw new Error(
        `Session ${sessionKey} is not active on IdentityRegistry`,
      );
    }
    if (validUntil <= nowSec) {
      throw new Error(
        `Session ${sessionKey} expired at ${validUntil.toString()}`,
      );
    }
    if (
      !walletContract ||
      walletContract.toLowerCase() ===
        "0x0000000000000000000000000000000000000000"
    ) {
      throw new Error(
        `Session ${sessionKey} has invalid walletContract in IdentityRegistry`,
      );
    }

    const sessionId = deriveSessionId(
      sessionKey as `0x${string}`,
      agentId,
      validUntil,
    );
    const nonce = toHex(randomBytes(32));

    // Build EIP-712 typed data and sign with the session key's private key
    const account = privateKeyToAccount(toHex(this.privateKey, { size: 32 }));
    const signature = await account.signTypedData({
      domain: {
        name: "GokiteAccount",
        version: "1",
        chainId: BigInt(chainId),
        verifyingContract: walletContract,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "token", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: walletContract,
        to: offer.payTo as `0x${string}`,
        token: offer.asset as `0x${string}`,
        value: amount,
        validAfter,
        validBefore,
        nonce,
      },
    });

    // Encode as base64 JSON for x402 programmable settlement.
    const payload = {
      scheme: "kite-programmable",
      version: "2",
      chainId,
      walletContract,
      sessionId,
      agentId: agentId.toString(),
      sessionKey,
      auth: {
        from: walletContract,
        to: offer.payTo,
        token: offer.asset,
        value: amount,
        validAfter,
        validBefore,
        nonce,
      },
      signature,
    };
    const x402Payload = Buffer.from(
      JSON.stringify(payload, (key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).toString("base64");

    return {
      success: true,
      method: "perCall",
      x402Payload,
      amount,
    };
  }

  private async payViaChannel(
    offer: X402Offer,
    opts: InterceptorOptions,
  ): Promise<PaymentResult> {
    const channelId =
      opts.channelId || this.providerChannels.get(offer.payTo.toLowerCase());

    if (!channelId) {
      throw new Error(`No active channel for provider ${offer.payTo}`);
    }

    // Verify on-chain that the channel's registered provider matches the
    // address in the 402 offer.  A mismatch means the 402 is directing
    // payment to a different party than the channel was opened against.
    const ch = await this.channelManager.getChannel(channelId);
    if (ch.provider.toLowerCase() !== offer.payTo.toLowerCase()) {
      throw new Error(
        `payTo mismatch: channel provider is ${ch.provider} but 402 offer says ${offer.payTo}`,
      );
    }

    const price = BigInt(offer.maxAmountRequired);

    // The consumer does NOT sign receipts — that is exclusively the
    // provider's responsibility (the contract verifies signer == provider).
    // The locked deposit IS the payment commitment for this channel.
    // Forward the last known receipt so the provider can validate
    // cumulative-cost continuity and so the retry carries proof of state.
    const lastReceipt = this.channelManager.getLastReceipt(channelId);

    return {
      success: true,
      method: "channel",
      receipt: lastReceipt ?? undefined,
      amount: price,
    };
  }

  private async payViaBatch(
    offer: X402Offer,
    _opts: InterceptorOptions,
  ): Promise<PaymentResult> {
    if (!this.batchManager) {
      throw new Error("Batch manager not configured");
    }

    const provider = offer.payTo.toLowerCase();
    const session = this.batchManager.getSessionForProvider(provider);
    if (!session) {
      throw new Error(`No active batch session for provider ${offer.payTo}`);
    }

    const price = BigInt(offer.maxAmountRequired);

    // Check if deposit can cover this call
    const canPay = this.batchManager.canAfford(session.sessionId, price);
    if (!canPay) {
      throw new Error(
        `Batch deposit exhausted. Deposit: ${session.deposit}, spent: ${session.cumulativeCost}, needed: ${price}`,
      );
    }

    // Sign receipt and record in batch
    const receipt = await this.batchManager.recordCall(
      session.sessionId,
      price,
      this.privateKey,
      this.signerAddress,
      provider,
    );

    return {
      success: true,
      method: "batch",
      receipt,
      amount: price,
    };
  }
}
