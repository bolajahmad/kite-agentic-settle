import { formatUnits } from "viem";
import { createChannelRecord } from "../../../channel-store.js";
import {
  buildChannelHeaders,
  extractChannelReceipt,
  validateChannelReceipt,
  waitForChannelActive,
  type ChannelCallReceipt,
} from "../../../utils/channel-helpers.js";
import {
  clampChannelOpenToSession,
  probeApi402Offer,
  type ChannelFlowOpts,
  type PayOffer,
} from "./shared.js";
import { ChannelStatus } from "../../../types.js";

async function runChannelCallLoop(
  { client, url, token, decide, onPayment }: ChannelFlowOpts,
  channelId: `0x${string}`,
  offer: PayOffer,
  options: { maxCalls: number; streamDeadlineMs: number },
) {
  const ratePerCall = BigInt(offer.maxAmountRequired);
  let callCount = 0;
  let lastReceipt: ChannelCallReceipt | null = null;

  while (true) {
    if (callCount >= options.maxCalls) {
      console.log(`  Reached max calls (${options.maxCalls}). Stopping stream.`);
      break;
    }

    const nowMs = Date.now();
    if (nowMs >= options.streamDeadlineMs) {
      console.log("  Stream duration reached. Stopping stream.");
      break;
    }

    const channel = await client.getContractService().getChannel(channelId);
    if (
      channel.status !== ChannelStatus.Open &&
      channel.status !== ChannelStatus.Active
    ) {
      console.log(
        `  Channel status is ${channel.status} (not open/active). Stopping stream.`,
      );
      break;
    }

    const nowSec = Math.floor(nowMs / 1000);
    if (channel.expiresAt > 0 && nowSec >= channel.expiresAt) {
      console.log("  Channel has reached on-chain expiry. Stopping stream.");
      break;
    }

    callCount++;

    if (decide === "cli") {
      const go = await import("../../../utils/index.js").then(({ prompt }) =>
        prompt(`  Make call #${callCount}? (yes/no): `),
      );
      if (go.toLowerCase() !== "yes" && go.toLowerCase() !== "y") {
        callCount--;
        break;
      }
    }

    console.log(`  Call #${callCount}...`);
    const t0 = Date.now();
    const headers = buildChannelHeaders(channelId, lastReceipt);
    const response = await client.fetch(url, { headers });
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
      if (received.channelId.toLowerCase() !== channelId.toLowerCase()) {
        console.log(
          `  Warning: receipt channelId ${received.channelId} does not match opened channel ${channelId}. Discarding receipt.`,
        );
      } else if (
        lastReceipt &&
        received.sequenceNumber <= lastReceipt.sequenceNumber
      ) {
        console.log(
          `  Warning: receipt seq ${received.sequenceNumber} is not greater than last seq ${lastReceipt.sequenceNumber}. Discarding receipt.`,
        );
      } else {
        const valid = await validateChannelReceipt(received, offer.payTo);
        if (valid) {
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
        } else {
          console.log(
            `  Warning: receipt signature is invalid or not from provider ${offer.payTo}. Discarding receipt.`,
          );
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

async function settleChannelWithReceipt(
  client: ChannelFlowOpts["client"],
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

async function resolveChannelWalletContract(
  client: ChannelFlowOpts["client"],
  sessionKeyAddress?: `0x${string}`,
): Promise<`0x${string}` | undefined> {
  if (!sessionKeyAddress) return undefined;

  const walletContract = await client
    .getContractService()
    .resolveWalletContractForSession(sessionKeyAddress);

  if (!walletContract) {
    throw new Error(
      `Unable to resolve ClientVault wallet contract for session ${sessionKeyAddress}`,
    );
  }

  return walletContract;
}

async function finalizeChannelFlow(
  client: ChannelFlowOpts["client"],
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

export async function runBatchApiCallsFlow(
  opts: ChannelFlowOpts,
  existingChannelId?: `0x${string}`,
) {
  const { client, url, token, ratePerCallOverride, depositOverride } = opts;

  const probeResult = await probeApi402Offer(url, token?.address);
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
      "Provider does not accept channel payments for this route. Use --mode perCall instead.",
    );
  }

  const maxPerCall =
    ratePerCallOverride ??
    (offer.maxRatePerCall
      ? BigInt(offer.maxRatePerCall)
      : BigInt(offer.maxAmountRequired));
  const walletContract = await resolveChannelWalletContract(
    client,
    opts.sessionKeyAddress,
  );

  console.log(`  Provider:         ${offer.payTo}`);
  console.log(
    `  Rate per call:    ${formatUnits(maxPerCall, token?.decimals || 18)} ${token?.symbol}`,
  );

  let channelId: `0x${string}`;

  if (existingChannelId) {
    channelId = existingChannelId;
    console.log(`  Reusing channel:  ${channelId}`);
    console.log("");
    client.setChannelForProvider(offer.payTo, channelId);
  } else {
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

    if (!walletContract || !opts.sessionKeyAddress) {
      throw new Error(
        "sessionKeyAddress and walletContract are required to open a channel.",
      );
    }

    console.log("  Opening payment channel on-chain (via ClientVault batch)...");
    const { txHash: openTxHash, channelId: newChannelId } =
      await client.getContractService().openChannelViaVaultBatch(
        opts.sessionKeyAddress,
        walletContract,
        offer.payTo,
        offer.asset,
        0, // prepaid mode
        deposit,
        deposit, // maxSpend == deposit
        maxDuration,
        maxPerCall,
      );
    if (!newChannelId) {
      throw new Error("openChannelViaVaultBatch did not return a channelId — check ChannelOpened event");
    }
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
      if (valid) {
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
      } else {
        console.log("  Warning: receipt signature is invalid.");
      }
    }
  } else {
    console.log(
      "  Warning: provider did not return a channel receipt for this call.",
    );
  }
}

export async function runStreamCallsFlow(
  opts: ChannelFlowOpts,
  existingChannelId?: `0x${string}`,
) {
  const {
    client,
    url,
    token,
    durationSecs,
    ratePerCallOverride,
    depositOverride,
  } = opts;
  console.log(`  Stream mode: single call using a time-bounded channel (${durationSecs}s).`);
  console.log("");

  const probeResult = await probeApi402Offer(url, token?.address);
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
      "Provider does not accept channel payments for this route. Use --mode perCall instead.",
    );
  }

  const maxPerCall =
    ratePerCallOverride ??
    (offer.maxRatePerCall
      ? BigInt(offer.maxRatePerCall)
      : BigInt(offer.maxAmountRequired));
  const recommendedDeposit = raw?.channelOptions?.recommendedDeposit
    ? BigInt(raw.channelOptions.recommendedDeposit)
    : maxPerCall * 10n;
  const requestedDeposit = depositOverride ?? recommendedDeposit;
  const constrained = clampChannelOpenToSession(
    durationSecs,
    requestedDeposit,
    opts,
  );
  const deposit = constrained.deposit;
  const effectiveDurationSecs = constrained.durationSecs;
  const walletContract = await resolveChannelWalletContract(
    client,
    opts.sessionKeyAddress,
  );

  console.log(`  Provider:      ${offer.payTo}`);
  console.log(
    `  Max/call cap:  ${formatUnits(maxPerCall, token?.decimals || 18)} ${token?.symbol}`,
  );
  if (ratePerCallOverride) {
    console.log(
      `  (probe price was ${formatUnits(BigInt(offer.maxAmountRequired), token?.decimals || 18)} — overridden)`,
    );
  }
  console.log(`  Stream:        ${effectiveDurationSecs}s`);
  console.log(
    `  Deposit:       ${formatUnits(deposit, token?.decimals || 18)} ${token?.symbol}`,
  );
  console.log("");

  let channelId: `0x${string}`;

  if (existingChannelId) {
    channelId = existingChannelId;
    const existing = await client.getContractService().getChannel(channelId);
    if (existing.provider.toLowerCase() !== offer.payTo.toLowerCase()) {
      throw new Error(
        `Provided channel ${channelId} belongs to provider ${existing.provider}, expected ${offer.payTo}. Stream calls must reuse a channel for the same provider.`,
      );
    }
    if (
      existing.status !== ChannelStatus.Open &&
      existing.status !== ChannelStatus.Active
    ) {
      throw new Error(
        `Provided channel ${channelId} is not open/active (status=${existing.status}).`,
      );
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (existing.expiresAt <= nowSec) {
      throw new Error(
        `Provided channel ${channelId} is expired at ${existing.expiresAt}. Open a new stream channel.`,
      );
    }

    console.log(`  Reusing channel: ${channelId}`);
    console.log(`  Expires at:      ${existing.expiresAt} (unix)`);
    console.log("");
  } else {
    if (!walletContract || !opts.sessionKeyAddress) {
      throw new Error(
        "sessionKeyAddress and walletContract are required to open a channel.",
      );
    }

    console.log("  Opening payment channel on-chain (via ClientVault batch)...");
    const { txHash: openTxHash, channelId: rawChannelId } =
      await client.getContractService().openChannelViaVaultBatch(
        opts.sessionKeyAddress,
        walletContract,
        offer.payTo,
        offer.asset,
        0, // prepaid mode
        deposit,
        deposit, // maxSpend == deposit
        effectiveDurationSecs,
        maxPerCall,
      );
    if (!rawChannelId) {
      throw new Error("openChannelViaVaultBatch did not return a channelId — check ChannelOpened event");
    }
    channelId = rawChannelId;
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

    console.log("  Waiting for provider to activate the channel (up to 90 s)...");
    const activated = await waitForChannelActive(client, channelId);
    if (activated) {
      console.log("  Channel is Active.");
    } else {
      console.log("  Provider did not activate in time. Proceeding anyway.");
    }
    console.log("");
  }

  client.setChannelForProvider(offer.payTo, channelId);

  const latest = await client.getContractService().getChannel(channelId);
  const nowSec = Math.floor(Date.now() / 1000);
  if (latest.expiresAt <= nowSec) {
    throw new Error(`Channel ${channelId} has expired. Open a new stream channel.`);
  }
  if (
    latest.status !== ChannelStatus.Open &&
    latest.status !== ChannelStatus.Active
  ) {
    throw new Error(
      `Channel ${channelId} is not open for calls (status=${latest.status}).`,
    );
  }

  console.log("  Making API call via stream channel...");
  const headers = buildChannelHeaders(channelId, null);
  const t0 = Date.now();
  const response = await client.fetch(url, { headers });
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
      if (valid) {
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
      } else {
        console.log("  Warning: receipt signature is invalid.");
      }
    }
  } else {
    console.log(
      "  Warning: provider did not return a channel receipt for this call.",
    );
  }

  console.log("");
  console.log("── Stream Channel ──────────────────────────────────────");
  console.log(`  Channel:     ${channelId}`);
  console.log("  Status:      call complete; channel left open.");
  console.log(`  Reuse call:  npx kite call --url <URL> --mode stream --channel ${channelId} --agent ${opts.agentIndex ?? "<agent>"} --session ${opts.sessionKeyAddress ?? "<session>"}`);
  console.log("  Note:        Calls will fail once this channel duration expires.");
  console.log("────────────────────────────────────────────────────────");
}
