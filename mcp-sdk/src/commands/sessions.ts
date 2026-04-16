import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatUnits, parseUnits } from "viem";
import { findFlag, prompt } from "../cli.js";
import { KitePaymentClient } from "../client.js";
import { ChannelStatus } from "../types.js";
import { parseToken } from "../utils/index.js";
import { getKiteDir, getVar } from "../vars.js";
import { deriveAgentAccount } from "../wallet.js";

// ── Session store (~/.kite-agent-pay/sessions.json) ───────────────────────────

interface StoredSession {
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

function sessionsFile(): string {
  return join(getKiteDir(), "sessions.json");
}

function loadSessions(): Record<string, StoredSession> {
  const path = sessionsFile();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function saveSessions(sessions: Record<string, StoredSession>): void {
  writeFileSync(sessionsFile(), JSON.stringify(sessions, null, 2) + "\n", {
    mode: 0o600,
  });
}

function storeSession(session: StoredSession): void {
  const all = loadSessions();
  all[session.channelId.toLowerCase()] = session;
  saveSessions(all);
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

// ── session start ─────────────────────────────────────────────────────────────

async function cmdSessionStart(args: string[]): Promise<void> {
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
  console.log("── Starting Payment Channel Session ──────────────────────");
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
  console.log("  Opening payment channel on-chain...");
  const { txHash: openTxHash, channelId } = await client.openChannel({
    provider: offer.payTo,
    token: offer.asset,
    mode: "prepaid",
    deposit,
    maxSpend: deposit,
    maxDuration: durationSecs,
    ratePerCall,
  });

  // Step 3: persist session locally immediately after open
  storeSession({
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
  console.log(`  Saved to:      ~/.kite-agent-pay/sessions.json`);
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
    console.log(`    npx kite session status --channel ${channelId}`);
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

  // Persist first-call result alongside stored session
  const all = loadSessions();
  const key = channelId.toLowerCase();
  if (all[key]) {
    all[key].firstCallStatus = firstResp.status;
    if (firstBody !== null) all[key].firstCallBody = firstBody;
    saveSessions(all);
  }

  console.log(`  First call:    HTTP ${firstResp.status} (${elapsed}ms)`);
  if (firstBody !== null) {
    console.log(`  Response:      ${JSON.stringify(firstBody, null, 2)}`);
  }
  console.log("");
  console.log("── Session Ready ─────────────────────────────────────────");
  console.log(`  Channel ID:    ${channelId}`);
  console.log(`  Provider:      ${offer.payTo}`);
  console.log(
    `  Deposit:       ${formatUnits(deposit, tokenDecimals)} ${token?.symbol}`,
  );
  console.log(`  Status:        Active`);
  console.log("");
  console.log("  Next steps:");
  console.log(`    npx kite call --url ${url} --mode channel`);
  console.log(`    npx kite session status --channel ${channelId}`);
  console.log("──────────────────────────────────────────────────────────");
}

// ── session status ────────────────────────────────────────────────────────────

async function cmdSessionStatus(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const channelFlag = findFlag(args, "--channel") as `0x${string}` | undefined;
  const agentIndex = Number(
    findFlag(args, "--agent-id") ?? findFlag(args, "--agent") ?? "0",
  );

  const { client } = await buildAgentClient(credential, agentIndex);
  const all = loadSessions();

  // If a specific channel was requested but it's not in local store,
  // still try to look it up on-chain.
  const keys = channelFlag ? [channelFlag.toLowerCase()] : Object.keys(all);

  if (keys.length === 0) {
    console.log("");
    console.log(
      "  No sessions found. Start one with: npx kite session start --url <api>",
    );
    return;
  }

  for (const key of keys) {
    const stored = all[key];
    const channelId = (stored?.channelId ?? channelFlag) as `0x${string}`;

    console.log("");
    console.log("── Session ───────────────────────────────────────────────");

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

// ── Public dispatcher ─────────────────────────────────────────────────────────

export async function cmdSessions(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "start":
      return cmdSessionStart(args.slice(1));
    case "status":
      return cmdSessionStatus(args.slice(1));
    default:
      console.log("");
      console.log("Usage:");
      console.log(
        "  npx kite session start  --url <api> [options]   Open a payment channel",
      );
      console.log(
        "  npx kite session status [--channel <id>]        Show channel state",
      );
      console.log("");
      console.log("Options for start:");
      console.log(
        "  --url <url>            API endpoint to open the session with",
      );
      console.log(
        "  --agent-id <n>         Agent derivation index (default: 0)",
      );
      console.log(
        "  --max-calls <n>        Max calls this channel covers (default: 100)",
      );
      console.log(
        "  --duration <secs>      Channel duration in seconds (default: 3600)",
      );
      console.log(
        "  --deposit <amount>     Override total deposit (token units)",
      );
      console.log(
        "  --rate-per-call <n>    Override per-call rate cap (token units)",
      );
      console.log("  --token <symbol>       Token symbol (default: DmUSDT)");
  }
}
