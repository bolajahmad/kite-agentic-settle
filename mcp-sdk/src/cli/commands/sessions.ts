import { formatUnits, parseUnits } from "viem";
import { KiteSettleClient } from "../../kite-settle-client.js";
import { getVar } from "../../vars.js";
import { findFlag, prompt } from "../index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build an EOA-level KiteSettleClient. */
async function buildEoaClient(credential: string): Promise<KiteSettleClient> {
  return KiteSettleClient.create({ credential });
}

// ── session start ─────────────────────────────────────────────────────────────
//
// Creates a new deterministic session key for an agent and registers it
// on KiteAAWallet with the provided rules (valueLimit, dailyLimit, validUntil,
// optionally blocked providers + metadata).

async function cmdSessionStart(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const agentIndex = Number(
    findFlag(args, "--agent-index") ?? findFlag(args, "--agent") ?? "0",
  );
  const sessionIndex = Number(findFlag(args, "--session-index") ?? "0");
  const valueLimitStr = findFlag(args, "--value-limit");
  const dailyLimitStr = findFlag(args, "--daily-limit");
  const validDaysStr = findFlag(args, "--valid-days");
  const purpose = findFlag(args, "--purpose") ?? "default session";
  const blockedAgentsStr = findFlag(args, "--block-agent");

  const client = await buildEoaClient(credential);
  const cs = client.getEoaClient().getContractService();

  const session = await client.deriveSession(agentIndex, sessionIndex);

  // agentId in IdentityRegistry = ERC-721 tokenId = agentIndex + 1
  const agentId = BigInt(agentIndex + 1);

  const valueLimit = parseUnits(valueLimitStr ?? "1", 18);
  const maxValueAllowed = parseUnits(dailyLimitStr ?? "10", 18); // lifetime spend cap
  const validDays = Number(validDaysStr ?? "30");
  const validUntil = BigInt(Math.floor(Date.now() / 1000) + validDays * 86_400);

  const blockedAgents: bigint[] = blockedAgentsStr
    ? blockedAgentsStr.split(",").map((a) => BigInt(a.trim()))
    : [];

  console.log("");
  console.log("── Creating Session Key ───────────────────────────────────");
  console.log(`  EOA:             ${client.eoaAddress}`);
  console.log(`  Agent ID:        ${agentId}  (index ${agentIndex})`);
  console.log(`  Session key:     ${session.address}`);
  console.log(`  Value limit:     ${valueLimitStr ?? "1"} per tx`);
  console.log(`  Max spend:       ${dailyLimitStr ?? "10"} lifetime cap`);
  console.log(`  Valid for:       ${validDays} days`);
  if (blockedAgents.length > 0) {
    console.log(`  Blocked agents:  ${blockedAgents.join(", ")}`);
  }
  console.log("");

  const txHash = await cs.addSessionKeyRule(
    agentId,
    session.address,
    valueLimit,
    maxValueAllowed,
    validUntil,
    blockedAgents,
  );

  console.log(`  Tx:              ${txHash}`);
  console.log(`  Explorer:        https://testnet.kitescan.ai/tx/${txHash}`);
  console.log("");
  console.log("── Session Key Created ────────────────────────────────────");
  console.log(`  Session key:     ${session.address}`);
  console.log(
    `  Valid until:     ${new Date(Number(validUntil) * 1000).toISOString()}`,
  );
  console.log("");
  console.log("  Manage with:");
  console.log(
    `    npx kite session status  --agent ${agentIndex}  --session-key ${session.address}`,
  );
  console.log(`    npx kite session list    --agent ${agentIndex}`);
  console.log("──────────────────────────────────────────────────────────");
}

// ── session list ──────────────────────────────────────────────────────────────
//
// Lists all session keys for an agent, enriched with on-chain status.

async function cmdSessionList(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const agentIndex = Number(
    findFlag(args, "--agent-index") ?? findFlag(args, "--agent") ?? "0",
  );

  const client = await buildEoaClient(credential);
  const cs = client.getEoaClient().getContractService();

  // In IdentityRegistry, agentId = ERC-721 tokenId = agentIndex + 1
  const agentTokenId = BigInt(agentIndex + 1);
  const sessionKeys = await cs.getAgentSessionsFromRegistry(agentTokenId);

  if (sessionKeys.length === 0) {
    console.log("");
    console.log(
      `  No session keys found for agent ID ${agentTokenId} (index ${agentIndex}).`,
    );
    console.log("  Create one with: npx kite session start");
    return;
  }

  console.log("");
  console.log(
    `  Session keys for agent ID ${agentTokenId} (index ${agentIndex})`,
  );
  console.log(`  EOA:      ${client.eoaAddress}`);
  console.log("");

  for (const sk of sessionKeys) {
    let sessionData: any = null;
    let sessionValid = false;

    try {
      const [active, , , , , , validUntil] = (await cs.validateSession(sk)) as any;
      sessionData = { active, validUntil: Number(validUntil) };
      sessionValid = active && sessionData.validUntil > Math.floor(Date.now() / 1000);
    } catch {
      // partial failure — still show what we can
    }

    const statusBadge = sessionData
      ? sessionData.active
        ? sessionValid
          ? "Active"
          : "Expired"
        : "Revoked"
      : "Unknown";
    console.log(`  ${sk}  [${statusBadge}]`);
    if (sessionData) {
      const rule = (await cs.getSessionFromRegistry(sk).catch(() => null)) as any;
      if (rule) {
        console.log(
          `    Limits:   ${formatUnits(rule.valueLimit, 18)} per-tx / ${formatUnits(rule.maxValueAllowed, 18)} total`,
        );
        console.log(
          `    Valid until: ${new Date(sessionData.validUntil * 1000).toISOString()}`,
        );
        if (rule.blockedProviders?.length > 0) {
          console.log(`    Blocked:  ${rule.blockedProviders.join(", ")}`);
        }
      }
    }
    console.log("");
  }

  console.log(`  Total: ${sessionKeys.length} session key(s)`);
}

// ── session status ────────────────────────────────────────────────────────────
//
// Show detailed status for a specific session key.

async function cmdSessionStatus(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const sessionKeyRaw =
    findFlag(args, "--session-key") || findFlag(args, "--key");
  const agentIndex = Number(
    findFlag(args, "--agent-index") ?? findFlag(args, "--agent") ?? "0",
  );

  const client = await buildEoaClient(credential);
  const cs = client.getEoaClient().getContractService();

  // If no explicit session key, derive the one at --session-index
  let sessionKey: string;
  if (sessionKeyRaw) {
    sessionKey = sessionKeyRaw;
  } else {
    const sessionIndex = Number(findFlag(args, "--session-index") ?? "0");
    const session = await client.deriveSession(agentIndex, sessionIndex);
    sessionKey = session.address;
  }

  console.log("");
  console.log("── Session Key Status ─────────────────────────────────────");
  console.log(`  Key:     ${sessionKey}`);
  console.log("");

  try {
    const [active, agentId, user, , valueLimit, maxValueAllowed, validUntilBig] =
      (await cs.validateSession(sessionKey)) as any;
    const rule = (await cs.getSessionFromRegistry(sessionKey)) as any;

    const validUntil = Number(validUntilBig);
    const now = Math.floor(Date.now() / 1000);
    const secsRemaining = validUntil - now;
    const sessionValid = active && secsRemaining > 0;
    const statusLabel = active ? (sessionValid ? "Active" : "Expired") : "Revoked";

    console.log(`  Status:       ${statusLabel}`);
    console.log(`  Owner (EOA):  ${user}`);
    console.log(`  Agent ID:     ${agentId}`);
    console.log(`  Value limit:  ${formatUnits(valueLimit, 18)} per tx`);
    console.log(`  Max spend:    ${formatUnits(maxValueAllowed, 18)} lifetime cap`);
    console.log(`  Valid until:  ${new Date(validUntil * 1000).toISOString()}`);
    if (secsRemaining > 0) {
      const days = Math.floor(secsRemaining / 86400);
      const hrs = Math.floor((secsRemaining % 86400) / 3600);
      console.log(`  Time left:    ${days}d ${hrs}h`);
    } else {
      console.log(`  Time left:    EXPIRED`);
    }
    const blocked: string[] = rule?.blockedProviders ?? [];
    if (blocked.length > 0) {
      console.log(`  Blocked providers:`);
      for (const p of blocked) {
        console.log(`    ${p}`);
      }
    } else {
      console.log(`  Blocked:      none`);
    }
  } catch (err: any) {
    console.log(`  (on-chain lookup failed: ${err.message})`);
  }

  console.log("──────────────────────────────────────────────────────────");
}

// ── session revoke ────────────────────────────────────────────────────────────
//
// Revokes a session key on KiteAAWallet so it can no longer sign payments.
// Only the owning EOA can revoke.

async function cmdSessionRevoke(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const sessionKeyRaw =
    findFlag(args, "--session-key") || findFlag(args, "--key");
  const agentIndex = Number(
    findFlag(args, "--agent-index") ?? findFlag(args, "--agent") ?? "0",
  );

  const client = await buildEoaClient(credential);
  const cs = client.getEoaClient().getContractService();

  let sessionKey: string;
  if (sessionKeyRaw) {
    sessionKey = sessionKeyRaw;
  } else {
    const sessionIndex = Number(findFlag(args, "--session-index") ?? "0");
    const session = await client.deriveSession(agentIndex, sessionIndex);
    sessionKey = session.address;
    console.log(
      `  (Derived session key at index ${sessionIndex}: ${sessionKey})`,
    );
  }

  // Verify the session belongs to this EOA before revoking
  try {
    const [, , user] = (await cs.validateSession(sessionKey)) as any;
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

  const txHash = await cs.revokeSessionKey(sessionKey);

  console.log(`  Tx:           ${txHash}`);
  console.log(`  Explorer:     https://testnet.kitescan.ai/tx/${txHash}`);
  console.log("");
  console.log("── Session Key Revoked ────────────────────────────────────");
  console.log(`  Key ${sessionKey} is now inactive.`);
  console.log("  The agent can no longer sign payments with this key.");
  console.log("──────────────────────────────────────────────────────────");
}

// ── session block ─────────────────────────────────────────────────────────────
//
// Adds a provider to the blocklist of a session key.

async function cmdSessionBlock(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const provider = args[0] || (await prompt("Provider address to block: "));
  if (!provider || !provider.startsWith("0x")) {
    throw new Error("Provider must be a valid 0x address.");
  }

  const sessionKeyRaw =
    findFlag(args, "--session-key") || findFlag(args, "--key");
  const agentIndex = Number(
    findFlag(args, "--agent-index") ?? findFlag(args, "--agent") ?? "0",
  );

  const client = await buildEoaClient(credential);
  const cs = client.getEoaClient().getContractService();

  let sessionKey: string;
  if (sessionKeyRaw) {
    sessionKey = sessionKeyRaw;
  } else {
    const sessionIndex = Number(findFlag(args, "--session-index") ?? "0");
    const session = await client.deriveSession(agentIndex, sessionIndex);
    sessionKey = session.address;
  }

  console.log("");
  console.log("── Blocking Provider ──────────────────────────────────────");
  console.log(`  Session key:  ${sessionKey}`);
  console.log(`  Provider:     ${provider}`);
  console.log("");

  // In the new IdentityRegistry design, blocked providers are set at session
  // creation time. To block a provider, revoke this session key and create a
  // new one with the provider in the blockedProviders list.
  throw new Error(
    "Dynamic provider blocking is not supported. " +
    "Revoke this session and create a new one with the provider blocked:\n" +
    `  npx kite session revoke --session-key ${sessionKey}\n` +
    `  npx kite session start --block ${provider}`,
  );
}

// ── session unblock ───────────────────────────────────────────────────────────
//
// Removes a provider from the blocklist of a session key.

async function cmdSessionUnblock(args: string[]): Promise<void> {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const provider = args[0] || (await prompt("Provider address to unblock: "));
  if (!provider || !provider.startsWith("0x")) {
    throw new Error("Provider must be a valid 0x address.");
  }

  const sessionKeyRaw =
    findFlag(args, "--session-key") || findFlag(args, "--key");
  const agentIndex = Number(
    findFlag(args, "--agent-index") ?? findFlag(args, "--agent") ?? "0",
  );

  const client = await buildEoaClient(credential);
  const cs = client.getEoaClient().getContractService();

  let sessionKey: string;
  if (sessionKeyRaw) {
    sessionKey = sessionKeyRaw;
  } else {
    const sessionIndex = Number(findFlag(args, "--session-index") ?? "0");
    const session = await client.deriveSession(agentIndex, sessionIndex);
    sessionKey = session.address;
  }

  console.log("");
  console.log("── Unblocking Provider ────────────────────────────────────");
  console.log(`  Session key:  ${sessionKey}`);
  console.log(`  Provider:     ${provider}`);
  console.log("");

  // In the new IdentityRegistry design, blocked providers are set at session
  // creation time and cannot be individually removed.
  // To unblock a provider, revoke this session and create a new one
  // without that provider in the blockedProviders list.
  throw new Error(
    "Dynamic provider unblocking is not supported. " +
    "Revoke this session and create a new one without the blocked provider:\n" +
    `  npx kite session revoke --session-key ${sessionKey}`,
  );
}

// ── Public dispatcher ─────────────────────────────────────────────────────────

export async function cmdSessions(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "start":
      return cmdSessionStart(args.slice(1));
    case "list":
      return cmdSessionList(args.slice(1));
    case "status":
      return cmdSessionStatus(args.slice(1));
    case "revoke":
      return cmdSessionRevoke(args.slice(1));
    case "block":
      return cmdSessionBlock(args.slice(1));
    case "unblock":
      return cmdSessionUnblock(args.slice(1));
    default:
      console.log(`
  Usage: npx kite session <subcommand> [options]

  Session keys are registered on KiteAAWallet and authorize agents to interact
  with service providers within defined spending rules.

  Subcommands:
    start      Create a new session key for an agent
    list       List all session keys for an agent
    status     Show detailed status of a session key
    revoke     Revoke a session key (irreversible)
    block      Block a provider for a session key
    unblock    Remove a provider from the blocklist

  Common options:
    --agent <n>            Agent derivation index (default: 0)
    --agent-index <n>      Alias for --agent
    --session-index <n>    Session derivation index (default: 0)
    --session-key <addr>   Explicit session key address (overrides derivation)
    --key <addr>           Alias for --session-key

  start options:
    --value-limit <n>      Max payment per tx in token units (default: 1)
    --daily-limit <n>      Max daily total in token units (default: 10)
    --valid-days <n>       Session validity in days (default: 30)
    --purpose <text>       Human-readable purpose (stored in metadata)
    --block <addr,addr>    Comma-separated list of providers to block initially

  block / unblock options:
    <provider>             First positional arg is the provider address

  Examples:
    npx kite session start --agent 0 --value-limit 2 --daily-limit 20
    npx kite session list  --agent 0
    npx kite session status --agent 0
    npx kite session revoke --session-key 0xabc...
    npx kite session block  0xDEF... --agent 0
    npx kite session unblock 0xDEF... --session-key 0xabc...
`);
  }
}
