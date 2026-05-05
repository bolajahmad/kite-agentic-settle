import {
  encodePacked,
  formatUnits,
  keccak256,
  parseUnits,
  recoverMessageAddress,
} from "viem";
import { createChannelRecord } from "../../channel-store.js";
import { KitePaymentClient } from "../../client.js";
import {
  DecisionMode,
  SessionRules,
  decide as decideCall,
} from "../../decide.js";
import { getSessionsByAgent } from "../../indexer.js";
import { KiteSettleClient } from "../../kite-settle-client.js";
import { ChannelStatus, PaymentRequest, PaymentResult } from "../../types.js";
import {
  prompt,
  resolveTokenMetadata,
  type TokenMetadata,
} from "../../utils/index.js";
import { getVar } from "../../vars.js";
import { findFlag } from "../index.js";

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
  token: TokenMetadata | null;
  decide: DecisionMode | undefined;
  defaultRules: SessionRules;
  onPayment: (r: PaymentResult) => void;
  maxCalls: number;
  durationSecs: number;
  ratePerCallOverride?: bigint;
  depositOverride?: bigint;
  agentIndex?: number;
  eoaAddress?: string;
  sessionKeyAddress?: `0x${string}`;
  sessionRemainingSeconds?: number;
  sessionRemainingCapacity?: bigint;
}

function clampChannelOpenToSession(
  requestedDurationSecs: number,
  requestedDeposit: bigint,
  opts: ChannelFlowOpts,
): { durationSecs: number; deposit: bigint } {
  const remainingSeconds = opts.sessionRemainingSeconds;
  const remainingCapacity = opts.sessionRemainingCapacity;

  if (remainingSeconds === undefined || remainingCapacity === undefined) {
    return {
      durationSecs: requestedDurationSecs,
      deposit: requestedDeposit,
    };
  }

  if (remainingSeconds <= 0) {
    throw new Error(
      "Selected session is expired or has no remaining validity window.",
    );
  }

  if (remainingCapacity <= 0n) {
    throw new Error(
      "Selected session has no remaining spend capacity for opening a channel.",
    );
  }

  const durationSecs = Math.min(requestedDurationSecs, remainingSeconds);
  const deposit =
    requestedDeposit > remainingCapacity ? remainingCapacity : requestedDeposit;

  if (durationSecs < requestedDurationSecs) {
    console.log(
      `  Session window cap: requested ${requestedDurationSecs}s, using ${durationSecs}s.`,
    );
  }
  if (deposit < requestedDeposit) {
    console.log(
      `  Session capacity cap: requested ${requestedDeposit.toString()} base units, using ${deposit.toString()}.`,
    );
  }

  if (deposit <= 0n) {
    throw new Error(
      "Effective deposit is zero after applying session capacity limits.",
    );
  }

  return { durationSecs, deposit };
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
    console.log({ ch });
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
    const response = await client.fetch(url, { headers });
    console.log({ response });
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
    const requestedDeposit = depositOverride ?? recommendedDeposit;
    const requestedMaxDuration: number =
      raw?.channelOptions?.maxDuration ?? 3600;
    const constrained = clampChannelOpenToSession(
      requestedMaxDuration,
      requestedDeposit,
      opts,
    );
    const deposit = constrained.deposit;
    const maxDuration = constrained.durationSecs;

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

    if (opts.agentIndex !== undefined && opts.eoaAddress) {
      createChannelRecord({
        channelId,
        provider: offer.payTo,
        token: offer.asset,
        openUrl: url,
        agentAddress: opts.eoaAddress,
        agentIndex: opts.agentIndex,
        maxPerCall: maxPerCall.toString(),
        deposit: deposit.toString(),
        maxSpend: deposit.toString(),
        durationSecs: maxDuration,
        openedAt: Date.now(),
        openTxHash,
        providerMaxRatePerCall: offer.maxRatePerCall,
      });
      console.log(
        `  Saved local channel state: ~/.kite-agent-pay/channels/${channelId}.json`,
      );
    }

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
  const requestedDeposit = depositOverride ?? maxPerCall * BigInt(maxCalls);
  const constrained = clampChannelOpenToSession(
    durationSecs,
    requestedDeposit,
    opts,
  );
  const deposit = constrained.deposit;
  const effectiveDurationSecs = constrained.durationSecs;

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
    maxDuration: effectiveDurationSecs,
    maxPerCall,
  });
  console.log(`  Channel ID:   ${channelId}`);
  console.log(`  Open tx:      ${openTxHash}`);

  if (opts.agentIndex !== undefined && opts.eoaAddress) {
    createChannelRecord({
      channelId,
      provider: offer.payTo,
      token: offer.asset,
      openUrl: url,
      agentAddress: opts.eoaAddress,
      agentIndex: opts.agentIndex,
      maxPerCall: maxPerCall.toString(),
      deposit: deposit.toString(),
      maxSpend: deposit.toString(),
      durationSecs: effectiveDurationSecs,
      openedAt: Date.now(),
      openTxHash,
      providerMaxRatePerCall: offer.maxRatePerCall,
    });
    console.log(
      `  Saved local channel state: ~/.kite-agent-pay/channels/${channelId}.json`,
    );
  }

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
  // Parse all CLI arguments
  let decide = findFlag(args, "--decide") as DecisionMode | undefined;
  const tokenFlag = findFlag(args, "--token");
  const agentIdStr = findFlag(args, "--agent");
  const sessionKeyFlag =
    findFlag(args, "--session") ??
    findFlag(args, "--session-key") ??
    findFlag(args, "--key");

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

  const token = await resolveTokenMetadata(tokenFlag || "DmUSDT");
  const tokenDecimals = token?.decimals ?? 18;

  const paymentMode =
    mode === "perCall" ? "perCall" : mode === "stream" ? "channel" : mode;

  const ratePerCallOverride = ratePerCallFlag
    ? parseUnits(ratePerCallFlag, tokenDecimals)
    : undefined;
  const depositOverride = depositFlag
    ? parseUnits(depositFlag, tokenDecimals)
    : undefined;

  const indexedSessions = agentIdStr
    ? await getSessionsByAgent(`0x${BigInt(agentIdStr).toString(16)}`).catch(
        () => [],
      )
    : [];

  const normalizeSession = (raw: string) =>
    raw.startsWith("0x") ? raw.toLowerCase() : `0x${raw.toLowerCase()}`;

  const explicitSessionKey = sessionKeyFlag
    ? normalizeSession(sessionKeyFlag)
    : undefined;
  const requiresSessionBoundChannel = mode === "batch" || mode === "stream";

  if (requiresSessionBoundChannel) {
    if (!agentIdStr) {
      throw new Error(
        "Channel mode requires --agent <id> so the channel is opened against an agent/session context.",
      );
    }
    if (!explicitSessionKey) {
      throw new Error(
        "Channel mode requires --session <sessionKey> (or --session-key/--key).",
      );
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const autoCandidates = indexedSessions
    .filter(
      (session) =>
        session.status.toUpperCase() === "ACTIVE" &&
        Number(session.validUntil) > now,
    )
    .map((session) => session.sessionKey.toLowerCase());

  const localCandidates = agentIdStr
    ? Array.from({ length: 64 })
        .map((_, i) => getVar(`SESSION_${agentIdStr}_${i}_ADDRESS`))
        .filter((v): v is string => Boolean(v))
        .map((v) => normalizeSession(v))
    : [];

  const mergedCandidates = Array.from(
    new Set([...autoCandidates, ...localCandidates]),
  );

  const sessionsToTry = requiresSessionBoundChannel
    ? [explicitSessionKey]
    : explicitSessionKey
      ? [explicitSessionKey]
      : mergedCandidates.length > 0
        ? mergedCandidates
        : [undefined];

  const runWithSettle = async (settle: KiteSettleClient): Promise<void> => {
    const sessionKeyAddress = settle.sessionKeyAddress;
    const client = settle.getPaymentClient();
    const balance = await settle.getDepositedBalance(token?.address);

    console.log(`  EOA:      ${settle.eoaAddress}`);
    if (agentIdStr) console.log(`  Agent ID: ${agentIdStr}`);
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

    const selectedSession = sessionKeyAddress
      ? indexedSessions.find(
          (session) =>
            session.sessionKey.toLowerCase() ===
            sessionKeyAddress.toLowerCase(),
        )
      : indexedSessions[0];

    let sessionRemainingSeconds: number | undefined;
    let sessionRemainingCapacity: bigint | undefined;

    if (requiresSessionBoundChannel) {
      if (!sessionKeyAddress) {
        throw new Error(
          "No session key is attached to this client. Use --agent and --session.",
        );
      }
      const contract = settle.getPaymentClient().getContractService();
      const [active, , , , , maxValueAllowed, validUntil] =
        (await contract.validateSession(sessionKeyAddress)) as any;
      if (!active) {
        throw new Error(`Session ${sessionKeyAddress} is not active.`);
      }
      const nowSec = Math.floor(Date.now() / 1000);
      sessionRemainingSeconds = Math.max(0, Number(validUntil) - nowSec);
      const spent = await contract.getSessionSpent(sessionKeyAddress);
      sessionRemainingCapacity =
        maxValueAllowed > spent ? maxValueAllowed - spent : 0n;
    }

    const defaultRule: SessionRules = selectedSession
      ? {
          maxPerCall: formatUnits(
            BigInt(selectedSession.valueLimit),
            token?.decimals ?? 18,
          ).toString(),
          maxPerSession: formatUnits(
            BigInt(selectedSession.maxLimit ?? selectedSession.valueLimit),
            token?.decimals ?? 18,
          ).toString(),
          blockedAgents: selectedSession.blockedAgents ?? [],
          requireApprovalAbove: formatUnits(
            BigInt(selectedSession.maxLimit ?? selectedSession.valueLimit),
            token?.decimals ?? 18,
          ).toString(),
        }
      : {
          maxPerCall: "10",
          maxPerSession: "100",
          blockedAgents: [],
          requireApprovalAbove: "50",
        };

    let lastPaymentResult: PaymentResult | undefined;
    const onPayment = (result: PaymentResult) => {
      lastPaymentResult = result;
    };

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
          agentIndex: agentIdStr ? Number.parseInt(agentIdStr, 10) : undefined,
          eoaAddress: settle.eoaAddress,
          sessionKeyAddress: sessionKeyAddress as `0x${string}` | undefined,
          sessionRemainingSeconds,
          sessionRemainingCapacity,
        },
        channelIdFlag,
      );
      return;
    }

    if (mode === "stream") {
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
        agentIndex: agentIdStr ? Number.parseInt(agentIdStr, 10) : undefined,
        eoaAddress: settle.eoaAddress,
        sessionKeyAddress: sessionKeyAddress as `0x${string}` | undefined,
        sessionRemainingSeconds,
        sessionRemainingCapacity,
      });
      return;
    }

    console.log(`  Per-call mode: making a single call with each request.`);
    const fetchOpts: any = {
      paymentMode: "perCall" as const,
      onPayment,
      sessionKey: sessionKeyAddress,
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
              await settle.getDepositedBalance(token?.address),
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
      const reason = errBody?.error || "payment was declined";
      console.log(`  Reason: ${reason}`);
      throw new Error(String(reason));
    }

    const body = await response.json();
    console.log(`  Status:  ${response.status} OK`);
    console.log(`  Data:    ${JSON.stringify(body, null, 2)}`);
    console.log(`  Time:    ${elapsed}ms`);

    if (lastPaymentResult) {
      console.log(formatReceipt(lastPaymentResult, url, body));
    }
  };

  let lastErr: unknown;
  for (const sessionKeyToTry of sessionsToTry) {
    try {
      const settle = agentIdStr
        ? await KiteSettleClient.create({
            agentId: BigInt(agentIdStr),
            sessionKey: sessionKeyToTry,
            defaultPaymentMode: paymentMode,
          })
        : await (async () => {
            const credential = getVar("PRIVATE_KEY");
            if (!credential) {
              throw new Error(
                "No credential found. Run: npx kite init\n" +
                  "  Or specify an agent: npx kite call --agent <agentId> --url <url>",
              );
            }
            return KiteSettleClient.create({
              credential,
              defaultPaymentMode: paymentMode,
            });
          })();

      await runWithSettle(settle);
      return;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);

      if (!agentIdStr || explicitSessionKey) throw err;

      if (
        msg.toLowerCase().includes("session key not active") ||
        msg.toLowerCase().includes("session private key not found") ||
        msg.toLowerCase().includes("unavailable for payments") ||
        msg.toLowerCase().includes(" is expired")
      ) {
        continue;
      }
      throw err;
    }
  }

  if (lastErr instanceof Error) throw lastErr;
  throw new Error("No usable session found for this call.");
}
