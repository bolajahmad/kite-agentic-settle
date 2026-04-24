import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
interface AgentService {
  name: string; // e.g. "MCP"
  endpoint: string; // publicly reachable URL
  version: string; // e.g. "v1"
}

interface AgentMetadata {
  type: string; // EIP-8004 registration URI
  name: string; // human-readable agent name
  description?: string;
  image?: string; // optional logo URL / data URI
  services?: AgentService[]; // list of exposed service endpoints
  x402Support?: boolean; // supports x402 single payments
  x402ChannelSupport?: boolean; // supports x402 payment channels
  active?: boolean;
  supportedTrust?: string[]; // e.g. ["crypto-economic"]
  tags?: string[];
  [key: string]: unknown;
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
 * Accepts one of three forms and always returns [base64EncodedURI, ""] on success,
 * or [undefined, reason] on any failure — never throws.
 *   1. A file path (.json or starting with / ./ ../) → read, validate, encode
 *   2. A raw JSON string (starts with '{')           → validate, encode
 *   3. An existing base64 string                     → decode, validate, return as-is
 */
function resolveAgentURI(
  metadataStr: string,
): [string, ""] | [undefined, string] {
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
      return [
        undefined,
        `Cannot read metadata file "${trimmed}": ${err.message}`,
      ];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [undefined, `Metadata file "${trimmed}" is not valid JSON`];
    }
    try {
      validateMetadata(parsed, `file "${trimmed}"`);
    } catch (err: any) {
      return [undefined, err.message];
    }
    return [Buffer.from(raw, "utf8").toString("base64"), ""];
  }

  // Case 2 – raw JSON string
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [undefined, "Metadata is not valid JSON"];
    }
    try {
      validateMetadata(parsed, "inline JSON");
    } catch (err: any) {
      return [undefined, err.message];
    }
    return [Buffer.from(trimmed, "utf8").toString("base64"), ""];
  }

  // Case 3 – base64 string
  let decoded: string;
  try {
    decoded = Buffer.from(trimmed, "base64").toString("utf8");
  } catch {
    return [undefined, "Metadata is not valid base64"];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return [undefined, "Decoded base64 metadata is not valid JSON"];
  }
  try {
    validateMetadata(parsed, "base64");
  } catch (err: any) {
    return [undefined, err.message];
  }
  return [trimmed, ""]; // already base64; return as-is
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

const AGENT_URI_TEMPLATE: AgentMetadata = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "My Agent",
  description: "Describe what your agent does",
  image: "",
  services: [
    {
      name: "MCP",
      endpoint: "http://localhost:3000",
      version: "v1",
    },
  ],
  x402Support: true,
  x402ChannelSupport: true,
  active: true,
  supportedTrust: ["crypto-economic"],
};

function tryClipboard(text: string): boolean {
  try {
    if (process.platform === "darwin") {
      execSync("pbcopy", { input: text });
    } else if (process.platform === "win32") {
      execSync("clip", { input: text });
    } else {
      try {
        execSync("xclip -selection clipboard", { input: text });
      } catch {
        execSync("xsel --clipboard --input", { input: text });
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function cmdShowAgentUriTemplate(args: string[]) {
  const json = JSON.stringify(AGENT_URI_TEMPLATE, null, 2);
  const agentURI = Buffer.from(json, "utf8").toString("base64");
  const outputPath = findFlag(args, "--output");

  header("Kite Agent URI — Metadata Template");
  console.log("");
  for (const line of json.split("\n")) console.log(`  ${line}`);
  console.log("");
  info(`Agent URI (base64): ${agentURI}`);
  console.log("");

  // Write to file if --output path provided
  if (outputPath) {
    const absPath = resolve(outputPath);
    try {
      writeFileSync(absPath, json, "utf8");
      info(`Template written to: ${absPath}`);
      info(`  npx kite onboard --metadata ${absPath}`);
    } catch (err: any) {
      info(`Warning: could not write to "${absPath}": ${err.message}`);
    }
  } else {
    info("Save this JSON to a file (e.g. agent.json) and run:");
    info("  npx kite onboard --metadata ./agent.json");
  }

  // Copy agentURI (base64) to clipboard
  const copied = tryClipboard(agentURI);
  if (copied) info("Agent URI (base64) copied to clipboard.");
  console.log("");
}

async function cmdShowAgentUriSchema(_args: string[]) {
  header("AgentMetadata Schema");
  console.log("");
  const lines = [
    "  interface AgentService {",
    '    name:     string   // e.g. "MCP"',
    "    endpoint: string   // publicly reachable URL",
    '    version:  string   // e.g. "v1"',
    "  }",
    "",
    "  interface AgentMetadata {",
    "    type:                 string          // required — EIP-8004 registration URI",
    "    name:                 string          // required — human-readable agent name",
    "    description?:         string",
    "    image?:               string          // logo URL or data URI",
    "    services?:            AgentService[]",
    "    x402Support?:         boolean         // supports x402 single payments",
    "    x402ChannelSupport?:  boolean         // supports x402 payment channels",
    "    active?:              boolean",
    '    supportedTrust?:      string[]        // e.g. ["crypto-economic"]',
    "    tags?:                string[]",
    "    [key: string]:        unknown         // additional custom fields allowed",
    "  }",
  ];
  for (const line of lines) console.log(line);
  console.log("");
}

async function cmdUpdateAgentUri(args: string[]) {
  header("Kite Agent — Update Agent URI");

  const credential =
    getVar("PRIVATE_KEY") ||
    (await prompt("  Provide seed phrase or private key: ", true));
  if (!credential)
    die(
      "Private key is required. Set PRIVATE_KEY env var or provide it at the prompt.",
    );

  const agentIdStr =
    findFlag(args, "--agent") ||
    (await prompt("  Agent ID (on-chain token ID): "));
  if (!agentIdStr?.trim()) die("Agent ID is required.");

  let agentId: bigint;
  try {
    agentId = BigInt(agentIdStr.trim());
  } catch {
    die(`Invalid agent ID "${agentIdStr}" — must be a number.`);
  }

  let metadataStr = findFlag(args, "--metadata") || findFlag(args, "-m");
  if (!metadataStr)
    metadataStr = await prompt("  Provide metadata JSON / file path: ");
  if (!metadataStr?.trim())
    die("Metadata is required to update the agent URI.");

  const [agentURI, resolveErr] = resolveAgentURI(metadataStr);
  if (!agentURI) die(resolveErr);

  info("");
  info(`Updating agent URI for agent #${agentId}...`);

  try {
    const client = await KiteSettleClient.create({ credential });
    const txHash = await client.updateAgentURI(agentId, agentURI);

    header("Agent URI Updated");
    info(`  Agent ID:  ${agentId}`);
    info(`  Tx hash:   ${txHash}`);
    info(`  New URI:   ${agentURI}`);
    console.log("");
  } catch (err: any) {
    die(err.message ?? String(err));
  }
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

  const [agentURI, resolveErr] = resolveAgentURI(metadata || "");
  if (!agentURI) info(resolveErr);

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

export async function cmdAgent(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "template":
      return cmdShowAgentUriTemplate(args.slice(1));
    case "schema":
      return cmdShowAgentUriSchema(args.slice(1));
    case "updateuri":
      return cmdUpdateAgentUri(args.slice(1));
    default:
      console.log("");
      console.log("  Usage: npx kite agent <command> [options]");
      console.log("");
      console.log("  Commands:");
      console.log(
        "    template    Print the EIP-8004 agent metadata JSON template",
      );
      console.log(
        "    schema      Print the AgentMetadata TypeScript interface",
      );
      console.log(
        "    updateuri   Update the on-chain agentURI for an existing agent",
      );
      console.log("");
      console.log("  Options:");
      console.log(
        "    --output <path>       Write the template JSON to a file (template only)",
      );
      console.log(
        "    --agent-id <n>        On-chain agent token ID (updateuri only)",
      );
      console.log(
        "    --metadata/-m <val>   Metadata JSON, file path, or base64 URI",
      );
      console.log("");
      console.log("  Examples:");
      console.log("    npx kite agent template");
      console.log("    npx kite agent template --output ./agent.json");
      console.log("    npx kite agent schema");
      console.log(
        "    npx kite agent updateuri --agent-id 1 --metadata ./agent.json",
      );
      console.log("");
  }
}
