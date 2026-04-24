import {
  encodePacked,
  formatUnits,
  keccak256,
  parseUnits,
  recoverMessageAddress,
} from "viem";
import { KitePaymentClient } from "../../client.js";
import {
  DecisionMode,
  SessionRules,
  decide as decideCall,
} from "../../decide.js";
import { getSessionsByAgent } from "../../indexer.js";
import { KiteSettleClient } from "../../kite-settle-client.js";
import { ChannelStatus, PaymentRequest, PaymentResult } from "../../types.js";
import { parseToken } from "../../utils/index.js";
import { getVar } from "../../vars.js";
import { findFlag, prompt } from "../index.js";

/** First offer extracted from a 402 response's `accepts[]` array. */
interface PayOffer {
  payTo: `0x${string}`;
  asset: `0x${string}`;
  maxAmountRequired: string;
  /** Provider's declared ceiling across all their endpoints. */
  maxRatePerCall?: string;
  scheme: string;
  description?: string;
  merchantName?: string;
  resource?: string;
}

/** Shared options threaded through batch/stream flows. */
interface ChannelFlowOpts {
  client: KitePaymentClient;
  url: string;
  token: ReturnType<typeof parseToken>;
  decide: DecisionMode | undefined;
  defaultRules: SessionRules;
  onPayment: (r: PaymentResult) => void;
  maxCalls: number;
  durationSecs: number;
  ratePerCallOverride?: bigint;
  depositOverride?: bigint;
}

async function promptForPayment(req: PaymentRequest): Promise<boolean> {
  console.log("");
  console.log("── Payment Required ──────────────────────────────────────");
  console.log(`  Service:     ${req.url}`);
  console.log(`  Amount:      ${req.price.toString()} USDT`);
  console.log(`  Pay To:      ${req.payTo}`);
  console.log(`  Asset:       ${req.asset}`);
  console.log(`  Scheme:      ${req.scheme}`);
  if (req.description) console.log(`  Description: ${req.description}`);
  if (req.merchantName) console.log(`  Merchant:    ${req.merchantName}`);
  console.log("──────────────────────────────────────────────────────────");
  console.log("");

  const answer = await prompt("  Approve payment? (yes/no): ");
  return answer === "yes" || answer === "y";
}

function formatReceipt(
  result: PaymentResult,
  url: string,
  responseBody?: any,
): string {
  let lines = [
    "",
    "── Payment Receipt ───────────────────────────────────────",
    `  Status:      ${result.success ? "SUCCESS" : "FAILED"}`,
    `  Method:      ${result.method}`,
    `  Amount:      ${formatUnits(result.amount, 18)} USDT`,
    `  Service:     ${url}`,
  ];
  if (result.txHash) {
    lines.push(
      `  Tx Hash:     ${result.txHash}`,
      `  Explorer:    https://testnet.kitescan.ai/tx/${result.txHash}`,
    );
  }
  if (result.receipt?.sessionId) {
    lines.push(
      `  Session:     ${result.receipt.sessionId}`,
      `  Nonce:       ${result.receipt.nonce}`,
      `  Provider:    ${result.receipt.provider}`,
      `  Consumer:    ${result.receipt.consumer}`,
    );
  }
  lines.push(`  Timestamp:   ${new Date().toISOString()}`);
  if (responseBody?.providerSignature) {
    lines.push(
      "",
      "  Provider Receipt (EIP-712 signed):",
      `  Signer:      ${responseBody.receipt?.provider || "unknown"}`,
      `  Signature:   ${responseBody.providerSignature}`,
    );
    if (responseBody.receipt) {
      lines.push(
        `  Service:     ${responseBody.receipt.service}`,
        `  Nonce:       ${responseBody.receipt.nonce}`,
        `  Timestamp:   ${responseBody.receipt.timestamp}`,
      );
    }
  }
  lines.push("──────────────────────────────────────────────────────────", "");
  return lines.join("\n");
}

/**
 * Provider-signed receipt returned per call in batch/stream mode.
 * The signature covers `keccak256(abi.encodePacked(channelId, sequenceNumber,
 * cumulativeCost, timestamp))` — the same digest the PaymentChannel contract
 * uses for on-chain settlement verification.
 */
interface ChannelCallReceipt {
  channelId: `0x${string}`;
  sequenceNumber: number;
  cumulativeCost: string; // bigint serialised as decimal string
  timestamp: number;
  providerSignature: `0x${string}`;
}

/**
 * Verify that a provider-signed channel receipt is authentic.
 *
 * The PaymentChannel contract uses:
 *   hash = keccak256(abi.encodePacked(channelId, sequenceNumber, cumulativeCost, timestamp))
 *   signer = toEthSignedMessageHash(hash).recover(signature)
 *   require(signer == ch.provider)
 *
 * We replicate the same digest here so we catch forged receipts before
 * they reach the settlement step.
 */
async function validateChannelReceipt(
  receipt: ChannelCallReceipt,
  providerAddress: string,
): Promise<boolean> {
  const hash = keccak256(
    encodePacked(
      ["bytes32", "uint256", "uint256", "uint256"],
      [
        receipt.channelId,
        BigInt(receipt.sequenceNumber),
        BigInt(receipt.cumulativeCost),
        BigInt(receipt.timestamp),
      ],
    ),
  );
  try {
    const recovered = await recoverMessageAddress({
      message: { raw: hash },
      signature: receipt.providerSignature,
    });
    return recovered.toLowerCase() === providerAddress.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Poll the on-chain channel status until it reaches `Active`, or until
 * `timeoutMs` elapses.  Returns `true` if activation was detected.
 */
async function waitForChannelActive(
  client: KitePaymentClient,
  channelId: `0x${string}`,
  timeoutMs = 90_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ch = await client.getChannel(channelId);
    if (ch.status === ChannelStatus.Active) return true;
    // Wait 3 s between polls without blocking the event loop entirely.
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return false;
}

/**
 * Extract a `ChannelCallReceipt` from an HTTP response.
 * Providers should embed it in `body.channelReceipt`; headers are checked
 * as a fallback so existing middleware can also convey the receipt.
 */
function extractChannelReceipt(
  body: any,
  headers: Headers,
): ChannelCallReceipt | null {
  // Hopefully, structured object in response body
  if (body?.channelReceipt) {
    return body.channelReceipt as ChannelCallReceipt;
  }
  // Fallback: individual HTTP headers
  const sig = headers.get("x-channel-receipt-sig");
  const seq = headers.get("x-channel-receipt-seq");
  const cost = headers.get("x-channel-cumulative-cost");
  const ts = headers.get("x-channel-receipt-timestamp");
  const channelId = headers.get("x-channel-id");
  if (sig && seq && cost && ts && channelId) {
    return {
      channelId: channelId as `0x${string}`,
      sequenceNumber: Number(seq),
      cumulativeCost: cost,
      timestamp: Number(ts),
      providerSignature: sig as `0x${string}`,
    };
  }
  return null;
}

/**
 * Build request headers for a channel call, including the last receipt if available.
 */
function buildChannelHeaders(
  channelId: `0x${string}`,
  lastReceipt: ChannelCallReceipt | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Payment-Mode": "channel",
    "X-Channel-Id": channelId,
  };

  if (lastReceipt) {
    headers["X-Last-Receipt-Seq"] = String(lastReceipt.sequenceNumber);
    headers["X-Last-Receipt-Cost"] = lastReceipt.cumulativeCost;
    headers["X-Last-Receipt-Timestamp"] = String(lastReceipt.timestamp);
    headers["X-Last-Receipt-Sig"] = lastReceipt.providerSignature;
  }

  return headers;
}

/**
 * Core call loop shared by batch and stream flows.
 * Terminates when `shouldStop()` returns `true`, the call budget is
 * exhausted, or the provider returns an error.
 *
 * For each successful response:
 *  1. Extracts the provider-signed `ChannelCallReceipt`.
 *  2. Verifies the receipt's `channelId` matches the opened channel.
 *  3. Verifies the `sequenceNumber` is strictly greater than the last.
 *  4. Verifies the ECDSA signature against the provider's address
 *     using the same digest the PaymentChannel contract checks on-chain.
 */
async function runChannelCallLoop(
  { client, url, token, decide, onPayment }: ChannelFlowOpts,
  channelId: `0x${string}`,
  offer: PayOffer,
  shouldStop: () => boolean,
) {
  const ratePerCall = BigInt(offer.maxAmountRequired);
  let callCount = 0;
  let lastReceipt: ChannelCallReceipt | null = null;

  while (!shouldStop()) {
    callCount++;

    if (decide === "cli") {
      const go = await prompt(`  Make call #${callCount}? (yes/no): `);
      if (go.toLowerCase() !== "yes" && go.toLowerCase() !== "y") {
        callCount--;
        break;
      }
    }

    console.log(`  Call #${callCount}...`);
    const t0 = Date.now();
    const headers = buildChannelHeaders(channelId, lastReceipt);
    const response = await globalThis.fetch(url, { headers });
    const elapsed = Date.now() - t0;

    if (response.status === 402) {
      const errBody = await response.text();
      let errDetail = errBody;
      try {
        errDetail = JSON.stringify(JSON.parse(errBody));
      } catch {}
      console.log(
        `  Status: 402 — channel rejected. Stopping loop.\n  Reason: ${errDetail}`,
      );
      callCount--;
      break;
    }

    if (!response.ok) {
      const errText = await response.text();
      console.log(
        `  Call #${callCount} failed: ${response.status} — ${errText}`,
      );
      break;
    }

    const body = await response.json();
    console.log(`  Status:  ${response.status} OK  (${elapsed}ms)`);
    console.log(`  Data:    ${JSON.stringify(body, null, 2)}`);

    const received = extractChannelReceipt(body, response.headers);

    if (received) {
      // 1. ChannelId in receipt must match the channel we opened.
      if (received.channelId.toLowerCase() !== channelId.toLowerCase()) {
        console.log(
          `  Warning: receipt channelId ${received.channelId} does not match ` +
            `opened channel ${channelId}. Discarding receipt.`,
        );
      }
      // 2. Sequence number must be strictly increasing.
      else if (
        lastReceipt &&
        received.sequenceNumber <= lastReceipt.sequenceNumber
      ) {
        console.log(
          `  Warning: receipt seq ${received.sequenceNumber} is not greater than ` +
            `last seq ${lastReceipt.sequenceNumber}. Discarding receipt.`,
        );
      }
      // 3. Validate the ECDSA signature (same digest as the on-chain contract).
      else {
        const valid = await validateChannelReceipt(received, offer.payTo);
        if (!valid) {
          console.log(
            `  Warning: receipt signature is invalid or not from provider ` +
              `${offer.payTo}. Discarding receipt.`,
          );
        } else {
          lastReceipt = received;
          onPayment({
            success: true,
            method: "channel",
            amount: ratePerCall,
            receipt: {
              requestHash: "",
              responseHash: "",
              callCost: ratePerCall,
              cumulativeCost: BigInt(received.cumulativeCost),
              nonce: received.sequenceNumber,
              timestamp: received.timestamp,
              sessionId: channelId,
              provider: offer.payTo,
              consumer: client.address,
              signature: received.providerSignature,
            },
          });
        }
      }
    } else {
      console.log(
        "  Warning: provider did not return a channel receipt for this call.",
      );
    }

    console.log(
      `  Cumulative cost: ${formatUnits(lastReceipt ? BigInt(lastReceipt.cumulativeCost) : 0n, token?.decimals || 18)} ${token?.symbol}`,
    );
    console.log("");
  }

  return { callCount, lastReceipt };
}

/**
 * Initiate on-chain settlement using the last provider-signed receipt.
 * Calls `ContractService.initiateSettlement` directly because the local
 * `ChannelManager` only tracks receipts *it* signed (provider-side receipts
 * are returned by the API server, not generated locally).
 */
async function settleChannelWithReceipt(
  client: KitePaymentClient,
  channelId: `0x${string}`,
  receipt: ChannelCallReceipt,
) {
  return client
    .getContractService()
    .initiateSettlement(
      channelId,
      receipt.sequenceNumber,
      BigInt(receipt.cumulativeCost),
      receipt.timestamp,
      receipt.providerSignature,
    );
}

/**
 * Shared settlement step: initiates on-chain settlement if we have a receipt,
 * then prints instructions for finalization after the challenge window.
 */
async function finalizeChannelFlow(
  client: KitePaymentClient,
  channelId: `0x${string}`,
  callCount: number,
  lastReceipt: ChannelCallReceipt | null,
) {
  console.log("");
  if (callCount === 0 || !lastReceipt) {
    console.log("  No calls completed — nothing to settle.");
    return;
  }

  console.log(`  ${callCount} call(s) completed. Initiating settlement...`);
  try {
    const settledTxHash = await settleChannelWithReceipt(
      client,
      channelId,
      lastReceipt,
    );
    console.log(`  Settlement tx:  ${settledTxHash}`);
    console.log(`  Challenge window opens for 1 hour.`);
    console.log(`  After the window closes, finalize with:`);
    console.log(`    npx kite finalize --channel ${channelId}`);
  } catch (error: any) {
    console.log(`  Settlement error: ${error.message}`);
  }
}

async function probeApi402Offer(
  url: string,
): Promise<null | { offer: PayOffer; raw: any }> {
  const probe = await globalThis.fetch(url);
  if (probe.status !== 402) return null;

  const text = await probe.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Cannot parse 402 response body: ${text}`);
  }

  const offer = parsed.accepts?.[0] as PayOffer;
  if (!offer) throw new Error("402 response is missing accepts[]");

  return { offer, raw: parsed };
}

async function runBatchApiCallsFlow(
  opts: ChannelFlowOpts,
  existingChannelId?: `0x${string}`,
) {
  const { client, url, token, ratePerCallOverride, depositOverride } = opts;

  // ── Step 1: probe ─────────────────────────────────────────────────────
  const probeResult = await probeApi402Offer(url);
  if (!probeResult) {
    console.log("  No payment required — making a direct call.");
    const r = await globalThis.fetch(url);
    const body = await r.json();
    console.log(`  Status:  ${r.status} OK`);
    console.log(`  Data:    ${JSON.stringify(body, null, 2)}`);
    return;
  }

  const { offer, raw } = probeResult;

  const acceptsChannel =
    raw?.channelOptions?.acceptsChannel === true ||
    offer.scheme === "kite-programmable";
  if (!acceptsChannel) {
    throw new Error(
      "Provider does not accept channel payments for this route. " +
        "Use --mode perCall instead.",
    );
  }

  const maxPerCall =
    ratePerCallOverride ??
    (offer.maxRatePerCall
      ? BigInt(offer.maxRatePerCall)
      : BigInt(offer.maxAmountRequired));

  console.log(`  Provider:         ${offer.payTo}`);
  console.log(
    `  Rate per call:    ${formatUnits(maxPerCall, token?.decimals || 18)} ${token?.symbol}`,
  );

  let channelId: `0x${string}`;

  if (existingChannelId) {
    // ── Reuse an existing open channel (--channel flag) ────────────────
    channelId = existingChannelId;
    console.log(`  Reusing channel:  ${channelId}`);
    console.log("");
    client.setChannelForProvider(offer.payTo, channelId);
  } else {
    // ── Step 2: open a new channel ────────────────────────────────────
    // Use server-recommended deposit if the caller did not override.
    const recommendedDeposit = raw?.channelOptions?.recommendedDeposit
      ? BigInt(raw.channelOptions.recommendedDeposit)
      : maxPerCall * 10n;
    const deposit = depositOverride ?? recommendedDeposit;
    const maxDuration: number = raw?.channelOptions?.maxDuration ?? 3600;

    console.log(
      `  Deposit:          ${formatUnits(deposit, token?.decimals || 18)} ${token?.symbol}`,
    );
    console.log("");

    console.log("  Opening payment channel on-chain...");
    const { txHash: openTxHash, channelId: newChannelId } =
      await client.openChannel({
        provider: offer.payTo,
        token: offer.asset,
        mode: "prepaid",
        deposit,
        maxSpend: deposit,
        maxDuration,
        maxPerCall,
      });
    channelId = newChannelId;
    console.log(`  Channel ID:   ${channelId}`);
    console.log(`  Open tx:      ${openTxHash}`);

    client.setChannelForProvider(offer.payTo, channelId);

    // ── Step 3: wait for provider activation ──────────────────────────
    console.log("  Waiting for provider to activate channel...");
    const activated = await waitForChannelActive(client, channelId);
    if (activated) {
      console.log("  Channel is Active.");
    } else {
      console.log(
        "  Provider did not activate within 90 s. Proceeding anyway.",
      );
    }
    console.log("");
  }

  // ── Step 4: make the ONE actual API call via the channel ───────────
  console.log(`  Making API call via channel...`);
  const headers = buildChannelHeaders(channelId, null);
  const t0 = Date.now();
  const response = await globalThis.fetch(url, { headers });
  const elapsed = Date.now() - t0;

  if (response.status === 402) {
    const errBody = await response.text();
    let errDetail = errBody;
    try {
      errDetail = JSON.stringify(JSON.parse(errBody));
    } catch {}
    throw new Error(`Channel rejected by provider: ${errDetail}`);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API call failed: ${response.status} — ${errText}`);
  }

  const body = (await response.json()) as any;
  console.log(`  Status:  ${response.status} OK  (${elapsed}ms)`);
  console.log(`  Data:    ${JSON.stringify(body.data ?? body, null, 2)}`);

  const received = extractChannelReceipt(body, response.headers);
  if (received) {
    if (received.channelId.toLowerCase() !== channelId.toLowerCase()) {
      console.log(
        `  Warning: receipt channelId mismatch — got ${received.channelId}`,
      );
    } else {
      const valid = await validateChannelReceipt(received, offer.payTo);
      if (!valid) {
        console.log(`  Warning: receipt signature is invalid.`);
      } else {
        opts.onPayment({
          success: true,
          method: "channel",
          amount: maxPerCall,
          receipt: {
            requestHash: "",
            responseHash: "",
            callCost: maxPerCall,
            cumulativeCost: BigInt(received.cumulativeCost),
            nonce: received.sequenceNumber,
            timestamp: received.timestamp,
            sessionId: channelId,
            provider: offer.payTo,
            consumer: client.address,
            signature: received.providerSignature,
          },
        });
        console.log("");
        console.log(
          "── Channel Receipt ──────────────────────────────────────",
        );
        console.log(`  Channel:     ${channelId}`);
        console.log(`  Sequence:    ${received.sequenceNumber}`);
        console.log(
          `  Spent:       ${formatUnits(BigInt(received.cumulativeCost), token?.decimals || 18)} ${token?.symbol} cumulative`,
        );
        console.log(`  Sig:         ${received.providerSignature}`);
        console.log(
          "─────────────────────────────────────────────────────────",
        );
        console.log(`  Channel is open — reuse it for the next call:`);
        console.log(
          `    npx kite call --url <URL> --mode batch --channel ${channelId}`,
        );
        console.log(`  To settle and close the channel:`);
        console.log(`    npx kite finalize --channel ${channelId}`);
        console.log(
          "─────────────────────────────────────────────────────────",
        );
      }
    }
  } else {
    console.log(
      "  Warning: provider did not return a channel receipt for this call.",
    );
  }
}

async function runStreamCallsFlow(opts: ChannelFlowOpts) {
  const {
    client,
    url,
    token,
    durationSecs,
    maxCalls,
    ratePerCallOverride,
    depositOverride,
  } = opts;
  console.log(
    `  Stream mode: ${durationSecs}s window, up to ${maxCalls} calls`,
  );
  console.log("");

  // Step 1: probe API information
  const probeResult = await probeApi402Offer(url);
  if (!probeResult) {
    console.log("  No payment required — making a direct call.");
    const r = await globalThis.fetch(url);
    const body = await r.json();
    console.log(`  Status:  ${r.status} OK`);
    console.log(`  Data:    ${JSON.stringify(body, null, 2)}`);
    return;
  }

  const { offer } = probeResult;
  const maxPerCall =
    ratePerCallOverride ??
    (offer.maxRatePerCall
      ? BigInt(offer.maxRatePerCall)
      : BigInt(offer.maxAmountRequired));
  // Deposit covers maxCalls worth of calls — unused funds are refunded on settle.
  const deposit = depositOverride ?? maxPerCall * BigInt(maxCalls);

  console.log(`  Provider:      ${offer.payTo}`);
  console.log(
    `  Max/call cap:  ${formatUnits(maxPerCall, token?.decimals || 18)} ${token?.symbol}`,
  );
  if (ratePerCallOverride) {
    console.log(
      `  (probe price was ${formatUnits(BigInt(offer.maxAmountRequired), token?.decimals || 18)} — overridden)`,
    );
  }
  console.log(`  Stream:        ${durationSecs}s`);
  console.log(`  Max calls:     ${maxCalls}`);
  console.log(
    `  Deposit:       ${formatUnits(deposit, token?.decimals || 18)} ${token?.symbol}`,
  );
  console.log("");

  // Step 2: open channel with the stream duration as expiry
  console.log("  Opening payment channel on-chain...");
  const { txHash: openTxHash, channelId } = await client.openChannel({
    provider: offer.payTo,
    token: offer.asset,
    mode: "prepaid",
    deposit,
    maxSpend: deposit,
    maxDuration: durationSecs,
    maxPerCall,
  });
  console.log(`  Channel ID:   ${channelId}`);
  console.log(`  Open tx:      ${openTxHash}`);

  // Notify the interceptor so auto/channel mode works if client.fetch is
  // called in a different context after this flow completes.
  client.setChannelForProvider(offer.payTo, channelId);
  console.log(`  Interceptor notified of channel.`);
  console.log("");

  // Step 3: wait for activation
  console.log("  Waiting for provider to activate the channel (up to 90 s)...");
  const activated = await waitForChannelActive(client, channelId);
  if (activated) {
    console.log("  Channel is Active.");
  } else {
    console.log("  Provider did not activate in time. Proceeding anyway.");
  }
  console.log("");

  // Step 4: call loop (bounded by elapsed time and maxCalls)
  const streamDeadline = Date.now() + durationSecs * 1000;
  let callsMade = 0;
  const { callCount, lastReceipt } = await runChannelCallLoop(
    opts,
    channelId,
    offer,
    () => {
      callsMade++;
      return Date.now() >= streamDeadline || callsMade > maxCalls;
    },
  );

  // Step 5: settle
  await finalizeChannelFlow(client, channelId, callCount, lastReceipt);
}

export async function callApi(args: string[]) {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  // Parse all CLI arguments
  let decide = findFlag(args, "--decide") as DecisionMode | undefined;
  const tokenFlag = findFlag(args, "--token");
  const agentIndex = findFlag(args, "--agent") || "0";
  const maxCalls = Number.parseInt(findFlag(args, "--max-calls") || "100", 10);
  const durationSecs = Number.parseInt(
    findFlag(args, "--duration") || "60",
    10,
  );
  const ratePerCallFlag = findFlag(args, "--rate-per-call");
  const depositFlag = findFlag(args, "--deposit");
  const channelIdFlag = findFlag(args, "--channel") as
    | `0x${string}`
    | undefined;
  let url = findFlag(args, "--url") || (await prompt("Enter API URL: "));
  let rawMode = findFlag(args, "--mode")?.trim() || "perCall";
  const mode = (rawMode === "x402" ? "perCall" : rawMode) as
    | "perCall"
    | "batch"
    | "stream"
    | "auto";

  const token = parseToken(tokenFlag || "DmUSDT");
  const tokenDecimals = token?.decimals ?? 18;

  // Build a KiteSettleClient — it derives EOA, agent, and session keys
  // deterministically from the stored credential.
  const sessionIndex = Number(findFlag(args, "--session") || "0");
  const settle = await KiteSettleClient.create({
    credential,
    defaultPaymentMode: (mode === "perCall"
      ? "perCall"
      : mode === "stream"
        ? "channel"
        : mode) as "perCall" | "channel" | "batch",
    agentIndex: Number(agentIndex),
    sessionIndex: mode === "perCall" ? sessionIndex : 0,
  });

  const agentAddress = settle.agentAddress ?? settle.eoaAddress;
  const sessionKeyAddress = settle.sessionKeyAddress;
  // The underlying payment client (session-key scoped for perCall mode).
  const client = settle.getPaymentClient();

  // Show the KiteAAWallet deposited balance for all modes — funds always
  // live in the wallet contract, not in the agent/session-key address.
  const balance = await settle.getDepositedBalance(token?.address);

  console.log(`  EOA:      ${settle.eoaAddress}`);
  console.log(`  Agent:    ${agentAddress} (index ${agentIndex})`);
  if (sessionKeyAddress) console.log(`  Session:  ${sessionKeyAddress}`);
  console.log(`  Target:   ${url}`);
  console.log(`  Mode:     ${mode}`);
  console.log(`  Decide:   ${decide ?? "auto"}`);
  console.log(
    `  Balance:  ${formatUnits(balance, tokenDecimals)} ${token?.symbol} (KiteAAWallet)`,
  );
  if (ratePerCallFlag)
    console.log(`  Rate/call override: ${ratePerCallFlag} ${token?.symbol}`);
  if (depositFlag)
    console.log(`  Deposit override:   ${depositFlag} ${token?.symbol}`);
  console.log("");

  // Optional overrides for channel deposit sizing (fixes issue #4).
  const ratePerCallOverride = ratePerCallFlag
    ? parseUnits(ratePerCallFlag, tokenDecimals)
    : undefined;
  const depositOverride = depositFlag
    ? parseUnits(depositFlag, tokenDecimals)
    : undefined;

  // Resolve on-chain session rules to power the decision engine.
  const resolvedOwner = await settle.resolveAgent(BigInt(agentAddress));
  const agentId = resolvedOwner ?? agentAddress;
  const sessions = await getSessionsByAgent(agentId);

  const defaultRule: SessionRules = {
    maxPerCall: formatUnits(
      BigInt(sessions[0].valueLimit),
      token?.decimals ?? 18,
    ).toString(),
    maxPerSession: formatUnits(
      BigInt(sessions[0].valueLimit),
      token?.decimals ?? 18,
    ).toString(),
    blockedProviders: sessions[0].blockedProviders,
    requireApprovalAbove: formatUnits(
      BigInt(sessions[0].dailyLimit),
      token?.decimals ?? 18,
    ).toString(),
  };

  let lastPaymentResult: PaymentResult | undefined;
  const onPayment = (result: PaymentResult) => {
    lastPaymentResult = result;
  };

  // Dispatch the actual calls
  if (mode === "batch") {
    await runBatchApiCallsFlow(
      {
        client,
        url,
        token,
        decide,
        defaultRules: defaultRule,
        onPayment,
        maxCalls,
        durationSecs,
        ratePerCallOverride,
        depositOverride,
      },
      channelIdFlag,
    );
  } else if (mode === "stream") {
    await runStreamCallsFlow({
      client,
      url,
      token,
      decide,
      defaultRules: defaultRule,
      onPayment,
      maxCalls,
      durationSecs,
      ratePerCallOverride,
      depositOverride,
    });
  } else {
    console.log(`  Per-call mode: making a single call with each request.`);
    const fetchOpts: any = {
      paymentMode: "perCall" as const,
      onPayment,
      sessionKey: sessionKeyAddress,
      walletAddress: agentAddress,
    };

    if (decide === "cli") {
      fetchOpts.onPaymentRequired = promptForPayment;
    } else {
      fetchOpts.onPaymentRequired = async (
        req: PaymentRequest,
      ): Promise<boolean> => {
        const ctx = {
          request: req,
          rules: defaultRule,
          balance: Number(
            formatUnits(
              await client.getTokenBalance(token?.address),
              tokenDecimals,
            ),
          ),
          totalSpentThisSession: Number(client.getTotalSpent()),
          callCount: client.getUsageLogs().length,
          openaiApiKey: process.env.OPENAI_API_KEY,
        };

        const result = await decideCall(ctx, decide);
        console.log(
          `  Decision: ${result.decision} [${result.tier}] — ${result.reason}`,
        );
        return result.decision !== "reject";
      };
    }

    console.log(`  Calling ${url}...`);
    console.log("");

    const t0 = Date.now();
    const response = await client.fetch(url, undefined, fetchOpts);
    const elapsed = Date.now() - t0;

    if (response.status === 402) {
      const errBody: any = await response.json().catch(() => null);
      console.log(`  Status: ${response.status} Payment Required`);
      console.log(`  The agent was not charged.`);
      if (errBody?.error) {
        console.log(`  Reason: ${errBody.error}`);
      } else {
        console.log(`  Reason: payment was declined`);
      }
    } else {
      const body = await response.json();
      console.log(`  Status:  ${response.status} OK`);
      console.log(`  Data:    ${JSON.stringify(body, null, 2)}`);
      console.log(`  Time:    ${elapsed}ms`);

      if (lastPaymentResult) {
        console.log(formatReceipt(lastPaymentResult, url, body));
      }
    }
  }
}
