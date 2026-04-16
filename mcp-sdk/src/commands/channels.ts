import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatUnits, parseUnits } from "viem";
import { findFlag, prompt } from "../cli.js";
import { KitePaymentClient } from "../client.js";
import { ChannelStatus } from "../types.js";
import { parseToken } from "../utils/index.js";
import { getKiteDir, getVar } from "../vars.js";
import { deriveAgentAccount } from "../wallet.js";

// ── Channel store (~/.kite-agent-pay/channels.json) ──────────────────────────

interface StoredChannel {
  channelId: `0x${string}`;
  provider: `0x${string}`;
  url: string;
  agentAddress: string;
  agentIndex: number;
  maxCalls: number;
  durationSecs: number;
  /** Stored as decimal string to avoid JSON bigint issues. */
  deposit: string;
  ratePerCall: string;
  token: string;
  openedAt: number;
  openTxHash: string;
  firstCallStatus?: number;
  firstCallBody?: unknown;
}

function channelsFile(): string {
  return join(getKiteDir(), "channels.json");
}

function loadChannels(): Record<string, StoredChannel> {
  const path = channelsFile();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function saveChannels(channels: Record<string, StoredChannel>): void {
  writeFileSync(channelsFile(), JSON.stringify(channels, null, 2) + "\n", {
    mode: 0o600,
  });
}

function storeChannel(channel: StoredChannel): void {
  const all = loadChannels();
  all[channel.channelId.toLowerCase()] = channel;
  saveChannels(all);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function channelStatusLabel(status: number): string {
  switch (status) {
    case ChannelStatus.Open:
      return "Pending Activation";
    case ChannelStatus.Active:
      return "Active";
    case ChannelStatus.SettlementPending:
      return "Settlement Pending";
    case ChannelStatus.Closed:
      return "Closed";
    default:
      return `Unknown (${status})`;
  }
}

/** Build an agent-derived KitePaymentClient from the EOA PRIVATE_KEY. */
async function buildAgentClient(
  credential: string,
  agentIndex: number,
  mode: "perCall" | "channel" | "batch" | "auto" | "session" = "channel",
): Promise<{
  client: KitePaymentClient;
  agentAddress: string;
  eoaAddress: string;
}> {
  const eoaClient = await KitePaymentClient.create({
    seedPhrase: credential,
    defaultPaymentMode: "perCall",
  });
  const { privateKey: agentPrivateKey, address: agentAddress } =
    await deriveAgentAccount(eoaClient.getPrivateKey(), agentIndex);
  const client = await KitePaymentClient.create({
    seedPhrase: agentPrivateKey,
    defaultPaymentMode: mode as any,
  });
  return { client, agentAddress, eoaAddress: eoaClient.address };
}

// ── channel open ─────────────────────────────────────────────────────────────

async function cmdChannelOpen(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const urlFlag = findFlag(args, "--url");
  const url = urlFlag || (await prompt("Enter API URL: "));
  const agentIndex = Number(
    findFlag(args, "--agent-id") ?? findFlag(args, "--agent") ?? "0",
  );
  const maxCalls = Number(findFlag(args, "--max-calls") ?? "100");
  const durationSecs = Number(findFlag(args, "--duration") ?? "3600");
  const depositFlag = findFlag(args, "--deposit");
  const ratePerCallFlag = findFlag(args, "--rate-per-call");
  const tokenFlag = findFlag(args, "--token");

  const token = parseToken(tokenFlag ?? "DmUSDT");
  const tokenDecimals = token?.decimals ?? 18;

  const { client, agentAddress, eoaAddress } = await buildAgentClient(
    credential,
    agentIndex,
    "channel",
  );

  console.log("");
  console.log("── Opening Payment Channel ───────────────────────────────");
  console.log(`  EOA:      ${eoaAddress}`);
  console.log(`  Agent:    ${agentAddress} (index ${agentIndex})`);
  console.log(`  Target:   ${url}`);
  console.log("");

  // Step 1: probe for 402 offer
  console.log("  Probing API for payment requirements...");
  const probe = await globalThis.fetch(url);

  if (probe.status !== 402) {
    console.log(`  API responded with ${probe.status} (no payment required).`);
    console.log("  A payment channel is unnecessary for this endpoint.");
    return;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(await probe.text());
  } catch {
    throw new Error("Cannot parse 402 response body.");
  }

  const offer = parsed.accepts?.[0];
  if (!offer) throw new Error("402 response is missing accepts[]");

  const ratePerCall = ratePerCallFlag
    ? parseUnits(ratePerCallFlag, tokenDecimals)
    : BigInt(offer.maxAmountRequired);
  const deposit = depositFlag
    ? parseUnits(depositFlag, tokenDecimals)
    : ratePerCall * BigInt(maxCalls);

  console.log(`  Provider:      ${offer.payTo}`);
  console.log(
    `  Rate/call cap: ${formatUnits(ratePerCall, tokenDecimals)} ${token?.symbol}`,
  );
  if (ratePerCallFlag) {
    console.log(
      `  (probe price was ${formatUnits(BigInt(offer.maxAmountRequired), tokenDecimals)} — overridden)`,
    );
  }
  console.log(`  Max calls:     ${maxCalls}`);
  console.log(`  Duration:      ${durationSecs}s`);
  console.log(
    `  Total deposit: ${formatUnits(deposit, tokenDecimals)} ${token?.symbol}`,
  );
  console.log("");

  // Step 2: open channel on-chain
  console.log("  Opening channel on-chain...");
  const { txHash: openTxHash, channelId } = await client.openChannel({
    provider: offer.payTo,
    token: offer.asset,
    mode: "prepaid",
    deposit,
    maxSpend: deposit,
    maxDuration: durationSecs,
    ratePerCall,
  });

  // Step 3: persist channel locally immediately after open
  storeChannel({
    channelId,
    provider: offer.payTo,
    url,
    agentAddress,
    agentIndex,
    maxCalls,
    durationSecs,
    deposit: deposit.toString(),
    ratePerCall: ratePerCall.toString(),
    token: offer.asset,
    openedAt: Date.now(),
    openTxHash,
  });

  console.log(`  Channel ID:    ${channelId}`);
  console.log(`  Open tx:       ${openTxHash}`);
  console.log(`  Explorer:      https://testnet.kitescan.ai/tx/${openTxHash}`);
  console.log(`  Status:        Pending Activation`);
  console.log(`  Saved to:      ~/.kite-agent-pay/channels.json`);
  console.log("");

  // Step 4: wait for provider activation, then make the first call
  console.log("  Waiting for provider to activate the channel (up to 90 s)...");
  const deadline = Date.now() + 90_000;
  let activated = false;
  while (Date.now() < deadline) {
    const ch = await client.getChannel(channelId);
    if (ch.status === ChannelStatus.Active) {
      activated = true;
      break;
    }
    await new Promise<void>((r) => setTimeout(r, 3_000));
  }

  if (!activated) {
    console.log("  Provider has not activated the channel within 90 s.");
    console.log("  You can check status with:");
    console.log(`    npx kite channel status --channel ${channelId}`);
    console.log("──────────────────────────────────────────────────────────");
    return;
  }

  console.log("  Channel is Active.");
  console.log("");

  // Step 5: make the first call to establish session and cache the response
  console.log("  Making initial call...");
  const t0 = Date.now();
  const firstResp = await globalThis.fetch(url, {
    headers: {
      "X-Payment-Mode": "channel",
      "X-Channel-Id": channelId,
    },
  });
  const elapsed = Date.now() - t0;

  let firstBody: unknown = null;
  try {
    firstBody = await firstResp.json();
  } catch {
    /* non-JSON response — not an error */
  }

  // Persist first-call result alongside stored channel
  const all = loadChannels();
  const key = channelId.toLowerCase();
  if (all[key]) {
    all[key].firstCallStatus = firstResp.status;
    if (firstBody !== null) all[key].firstCallBody = firstBody;
    saveChannels(all);
  }

  console.log(`  First call:    HTTP ${firstResp.status} (${elapsed}ms)`);
  if (firstBody !== null) {
    console.log(`  Response:      ${JSON.stringify(firstBody, null, 2)}`);
  }
  console.log("");
  console.log("── Channel Ready ─────────────────────────────────────");
  console.log(`  Channel ID:    ${channelId}`);
  console.log(`  Provider:      ${offer.payTo}`);
  console.log(
    `  Deposit:       ${formatUnits(deposit, tokenDecimals)} ${token?.symbol}`,
  );
  console.log(`  Status:        Active`);
  console.log("");
  console.log("  Next steps:");
  console.log(`    npx kite call --url ${url} --mode channel`);
  console.log(`    npx kite channel status --channel ${channelId}`);
  console.log("──────────────────────────────────────────────────────────");
}

// ── channel status ────────────────────────────────────────────────────────────

async function cmdChannelStatus(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const channelFlag = findFlag(args, "--channel") as `0x${string}` | undefined;
  const agentIndex = Number(
    findFlag(args, "--agent-id") ?? findFlag(args, "--agent") ?? "0",
  );

  const { client } = await buildAgentClient(credential, agentIndex);
  const all = loadChannels();

  // If a specific channel was requested but it's not in local store,
  // still try to look it up on-chain.
  const keys = channelFlag ? [channelFlag.toLowerCase()] : Object.keys(all);

  if (keys.length === 0) {
    console.log("");
    console.log(
      "  No channels found. Open one with: npx kite channel open --url <api>",
    );
    return;
  }

  for (const key of keys) {
    const stored = all[key];
    const channelId = stored?.channelId ?? channelFlag;

    console.log("");
    console.log("── Channel ───────────────────────────────────────────────");

    if (stored) {
      console.log(`  Channel ID:    ${channelId}`);
      console.log(`  Provider:      ${stored.provider}`);
      console.log(`  URL:           ${stored.url}`);
      console.log(
        `  Agent:         ${stored.agentAddress} (index ${stored.agentIndex})`,
      );
      console.log(`  Max calls:     ${stored.maxCalls}`);
      console.log(`  Duration:      ${stored.durationSecs}s`);
      console.log(
        `  Deposit:       ${formatUnits(BigInt(stored.deposit), 18)} (${stored.deposit} raw)`,
      );
      console.log(
        `  Rate/call cap: ${formatUnits(BigInt(stored.ratePerCall), 18)}`,
      );
      console.log(
        `  Opened at:     ${new Date(stored.openedAt).toISOString()}`,
      );
      console.log(`  Open tx:       ${stored.openTxHash}`);
      if (stored.firstCallStatus !== undefined) {
        console.log(`  First call:    HTTP ${stored.firstCallStatus}`);
      }
    } else {
      console.log(`  Channel ID:    ${channelId}`);
      console.log(`  (no local record — fetching on-chain state only)`);
    }

    // Live on-chain state
    try {
      const ch = await client.getChannel(channelId);
      console.log("");
      console.log("  ── On-chain ──────────────────────────────────────");
      console.log(`  Status:           ${channelStatusLabel(ch.status)}`);
      console.log(`  Deposit:          ${formatUnits(ch.deposit, 18)}`);
      console.log(`  Settled:          ${formatUnits(ch.settledAmount, 18)}`);
      console.log(
        `  Highest claimed:  ${formatUnits(ch.highestClaimedCost, 18)}`,
      );
      console.log(`  Sequence #:       ${ch.highestSequenceNumber}`);
      if (ch.expiresAt > 0) {
        console.log(
          `  Expires at:       ${new Date(ch.expiresAt * 1000).toISOString()}`,
        );
      }
      if (ch.settlementDeadline > 0) {
        console.log(
          `  Settlement by:    ${new Date(ch.settlementDeadline * 1000).toISOString()}`,
        );
      }
    } catch (err: any) {
      console.log(`  (on-chain lookup failed: ${err.message})`);
    }

    console.log("──────────────────────────────────────────────────────────");
  }
}

async function cmdChannelClose(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const channelRaw =
    findFlag(args, "--channel") || (await prompt("Enter channel ID: "));
  const channelId = channelRaw.trim() as `0x${string}`;
  const agentIndex = Number(
    findFlag(args, "--agent-id") ?? findFlag(args, "--agent") ?? "0",
  );
  const skipWithdraw = args.includes("--no-withdraw");

  const { client, agentAddress } = await buildAgentClient(
    credential,
    agentIndex,
    "channel",
  );

  console.log("");
  console.log("── Closing Payment Channel ───────────────────────────────");
  console.log(`  Channel ID:  ${channelId}`);
  console.log(`  Agent:       ${agentAddress} (index ${agentIndex})`);
  console.log("");

  // ── 1. Fetch on-chain channel state and verify ownership ─────────────────
  console.log("  Fetching on-chain channel state...");
  const ch = await client.getChannel(channelId);

  if (ch.consumer.toLowerCase() !== agentAddress.toLowerCase()) {
    throw new Error(
      `Access denied: channel consumer is ${ch.consumer} but agent address is ${agentAddress}. ` +
        `Use --agent-id <n> to select the correct agent index.`,
    );
  }

  if (ch.status === ChannelStatus.Closed) {
    console.log("  Channel is already Closed.");
    return;
  }

  console.log(`  Status:      ${channelStatusLabel(ch.status)}`);
  console.log(`  Provider:    ${ch.provider}`);
  console.log(`  Deposit:     ${formatUnits(ch.deposit, 18)} (total locked)`);
  console.log(
    `  Settled:     ${formatUnits(ch.settledAmount, 18)} (provider claimed so far)`,
  );
  const unspent = ch.deposit - ch.highestClaimedCost;
  console.log(`  Refundable:  ~${formatUnits(unspent, 18)} (estimate)`);
  console.log("");

  // ── 2. Initiate settlement (starts challenge window) ─────────────────────
  if (ch.status === ChannelStatus.SettlementPending) {
    console.log("  Settlement already pending — skipping initiateSettlement.");
  } else {
    console.log("  Initiating settlement on-chain...");
    let settleTxHash: string;
    if (
      ch.status === ChannelStatus.Open ||
      ch.status === ChannelStatus.Active
    ) {
      // Check if channel has expired — use forceCloseExpired if so
      const now = Math.floor(Date.now() / 1000);
      if (ch.expiresAt > 0 && now > ch.expiresAt) {
        settleTxHash = await client.forceCloseExpired(channelId);
        console.log(`  Force-closed expired channel.`);
      } else {
        settleTxHash = await client.initiateSettlement(channelId);
      }
    } else {
      settleTxHash = await client.initiateSettlement(channelId);
    }
    console.log(`  Settlement tx:  ${settleTxHash}`);
    console.log(
      `  Explorer:       https://testnet.kitescan.ai/tx/${settleTxHash}`,
    );
    console.log("");
  }

  // ── 3. Poll for challenge window to close, then finalize ─────────────────
  console.log("  Waiting for challenge window to close...");
  console.log("  (This can take up to 1 hour on mainnet. Polling every 30 s.)");

  const POLL_INTERVAL = 30_000;
  let finalized = false;

  while (!finalized) {
    const state = await client.getSettlementState(channelId);
    const now = Math.floor(Date.now() / 1000);

    if (state.deadline > 0 && now >= state.deadline) {
      console.log("  Challenge window closed. Finalizing...");
      const finalizeTx = await client.finalize(channelId);
      console.log(`  Finalize tx:    ${finalizeTx}`);
      console.log(
        `  Explorer:       https://testnet.kitescan.ai/tx/${finalizeTx}`,
      );
      finalized = true;
    } else if (state.deadline > 0) {
      const secsLeft = state.deadline - now;
      console.log(
        `  Challenge window closes in ${secsLeft}s ` +
          `(${new Date(state.deadline * 1000).toISOString()}). Polling again in 30s...`,
      );
      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL));
    } else {
      // deadline == 0 means we need to re-check overall channel status
      const updated = await client.getChannel(channelId);
      if (updated.status === ChannelStatus.Closed) {
        console.log("  Channel already finalized (Closed).");
        finalized = true;
      } else {
        console.log(
          "  Waiting for settlement deadline to be set... retrying in 30s.",
        );
        await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL));
      }
    }
  }

  console.log("");

  // ── 4. Withdraw refunded balance from AA wallet back to EOA ──────────────
  if (skipWithdraw) {
    console.log(
      "  Skipping withdrawal (--no-withdraw). Refunded tokens remain in the AA wallet.",
    );
  } else {
    // Build a fresh client with the agent key to query balance post-finalize
    const postBalance = await client.getDepositedTokenBalance();
    if (postBalance === 0n) {
      console.log(
        "  Deposited balance is 0 — nothing to withdraw (refund may have gone directly to EOA).",
      );
    } else {
      console.log(
        `  Withdrawing refund of ${formatUnits(postBalance, 18)} from AA wallet to EOA...`,
      );
      const withdrawTx = await client.withdrawFromWallet(postBalance);
      console.log(`  Withdraw tx:    ${withdrawTx}`);
      console.log(
        `  Explorer:       https://testnet.kitescan.ai/tx/${withdrawTx}`,
      );
    }
  }

  // ── 5. Remove channel from local store ──────────────────────────────────
  const all = loadChannels();
  const key = channelId.toLowerCase();
  if (all[key]) {
    delete all[key];
    saveChannels(all);
    console.log("  Channel removed from ~/.kite-agent-pay/channels.json");
  }

  console.log("");
  console.log("── Channel Closed ────────────────────────────────────────");
  console.log(`  Channel ID:  ${channelId}`);
  console.log(`  Provider:    ${ch.provider}`);
  console.log(
    `  You paid:    ~${formatUnits(ch.highestClaimedCost, 18)} (provider's highest claim)`,
  );
  console.log(
    `  Refunded:    ~${formatUnits(unspent, 18)} (returned to wallet)`,
  );
  console.log("──────────────────────────────────────────────────────────");
}



// ── channel list ─────────────────────────────────────────────────────────────

async function cmdChannelList(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const agentIndex = Number(
    findFlag(args, "--agent-id") ?? findFlag(args, "--agent") ?? "0",
  );
  // --filter active|all  (default: all)
  const filter = (findFlag(args, "--filter") ?? "all").toLowerCase();

  const { agentAddress } = await buildAgentClient(credential, agentIndex);
  // Build a read-only client for on-chain lookups
  const { client } = await buildAgentClient(credential, agentIndex);

  const all = loadChannels();
  const entries = Object.values(all).filter(
    (s) => s.agentAddress.toLowerCase() === agentAddress.toLowerCase(),
  );

  if (entries.length === 0) {
    console.log("");
    console.log(
      `  No channels found for agent ${agentAddress} (index ${agentIndex}).`,
    );
    console.log(
      "  Open one with: npx kite channel open --url <api>",
    );
    return;
  }

  // Enrich each entry with live on-chain status
  const enriched: Array<{ stored: StoredChannel; onChainStatus: number | null }> = [];
  for (const stored of entries) {
    let onChainStatus: number | null = null;
    try {
      const ch = await client.getChannel(stored.channelId);
      onChainStatus = ch.status;
    } catch {
      // unreachable channel — treat as unknown
    }
    enriched.push({ stored, onChainStatus });
  }

  // Apply filter
  const visible = filter === "active"
    ? enriched.filter(({ onChainStatus }) => onChainStatus === ChannelStatus.Active)
    : enriched;

  if (visible.length === 0) {
    console.log("");
    console.log(`  No ${filter} channels found for agent ${agentAddress}.`);
    return;
  }

  console.log("");
  console.log(`  Channels for agent ${agentAddress} (index ${agentIndex})`);
  if (filter === "active") console.log("  Filter: active only");
  console.log("");

  for (const { stored, onChainStatus } of visible) {
    const statusLabel =
      onChainStatus !== null ? channelStatusLabel(onChainStatus) : "Unknown";
    const age = Math.round((Date.now() - stored.openedAt) / 60_000);
    console.log(
      `  ${stored.channelId}  ${statusLabel.padEnd(20)}  ${stored.url}  (+${age}m)`,
    );
    console.log(
      `    Provider: ${stored.provider}  Deposit: ${formatUnits(BigInt(stored.deposit), 18)}`,
    );
    console.log("");
  }

  console.log(`  Total: ${visible.length} channel(s)`);
}

// ── channel resume ────────────────────────────────────────────────────────────

async function cmdChannelResume(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const channelRaw = findFlag(args, "--channel");
  const agentIndex = Number(
    findFlag(args, "--agent-id") ?? findFlag(args, "--agent") ?? "0",
  );

  const { client, agentAddress } = await buildAgentClient(
    credential,
    agentIndex,
    "channel",
  );

  const all = loadChannels();

  // Resolve channel: explicit flag → first active channel for this agent
  let stored: StoredChannel | undefined;
  if (channelRaw) {
    stored = all[channelRaw.toLowerCase()];
    if (!stored) {
      throw new Error(
        `Channel ${channelRaw} not found in local channel store. ` +
          "Check with: npx kite channel list",
      );
    }
  } else {
    // Pick the most recent Active session belonging to this agent
    const agentSessions = Object.values(all)
      .filter((s) => s.agentAddress.toLowerCase() === agentAddress.toLowerCase())
      .sort((a, b) => b.openedAt - a.openedAt);

    for (const s of agentSessions) {
      try {
        const ch = await client.getChannel(s.channelId);
        if (ch.status === ChannelStatus.Active) {
          stored = s;
          break;
        }
      } catch {
        // skip unreachable
      }
    }

    if (!stored) {
      throw new Error(
        "No active channel found for this agent. " +
          "Open one with: npx kite channel open --url <api>",
      );
    }
  }

  const channelId = stored.channelId;

  console.log("");
  console.log("── Resuming Channel ──────────────────────────────────────");
  console.log(`  Channel ID:  ${channelId}`);
  console.log(`  Agent:       ${agentAddress} (index ${agentIndex})`);
  console.log(`  Provider:    ${stored.provider}`);
  console.log(`  URL:         ${stored.url}`);
  console.log("");

  // Verify ownership
  const ch = await client.getChannel(channelId);
  if (ch.consumer.toLowerCase() !== agentAddress.toLowerCase()) {
    throw new Error(
      `Channel consumer is ${ch.consumer} — does not match agent ${agentAddress}. ` +
        "Use --agent-id to select the correct agent.",
    );
  }

  if (ch.status === ChannelStatus.Closed) {
    console.log(
      "  Channel is Closed — cannot resume. Open a new one with:",
    );
    console.log(`    npx kite channel open --url ${stored.url}`);
    return;
  }

  if (ch.status === ChannelStatus.SettlementPending) {
    console.log(
      "  Channel is in SettlementPending — it is being closed, not resumed.",
    );
    return;
  }

  // Re-register with the interceptor so client.fetch() routes through this channel
  client.setChannelForProvider(stored.provider, channelId);
  console.log("  Interceptor re-registered with channel.");

  console.log(`  Status:      ${channelStatusLabel(ch.status)}`);
  console.log(`  Deposit:     ${formatUnits(ch.deposit, 18)}`);
  console.log(
    `  Remaining:   ~${formatUnits(ch.deposit - ch.highestClaimedCost, 18)}`,
  );
  if (ch.expiresAt > 0) {
    const secsLeft = ch.expiresAt - Math.floor(Date.now() / 1000);
    console.log(
      `  Expires:     ${new Date(ch.expiresAt * 1000).toISOString()} (${secsLeft > 0 ? secsLeft + "s left" : "EXPIRED"})`,
    );
  }
  console.log("");
  console.log("  Channel is ready. Make calls with:");
  console.log(
    `    npx kite call --url ${stored.url} --mode channel`,
  );
  console.log("──────────────────────────────────────────────────────────");
}

// ── (extend removed — channels are one-off; open a new channel instead) ───────

async function cmdSessionExtend(_args: string[]): Promise<void> {
  console.log("  npx kite channel open --url <api>   opens a new channel.");
  console.log("  Channels cannot be extended in-place on-chain.");
}

// keep reference so TypeScript doesn't error on the removed dispatcher case
void cmdSessionExtend;

// ── Public dispatcher ─────────────────────────────────────────────────────────

export async function cmdChannels(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "open":
      return cmdChannelOpen(args.slice(1));
    case "status":
      return cmdChannelStatus(args.slice(1));
    case "close":
      return cmdChannelClose(args.slice(1));
    case "list":
      return cmdChannelList(args.slice(1));
    case "resume":
      return cmdChannelResume(args.slice(1));
    default:
      console.log("");
      console.log("Usage:");
      console.log(
        "  npx kite channel open    --url <api> [opts]      Open a payment channel",
      );
      console.log(
        "  npx kite channel list    [--agent <n>] [--filter active|all]",
      );
      console.log(
        "  npx kite channel status  [--channel <id>]        Show channel state",
      );
      console.log(
        "  npx kite channel resume  [--channel <id>]        Re-attach to existing channel",
      );
      console.log(
        "  npx kite channel close   --channel <id> [opts]   Settle & refund",
      );
      console.log("");
      console.log("Common options:");
      console.log(
        "  --agent-id <n>         Agent derivation index (default: 0)",
      );
      console.log("");
      console.log("open options:");
      console.log(
        "  --url <url>            Target API endpoint",
      );
      console.log(
        "  --max-calls <n>        Max calls channel covers (default: 100)",
      );
      console.log(
        "  --duration <secs>      Channel lifetime in seconds (default: 3600)",
      );
      console.log(
        "  --deposit <amount>     Total deposit (token units, absolute)",
      );
      console.log(
        "  --rate-per-call <n>    Per-call rate cap (token units)",
      );
      console.log("");
      console.log("close options:");
      console.log(
        "  --no-withdraw          Skip withdrawing refund to EOA after finalization",
      );
  }
}



