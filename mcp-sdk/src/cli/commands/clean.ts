/**
 * kite clean — Delete stored configuration data from ~/.kite-agent-pay/vars.json
 *
 * Usage:
 *   npx kite clean                 Delete everything (prompts for confirmation)
 *   npx kite clean --agent <id>    Delete all data for a specific agent
 *   npx kite clean --session       Delete all session keys across all agents
 *
 * Two categories of stored data:
 *
 *   EOA / identity data (required for onboarding-style operations):
 *     PRIVATE_KEY, DEPLOYER_KEY, AGENT_<id>_ID, AGENT_<id>_URI,
 *     AGENT_<id>_OWNER, AGENT_<id>_PRIVATE_KEY
 *
 *   Session data (required for agent-mode calls: kite call, balance, etc.):
 *     SESSION_<agentId>_<idx>_ADDRESS, SESSION_<agentId>_<idx>_PRIVATE_KEY,
 *     AGENT_<id>_SEED (legacy encrypted-blob passphrase, no longer generated)
 */

import { prompt } from "../../utils/index.js";
import { clearAllVars, clearVarsWhere, listVars } from "../../vars.js";

// ── Helpers ────────────────────────────────────────────────────────

function info(msg: string) {
  console.log(`  ${msg}`);
}

function header(title: string) {
  console.log("");
  console.log(`  ${title}`);
  console.log(`  ${"─".repeat(54)}`);
}

/** Keys that belong to a specific agentId (EOA data + its sessions). */
function isAgentKey(key: string, agentId: string): boolean {
  return (
    key === `AGENT_${agentId}_ID` ||
    key === `AGENT_${agentId}_URI` ||
    key === `AGENT_${agentId}_OWNER` ||
    key === `AGENT_${agentId}_SEED` ||
    key === `AGENT_${agentId}_PRIVATE_KEY` ||
    key.startsWith(`SESSION_${agentId}_`)
  );
}

/** Keys that are session-related across all agents. */
function isSessionKey(key: string): boolean {
  return /^SESSION_\d+_\d+_/.test(key) || /^AGENT_\d+_SEED$/.test(key);
}

// ── Password confirmation ──────────────────────────────────────────

async function confirmWithPassword(action: string): Promise<boolean> {
  console.log("");
  info(`⚠️  WARNING: ${action}`);
  info(
    "This will make affected CLI/SDK operations unusable until you re-onboard.",
  );
  console.log("");

  const pw1 = await prompt("  Type DELETE to confirm: ", false);
  if (pw1.trim() !== "DELETE") {
    info("Aborted — confirmation did not match.");
    return false;
  }
  return true;
}

// ── Sub-commands ───────────────────────────────────────────────────

async function cleanAll() {
  const allKeys = listVars();
  if (allKeys.length === 0) {
    info("Nothing stored — vars file is already empty.");
    return;
  }

  header("Clean All — Stored Variables");
  info(`${allKeys.length} variable(s) will be deleted:`);
  for (const k of allKeys) {
    info(`  • ${k}`);
  }

  const ok = await confirmWithPassword(
    "This will delete ALL stored credentials and session data.",
  );
  if (!ok) return;

  const count = clearAllVars();
  console.log("");
  info(`✓ Deleted ${count} variable(s). Vars file is now empty.`);
  info("  Run  npx kite init  to set up again.");
  console.log("");
}

async function cleanAgent(agentId: string) {
  if (!/^\d+$/.test(agentId)) {
    console.error(
      `  Error: --agent must be a numeric agentId (e.g. --agent 1)`,
    );
    process.exit(1);
  }

  const matching = listVars().filter((k) => isAgentKey(k, agentId));
  if (matching.length === 0) {
    info(`No stored data found for agentId=${agentId}.`);
    return;
  }

  header(`Clean Agent ${agentId}`);
  info(`${matching.length} variable(s) will be deleted:`);
  for (const k of matching) {
    info(`  • ${k}`);
  }

  const ok = await confirmWithPassword(
    `This will delete all local data for agent ${agentId}.`,
  );
  if (!ok) return;

  const deleted = clearVarsWhere((k) => isAgentKey(k, agentId));
  console.log("");
  info(`✓ Deleted ${deleted.length} variable(s) for agentId=${agentId}.`);
  info(`  Run  npx kite onboard  to register a new agent.`);
  console.log("");
}

async function cleanSessions() {
  const matching = listVars().filter(isSessionKey);
  if (matching.length === 0) {
    info("No session data found in vars.");
    return;
  }

  header("Clean Sessions");
  info(`${matching.length} session variable(s) will be deleted:`);
  for (const k of matching) {
    info(`  • ${k}`);
  }

  const ok = await confirmWithPassword(
    "This will delete all session keys — agent-mode calls will fail until you re-onboard.",
  );
  if (!ok) return;

  const deleted = clearVarsWhere(isSessionKey);
  console.log("");
  info(`✓ Deleted ${deleted.length} session variable(s).`);
  info(`  Run  npx kite onboard  to create new session keys.`);
  console.log("");
}

// ── Entry point ────────────────────────────────────────────────────

export async function cmdClean(args: string[]) {
  // Help
  if (args.includes("--help") || args.includes("-h") || args.includes("help")) {
    console.log(`
  Usage: kite clean [options]

  Delete locally stored credentials and session data from
  ~/.kite-agent-pay/vars.json.

  Options:
    (none)          Delete ALL stored data (credentials + sessions)
    --agent <id>    Delete data for a specific agentId only
    --session       Delete all session keys (across all agents)
    --help          Show this help

  Two categories of data are stored:

    EOA / identity  PRIVATE_KEY, DEPLOYER_KEY, AGENT_<id>_* — needed by
                    onboarding commands (kite init, kite onboard, kite session)

    Session keys    SESSION_<id>_*  — needed by agent-mode commands
                    (kite call, kite balance, kite channel, …)

  Examples:
    npx kite clean                 Delete everything
    npx kite clean --session       Delete only session keys
    npx kite clean --agent 2       Delete all data for agent 2
`);
    return;
  }

  const agentIdx = args.indexOf("--agent");
  const hasSession = args.includes("--session");

  if (agentIdx !== -1) {
    const agentId = args[agentIdx + 1];
    if (!agentId || agentId.startsWith("--")) {
      console.error(
        "  Error: --agent requires a numeric agentId  (e.g. --agent 1)",
      );
      process.exit(1);
    }
    await cleanAgent(agentId);
  } else if (hasSession) {
    await cleanSessions();
  } else {
    // No flags → clean everything
    await cleanAll();
  }
}
