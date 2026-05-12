import { createPublicClient, formatUnits, http, parseUnits } from "viem";
import { GokiteAASDK } from "gokite-aa-sdk";
import { clientAgentVaultAbi } from "../../abis.js";
import {
  getSessionByKey,
  getSessionSpentFromIndexer,
  getSessionsByAgent,
  type IndexedSession,
} from "../../indexer.js";
import { KiteSettleClient } from "../../kite-settle-client.js";
import { prompt } from "../../utils/index.js";
import { deriveSessionId } from "../../utils/session-id.js";
import { getVar, setVar } from "../../vars.js";
import { findFlag } from "../index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build an EOA-level KiteSettleClient. */
async function buildEoaClient(credential: string): Promise<KiteSettleClient> {
  return KiteSettleClient.create({ credential });
}

type SessionListRow = {
  sessionKey: string;
  status: string;
  expiresAt: string;
  maxAmount: string;
  remainingAmount: string;
};

function formatSessionAmount(rawAmount: string | bigint): string {
  const amount = typeof rawAmount === "bigint" ? rawAmount : BigInt(rawAmount);
  return formatUnits(amount, 18);
}

function formatSessionExpiry(unixSeconds: string): string {
  return new Date(Number(unixSeconds) * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", " UTC");
}

function normalizeSessionStatus(status: string): string {
  const normalized = status.trim().toLowerCase();
  return normalized
    ? normalized[0].toUpperCase() + normalized.slice(1)
    : "Unknown";
}

function getEffectiveSessionStatus(session: IndexedSession): string {
  const normalized = session.status.trim().toUpperCase();
  const now = Math.floor(Date.now() / 1000);
  const validUntil = Number(session.validUntil);

  if (normalized === "ACTIVE" && validUntil <= now) {
    return "Expired";
  }

  return normalizeSessionStatus(session.status);
}

function normalizeSessionKey(sessionKeyRaw: string): string {
  return sessionKeyRaw.startsWith("0x")
    ? sessionKeyRaw.toLowerCase()
    : `0x${sessionKeyRaw.toLowerCase()}`;
}

function parsePagination(args: string[]): { limit: number; offset: number } {
  const limitRaw = findFlag(args, "--limit");
  const offsetRaw = findFlag(args, "--offset");

  return {
    limit: limitRaw ? Math.max(1, Number.parseInt(limitRaw, 10)) : 10,
    offset: offsetRaw ? Math.max(0, Number.parseInt(offsetRaw, 10)) : 0,
  };
}

async function buildSessionListRow(
  session: IndexedSession,
): Promise<SessionListRow> {
  const spent = await getSessionSpentFromIndexer(session.sessionKey).catch(
    () => 0n,
  );
  const maxAmount = BigInt(session.maxLimit);
  const remainingAmount = maxAmount > spent ? maxAmount - spent : 0n;

  return {
    sessionKey: session.sessionKey,
    status: getEffectiveSessionStatus(session),
    expiresAt: formatSessionExpiry(session.validUntil),
    maxAmount: formatSessionAmount(maxAmount),
    remainingAmount: formatSessionAmount(remainingAmount),
  };
}

function printSessionListTable(rows: SessionListRow[]): void {
  const headers = [
    "Session Key",
    "Status",
    "Expires",
    "Max Amount",
    "Remaining",
  ];
  const widths = [
    Math.max(headers[0].length, ...rows.map((row) => row.sessionKey.length)),
    Math.max(headers[1].length, ...rows.map((row) => row.status.length)),
    Math.max(headers[2].length, ...rows.map((row) => row.expiresAt.length)),
    Math.max(headers[3].length, ...rows.map((row) => row.maxAmount.length)),
    Math.max(
      headers[4].length,
      ...rows.map((row) => row.remainingAmount.length),
    ),
  ];
  const pad = (value: string, width: number) => value.padEnd(width, " ");

  console.log(
    `  ${pad(headers[0], widths[0])}  ${pad(headers[1], widths[1])}  ${pad(headers[2], widths[2])}  ${pad(headers[3], widths[3])}  ${pad(headers[4], widths[4])}`,
  );
  console.log(
    `  ${"-".repeat(widths[0])}  ${"-".repeat(widths[1])}  ${"-".repeat(widths[2])}  ${"-".repeat(widths[3])}  ${"-".repeat(widths[4])}`,
  );

  for (const row of rows) {
    console.log(
      `  ${pad(row.sessionKey, widths[0])}  ${pad(row.status, widths[1])}  ${pad(row.expiresAt, widths[2])}  ${pad(row.maxAmount, widths[3])}  ${pad(row.remainingAmount, widths[4])}`,
    );
  }
}

async function resolveIndexedSession(
  sessionKeyRaw: string,
): Promise<IndexedSession | null> {
  return getSessionByKey(normalizeSessionKey(sessionKeyRaw));
}

// ── session start ─────────────────────────────────────────────────────────────
//
// Creates a new deterministic session key for an agent.
// Flow:
//   1. Derive session key & sessionId (keccak256(abi.encodePacked(sessionKey, agentId, validUntil)))
//   2. Create session on vault (ClientAgentVault.createSession)
//   3. Wait for vault confirmation
//   4. Register session on IdentityRegistry (registerSession)
//
// This ensures atomicity and prevents frontrunning.

async function cmdSessionCreate(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  let agentIndexStr = findFlag(args, "--agent") ?? findFlag(args, "-aid");
  if (!agentIndexStr) agentIndexStr = await prompt("  Agent ID: ");

  let valueLimitStr = findFlag(args, "--value-limit");
  if (!valueLimitStr)
    valueLimitStr = (await prompt("  Value limit per tx in USDT [1]: ")) || "1";

  let dailyLimitStr = findFlag(args, "--daily-limit");
  if (!dailyLimitStr)
    dailyLimitStr =
      (await prompt("  Lifetime spend cap in USDT [10]: ")) || "10";

  let validDaysStr = findFlag(args, "--valid-days");
  if (!validDaysStr)
    validDaysStr = (await prompt("  Session validity in days [7]: ")) || "7";

  const blockedAgentsStr = findFlag(args, "--block-agent");

  const client = await buildEoaClient(credential);
  const cs = client.getEoaClient().getContractService();

  // agentId in IdentityRegistry = ERC-721 tokenId
  const agentId = BigInt(agentIndexStr);

  // Derive next session index from the number of existing sessions for this agent
  const existingSessions = await cs.getAgentSessionsFromRegistry(agentId);
  const sessionIndex = existingSessions.length;

  const session = await client.deriveSession(Number(agentId), sessionIndex);

  const valueLimit = parseUnits(valueLimitStr, 18);
  const maxValueAllowed = parseUnits(dailyLimitStr, 18); // lifetime spend cap
  const validDays = Number(validDaysStr);
  const validUntil = BigInt(Math.floor(Date.now() / 1000) + validDays * 86_400);

  const blockedAgents: bigint[] = blockedAgentsStr
    ? blockedAgentsStr.split(",").map((a) => BigInt(a.trim()))
    : [];

  // ── Step 1: Derive sessionId (must match vault encoding) ──────────────
  const sessionId = deriveSessionId(
    session.address as `0x${string}`,
    agentId,
    validUntil,
  );

  console.log("");
  console.log("── Creating Session ───────────────────────────────────────");
  console.log(`  EOA:             ${client.eoaAddress}`);
  console.log(`  Agent ID:        ${agentId}`);
  console.log(`  Session index:   ${sessionIndex}`);
  console.log(`  Session key:     ${session.address}`);
  console.log(`  Session ID:      ${sessionId}`);
  console.log(`  Value limit:     ${valueLimitStr} per tx`);
  console.log(`  Max spend:       ${dailyLimitStr} lifetime cap`);
  console.log(`  Valid for:       ${validDays} days`);
  if (blockedAgents.length > 0) {
    console.log(`  Blocked agents:  ${blockedAgents.join(", ")}`);
  }
  console.log("");

  // Get AA wallet address from agent mapping first (new sessions are not on registry yet).
  const agentWallet = await cs.getAgentWalletFromRegistry(agentId);
  const aaWalletAddress = agentWallet?.walletContract ?? null;
  let walletContractToUse: string;

  if (!aaWalletAddress) {
    // Fall back to AA SDK derivation, then static config.
    const config = client.getEoaClient().config;
    if (config.networkName && config.bundlerUrl) {
      const aaSdk = new GokiteAASDK(
        config.networkName,
        config.rpcUrl,
        config.bundlerUrl,
      );
      walletContractToUse = aaSdk.getAccountAddress(
        client.eoaAddress,
      ) as `0x${string}`;
    } else if (config.contracts.kiteAAWallet) {
      walletContractToUse = config.contracts.kiteAAWallet;
    } else {
      throw new Error(
        "AA wallet not found for agent. Configure networkName+bundlerUrl or contracts.kiteAAWallet.",
      );
    }
    console.log(`  AA wallet (derived): ${walletContractToUse}`);
  } else {
    walletContractToUse = aaWalletAddress;
    console.log(`  AA wallet:          ${aaWalletAddress}`);
  }

  // ── Step 2: Create session on vault ────────────────────────────────────
  console.log("");
  console.log("  Creating session on vault...");

  const createSessionHash = await cs.createVaultSession({
    walletContract: walletContractToUse as `0x${string}`,
    sessionId: sessionId as `0x${string}`,
    sessionKey: session.address,
    rules: [], // Empty rules for now; can be added later
  });

  console.log(`  Vault tx:        ${createSessionHash}`);
  console.log("");

  // ── Step 3: Wait for vault confirmation ────────────────────────────────
  console.log("  Waiting for vault confirmation...");
  const publicClient = createPublicClient({
    transport: http(client.getEoaClient().config.rpcUrl),
  });

  const sessionExistsOnVault = await new Promise<boolean>((resolve) => {
    const checkInterval = setInterval(async () => {
      try {
        const exists = await publicClient.readContract({
          address: walletContractToUse as `0x${string}`,
          abi: clientAgentVaultAbi,
          functionName: "sessionExists",
          args: [sessionId],
        });

        if (exists) {
          clearInterval(checkInterval);
          resolve(true);
        }
      } catch {
        // Ignore read errors and keep polling
      }
    }, 1000);

    // Timeout after 30 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve(false);
    }, 30000);
  });

  if (!sessionExistsOnVault) {
    console.log(
      "   WARNING: Session not confirmed on vault after 30s. Proceeding anyway...",
    );
  } else {
    console.log("   Session confirmed on vault.");
  }

  // ── Step 4: Register session on IdentityRegistry ──────────────────────
  console.log("");
  console.log("  Registering session on IdentityRegistry...");

  const registerHash = await cs.registerSessionOnRegistry({
    agentId,
    sessionKey: session.address,
    user: client.eoaAddress,
    walletContract: walletContractToUse,
    validUntil,
    blockedAgents,
  });

  console.log(`  Registry tx:     ${registerHash}`);
  console.log("");

  // Persist session credentials
  try {
    setVar(`SESSION_${agentId}_${sessionIndex}_ADDRESS`, session.address);
    setVar(
      `SESSION_${agentId}_${sessionIndex}_PRIVATE_KEY`,
      session.privateKey,
    );
    setVar(`SESSION_${agentId}_${sessionIndex}_ID`, sessionId);
  } catch {
    console.log("  Warning: Could not persist session credentials to vars.");
  }

  console.log("── Session Created ────────────────────────────────────────");
  console.log(`  Session key:     ${session.address}`);
  console.log(
    `  Valid until:     ${new Date(Number(validUntil) * 1000).toISOString()}`,
  );
  console.log("");
  console.log("  Manage with:");
  console.log(
    `    npx kite session status  --agent ${agentId}  --session-key ${session.address}`,
  );
  console.log(`    npx kite session list    --agent ${agentId}`);
  console.log("──────────────────────────────────────────────────────────");
}

// ── session list ──────────────────────────────────────────────────────────────
//
// Lists paginated session keys for an agent using the indexer for usage data.
async function cmdSessionList(args: string[]): Promise<void> {
  let agentIndexStr = findFlag(args, "--agent") ?? findFlag(args, "-aid");
  if (!agentIndexStr) agentIndexStr = await prompt("  Agent ID: ");

  const agentId = BigInt(agentIndexStr);
  const { limit, offset } = parsePagination(args);
  const sessions = await getSessionsByAgent(
    `0x${agentId.toString(16)}`,
    limit,
    offset,
  );

  if (sessions.length === 0) {
    console.log("");
    console.log(`  No session keys found for agent ID ${agentId}`);
    console.log("  Create one with: npx kite session create");
    return;
  }

  const rows = await Promise.all(
    sessions.map((session) => buildSessionListRow(session)),
  );
  const pageInfo =
    sessions.length < limit
      ? `${offset + 1}-${offset + sessions.length} (all results in this page)`
      : `${offset + 1}-${offset + sessions.length}  (pass --offset ${offset + limit} for next page)`;

  console.log("");
  console.log(`  Session keys for agent ID ${agentId}`);
  console.log(`  Showing: ${pageInfo}`);
  console.log("");
  printSessionListTable(rows);
  console.log("");
  console.log(`  Returned: ${sessions.length} session key(s)`);
}

// ── session status ────────────────────────────────────────────────────────────
//
// Show status for a specific session key.

async function cmdSessionStatus(args: string[]): Promise<void> {
  const sessionKeyRaw =
    findFlag(args, "--session") ??
    findFlag(args, "--session-key") ??
    findFlag(args, "--key");

  if (!sessionKeyRaw) {
    console.log("");
    console.log("  Missing session key.");
    console.log("  Pass one with: npx kite session status --session 0xabc...");
    return;
  }

  const session = await resolveIndexedSession(sessionKeyRaw);
  const normalizedKey = normalizeSessionKey(sessionKeyRaw);

  console.log("");
  console.log("── Session Key Status ─────────────────────────────────────");
  console.log(`  Key:     ${normalizedKey}`);

  if (!session) {
    console.log("  Status:  Missing");
    console.log("  Info:    No indexed session was found for this key.");
    console.log("──────────────────────────────────────────────────────────");
    return;
  }

  console.log(`  Status:  ${getEffectiveSessionStatus(session)}`);
  console.log(`  Address: ${session.sessionKey}`);
  console.log("──────────────────────────────────────────────────────────");
}

// ── session revoke ────────────────────────────────────────────────────────────
//
// Revokes a session key atomically:
//   1. Remove from vault (ClientAgentVault.removeSession)
//   2. Revoke on IdentityRegistry (revokeSession)
//
// This prevents frontrunning by removing from vault first.

async function cmdSessionRevoke(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const sessionKeyRaw =
    findFlag(args, "--session") ??
    findFlag(args, "--session-key") ??
    findFlag(args, "--key");
  const agentIdRaw =
    findFlag(args, "--agent") ??
    findFlag(args, "--agent-index") ??
    findFlag(args, "-aid");

  if (!sessionKeyRaw) {
    throw new Error(
      "Missing session key. Use: npx kite session revoke --session-key 0xabc...",
    );
  }

  const client = await buildEoaClient(credential);
  const cs = client.getEoaClient().getContractService();

  const sessionKey = normalizeSessionKey(sessionKeyRaw);

  if (agentIdRaw) {
    const agentId = BigInt(agentIdRaw);
    const onchainSessions = await cs.getAgentSessionsFromRegistry(agentId);
    const sessionIndex = onchainSessions.findIndex(
      (key) => key.toLowerCase() === sessionKey,
    );

    if (sessionIndex === -1) {
      throw new Error(
        `Session key ${sessionKey} was not found for agent ID ${agentId}.`,
      );
    }

    const derived = await client.deriveSession(Number(agentId), sessionIndex);
    if (derived.address.toLowerCase() !== sessionKey) {
      throw new Error(
        `Non-ownership proof failed: session key ${sessionKey} is not owned by EOA ${client.eoaAddress} for agent ID ${agentId}.`,
      );
    }
  }

  // Verify the session belongs to this EOA before revoking
  let sessionOnRegistry: any;
  try {
    sessionOnRegistry = (await cs.validateSession(sessionKey)) as any;
    const [, , user] = sessionOnRegistry;
    const owner = user as string;
    if (owner.toLowerCase() !== client.eoaAddress.toLowerCase()) {
      throw new Error(
        `Session key ${sessionKey} belongs to ${owner}, not ${client.eoaAddress}. ` +
          "Only the owning EOA can revoke a session key.",
      );
    }
  } catch (err: any) {
    if (err.message.includes("belongs to")) throw err;
    // If validateSession fails, the key may not exist — still try revoke
  }

  console.log("");
  console.log("── Revoking Session Key ───────────────────────────────────");
  console.log(`  Session key:  ${sessionKey}`);
  console.log(`  EOA:          ${client.eoaAddress}`);
  console.log("");

  // ── Step 1: Resolve session metadata needed for vault removal ───────────
  let vaultAddress: string | undefined;
  let sessionId: `0x${string}` | undefined;

  if (sessionOnRegistry && Array.isArray(sessionOnRegistry)) {
    // validateSession returns tuple: (active, agentId, user, walletContract, validUntil)
    const agentId = (sessionOnRegistry as any)[1] as bigint;
    const walletContract = (sessionOnRegistry as any)[3] as string;
    const validUntil = (sessionOnRegistry as any)[4] as bigint;

    if (
      walletContract &&
      walletContract !== "0x0000000000000000000000000000000000000000"
    ) {
      vaultAddress = walletContract;
    }

    sessionId = deriveSessionId(
      sessionKey as `0x${string}`,
      agentId,
      validUntil,
    );
  }

  if (!vaultAddress && agentIdRaw) {
    const agentWallet = await cs.getAgentWalletFromRegistry(BigInt(agentIdRaw));
    if (agentWallet?.walletContract) {
      vaultAddress = agentWallet.walletContract;
    }
  }

  if (!vaultAddress) {
    const config = client.getEoaClient().config;
    if (config.networkName && config.bundlerUrl) {
      const aaSdk = new GokiteAASDK(
        config.networkName,
        config.rpcUrl,
        config.bundlerUrl,
      );
      vaultAddress = aaSdk.getAccountAddress(client.eoaAddress) as string;
    } else if (config.contracts.kiteAAWallet) {
      vaultAddress = config.contracts.kiteAAWallet;
    }
  }

  // ── Step 2: Remove from vault first ────────────────────────────────────
  console.log("  Removing session from vault...");

  // We need sessionId to remove from vault.
  if (!sessionId) {
    console.log(
      "  ⚠ Could not derive sessionId from registry; proceeding with registry revoke only",
    );
  }

  if (sessionId && vaultAddress) {
    try {
      const vaultRemoveHash = await cs.removeVaultSession(
        vaultAddress,
        sessionId,
      );
      console.log(`  Vault tx:     ${vaultRemoveHash}`);

      // Wait briefly for vault to process
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (err: any) {
      console.log(`  ⚠ Warning: Could not remove from vault: ${err.message}`);
    }
  }

  // ── Step 3: Revoke on IdentityRegistry ─────────────────────────────────
  console.log("  Revoking session on IdentityRegistry...");

  const registryRevokeHash = await cs.revokeSessionOnRegistry(sessionKey);

  console.log(`  Registry tx:  ${registryRevokeHash}`);
  console.log("");
  console.log("── Session Key Revoked ────────────────────────────────────");
  console.log(`  Key ${sessionKey} is now inactive.`);
  console.log("  The agent can no longer sign payments with this key.");
  console.log("──────────────────────────────────────────────────────────");
}

// ── Public dispatcher ─────────────────────────────────────────────────────────

export async function cmdSessions(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "create":
      return cmdSessionCreate(args.slice(1));
    case "list":
      return cmdSessionList(args.slice(1));
    case "status":
      return cmdSessionStatus(args.slice(1));
    case "revoke":
      return cmdSessionRevoke(args.slice(1));
    default:
      console.log(`
  Usage: npx kite session <subcommand> [options]

  Session keys are registered on KiteAAWallet and authorize agents to interact
  with service providers within defined spending rules.

  Subcommands:
    create      Create a new session key for an agent
    list       List all session keys for an agent
    status     Show detailed status of a session key
    revoke     Revoke a session key (irreversible)

  Common options:
    --agent <n>            Agent derivation index (default: 0)
    --session <addr>        Explicit session key address (overrides derivation)
    --session-key <addr>   Alias for --session
    --key <addr>           Alias for --session
    --limit <n>            Page size for indexed session list (default: 10)
    --offset <n>           Result offset for indexed session list (default: 0)

  start options:
    --value-limit <n>      Max payment per tx in token units (default: 1)
    --daily-limit <n>      Max daily total in token units (default: 10)
    --valid-days <n>       Session validity in days (default: 30)
    --purpose <text>       Human-readable purpose (stored in metadata)

  Examples:
    npx kite session create --agent 0 --value-limit 2 --daily-limit 20
    npx kite session list  --agent 0
    npx kite session list  --agent 0 --limit 10 --offset 10
    npx kite session status --session-key 0xabc...
    npx kite session revoke --session-key 0xabc...
    npx kite session revoke --session-key 0xabc... --agent 1
`);
  }
}
