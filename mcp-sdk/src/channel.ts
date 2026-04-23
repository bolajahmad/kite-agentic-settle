import { ContractService } from "./contracts.js";
import {
  createSignedReceipt,
  validateReceipt,
  verifyReceipt,
} from "./receipt.js";
import type { ChannelConfig, ChannelState, Receipt } from "./types.js";

export class ChannelManager {
  private readonly contractService: ContractService;
  private readonly token: string;
  private readonly privateKey: Uint8Array;
  private readonly signerAddress: string;

  // Track receipts per channel: channelId -> receipts[]
  private readonly receipts: Map<string, Receipt[]> = new Map();

  constructor(
    contractService: ContractService,
    token: string,
    privateKey: Uint8Array,
    signerAddress: string,
  ) {
    this.contractService = contractService;
    this.token = token;
    this.privateKey = privateKey;
    this.signerAddress = signerAddress;
  }

  async openChannel(
    config: ChannelConfig,
  ): Promise<{ txHash: string; channelId: `0x${string}` }> {
    const token = config.token || this.token;
    const mode = config.mode === "prepaid" ? 0 : 1;

    const result = await this.contractService.openChannel(
      config.provider,
      token,
      mode,
      config.deposit,
      config.maxSpend,
      config.maxDuration,
      config.maxPerCall,
    );

    if (!result.channelId) {
      throw new Error("Failed to extract channelId from transaction");
    }

    this.receipts.set(result.channelId, []);
    return { txHash: result.txHash, channelId: result.channelId };
  }

  async activateChannel(channelId: `0x${string}`): Promise<string> {
    return await this.contractService.activateChannel(channelId);
  }

  // Provider calls this after processing an API request.
  // Signs a receipt for the consumer via EIP-712.
  async signReceiptAsProvider(
    channelId: `0x${string}`,
    callCost: bigint,
    consumerAddress: string,
    requestHash?: string,
    responseHash?: string,
  ): Promise<Receipt> {
    const existing = this.receipts.get(channelId) || [];
    const prevReceipt =
      existing.length > 0 ? existing[existing.length - 1] : null;

    const nonce = prevReceipt ? prevReceipt.nonce + 1 : 1;
    const cumulativeCost = (prevReceipt?.cumulativeCost ?? 0n) + callCost;
    const timestamp = Math.floor(Date.now() / 1000);

    const receipt = await createSignedReceipt(this.privateKey, {
      requestHash: requestHash || "",
      responseHash: responseHash || "",
      callCost,
      cumulativeCost,
      nonce,
      timestamp,
      sessionId: channelId,
      provider: this.signerAddress,
      consumer: consumerAddress,
    });

    existing.push(receipt);
    this.receipts.set(channelId, existing);
    return receipt;
  }

  // Consumer calls this to verify and store a receipt from the provider.
  async verifyAndStoreReceipt(
    channelId: `0x${string}`,
    receipt: Receipt,
    providerAddress: string,
    maxPerCall: bigint,
  ): Promise<{ valid: boolean; reason?: string }> {
    // Verify signature
    const sigValid = await verifyReceipt(receipt, providerAddress);
    if (!sigValid) {
      return { valid: false, reason: "Invalid provider signature" };
    }

    // Validate fields
    const existing = this.receipts.get(channelId) || [];
    const prevReceipt =
      existing.length > 0 ? existing[existing.length - 1] : null;
    const fieldCheck = validateReceipt(receipt, prevReceipt, maxPerCall);
    if (!fieldCheck.valid) {
      return fieldCheck;
    }

    existing.push(receipt);
    this.receipts.set(channelId, existing);
    return { valid: true };
  }

  // Initiate settlement with the last receipt (starts challenge window)
  async initiateSettlement(
    channelId: `0x${string}`,
    merkleRoot?: `0x${string}`,
  ): Promise<string> {
    const existing = this.receipts.get(channelId) || [];

    if (existing.length === 0) {
      // No receipts — initiate with zero claim
      return await this.contractService.initiateSettlement(
        channelId,
        0,
        0n,
        0,
        "0x" as `0x${string}`,
        merkleRoot,
      );
    }

    const lastReceipt = existing[existing.length - 1];
    if (!lastReceipt.signature) {
      throw new Error("Last receipt has no signature");
    }

    return await this.contractService.initiateSettlement(
      channelId,
      lastReceipt.nonce,
      lastReceipt.cumulativeCost,
      lastReceipt.timestamp,
      lastReceipt.signature,
      merkleRoot,
    );
  }

  // Submit a higher receipt during the challenge window (permissionless)
  async submitReceipt(
    channelId: `0x${string}`,
    receipt: Receipt,
  ): Promise<string> {
    if (!receipt.signature) {
      throw new Error("Receipt has no signature");
    }

    return await this.contractService.submitReceipt(
      channelId,
      receipt.nonce,
      receipt.cumulativeCost,
      receipt.timestamp,
      receipt.signature,
    );
  }

  // Finalize settlement after challenge window closes
  async finalize(
    channelId: `0x${string}`,
    merkleRoot?: `0x${string}`,
  ): Promise<string> {
    return await this.contractService.finalize(channelId, merkleRoot);
  }

  // Force close an expired channel (opens settlement window)
  async forceCloseExpired(channelId: `0x${string}`): Promise<string> {
    return await this.contractService.forceCloseExpired(channelId);
  }

  async getChannel(channelId: `0x${string}`): Promise<ChannelState> {
    return await this.contractService.getChannel(channelId);
  }

  async getSettlementState(channelId: `0x${string}`) {
    return await this.contractService.getSettlementState(channelId);
  }

  getReceipts(channelId: `0x${string}`): Receipt[] {
    return this.receipts.get(channelId) || [];
  }

  getLastReceipt(channelId: `0x${string}`): Receipt | null {
    const existing = this.receipts.get(channelId) || [];
    return existing.length > 0 ? existing[existing.length - 1] : null;
  }

  getTotalSpent(channelId: `0x${string}`): bigint {
    const last = this.getLastReceipt(channelId);
    return last?.cumulativeCost ?? 0n;
  }
}
