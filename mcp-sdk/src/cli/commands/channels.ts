import {
  encodePacked,
  formatUnits,
  keccak256,
  parseUnits,
  recoverMessageAddress,
} from "viem";
import {
  appendCallResult,
  createChannelRecord,
  loadChannel,
  type AuditReceipt,
  type ChannelCallReceipt,
  type StoredChannel,
} from "../../channel-store.js";
import {
  getChannelById,
  getSessionByKey,
  type IndexedChannel,
} from "../../indexer.js";
import { KiteSettleClient } from "../../kite-settle-client.js";
import { ChannelStatus } from "../../types.js";
import { prompt, resolveTokenMetadata } from "../../utils/index.js";
import { deriveSessionId } from "../../utils/session-id.js";
import { getVar } from "../../vars.js";
import { findFlag } from "../index.js";

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

/** Build an EOA-level KiteSettleClient for channel management operations. */
async function buildAgentClient(credential: string): Promise<{
  client: KiteSettleClient;
  eoaAddress: string;
}> {
  const settle = await KiteSettleClient.create({
    credential,
    defaultPaymentMode: "channel",
  });
  return {
    client: settle,
    eoaAddress: settle.eoaAddress,
  };
}

function parsePagination(args: string[]): { limit: number; offset: number } {
  const limitRaw = findFlag(args, "--limit");
  const offsetRaw = findFlag(args, "--offset");

  return {
    limit: limitRaw ? Math.max(1, Number.parseInt(limitRaw, 10)) : 10,
    offset: offsetRaw ? Math.max(0, Number.parseInt(offsetRaw, 10)) : 0,
  };
}

function parseAgentIndex(args: string[]): number {
  const raw = findFlag(args, "--agent-id") ?? findFlag(args, "--agent") ?? "0";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeSessionKey(raw: string): `0x${string}` {
  return (
    raw.startsWith("0x") ? raw.toLowerCase() : `0x${raw.toLowerCase()}`
  ) as `0x${string}`;
}

async function resolveChannelWalletContract(
  client: KiteSettleClient,
  sessionKeyAddress?: `0x${string}`,
): Promise<`0x${string}` | undefined> {
  if (!sessionKeyAddress) return undefined;

  const walletContract = await client
    .getPaymentClient()
    .getContractService()
    .resolveWalletContractForSession(sessionKeyAddress);

  if (!walletContract) {
    throw new Error(
      `Unable to resolve ClientVault wallet contract for session ${sessionKeyAddress}`,
    );
  }

  return walletContract;
}

function toAgentEntityId(agentId: number): string {
  return `0x${BigInt(agentId).toString(16)}`;
}

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatIsoFromSeconds(
  unixSeconds: string | number | null | undefined,
): string {
  if (unixSeconds === null || unixSeconds === undefined) return "-";
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return new Date(n * 1000).toISOString();
}

function safeBigInt(
  value: string | number | bigint | null | undefined,
): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.max(0, Math.floor(value)));
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function indexedStatusLabel(
  status: string,
  expiresAt?: string | number | null,
): string {
  const expiresAtNum = Number(expiresAt);
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    Number.isFinite(expiresAtNum) &&
    expiresAtNum > 0 &&
    expiresAtNum < nowSec &&
    status.toUpperCase() === "ACTIVE"
  ) {
    return "Expired";
  }

  switch (status.toUpperCase()) {
    case "OPEN":
      return "Pending Activation";
    case "ACTIVE":
      return "Active";
    case "SETTLEMENT_PENDING":
      return "Settlement Pending";
    case "CLOSED":
      return "Closed";
    default:
      return status || "Unknown";
  }
}

function computeChannelSnapshot(
  indexed: IndexedChannel | null,
  cached: StoredChannel | null,
): {
  source: string;
  status: string;
  spentRaw: bigint;
  maxPerCallRaw: bigint;
  maxSpendRaw: bigint;
  durationText: string;
} {
  const hasIndexed = !!indexed;
  const hasCached = !!cached;

  const source = hasIndexed
    ? hasCached
      ? "graphql+in-memory"
      : "graphql"
    : "in-memory";

  const status = hasIndexed
    ? indexedStatusLabel(indexed.status, indexed.expiresAt)
    : "In-memory only";

  const indexedSpent = hasIndexed
    ? safeBigInt(indexed.highestClaimedCost ?? indexed.settledAmount)
    : 0n;
  const cachedSpent = hasCached ? safeBigInt(cached.cumulativeCost) : 0n;
  const spentRaw = indexedSpent > cachedSpent ? indexedSpent : cachedSpent;

  const maxPerCallRaw = hasIndexed
    ? safeBigInt(indexed.maxPerCall)
    : hasCached
      ? safeBigInt(cached.maxPerCall)
      : 0n;

  const maxSpendRaw = hasIndexed
    ? safeBigInt(indexed.maxSpend)
    : hasCached
      ? safeBigInt(cached.maxSpend)
      : 0n;

  const nowSec = Math.floor(Date.now() / 1000);

  let durationText = "-";
  if (hasIndexed) {
    const openedAt = Number(indexed.openedAt);
    const expiresAt = Number(indexed.expiresAt);
    const total = Math.max(0, expiresAt - openedAt);
    const remaining = Math.max(0, expiresAt - nowSec);
    durationText = `${formatSeconds(remaining)} remaining / ${formatSeconds(total)} total`;
  } else if (hasCached) {
    const elapsed = Math.max(
      0,
      Math.floor((Date.now() - cached.openedAt) / 1000),
    );
    const total = Math.max(0, cached.durationSecs);
    const remaining = Math.max(0, total - elapsed);
    durationText = `${formatSeconds(remaining)} remaining / ${formatSeconds(total)} total`;
  }

  return {
    source,
    status,
    spentRaw,
    maxPerCallRaw,
    maxSpendRaw,
    durationText,
  };
}

function resolveStoredMerkleRoot(channelId: `0x${string}`): `0x${string}` {
  const stored = loadChannel(channelId);
  if (!stored?.merkleRoot) {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  return stored.merkleRoot;
}

function resolveLatestStoredReceipt(
  channelId: `0x${string}`,
): ChannelCallReceipt | null {
  const stored = loadChannel(channelId);
  const latest = stored?.calls.at(-1)?.channelReceipt;
  return latest ?? null;
}

async function buildSessionClientForAgent(
  agentIndex: number,
  channelId?: `0x${string}`,
): Promise<KiteSettleClient> {
  let sessionKey: string | undefined;

  if (channelId) {
    const indexedChannel = await getChannelById(channelId).catch(() => null);
    sessionKey = indexedChannel?.session?.sessionKey;
  }

  return KiteSettleClient.create({
    agentId: BigInt(agentIndex),
    sessionKey,
    defaultPaymentMode: "channel",
    allowUnavailableSession: true,
  });
}

// ── channel open ─────────────────────────────────────────────────────────────

async function cmdChannelOpen(args: string[]): Promise<void> {
  const rawAgent = findFlag(args, "--agent-id") ?? findFlag(args, "--agent");
  if (!rawAgent) {
    throw new Error(
      "--agent <id> (or --agent-id <id>) is required for channel open.",
    );
  }
  const agentIndex = Number.parseInt(rawAgent, 10);
  if (!Number.isFinite(agentIndex) || agentIndex < 0) {
    throw new Error("--agent must be a non-negative integer.");
  }
  const sessionRaw =
    findFlag(args, "--session") ??
    findFlag(args, "--session-key") ??
    findFlag(args, "--key");
  if (!sessionRaw) {
    throw new Error(
      "--session <sessionKey> is required for channel open (agent/session mode).",
    );
  }
  const sessionKey = normalizeSessionKey(sessionRaw);

  const urlFlag = findFlag(args, "--url");
  const url = urlFlag || (await prompt("Enter API URL: "));
  const maxCalls = Number(findFlag(args, "--max-calls") ?? "100");
  const durationSecs = Number(findFlag(args, "--duration") ?? "3600");
  const depositFlag = findFlag(args, "--deposit");
  const ratePerCallFlag = findFlag(args, "--rate-per-call");
  const tokenFlag = findFlag(args, "--token");

  const token = await resolveTokenMetadata(tokenFlag ?? "DmUSDT");
  const tokenDecimals = token?.decimals ?? 18;

  const client = await KiteSettleClient.create({
    agentId: BigInt(agentIndex),
    sessionKey,
    defaultPaymentMode: "channel",
  });
  const sessionKeyAddress =
    (client.sessionKeyAddress as `0x${string}` | undefined) ?? sessionKey;
  const eoaAddress = client.eoaAddress;

  const contract = client.getPaymentClient().getContractService();
  const [active, , , , , maxValueAllowed, validUntil] =
    (await contract.validateSession(sessionKey)) as any;
  if (!active) {
    throw new Error(`Session ${sessionKey} is not active.`);
  }

  let validUntilBigint: bigint;
  try {
    validUntilBigint = BigInt(validUntil);
  } catch {
    const indexedSessionForWindow = await getSessionByKey(sessionKey).catch(
      () => null,
    );
    if (!indexedSessionForWindow) {
      throw new Error(
        `Session ${sessionKey} has invalid validUntil from validateSession and cannot be resolved from indexer.`,
      );
    }
    validUntilBigint = BigInt(indexedSessionForWindow.validUntil);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const remainingSeconds = Math.max(0, Number(validUntilBigint) - nowSec);
  if (remainingSeconds <= 0) {
    throw new Error(`Session ${sessionKey} is expired.`);
  }

  console.log("");
  console.log("── Opening Payment Channel ───────────────────────────────");
  console.log(`  EOA:      ${eoaAddress}`);
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

  const offers = parsed.accepts as
    | Array<{
        payTo: `0x${string}`;
        asset: `0x${string}`;
        maxAmountRequired: string;
        maxRatePerCall?: string;
        scheme: string;
        description?: string;
        merchantName?: string;
        resource?: string;
      }>
    | undefined;
  if (!offers || offers.length === 0)
    throw new Error("402 response is missing accepts[]");

  const preferredAsset = token?.address.toLowerCase();
  const scopedOffers = preferredAsset
    ? offers.filter(
        (candidate) => candidate.asset.toLowerCase() === preferredAsset,
      )
    : offers;
  const offer =
    [...scopedOffers].sort((a, b) => {
      const aAmount = BigInt(a.maxAmountRequired);
      const bAmount = BigInt(b.maxAmountRequired);
      if (aAmount < bAmount) return -1;
      if (aAmount > bAmount) return 1;
      return 0;
    })[0] ?? offers[0];

  // Provider may declare maxRatePerCall in the 402 offer (the highest
  // per-call price any of their endpoints can charge). Use that as the
  // maxPerCall ceiling, falling back to the probed price or user override.
  const providerMaxRatePerCall: string | undefined = offer.maxRatePerCall;
  const maxPerCall = ratePerCallFlag
    ? parseUnits(ratePerCallFlag, tokenDecimals)
    : providerMaxRatePerCall
      ? BigInt(providerMaxRatePerCall)
      : BigInt(offer.maxAmountRequired);
  const deposit = depositFlag
    ? parseUnits(depositFlag, tokenDecimals)
    : maxPerCall * BigInt(maxCalls);
  const walletContractForSpending = await resolveChannelWalletContract(
    client,
    sessionKeyAddress,
  );
  if (!walletContractForSpending) {
    throw new Error(
      `Unable to resolve ClientVault wallet contract for session ${sessionKeyAddress}`,
    );
  }

  // Try to get spending rules from ClientVault (preferred method for accurate spending capacity)
  // Fall back to using maxValueAllowed from validateSession if spending rules are not available
  let remainingCapacity: bigint;

  try {
    // Fetch session from indexer to get the agentId and validUntil for deriving sessionId
    const indexedSession = await getSessionByKey(sessionKey).catch(() => null);
    if (!indexedSession) {
      throw new Error("Session not found in indexer");
    }

    // Derive the proper sessionId using agent ID and validUntil (required for spending rules lookup)
    const agentIdBigint = BigInt(indexedSession.agent.agentId);
    const validUntilBigint = BigInt(indexedSession.validUntil);
    const derivedSessionId = deriveSessionId(
      sessionKeyAddress,
      agentIdBigint,
      validUntilBigint,
    );

    // Get spending rules from ClientVault for this session
    const spendingRules = await contract.getVaultSpendingRules(
      walletContractForSpending,
      derivedSessionId,
    );

    if (spendingRules && spendingRules.length > 0) {
      const currentRule = spendingRules[0];
      const totalBudget = currentRule.rule.budget;
      const totalSpent = currentRule.usage.amountUsed;
      remainingCapacity =
        totalBudget > totalSpent ? totalBudget - totalSpent : 0n;
      console.log(
        `  Session spend:   ${formatUnits(totalSpent, tokenDecimals)}/${formatUnits(totalBudget, tokenDecimals)} ${token?.symbol}`,
      );
    } else {
      throw new Error("No spending rules found");
    }
  } catch {
    remainingCapacity = maxValueAllowed;
    console.log(
      `  Session spend:   using max session limit ${formatUnits(maxValueAllowed, tokenDecimals)} ${token?.symbol}`,
    );
  }
  if (remainingCapacity <= 0n) {
    throw new Error(
      `Session ${sessionKey} has no remaining capacity for opening a channel.`,
    );
  }
  const effectiveDeposit =
    deposit > remainingCapacity ? remainingCapacity : deposit;
  const effectiveDuration = Math.min(durationSecs, remainingSeconds);

  console.log(`  Provider:      ${offer.payTo}`);
  console.log(
    `  Max/call cap:  ${formatUnits(maxPerCall, tokenDecimals)} ${token?.symbol}`,
  );
  if (ratePerCallFlag) {
    console.log(
      `  (probe price was ${formatUnits(BigInt(offer.maxAmountRequired), tokenDecimals)} — overridden)`,
    );
  }
  console.log(`  Max calls:     ${maxCalls}`);
  console.log(`  Duration:      ${effectiveDuration}s`);
  console.log(
    `  Total deposit: ${formatUnits(effectiveDeposit, tokenDecimals)} ${token?.symbol}`,
  );
  if (effectiveDuration < durationSecs) {
    console.log(
      `  Session window cap applied: requested ${durationSecs}s, using ${effectiveDuration}s`,
    );
  }
  if (effectiveDeposit < deposit) {
    console.log(
      `  Session capacity cap applied: requested ${formatUnits(deposit, tokenDecimals)}, using ${formatUnits(effectiveDeposit, tokenDecimals)} ${token?.symbol}`,
    );
  }
  console.log("");

  // Step 2: open channel on-chain via AA batch (prepaid mode = 0)
  console.log(`  Wallet:       ${walletContractForSpending}`);
  console.log("  Opening payment channel on-chain (via ClientVault batch)...");
  const { txHash: openTxHash, channelId } =
    await contract.openChannelViaVaultBatch(
      sessionKeyAddress,
      walletContractForSpending,
      offer.payTo,
      offer.asset,
      0,
      effectiveDeposit,
      effectiveDeposit,
      effectiveDuration,
      maxPerCall,
    );

  if (!channelId) {
    throw new Error(
      `Channel open transaction submitted (${openTxHash}) but no channelId was returned`,
    );
  }

  // Step 3: persist channel in per-channel store immediately
  createChannelRecord({
    channelId,
    provider: offer.payTo,
    token: offer.asset,
    openUrl: url,
    agentAddress: eoaAddress,
    agentIndex,
    maxPerCall: maxPerCall.toString(),
    deposit: effectiveDeposit.toString(),
    maxSpend: effectiveDeposit.toString(),
    durationSecs: effectiveDuration,
    openedAt: Date.now(),
    openTxHash,
    providerMaxRatePerCall,
  });

  console.log(`  Channel ID:    ${channelId}`);
  console.log(`  Open tx:       ${openTxHash}`);
  console.log(`  Explorer:      https://testnet.kitescan.ai/tx/${openTxHash}`);
  console.log(`  Status:        Pending Activation`);
  console.log(`  Saved to:      ~/.kite-agent-pay/channels/${channelId}.json`);
  console.log("");

  // Step 4: wait for provider activation
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
    console.log("  You can make calls once active with:");
    console.log(
      `    npx kite channel call --channel ${channelId} --url <endpoint>`,
    );
    console.log("──────────────────────────────────────────────────────────");
    return;
  }

  console.log("  Channel is Active.");
  console.log("");
  console.log("── Channel Ready ─────────────────────────────────────");
  console.log(`  Channel ID:    ${channelId}`);
  console.log(`  Provider:      ${offer.payTo}`);
  console.log(
    `  Deposit:       ${formatUnits(deposit, tokenDecimals)} ${token?.symbol}`,
  );
  console.log(`  Status:        Active`);
  console.log("");
  console.log("  Make calls on any provider endpoint with:");
  console.log(
    `    npx kite channel call --channel ${channelId} --url <endpoint>`,
  );
  console.log(
    `    npx kite channel call --channel ${channelId} --url <other-endpoint>`,
  );
  console.log(`    npx kite channel status --channel ${channelId}`);
  console.log("──────────────────────────────────────────────────────────");
}

// ── channel status ────────────────────────────────────────────────────────────

async function cmdChannelStatus(args: string[]): Promise<void> {
  const channelFlag =
    findFlag(args, "--channel") ?? (await prompt("Enter channel ID:"));

  const client = KiteSettleClient.createReadOnly();

  if (!channelFlag) {
    console.log("");
    console.log("── Channel Status ────────────────────────────────────────");
    console.log(
      "  No channel ID provided. Use --channel <id> to view a specific channel, or provide an agent ID to list all channels for that agent.",
    );
    console.log("──────────────────────────────────────────────────────────");
    return;
  }

  const ch = await client.getChannelInfo(channelFlag);

  if (!ch) {
    console.log("");
    console.log(`  Channel ${channelFlag} not found in indexer.`);
    return;
  }

  const maxSpendBig = safeBigInt(ch.maxSpend);
  const settledBig = safeBigInt(ch.settledAmount);
  const maxPerCallBig = safeBigInt(ch.maxPerCall);
  const callsRemaining =
    maxPerCallBig > 0n
      ? (maxSpendBig > settledBig ? maxSpendBig - settledBig : 0n) /
        maxPerCallBig
      : null;

  const openedAtNum = Number(ch.openedAt);
  const expiresAtNum = Number(ch.expiresAt);
  const nowSec = Math.floor(Date.now() / 1000);
  const totalDuration = Math.max(0, expiresAtNum - openedAtNum);
  const remaining = Math.max(0, expiresAtNum - nowSec);
  const durationText = `${formatSeconds(remaining)} remaining / ${formatSeconds(totalDuration)} total`;

  console.log("");
  console.log("── Channel Status ────────────────────────────────────────");
  console.log(`  Channel ID:      ${ch.channelId.toLowerCase()}`);
  console.log(`  Status:          ${ch.status}`);
  console.log(`  Provider:        ${ch.provider}`);
  console.log(`  Settled:         ${ch.settledAmountFormatted}`);
  console.log(`  Deposit:         ${ch.depositFormatted}`);
  console.log(`  Max spend:       ${ch.maxSpendFormatted}`);
  console.log(`  Max/call:        ${ch.maxPerCallFormatted}`);
  console.log(
    `  Calls remaining: ${callsRemaining === null ? "n/a" : callsRemaining.toString()}`,
  );
  console.log(`  Duration:        ${durationText}`);
  console.log(`  Opened at:       ${formatIsoFromSeconds(ch.openedAt)}`);
  console.log(`  Expires at:      ${formatIsoFromSeconds(ch.expiresAt)}`);
  if (ch.settlementDeadline) {
    const deadline = Number(ch.settlementDeadline);
    if (deadline > 0) {
      const challengeState =
        nowSec <= deadline
          ? `open (${formatSeconds(deadline - nowSec)} left)`
          : "closed (finalizable)";
      console.log(
        `  Settlement by:   ${formatIsoFromSeconds(ch.settlementDeadline)} (${challengeState})`,
      );
    }
  }
  console.log("──────────────────────────────────────────────────────────");
}

async function cmdChannelClose(args: string[]): Promise<void> {
  const channelRaw =
    findFlag(args, "--channel") || (await prompt("Enter channel ID: "));
  const channelId = channelRaw.trim() as `0x${string}`;
  const agentIndex = parseAgentIndex(args);
  const client = await buildSessionClientForAgent(agentIndex, channelId);
  const contract = client.getPaymentClient().getContractService();
  const sessionKeyAddress = client.sessionKeyAddress as
    | `0x${string}`
    | undefined;
  const merkleRoot = resolveStoredMerkleRoot(channelId);
  const latestReceipt = resolveLatestStoredReceipt(channelId);

  console.log("");
  console.log("── Closing Payment Channel (Agent) ───────────────────────");
  console.log(`  Channel ID:  ${channelId}`);
  console.log(`  Agent ID:    ${agentIndex}`);
  console.log(`  Signer:      ${client.address}`);
  console.log("");

  console.log("  Fetching on-chain channel state...");
  const ch = await client.getChannel(channelId);

  if (ch.status === ChannelStatus.Closed) {
    console.log("  Channel is already Closed.");
    return;
  }

  console.log(`  Status:      ${channelStatusLabel(ch.status)}`);
  console.log(`  Provider:    ${ch.provider}`);
  console.log(`  Deposit:     ${formatUnits(ch.deposit, 18)} (total locked)`);
  console.log(`  Settled:     ${formatUnits(ch.settledAmount, 18)}`);
  console.log(`  Merkle root: ${merkleRoot}`);
  console.log("");

  if (ch.status === ChannelStatus.SettlementPending) {
    const state = await client.getSettlementState(channelId);
    console.log("  Settlement already pending.");
    if (state.deadline > 0) {
      console.log(
        `  Settlement deadline: ${new Date(state.deadline * 1000).toISOString()}`,
      );
    }
    console.log("  Use: npx kite channel status --channel <id>");
    console.log("──────────────────────────────────────────────────────────");
    return;
  }

  console.log("  Initiating settlement on-chain...");
  let settleTxHash: string | undefined;
  const sequenceNumber = latestReceipt?.sequenceNumber ?? 0;
  const cumulativeCost = latestReceipt
    ? BigInt(latestReceipt.cumulativeCost)
    : 0n;
  const timestamp = latestReceipt?.timestamp ?? 0;
  const providerSignature =
    latestReceipt?.providerSignature ?? ("0x" as `0x${string}`);

  let usedAaClose = false;
  let usedReceiptClaim = !!latestReceipt;
  if (sessionKeyAddress) {
    const walletContractForSettlement = await resolveChannelWalletContract(
      client,
      sessionKeyAddress,
    ).catch(() => undefined);

    if (walletContractForSettlement) {
      try {
        settleTxHash = await contract.initiateSettlementViaVaultAA(
          sessionKeyAddress,
          walletContractForSettlement,
          channelId,
          sequenceNumber,
          cumulativeCost,
          timestamp,
          providerSignature,
          merkleRoot,
        );
        usedAaClose = true;
      } catch (aaErr: any) {
        const reason = aaErr?.message ?? String(aaErr);
        console.log(`  AA close path failed (${reason}).`);

        if (latestReceipt) {
          try {
            console.log(
              "  Retrying AA close with zero-claim settlement (no local receipt claim)...",
            );
            settleTxHash = await contract.initiateSettlementViaVaultAA(
              sessionKeyAddress,
              walletContractForSettlement,
              channelId,
              0,
              0n,
              0,
              "0x" as `0x${string}`,
              merkleRoot,
            );
            usedAaClose = true;
            usedReceiptClaim = false;
          } catch (aaZeroErr: any) {
            const zeroReason = aaZeroErr?.message ?? String(aaZeroErr);
            console.log(
              `  AA zero-claim close also failed (${zeroReason}). Falling back...`,
            );
          }
        } else {
          console.log("  Falling back...");
        }
      }
    }
  }

  if (!usedAaClose) {
    if (latestReceipt) {
      settleTxHash = await client.initiateSettlementWithReceipt(
        channelId,
        latestReceipt.sequenceNumber,
        BigInt(latestReceipt.cumulativeCost),
        latestReceipt.timestamp,
        latestReceipt.providerSignature,
        merkleRoot,
      );
      usedReceiptClaim = true;
    } else {
      settleTxHash = await client.initiateSettlement(channelId, merkleRoot);
      usedReceiptClaim = false;
    }
  }

  if (!settleTxHash) {
    throw new Error("Failed to initiate settlement.");
  }

  if (usedReceiptClaim && latestReceipt) {
    console.log(
      `  Claimed with receipt: seq=${latestReceipt.sequenceNumber} cumulative=${latestReceipt.cumulativeCost}`,
    );
  } else {
    console.log("  No local receipt found. Initiated with zero claim.");
  }
  if (usedAaClose) {
    console.log("  Settlement submitted via AA wallet (gasless path).");
  }

  const state = await client.getSettlementState(channelId);
  const deadlineText =
    state.deadline > 0
      ? new Date(state.deadline * 1000).toISOString()
      : "(pending state update)";

  console.log(`  Settlement tx:  ${settleTxHash}`);
  console.log(
    `  Explorer:       https://testnet.kitescan.ai/tx/${settleTxHash}`,
  );
  console.log(`  Settlement by:  ${deadlineText}`);
  console.log("  Background wait is non-blocking.");
  console.log("  Track with:     npx kite channel status --channel <id>");
  console.log("");

  console.log("── Settlement Initiated ─────────────────────────────────");
  console.log(`  Channel ID:  ${channelId}`);
  console.log(`  Provider:    ${ch.provider}`);
  console.log("  Finalize after challenge window with: ");
  console.log(`    npx kite channel finalize --channel ${channelId}`);
  console.log("──────────────────────────────────────────────────────────");
}

async function cmdChannelForceClose(args: string[]): Promise<void> {
  const channelFlag = findFlag(args, "--channel") as `0x${string}` | undefined;
  const sessionKeyRaw =
    findFlag(args, "--session") ??
    findFlag(args, "--session-key") ??
    findFlag(args, "--key");
  const sessionKey = sessionKeyRaw
    ? normalizeSessionKey(sessionKeyRaw)
    : undefined;
  const agentRaw = findFlag(args, "--agent-id") ?? findFlag(args, "--agent");
  const agentIndex = agentRaw ? Number.parseInt(agentRaw, 10) : 0;

  if (!channelFlag && !sessionKeyRaw && !agentRaw) {
    console.log("");
    console.log("Usage:");
    console.log(
      "  npx kite channel finalize --channel <id>               Finalize one channel",
    );
    console.log(
      "  npx kite channel finalize --session <key>              Finalize all session channels",
    );
    console.log(
      "  npx kite channel finalize --agent <n>                  Finalize all agent channels",
    );
    console.log("");
    console.log(
      "  Channels with a pending settlement past the challenge window are finalized.",
    );
    console.log(
      "  Expired open channels are finalized after settlement window",
    );
    console.log("");
    return;
  }

  console.log("");
  console.log("── Finalizing Channel(s) ─────────────────────────────────");
  if (channelFlag) console.log(`  Channel:   ${channelFlag}`);
  if (sessionKey) console.log(`  Session:   ${sessionKey}`);
  if (agentRaw) console.log(`  Agent:     ${agentIndex}`);
  console.log("  Path:      AA wallet (gasless)");
  console.log("");

  const results = await KiteSettleClient.finalizeChannels({
    channelId: channelFlag,
    sessionKey,
    agentId: agentRaw ? BigInt(agentIndex) : undefined,
  });

  if (results.length === 0) {
    console.log("  No channels eligible for finalization.");
    console.log("──────────────────────────────────────────────────────────");
    return;
  }

  for (const result of results) {
    console.log(`  Channel: ${result.channelId}`);
    switch (result.status) {
      case "success":
        console.log(`  Status:  ${result.message ?? "Done"}`);
        if (result.txHash) {
          console.log(`  Tx hash: ${result.txHash}`);
          console.log(
            `  Explorer: https://testnet.kitescan.ai/tx/${result.txHash}`,
          );
        }
        break;
      case "already_closed":
        console.log("  Status:  Already closed");
        break;
      case "error":
        console.log(`  Status:  Error — ${result.message}`);
        break;
      default:
        console.log(`  Status:  ${result.status}`);
    }
    console.log("");
  }

  console.log("  Track with: npx kite channel status --channel <id>");
  console.log("──────────────────────────────────────────────────────────");
}

// ── channel settle ────────────────────────────────────────────────────────────
/**
 * Initiate settlement for one or more channels using the SDK's `initiateSettlements`.
 *
 * Identifier precedence: channelId > sessionKey > agentId.
 * Without --channel, only expired channels are settled (use --force-active-close to include active).
 */
async function cmdChannelSettle(args: string[]): Promise<void> {
  const channelFlag = findFlag(args, "--channel") as `0x${string}` | undefined;
  const sessionKeyRaw =
    findFlag(args, "--session") ??
    findFlag(args, "--session-key") ??
    findFlag(args, "--key");
  const sessionKey = sessionKeyRaw
    ? normalizeSessionKey(sessionKeyRaw)
    : undefined;
  const agentRaw = findFlag(args, "--agent-id") ?? findFlag(args, "--agent");
  const agentIndex = agentRaw ? Number.parseInt(agentRaw, 10) : 0;
  const forceActiveClose = args.includes("--force-active-close");

  if (!channelFlag && !sessionKeyRaw && !agentRaw) {
    console.log("");
    console.log("Usage:");
    console.log(
      "  npx kite channel settle --channel <id>                      Settle one channel",
    );
    console.log(
      "  npx kite channel settle --session <key> [--force-active-close]",
    );
    console.log(
      "  npx kite channel settle --agent <n>    [--force-active-close]",
    );
    console.log("");
    return;
  }

  console.log("");
  console.log("── Initiating Channel Settlement ─────────────────────────");
  if (channelFlag) console.log(`  Channel:   ${channelFlag}`);
  if (sessionKey) console.log(`  Session:   ${sessionKey}`);
  if (agentRaw) console.log(`  Agent:     ${agentIndex}`);
  console.log(
    `  Mode:      ${forceActiveClose ? "All channels (--force-active-close)" : "Expired channels only"}`,
  );
  console.log("");

  const results = await KiteSettleClient.initiateSettlements(
    {
      channelId: channelFlag,
      sessionKey,
      agentId: agentRaw ? BigInt(agentIndex) : undefined,
    },
    { forceActiveClose },
  );

  if (results.length === 0) {
    console.log("  No channels eligible for settlement.");
    if (!forceActiveClose) {
      console.log(
        "  (Pass --force-active-close to include non-expired channels)",
      );
    }
    console.log("──────────────────────────────────────────────────────────");
    return;
  }

  for (const result of results) {
    console.log(`  Channel: ${result.channelId}`);
    switch (result.status) {
      case "success":
        console.log("  Status:  Settlement initiated");
        if (result.txHash) {
          console.log(`  Tx hash: ${result.txHash}`);
          console.log(
            `  Explorer: https://testnet.kitescan.ai/tx/${result.txHash}`,
          );
        }
        if (result.settlementDeadline) {
          console.log(`  Deadline: ${result.settlementDeadline}`);
        }
        console.log(
          `  Path:     ${result.usedAaPath ? "AA wallet (gasless)" : "Direct EOA"}`,
        );
        console.log(
          `  Claim:    ${result.usedReceiptClaim ? "With provider receipt" : "Zero claim (no local receipt)"}`,
        );
        break;
      case "already_pending":
        console.log("  Status:  Settlement already pending");
        if (result.settlementDeadline) {
          console.log(`  Deadline: ${result.settlementDeadline}`);
        }
        break;
      case "already_closed":
        console.log("  Status:  Already closed");
        break;
      case "error":
        console.log(`  Status:  Error — ${result.message}`);
        break;
    }
    console.log("");
  }

  console.log("  Track with: npx kite channel status --channel <id>");
  console.log(
    "  Finalize after challenge window with: npx kite channel finalize --channel <id>",
  );
  console.log("──────────────────────────────────────────────────────────");
}

// ── channel list ─────────────────────────────────────────────────────────────
async function cmdChannelList(args: string[]): Promise<void> {
  const { limit, offset } = parsePagination(args);
  const filter = (findFlag(args, "--filter") ?? "all").toLowerCase();
  const sessionKeyRaw =
    findFlag(args, "--session") ??
    findFlag(args, "--session-key") ??
    findFlag(args, "--key");
  const agentRaw = findFlag(args, "--agent-id") ?? findFlag(args, "--agent");

  if (!sessionKeyRaw && !agentRaw) {
    console.log("");
    console.log("  Error: at least one of --agent or --session is required.");
    console.log("  Usage:");
    console.log("    npx kite channel list --agent <id> [--filter active]");
    console.log("    npx kite channel list --session <key> [--filter active]");
    return;
  }

  const client = KiteSettleClient.createReadOnly();
  let channels: Awaited<ReturnType<typeof client.listChannels>>;
  let label: string;

  if (sessionKeyRaw) {
    // Session key takes precedence over agentId when both are given
    const sessionKey = normalizeSessionKey(sessionKeyRaw);
    channels = await client
      .listChannelsBySession(sessionKey, { limit, offset })
      .catch((err: Error) => {
        throw new Error(`Failed to query channels for session: ${err.message}`);
      });
    label = `session ${sessionKey}`;
  } else {
    const agentIndex = parseAgentIndex(args);
    channels = await client
      .listChannels(agentIndex, { limit, offset })
      .catch((err: Error) => {
        throw new Error(
          `Failed to query channels from indexer: ${err.message}`,
        );
      });
    label = `agent ${agentIndex} (${toAgentEntityId(agentIndex)})`;
  }

  const visible =
    filter === "active"
      ? channels.filter((ch) => ch.status.toLowerCase() === "active")
      : channels;

  if (visible.length === 0) {
    console.log("");
    console.log(
      `  No${filter === "active" ? " active" : ""} channels found for ${label}.`,
    );
    return;
  }

  const headers = ["Channel ID", "Status", "Provider", "Deposit", "Max/Call"];
  const rows = visible.map((ch) => ({
    channelId: ch.channelId.toLowerCase(),
    status: ch.status,
    provider: ch.provider,
    deposit: ch.depositFormatted,
    maxPerCall: ch.maxPerCallFormatted,
  }));
  const widths = [
    Math.max(headers[0].length, ...rows.map((r) => r.channelId.length)),
    Math.max(headers[1].length, ...rows.map((r) => r.status.length)),
    Math.max(headers[2].length, ...rows.map((r) => r.provider.length)),
    Math.max(headers[3].length, ...rows.map((r) => r.deposit.length)),
    Math.max(headers[4].length, ...rows.map((r) => r.maxPerCall.length)),
  ];
  const pad = (value: string, width: number) => value.padEnd(width, " ");

  const pageInfo =
    channels.length < limit
      ? `${offset + 1}-${offset + channels.length} (all results in this page)`
      : `${offset + 1}-${offset + channels.length}  (pass --offset ${offset + limit} for next page)`;

  console.log("");
  console.log(`  Channels for ${label}`);
  console.log(`  Showing: ${pageInfo}`);
  if (filter === "active") console.log("  Filter: active only");
  console.log("");
  console.log(
    `  ${pad(headers[0], widths[0])}  ${pad(headers[1], widths[1])}  ${pad(headers[2], widths[2])}  ${pad(headers[3], widths[3])}  ${pad(headers[4], widths[4])}`,
  );
  console.log(
    `  ${"-".repeat(widths[0])}  ${"-".repeat(widths[1])}  ${"-".repeat(widths[2])}  ${"-".repeat(widths[3])}  ${"-".repeat(widths[4])}`,
  );
  for (const row of rows) {
    console.log(
      `  ${pad(row.channelId, widths[0])}  ${pad(row.status, widths[1])}  ${pad(row.provider, widths[2])}  ${pad(row.deposit, widths[3])}  ${pad(row.maxPerCall, widths[4])}`,
    );
  }
  console.log("");
  console.log(`  Returned: ${visible.length} channel(s)`);
}

// ── channel call ─────────────────────────────────────────────────────────────
/**
 * Make a single API call on an existing payment channel.
 * Appends the receipts to the channel's local Merkle receipt tree.
 *
 * Usage:
 *   npx kite channel call --channel <id> --url <endpoint> [--body <json>]
 */
async function cmdChannelCall(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const channelRaw = findFlag(args, "--channel");
  if (!channelRaw) throw new Error("--channel <id> is required");
  const channelId = channelRaw.trim() as `0x${string}`;

  const url = findFlag(args, "--url");
  if (!url) throw new Error("--url <endpoint> is required");

  const bodyRaw = findFlag(args, "--body");
  const method =
    findFlag(args, "--method")?.toUpperCase() ?? (bodyRaw ? "POST" : "GET");

  const stored = loadChannel(channelId);
  if (!stored) {
    throw new Error(
      `Channel ${channelId} not found in local store. ` +
        "Check with: npx kite channel list",
    );
  }

  console.log("");
  console.log("── Channel Call ──────────────────────────────────────────");
  console.log(`  Channel:   ${channelId}`);
  console.log(`  URL:       ${url}`);
  console.log(`  Seq #:     ${stored.callCount + 1}`);
  console.log("");

  // Build headers — include last channel receipt if available
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Payment-Mode": "channel",
    "X-Channel-Id": channelId,
    "X-Sequence-Number": String(stored.callCount + 1),
  };

  if (stored.calls.length > 0) {
    const last = stored.calls.at(-1)?.channelReceipt;
    if (!last) {
      throw new Error("Missing latest receipt state for this channel.");
    }
    headers["X-Prev-Cumulative-Cost"] = last.cumulativeCost;
    headers["X-Prev-Provider-Sig"] = last.providerSignature;
  }

  const fetchInit: RequestInit = { method, headers };
  if (bodyRaw && method !== "GET") {
    fetchInit.body = bodyRaw;
  }

  const t0 = Date.now();
  const resp = await globalThis.fetch(url, fetchInit);
  const elapsed = Date.now() - t0;

  // Extract response body first (stream routes return channelReceipt in JSON)
  let responseBody: any = null;
  let auditReceiptRaw: any = null;
  try {
    responseBody = await resp.json();
    auditReceiptRaw = responseBody?.__auditReceipt ?? null;
    if (auditReceiptRaw) {
      delete responseBody.__auditReceipt;
    }
  } catch {
    /* non-JSON response */
  }

  console.log(`  HTTP:      ${resp.status} (${elapsed}ms)`);
  if (responseBody !== null) {
    console.log(`  Response:  ${JSON.stringify(responseBody, null, 2)}`);
  }

  // Accept both legacy header names and stream channel header names.
  const seqStr =
    resp.headers.get("X-Sequence-Number") ??
    resp.headers.get("X-Channel-Receipt-Seq") ??
    (responseBody?.channelReceipt?.sequenceNumber != null
      ? String(responseBody.channelReceipt.sequenceNumber)
      : null);
  const cumCostStr =
    resp.headers.get("X-Cumulative-Cost") ??
    resp.headers.get("X-Channel-Cumulative-Cost") ??
    responseBody?.channelReceipt?.cumulativeCost ??
    null;
  const providerSig = (resp.headers.get("X-Provider-Signature") ??
    resp.headers.get("X-Channel-Receipt-Sig") ??
    responseBody?.channelReceipt?.providerSignature ??
    null) as `0x${string}` | null;
  const timestampHeader =
    resp.headers.get("X-Channel-Receipt-Timestamp") ??
    (responseBody?.channelReceipt?.timestamp != null
      ? String(responseBody.channelReceipt.timestamp)
      : null);

  if (!seqStr || !cumCostStr || !providerSig) {
    console.log("");
    console.log(
      "  Warning: provider did not return full receipt headers/body — receipts not recorded.",
    );
    console.log("──────────────────────────────────────────────────────────");
    return;
  }

  // Derive call cost when provider only returns cumulative cost.
  const previousCumulativeCost =
    stored.calls.length > 0
      ? BigInt(
          stored.calls[stored.calls.length - 1]!.channelReceipt.cumulativeCost,
        )
      : 0n;
  const currentCumulativeCost = BigInt(cumCostStr);
  const callCostStr =
    currentCumulativeCost > previousCumulativeCost
      ? (currentCumulativeCost - previousCumulativeCost).toString()
      : "0";

  // Stream routes usually omit __auditReceipt; synthesize deterministic hashes.
  if (!auditReceiptRaw) {
    const requestHash = keccak256(
      encodePacked(
        ["string", "string", "string"],
        [method, url, bodyRaw ?? ""],
      ),
    );
    const responseHash = keccak256(
      encodePacked(
        ["string"],
        [JSON.stringify(responseBody?.data ?? responseBody ?? null)],
      ),
    );

    auditReceiptRaw = {
      requestHash,
      responseHash,
      providerSignature: providerSig,
    };
  }

  const channelReceipt: ChannelCallReceipt = {
    channelId,
    sequenceNumber: Number(seqStr),
    callCost: callCostStr,
    cumulativeCost: cumCostStr,
    timestamp: timestampHeader
      ? Number(timestampHeader)
      : Math.floor(Date.now() / 1000),
    providerSignature: providerSig,
  };

  const auditReceipt: AuditReceipt = {
    url,
    requestHash: auditReceiptRaw.requestHash,
    responseHash: auditReceiptRaw.responseHash,
    providerEIP712Signature: auditReceiptRaw.providerSignature,
  };

  // Verify channel receipt signature
  const receiptHash = keccak256(
    encodePacked(
      ["bytes32", "uint256", "uint256", "uint256"],
      [
        channelId,
        BigInt(channelReceipt.sequenceNumber),
        BigInt(channelReceipt.cumulativeCost),
        BigInt(channelReceipt.timestamp),
      ],
    ),
  );
  const recoveredProvider = await recoverMessageAddress({
    message: { raw: receiptHash },
    signature: providerSig,
  });
  if (recoveredProvider.toLowerCase() !== stored.provider.toLowerCase()) {
    throw new Error(
      `Provider signature mismatch! Expected ${stored.provider} but recovered ${recoveredProvider}. ` +
        "Refusing to record receipt.",
    );
  }

  const updated = appendCallResult(channelId, channelReceipt, auditReceipt);

  console.log("");
  console.log("── Receipt Recorded ──────────────────────────────────────");
  console.log(`  Seq #:       ${channelReceipt.sequenceNumber}`);
  console.log(`  Call cost:   ${callCostStr} (base units)`);
  console.log(`  Cumulative:  ${cumCostStr} (base units)`);
  console.log(`  Leaf hash:   ${updated.leaves.at(-1)}`);
  console.log(`  Merkle root: ${updated.merkleRoot}`);
  console.log(`  Total calls: ${updated.callCount}`);
  console.log("──────────────────────────────────────────────────────────");
}

// ── Public dispatcher ─────────────────────────────────────────────────────────
export async function cmdChannels(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "open":
      return cmdChannelOpen(args.slice(1));
    case "call":
      return cmdChannelCall(args.slice(1));
    case "status":
      return cmdChannelStatus(args.slice(1));
    case "close":
      return cmdChannelClose(args.slice(1));
    case "settle":
      return cmdChannelSettle(args.slice(1));
    case "finalize":
      return cmdChannelForceClose(args.slice(1));
    case "list":
      return cmdChannelList(args.slice(1));
    default:
      console.log("");
      console.log("Usage:");
      console.log(
        "  npx kite channel open    --url <api> [opts]      Open a payment channel",
      );
      console.log(
        "  npx kite channel call    --channel <id> --url <endpoint>  Make a call on an existing channel",
      );
      console.log(
        "  npx kite channel list    [--agent <n>] [--filter active|all] [--limit <n>] [--offset <n>] [--include-cache]",
      );
      console.log(
        "  npx kite channel status  [--channel <id>] [--agent <n>] [--limit <n>] [--offset <n>] [--include-cache]",
      );
      console.log(
        "  npx kite channel resume  [--channel <id>]        Re-attach to existing channel",
      );
      console.log(
        "  npx kite channel close   --channel <id> [--agent <n>]   Initiate settlement (agent/session)",
      );
      console.log(
        "  npx kite channel settle  [--channel <id>] [--session <key>] [--agent <n>] [--force-active-close]  Settle one or more channels",
      );
      console.log(
        "  npx kite channel finalize --channel <id>         finalize expired or finalize (EOA)",
      );
      console.log("");
      console.log("Common options:");
      console.log(
        "  --agent-id <n>         Agent derivation index (default: 0)",
      );
      console.log(
        "  --limit <n>            Page size for indexed channel reads (default: 10)",
      );
      console.log(
        "  --offset <n>           Result offset for indexed channel reads (default: 0)",
      );
      console.log(
        "  --include-cache        Merge local in-memory channel state with indexed data",
      );
      console.log("");
      console.log("open options:");
      console.log("  --url <url>            Target API endpoint");
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
        "  --rate-per-call <n>    Max per-call ceiling (token units)",
      );
      console.log("");
      console.log("call options:");
      console.log(
        "  --url <url>            Endpoint to call (can differ from open URL)",
      );
      console.log("  --method <GET|POST>    HTTP method (default: GET)");
      console.log("  --body <json>          Request body for POST calls");
      console.log("");
      console.log("close options:");
      console.log(
        "  --agent <n>            Agent ID used to load/regenerate session key (default: 0)",
      );
  }
}
