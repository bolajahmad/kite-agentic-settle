import { formatUnits, parseUnits, stringToHex } from "viem";
import { findFlag, prompt } from "../cli.js";
import { KitePaymentClient } from "../client.js";
import { getVar } from "../vars.js";
import { deriveAgentAccount, deriveSessionAccount } from "../wallet.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build an EOA-level KitePaymentClient (not agent-derived). */
async function buildEoaClient(credential: string): Promise<KitePaymentClient> {
  return KitePaymentClient.create({ seedPhrase: credential });
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
  const blockedProvidersStr = findFlag(args, "--block");

  const client = await buildEoaClient(credential);
  const cs = client.getContractService();

  // Derive agent key for agentId lookup
  const agentPrivateKeyBytes = client.getPrivateKey();
  const agent = await deriveAgentAccount(agentPrivateKeyBytes, agentIndex);
  const session = await deriveSessionAccount(agentPrivateKeyBytes, agentIndex, sessionIndex);

  // Resolve agentId on-chain
  let agentId: `0x${string}`;
  try {
    const resolved = await client.resolveAgentByAddress(agent.address);
    agentId = ((resolved as any)[0] ?? (resolved as any).agentId) as `0x${string}`;
    if (!agentId || agentId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      throw new Error("Agent not registered on-chain.");
    }
  } catch (err: any) {
    throw new Error(
      `Agent at index ${agentIndex} (${agent.address}) is not registered. ` +
        "Run: npx kite onboard --name <name>",
    );
  }

  const valueLimit = parseUnits(valueLimitStr ?? "1", 18);
  const dailyLimit = parseUnits(dailyLimitStr ?? "10", 18);
  const validDays = Number(validDaysStr ?? "30");
  const validUntil = Math.floor(Date.now() / 1000) + validDays * 86_400;

  const blockedProviders: `0x${string}`[] = blockedProvidersStr
    ? (blockedProvidersStr.split(",").map((a) => a.trim()) as `0x${string}`[])
    : [];

  const sessionMeta = JSON.stringify({
    purpose,
    agentIndex,
    sessionIndex,
    createdAt: new Date().toISOString(),
  });
  const sessionMetaHex = stringToHex(sessionMeta) as `0x${string}`;

  console.log("");
  console.log("── Creating Session Key ───────────────────────────────────");
  console.log(`  EOA:             ${client.address}`);
  console.log(`  Agent index:     ${agentIndex}  (${agent.address})`);
  console.log(`  Agent ID:        ${agentId}`);
  console.log(`  Session index:   ${sessionIndex}  (${session.address})`);
  console.log(`  Value limit:     ${valueLimitStr ?? "1"} per tx`);
  console.log(`  Daily limit:     ${dailyLimitStr ?? "10"}`);
  console.log(`  Valid for:       ${validDays} days`);
  if (blockedProviders.length > 0) {
    console.log(`  Blocked:         ${blockedProviders.join(", ")}`);
  }
  console.log("");

  const txHash = await cs.addSessionKeyRule(
    session.address,
    agentId,
    sessionIndex,
    valueLimit,
    dailyLimit,
    validUntil,
    blockedProviders,
    sessionMetaHex,
  );

  console.log(`  Tx:              ${txHash}`);
  console.log(`  Explorer:        https://testnet.kitescan.ai/tx/${txHash}`);
  console.log("");
  console.log("── Session Key Created ────────────────────────────────────");
  console.log(`  Session key:     ${session.address}`);
  console.log(`  Valid until:     ${new Date(validUntil * 1000).toISOString()}`);
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
  const cs = client.getContractService();

  const agentPrivateKeyBytes = client.getPrivateKey();
  const agent = await deriveAgentAccount(agentPrivateKeyBytes, agentIndex);

  // Resolve agentId
  let agentId: `0x${string}`;
  try {
    const resolved = await client.resolveAgentByAddress(agent.address);
    agentId = ((resolved as any)[0] ?? (resolved as any).agentId) as `0x${string}`;
  } catch {
    throw new Error(
      `Agent at index ${agentIndex} (${agent.address}) is not registered. ` +
        "Run: npx kite onboard --name <name>",
    );
  }

  const sessionKeys = await cs.getAgentSessionKeys(agentId);

  if (sessionKeys.length === 0) {
    console.log("");
    console.log(`  No session keys found for agent ${agent.address} (index ${agentIndex}).`);
    console.log("  Create one with: npx kite session start");
    return;
  }

  console.log("");
  console.log(`  Session keys for agent ${agent.address} (index ${agentIndex})`);
  console.log(`  Agent ID: ${agentId}`);
  console.log("");

  for (const sk of sessionKeys) {
    let valid = false;
    let rule: readonly [string, `0x${string}`, bigint, bigint, bigint, boolean] | null = null;
    let blocked: readonly `0x${string}`[] = [];

    try {
      valid = await cs.isSessionValid(sk);
      rule = (await cs.getSessionRule(sk)) as any;
      blocked = await cs.getSessionBlockedProviders(sk);
    } catch {
      // partial failure — still show what we can
    }

    const statusBadge = rule ? (rule[5] ? (valid ? "Active" : "Expired") : "Revoked") : "Unknown";
    console.log(`  ${sk}  [${statusBadge}]`);
    if (rule) {
      console.log(
        `    Limits:   ${formatUnits(rule[2], 18)} per-tx / ${formatUnits(rule[3], 18)} daily`,
      );
      const validUntil = Number(rule[4]);
      console.log(
        `    Valid until: ${new Date(validUntil * 1000).toISOString()}`,
      );
    }
    if (blocked.length > 0) {
      console.log(`    Blocked:  ${blocked.join(", ")}`);
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

  const sessionKeyRaw = findFlag(args, "--session-key") || findFlag(args, "--key");
  const agentIndex = Number(
    findFlag(args, "--agent-index") ?? findFlag(args, "--agent") ?? "0",
  );

  const client = await buildEoaClient(credential);
  const cs = client.getContractService();

  // If no explicit session key, derive the one at --session-index
  let sessionKey: string;
  if (sessionKeyRaw) {
    sessionKey = sessionKeyRaw;
  } else {
    const sessionIndex = Number(findFlag(args, "--session-index") ?? "0");
    const agentPrivateKeyBytes = client.getPrivateKey();
    const session = await deriveSessionAccount(agentPrivateKeyBytes, agentIndex, sessionIndex);
    sessionKey = session.address;
  }

  console.log("");
  console.log("── Session Key Status ─────────────────────────────────────");
  console.log(`  Key:     ${sessionKey}`);
  console.log("");

  try {
    const rule = (await cs.getSessionRule(sessionKey)) as readonly [
      string,       // user (EOA)
      `0x${string}`, // agentId
      bigint,       // valueLimit
      bigint,       // dailyLimit
      bigint,       // validUntil
      boolean,      // active
    ];
    const valid = await cs.isSessionValid(sessionKey);
    const blocked = await cs.getSessionBlockedProviders(sessionKey);

    const validUntil = Number(rule[4]);
    const now = Math.floor(Date.now() / 1000);
    const secsRemaining = validUntil - now;
    const statusLabel = rule[5]
      ? (valid ? "Active" : "Expired")
      : "Revoked";

    console.log(`  Status:       ${statusLabel}`);
    console.log(`  Owner (EOA):  ${rule[0]}`);
    console.log(`  Agent ID:     ${rule[1]}`);
    console.log(`  Value limit:  ${formatUnits(rule[2], 18)} per tx`);
    console.log(`  Daily limit:  ${formatUnits(rule[3], 18)}`);
    console.log(`  Valid until:  ${new Date(validUntil * 1000).toISOString()}`);
    if (secsRemaining > 0) {
      const days = Math.floor(secsRemaining / 86400);
      const hrs = Math.floor((secsRemaining % 86400) / 3600);
      console.log(`  Time left:    ${days}d ${hrs}h`);
    } else {
      console.log(`  Time left:    EXPIRED`);
    }
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

  const sessionKeyRaw = findFlag(args, "--session-key") || findFlag(args, "--key");
  const agentIndex = Number(
    findFlag(args, "--agent-index") ?? findFlag(args, "--agent") ?? "0",
  );

  const client = await buildEoaClient(credential);
  const cs = client.getContractService();

  let sessionKey: string;
  if (sessionKeyRaw) {
    sessionKey = sessionKeyRaw;
  } else {
    const sessionIndex = Number(findFlag(args, "--session-index") ?? "0");
    const agentPrivateKeyBytes = client.getPrivateKey();
    const session = await deriveSessionAccount(agentPrivateKeyBytes, agentIndex, sessionIndex);
    sessionKey = session.address;
    console.log(`  (Derived session key at index ${sessionIndex}: ${sessionKey})`);
  }

  // Verify the session belongs to this EOA before revoking
  try {
    const rule = (await cs.getSessionRule(sessionKey)) as any;
    const owner = rule[0] as string;
    if (owner.toLowerCase() !== client.address.toLowerCase()) {
      throw new Error(
        `Session key ${sessionKey} belongs to ${owner}, not ${client.address}. ` +
          "Only the owning EOA can revoke a session key.",
      );
    }
  } catch (err: any) {
    if (err.message.includes("belongs to")) throw err;
    // If getSessionRule fails, the key may not exist — still try revoke
  }

  console.log("");
  console.log("── Revoking Session Key ───────────────────────────────────");
  console.log(`  Session key:  ${sessionKey}`);
  console.log(`  EOA:          ${client.address}`);
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

  const sessionKeyRaw = findFlag(args, "--session-key") || findFlag(args, "--key");
  const agentIndex = Number(
    findFlag(args, "--agent-index") ?? findFlag(args, "--agent") ?? "0",
  );

  const client = await buildEoaClient(credential);
  const cs = client.getContractService();

  let sessionKey: string;
  if (sessionKeyRaw) {
    sessionKey = sessionKeyRaw;
  } else {
    const sessionIndex = Number(findFlag(args, "--session-index") ?? "0");
    const agentPrivateKeyBytes = client.getPrivateKey();
    const session = await deriveSessionAccount(agentPrivateKeyBytes, agentIndex, sessionIndex);
    sessionKey = session.address;
  }

  console.log("");
  console.log("── Blocking Provider ──────────────────────────────────────");
  console.log(`  Session key:  ${sessionKey}`);
  console.log(`  Provider:     ${provider}`);
  console.log("");

  const txHash = await cs.blockProvider(sessionKey, provider);

  console.log(`  Tx:           ${txHash}`);
  console.log(`  Explorer:     https://testnet.kitescan.ai/tx/${txHash}`);
  console.log("");
  console.log(`  Provider ${provider} is now blocked for session ${sessionKey}.`);
  console.log("──────────────────────────────────────────────────────────");
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

  const sessionKeyRaw = findFlag(args, "--session-key") || findFlag(args, "--key");
  const agentIndex = Number(
    findFlag(args, "--agent-index") ?? findFlag(args, "--agent") ?? "0",
  );

  const client = await buildEoaClient(credential);
  const cs = client.getContractService();

  let sessionKey: string;
  if (sessionKeyRaw) {
    sessionKey = sessionKeyRaw;
  } else {
    const sessionIndex = Number(findFlag(args, "--session-index") ?? "0");
    const agentPrivateKeyBytes = client.getPrivateKey();
    const session = await deriveSessionAccount(agentPrivateKeyBytes, agentIndex, sessionIndex);
    sessionKey = session.address;
  }

  console.log("");
  console.log("── Unblocking Provider ────────────────────────────────────");
  console.log(`  Session key:  ${sessionKey}`);
  console.log(`  Provider:     ${provider}`);
  console.log("");

  const txHash = await cs.unblockProvider(sessionKey, provider);

  console.log(`  Tx:           ${txHash}`);
  console.log(`  Explorer:     https://testnet.kitescan.ai/tx/${txHash}`);
  console.log("");
  console.log(`  Provider ${provider} is now unblocked for session ${sessionKey}.`);
  console.log("──────────────────────────────────────────────────────────");
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
