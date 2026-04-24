import { readFileSync } from "node:fs";
import { KiteSettleClient } from "../../kite-settle-client.js";
import { getVar } from "../../vars.js";
import { findFlag, prompt } from "../index.js";

function header(title: string) {
  console.log("");
  console.log(`  ${title}`);
  console.log(`  ${"─".repeat(50)}`);
}

function die(msg: string): never {
  console.error(`\n  Error: ${msg}\n`);
  process.exit(1);
}

function info(msg: string) {
  console.log(`  ${msg}`);
}

// ── Metadata helpers ─────────────────────────────────────────────────────────
// AgentMetadata based off EIP-8004
interface AgentMetadata {
  type: string;
  name: string;
  supportx402Channels: true;
  description?: string;
  [key: string]: unknown;
  image?: string;
  tags?: string[];
}

function validateMetadata(parsed: unknown, source: string): AgentMetadata {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Metadata from ${source} must be a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.name !== "string" || !obj.name.trim()) {
    throw new Error(
      `Metadata from ${source} must include a non-empty "name" field`,
    );
  }
  return obj as AgentMetadata;
}

/**
 * Accepts one of three forms and always returns a base64-encoded agentURI:
 *   1. A file path (.json or starting with / ./ ../) → read, validate, encode
 *   2. A raw JSON string (starts with '{')           → validate, encode
 *   3. An existing base64 string                     → decode, validate, return as-is
 */
function resolveAgentURI(metadataStr: string): string {
  const trimmed = metadataStr.trim();

  // Case 1 – file path
  const looksLikePath =
    trimmed.endsWith(".json") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../");

  if (looksLikePath) {
    let raw: string;
    try {
      raw = readFileSync(trimmed, "utf8");
    } catch (err: any) {
      throw new Error(`Cannot read metadata file "${trimmed}": ${err.message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Metadata file "${trimmed}" is not valid JSON`);
    }
    validateMetadata(parsed, `file "${trimmed}"`);
    return Buffer.from(raw, "utf8").toString("base64");
  }

  // Case 2 – raw JSON string
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Metadata is not valid JSON");
    }
    validateMetadata(parsed, "inline JSON");
    return Buffer.from(trimmed, "utf8").toString("base64");
  }

  // Case 3 – base64 string
  let decoded: string;
  try {
    decoded = Buffer.from(trimmed, "base64").toString("utf8");
  } catch {
    throw new Error("Metadata is not valid base64");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error("Decoded base64 metadata is not valid JSON");
  }
  validateMetadata(parsed, "base64");
  return trimmed; // already base64; return as-is
}

type AgentCLIArgs = {
  metadata: string;
  valueLimit: string;
  totalLimit: string;
  validDays: string;
  fundAmount?: string;
  gasAmount?: string;
};
async function deriveAgentArguments(args: string[]): Promise<AgentCLIArgs> {
  // accept expected CLI flags
  let metadataStr = findFlag(args, "--metadata") || findFlag(args, "-m");
  let valueLimitStr = findFlag(args, "--value-limit");
  let totalLimitStr = findFlag(args, "--limit");
  let validDaysStr = findFlag(args, "--valid-days");
  let fundAmountStr = findFlag(args, "--fund");
  let gasAmountStr = findFlag(args, "--gas");

  // Ensure important data is provided
  if (!metadataStr)
    metadataStr = await prompt("  Provide metadata JSON / Metadata path: ");
  if (!valueLimitStr)
    valueLimitStr =
      (await prompt("  Value limit per tx in USDT [1.0]: ")) || "1.0";
  if (!totalLimitStr)
    totalLimitStr = (await prompt("  Total limit in USDT [10.0]: ")) || "10.0";
  if (!validDaysStr)
    validDaysStr = (await prompt("  Session validity in days [7]: ")) || "7";

  return {
    metadata: metadataStr,
    valueLimit: valueLimitStr,
    totalLimit: totalLimitStr,
    validDays: validDaysStr,
    fundAmount: fundAmountStr,
    gasAmount: gasAmountStr,
  };
}

// ── Onboard command ───────────────────────────────────────────────────────────
// Registeres a new User, Agent and creates a session for the agent.
// If needed, will also fund the AAWallet with specified token.
export async function cmdOnboardAgent(args: string[]): Promise<void> {
  header("Kite Agent Pay — Onboard Agent");
  let credential: string | undefined;

  // If PRIVATE_KEY is set, or prompt
  credential = getVar("PRIVATE_KEY");
  if (!credential)
    credential = await prompt("  Provide seed phrase or private key: ", true);
  if (!credential)
    die(
      "Private key is required to onboard an agent. Set PRIVATE_KEY env var or provide it at the prompt.",
    );

  let { metadata, validDays, valueLimit, totalLimit, fundAmount, gasAmount } =
    await deriveAgentArguments(args);

  const wantFund = await prompt("  Fund wallet? (y/N): ");
  if (wantFund.toLowerCase() === "y") {
    if (!fundAmount)
      fundAmount =
        (await prompt("  USDT amount to deposit [10.0]: ")) || "10.0";
    if (!gasAmount)
      gasAmount =
        (await prompt("  Native gas to send in ETH [0.001]: ")) || "0.001";
  }

  info("");
  info("Starting onboarding...");

  let agentURI: string;
  try {
    agentURI = resolveAgentURI(metadata || "");
  } catch (err: any) {
    die(err.message);
  }

  try {
    // Create the User's client instance
    const client = await KiteSettleClient.create({ credential });
    const result = await client.onboard(
      {
        agentURI,
        valueLimit: valueLimit ?? undefined,
        maxValueAllowed: totalLimit ?? undefined,
        validDays: validDays ? Number(validDays) : undefined,
        fundAmount: fundAmount ?? undefined,
        gasAmount: gasAmount ?? undefined,
      },
      (step) => info(`  → ${step}`),
    );

    header("Onboarding Complete");
    info(`  EOA Address:     ${result.eoaAddress}`);
    info(`  Agent ID:        ${result.agentId}`);
    info(`  Session key:     ${result.sessionKeyAddress}`);
    info(`  Session seed:    ${result.sessionSeed}`);
    info(`  Wallet balance:  ${result.walletUSDTBalance} USDT`);
    info("");
    for (const tx of result.txHashes) {
      if (tx.hash) info(`  ${tx.step}: ${tx.hash}`);
    }
  } catch (err: any) {
    die(err.message ?? String(err));
  }
}
