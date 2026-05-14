#!/usr/bin/env node
/**
 * Kite Agent Pay — Unified CLI
 *
 * npx kite init                 Store EOA credential (private key / seed phrase)
 * npx kite onboard              One-step agent registration + session key setup
 * npx kite whoami               Show current agent identity
 *
 * npx kite call                 Call a paid API endpoint
 * npx kite balance              Show agent token balance
 * npx kite usage                Show usage logs
 * npx kite fund <token> [amt]   Fund wallet with test tokens
 * npx kite withdraw [token] [amt]  Withdraw tokens from wallet (to EOA)
 * npx kite simulate             Run payment simulation
 *
 * Config is written only by: kite init, kite onboard, kite session create
 * There is no manual vars command — use those commands to set credentials.
 */

import { KITE_TESTNET } from "../config.js";
import { ContractService } from "../contracts.js";
import { KiteSettleClient } from "../kite-settle-client.js";
import { prompt } from "../utils/index.js";
import { getCredential, getConfigPath, setCredential, getVar } from "../vars.js";

// ── Helpers ────────────────────────────────────────────────────────

function info(msg: string) {
  console.log(`  ${msg}`);
}

function header(title: string) {
  console.log("");
  console.log(`  ${title}`);
  console.log(`  ${"─".repeat(50)}`);
}

function die(msg: string): never {
  console.error(`\n  Error: ${msg}\n`);
  process.exit(1);
}

function getCliArgs(): string[] {
  return process.argv.slice(2);
}

export function findFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return undefined;
}

function truncateText(text: string, maxLen = 120): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}...`;
}

function decodeAgentMetadataURI(
  agentURI: string,
): { name?: string; shortDescription?: string } | null {
  const trimmed = agentURI.trim();
  const parseObject = (
    text: string,
  ): { name?: string; shortDescription?: string } | null => {
    try {
      const parsed = JSON.parse(text);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return null;
      }
      const obj = parsed as Record<string, unknown>;
      const name = typeof obj.name === "string" ? obj.name.trim() : undefined;
      const descValue =
        typeof obj.description === "string"
          ? obj.description
          : typeof obj.shortDescription === "string"
            ? obj.shortDescription
            : undefined;
      const shortDescription = descValue?.replace(/\s+/g, " ").trim();
      return {
        name: name || undefined,
        shortDescription: shortDescription || undefined,
      };
    } catch {
      return null;
    }
  };

  if (trimmed.startsWith("{")) {
    return parseObject(trimmed);
  }

  const dataUriPrefix = "data:application/json;base64,";
  if (trimmed.toLowerCase().startsWith(dataUriPrefix)) {
    const b64 = trimmed.slice(dataUriPrefix.length);
    return parseObject(Buffer.from(b64, "base64").toString("utf8"));
  }

  return parseObject(Buffer.from(trimmed, "base64").toString("utf8"));
}

// ── init subcommand ────────────────────────────────────────────────
async function cmdInit() {
  header("KiteSettler — EOA Setup");

  // Store seed phrase / private key in dedicated config file
  const existing = getCredential();
  if (existing) {
    info("Credential already stored in config.");
    const overwrite = await prompt("  Overwrite? (y/N): ");
    if (overwrite.toLowerCase() !== "y") {
      info("Aborted.");
      return;
    }
  }

  info("Enter your EOA seed phrase or private key.");
  info("This will be stored locally in a dedicated config file (never committed to git).\n");

  const credential = await prompt("  Seed phrase or private key: ", true);
  if (!credential) die("Credential cannot be empty");

  setCredential(credential);
  info(`  Stored credential in ${getConfigPath()}`);

  info("");
  info("Next steps:");
  info(`  npx kite onboard --name "My Agent"   — register agent on-chain`);
  info(`  npx kite whoami                      — verify identity`);
  console.log("");
}

// ── whoami subcommand ──────────────────────────────────────────────
async function cmdWhoami(args: string[]) {
  const agentIndexStr =
    findFlag(args, "--agent") ??
    findFlag(args, "--agent-id") ??
    findFlag(args, "--agent-index") ??
    findFlag(args, "-aid");

  try {
    // Load credential from vars (optional for agent-scoped whoami)
    const credential = getCredential();
    if (!credential && agentIndexStr == undefined) {
      die("No credential found. Run: npx kite init or pass --agent <id>");
    }

    if (agentIndexStr == undefined) {
      const client = await KiteSettleClient.create({ credential });
      const aaWalletAddress = await client
        .getOwnerAAWalletAddress()
        .catch(() => undefined);
      const ownedAgents = await client
        .getAgentsByOwner(client.eoaAddress)
        .catch(() => []);
      const hasOnchainAgents = ownedAgents.length > 0;

      info(`  EOA Address:    ${client.eoaAddress}`);
      info(`  AA Wallet:      ${aaWalletAddress ?? "Unable to resolve"}`);
      info(
        `  Identity Status: ${hasOnchainAgents ? `Registered (${ownedAgents.length} agent${ownedAgents.length === 1 ? "" : "s"})` : "No registered agents found"}`,
      );
    } else {
      let agentId: bigint;
      try {
        agentId = BigInt(agentIndexStr);
      } catch {
        die(
          "Invalid --agent value. Must be a non-negative integer (on-chain agentId).",
        );
      }
      if (agentId < 0n) {
        die(
          "Invalid --agent value. Must be a non-negative integer (on-chain agentId).",
        );
      }

      const readContracts = new ContractService(KITE_TESTNET, null, "");
      const ownerOnchain = await readContracts
        .getAgentOwner(agentId)
        .catch(() => null);
      const agentURI = await readContracts
        .getAgentURI(agentId)
        .catch(() => null);
      const decoded = agentURI ? decodeAgentMetadataURI(agentURI) : null;
      const walletFromRegistry = await readContracts
        .getAgentWalletFromRegistry(agentId)
        .catch(() => null);

      const credentialClient = credential
        ? await KiteSettleClient.create({ credential }).catch(() => null)
        : null;
      const aaWalletAddress = credentialClient
        ? await credentialClient
            .getOwnerAAWalletAddress()
            .catch(() => undefined)
        : undefined;

      // Agents are NFTs (IdentityRegistry tokenIds). Session keys are bound
      // to the agent and stored locally during `kite onboard`.
      const sessionAddr = getVar(`SESSION_${agentId}_0_ADDRESS`);
      const ownerAddr = getVar(`AGENT_${agentId}_OWNER`);
      const walletFromVars = getVar(`AGENT_${agentId}_WALLET`);
      const resolvedOwner =
        walletFromRegistry?.user ?? ownerOnchain ?? ownerAddr ?? "Unknown";
      const resolvedWallet =
        walletFromRegistry?.walletContract ??
        walletFromVars ??
        aaWalletAddress ??
        "Unknown";

      info(`  EOA Address:    ${resolvedOwner}`);
      info(`  AA Wallet:      ${resolvedWallet}`);
      info(
        `  Agent Status:    ${ownerOnchain ? "Found on IdentityRegistry" : "Not found on IdentityRegistry"}`,
      );
      info("\n");
      info(`    Agent ID:       ${agentId}  (NFT on IdentityRegistry)`);
      if (decoded?.name) {
        info(`    Agent Name:     ${decoded.name}`);
      }
      if (decoded?.shortDescription) {
        info(
          `    Description:    ${truncateText(decoded.shortDescription, 140)}`,
        );
      }
      if (!decoded && agentURI) {
        info(`    Metadata URI:   Present (non-decodable format)`);
      }
      if (sessionAddr) {
        info(`    Session Key:    ${sessionAddr}`);
        info(`    Session Status: Stored (run onboard to renew)`);
      } else {
        info(`    Session Key:    Not found — run: npx kite onboard`);
      }

      console.log("");
    }
  } catch (err: any) {
    die(err.message);
  }
}

// ── help ───────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
  Kite Agent Pay CLI

  Setup (run once — writes credentials to local config):
    kite init                 Store your EOA private key / seed phrase
    kite onboard              Register agent on-chain + create session key
    kite whoami               Show current agent identity
    kite clean                Delete stored config/credentials (prompts for confirmation)
    kite clean --agent <id>   Delete data for a specific agent only
    kite clean --session      Delete all session keys only

  Note: config is written only by the commands above.
        Use kite init, kite onboard, or kite session create to update credentials.

  EOA commands (require credential from kite init — run by the wallet owner):
    kite init, kite onboard, kite session start|revoke, kite agent register

  Agent commands (use session keys — can run autonomously):
    kite call, kite balance, kite channel *, kite usage, kite simulate

  Commands:
    kite call                 Call a paid API endpoint
    kite call --mode batch    Open a channel, make N calls, settle
    kite call --mode stream   Open a channel, call for T seconds, settle
    kite balance              Show agent token balance
    kite usage                Show usage logs
    kite fund <addr> [amt]    Fund with test tokens
    kite simulate             Run payment simulation

  Channel commands (manual multi-route):
    kite channel open         Open a payment channel
    kite channel call         Make a call on an existing channel (any endpoint)
    kite channel status       Show on-chain + local channel state
    kite channel list         List all channels for an agent
    kite channel resume       Re-attach to an existing channel
    kite channel close        Initiate settlement (agent/session)
    kite channel force-close  Force-close expired / finalize (EOA)

  Options:
    --agent-index <n>         Agent derivation index (default: 0)
    --agent <id>              On-chain agentId (for whoami/session/channel)
    --decide <mode>           Decision mode: auto, rules, ai, cli
    --url <url>               Target a live API URL

  Examples:
    npx kite init
    npx kite onboard --name "My Agent" --category defi
    npx kite call --agent-index 0
    npx kite call --agent-index 0 --decide rules
    npx kite balance --token "" --show-native
    npx kite whoami --agent 1

  Config files:
    ~/.kite-agent-pay/config.json  EOA credential from kite init (mode 0600)
    ~/.kite-agent-pay/vars.json    Agent/session keys from onboarding (mode 0600)
`);
}

// ── Main router ────────────────────────────────────────────────────

async function main() {
  const args = getCliArgs();
  const command = args[0] || "help";

  console.log("");
  console.log("  KiteSettler");

  try {
    switch (command) {
      case "init":
        await cmdInit();
        break;

      case "whoami":
        await cmdWhoami(args.slice(1));
        break;

      case "agent": {
        const { cmdAgent } = await import("./commands/agent.js");
        await cmdAgent(args.slice(1));
        break;
      }

      case "onboard": {
        const { cmdOnboardAgent } = await import("./commands/agent.js");
        await cmdOnboardAgent(args.slice(1));
        break;
      }

      case "channel": {
        const { cmdChannels } = await import("./commands/channels.js");
        await cmdChannels(args.slice(1));
        break;
      }

      case "session": {
        const { cmdSessions } = await import("./commands/sessions.js");
        await cmdSessions(args.slice(1));
        break;
      }

      case "clean": {
        const { cmdClean } = await import("./commands/clean.js");
        await cmdClean(args.slice(1));
        break;
      }

      case "call":
      case "balance":
      case "usage":
      case "fund":
      case "withdraw":
      case "simulate": {
        // Delegate to the app module (lazy import to keep vars/init fast)
        const { runAppCommand } = await import("./commands/index.js");
        await runAppCommand(command, args.slice(1));
        break;
      }

      case "help":
      case "--help":
      case "-h":
        showHelp();
        break;

      default:
        console.error(`  Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (err: any) {
    die(err.message);
  }
}

main();
