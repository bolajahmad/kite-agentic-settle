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
  type ChannelFlowOpts,
  type PayOffer,
  probeApi402Offer,
} from "./shared.js";

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
      console.log(`  Call #${callCount} failed: ${response.status} — ${errText}`);
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
      "Provider does not accept channel payments for this route. Use --mode perCall instead.",
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
    channelId = existingChannelId;
    console.log(`  Reusing channel:  ${channelId}`);
    console.log("");
    client.setChannelForProvider(offer.payTo, channelId);
  } else {
    const recommendedDeposit = raw?.channelOptions?.recommendedDeposit
      ? BigInt(raw.channelOptions.recommendedDeposit)
      : maxPerCall * 10n;
    const requestedDeposit = depositOverride ?? recommendedDeposit;
    const requestedMaxDuration: number = raw?.channelOptions?.maxDuration ?? 3600;
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

    console.log("  Waiting for provider to activate channel...");
    const activated = await waitForChannelActive(client, channelId);
    if (activated) {
      console.log("  Channel is Active.");
    } else {
      console.log("  Provider did not activate within 90 s. Proceeding anyway.");
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
      console.log(`  Warning: receipt channelId mismatch — got ${received.channelId}`);
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
        console.log("── Channel Receipt ──────────────────────────────────────");
        console.log(`  Channel:     ${channelId}`);
        console.log(`  Sequence:    ${received.sequenceNumber}`);
        console.log(
          `  Spent:       ${formatUnits(BigInt(received.cumulativeCost), token?.decimals || 18)} ${token?.symbol} cumulative`,
        );
        console.log(`  Sig:         ${received.providerSignature}`);
        console.log("─────────────────────────────────────────────────────────");
        console.log(`  Channel is open — reuse it for the next call:`);
        console.log(`    npx kite call --url <URL> --mode batch --channel ${channelId}`);
        console.log(`  To settle and close the channel:`);
        console.log(`    npx kite finalize --channel ${channelId}`);
        console.log("─────────────────────────────────────────────────────────");
      } else {
        console.log("  Warning: receipt signature is invalid.");
      }
    }
  } else {
    console.log("  Warning: provider did not return a channel receipt for this call.");
  }
}

export async function runStreamCallsFlow(opts: ChannelFlowOpts) {
  const {
    client,
    url,
    token,
    durationSecs,
    maxCalls,
    ratePerCallOverride,
    depositOverride,
  } = opts;
  console.log(`  Stream mode: ${durationSecs}s window, up to ${maxCalls} calls`);
  console.log("");

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

  client.setChannelForProvider(offer.payTo, channelId);
  console.log(`  Interceptor notified of channel.`);
  console.log("");

  console.log("  Waiting for provider to activate the channel (up to 90 s)...");
  const activated = await waitForChannelActive(client, channelId);
  if (activated) {
    console.log("  Channel is Active.");
  } else {
    console.log("  Provider did not activate in time. Proceeding anyway.");
  }
  console.log("");

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

  await finalizeChannelFlow(client, channelId, callCount, lastReceipt);
}
