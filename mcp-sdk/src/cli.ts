#!/usr/bin/env node
/**
 * Kite Agent Pay — Unified CLI
 *
 * npx kite vars set <key>       Store a secret variable (hidden prompt)
 * npx kite vars get <key>       Retrieve a variable value
 * npx kite vars list            List stored variable names
 * npx kite vars delete <key>    Delete a variable
 * npx kite vars path            Show vars file location
 *
 * npx kite init                 Interactive first-time onboarding
 * npx kite whoami               Show current agent identity
 *
 * npx kite call                 Call a paid API endpoint
 * npx kite balance              Show agent token balance
 * npx kite usage                Show usage logs
 * npx kite fund <token> [amt]    Fund wallet with test tokens
 * npx kite withdraw [token] [amt]  Withdraw tokens from wallet (to EOA)
 * npx kite simulate             Run payment simulation
 */

import readline from "node:readline";
import { zeroAddress } from "viem";
import {
  deleteVar,
  getVar,
  getVarsPath,
  hasVar,
  listVars,
  setVar,
} from "./vars.js";

// ── Helpers ────────────────────────────────────────────────────────

export async function prompt(
  question: string,
  hidden = false,
): Promise<string> {
  return new Promise((res) => {
    if (hidden && process.stdin.isTTY) {
      const stdin = process.stdin;

      process.stdout.write(question);

      const wasRaw = stdin.isRaw;

      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf-8");

      let value = "";

      const onData = (chunk: string) => {
        const str = chunk.toString();

        // ENTER / RETURN
        if (str === "\n" || str === "\r" || str === "\u0004") {
          stdin.setRawMode(wasRaw ?? false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          return res(value);
        }

        // CTRL + C
        if (str === "\u0003") {
          process.exit(1);
        }

        // BACKSPACE (can come as multiple chars too)
        if (str === "\u007F" || str === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          return;
        }

        // 🔥 HANDLE NORMAL INPUT + PASTE
        // Remove any newline chars inside paste
        const clean = str.replace(/[\r\n]/g, "");

        if (!clean) return;

        // Append full chunk
        value += clean;

        // 🔥 CRITICAL: overwrite what terminal already printed
        // Move cursor back by length of pasted string
        process.stdout.write("\b".repeat(clean.length));

        // Replace with masked output
        process.stdout.write("*".repeat(clean.length));
      };

      stdin.on("data", onData);
    } else {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(question, (answer) => {
        rl.close();
        res(answer.trim());
      });
    }
  });
}

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

// ── Args ───────────────────────────────────────────────────────────

function getCliArgs(): string[] {
  return process.argv.slice(2);
}

export function findFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return undefined;
}

// ── vars subcommand ────────────────────────────────────────────────

async function cmdVars(args: string[]) {
  const sub = args[0];

  switch (sub) {
    case "set": {
      const key = args[1];
      if (!key) die("Usage: kite vars set <key>");

      const value = await prompt(`  Enter value for ${key}: `, true);
      if (!value) die("Value cannot be empty");

      setVar(key, value);
      info(`✓ Stored "${key}" in ${getVarsPath()}`);
      break;
    }

    case "get": {
      const key = args[1];
      if (!key) die("Usage: kite vars get <key>");
      const val = getVar(key);
      if (val === undefined) die(`Variable "${key}" is not set`);
      console.log(val);
      break;
    }

    case "list": {
      const keys = listVars();
      if (keys.length === 0) {
        info("No variables stored yet.");
        info(`Run: npx kite vars set <key>`);
      } else {
        header("Stored Variables");
        for (const k of keys) {
          info(`  ${k}`);
        }
        console.log("");
      }
      break;
    }

    case "delete": {
      const key = args[1];
      if (!key) die("Usage: kite vars delete <key>");
      if (deleteVar(key)) {
        info(`✓ Deleted "${key}"`);
      } else {
        die(`Variable "${key}" does not exist`);
      }
      break;
    }

    case "path": {
      console.log(getVarsPath());
      break;
    }

    case "setup": {
      // Show which essential vars are missing
      const essential = ["PRIVATE_KEY", "AGENT_SEED"];
      const missing = essential.filter((k) => !hasVar(k) && !process.env[k]);

      if (missing.length === 0) {
        info("All essential variables are set. ✓");
      } else {
        header("Missing Variables");
        for (const k of missing) {
          info(`  ${k}  — Run: npx kite vars set ${k}`);
        }
        console.log("");
      }
      break;
    }

    default:
      console.log(`
  Usage: kite vars <command>

  Commands:
    set <key>      Store a secret variable (hidden input)
    get <key>      Retrieve a variable value
    list           List all stored variable names
    delete <key>   Delete a variable
    path           Show vars file location
    setup          Check which variables are missing
`);
  }
}

// ── init subcommand ────────────────────────────────────────────────

async function cmdInit() {
  header("KiteSettler — EOA Setup");

  // Store seed phrase / private key in vars
  const existing = getVar("PRIVATE_KEY");
  if (existing) {
    info("Credential already stored in vars.");
    const overwrite = await prompt("  Overwrite? (y/N): ");
    if (overwrite.toLowerCase() !== "y") {
      info("Aborted.");
      return;
    }
  }

  info("Enter your EOA seed phrase or private key.");
  info("This will be stored locally in vars (never committed to git).\n");

  const credential = await prompt("  Seed phrase or private key: ", true);
  if (!credential) die("Credential cannot be empty");

  setVar("PRIVATE_KEY", credential);
  info(`✓ Stored PRIVATE_KEY in ${getVarsPath()}`);

  info("");
  info("Next steps:");
  info(`  npx kite onboard --name "My Agent"   — register agent on-chain`);
  info(`  npx kite whoami                      — verify identity`);
  console.log("");
}

// ── onboard subcommand ─────────────────────────────────────────────

async function cmdOnboard(args: string[]) {
  header("Kite Agent Pay — Onboard Agent");

  // Accept flags or prompt interactively
  let name = findFlag(args, "--name");
  let category = findFlag(args, "--category");
  let description = findFlag(args, "--description");
  let valueLimitStr = findFlag(args, "--value-limit");
  let dailyLimitStr = findFlag(args, "--daily-limit");
  let validDaysStr = findFlag(args, "--valid-days");
  let fundAmountStr = findFlag(args, "--fund");
  let gasAmountStr = findFlag(args, "--gas");
  const agentIndexStr = findFlag(args, "--agent-index");

  let credential: string | undefined;

  // Check vars first, then prompt
  credential = getVar("PRIVATE_KEY");
  if (!credential) {
    credential = await prompt("  Seed phrase or private key: ", true);
  }

  if (!credential) die("Seed phrase or private key is required");

  // Interactive prompts for missing values
  if (!name) name = await prompt("  Agent name: ");
  if (!name) die("Agent name is required");

  if (!category)
    category =
      (await prompt("  Category (e.g. defi, social, data) [general]: ")) ||
      "general";
  if (!description) description = (await prompt("  Description []: ")) || "";

  if (!valueLimitStr)
    valueLimitStr =
      (await prompt("  Value limit per tx in KTT [1.0]: ")) || "1.0";
  if (!dailyLimitStr)
    dailyLimitStr = (await prompt("  Daily limit in KTT [10.0]: ")) || "10.0";
  if (!validDaysStr)
    validDaysStr = (await prompt("  Session validity in days [30]: ")) || "30";

  const wantFund = await prompt("  Fund agent wallet? (y/N): ");
  if (wantFund.toLowerCase() === "y") {
    if (!fundAmountStr)
      fundAmountStr =
        (await prompt("  KTT amount to deposit [1.0]: ")) || "1.0";
    if (!gasAmountStr)
      gasAmountStr =
        (await prompt("  Native gas to send in ETH [0.001]: ")) || "0.001";
  }

  // Create client
  info("");
  info("Starting onboarding...");

  try {
    const { KitePaymentClient } = await import("./client.js");

    const client = await KitePaymentClient.create({
      seedPhrase: credential,
    });

    const result = await client.onboard(
      {
        agentName: name,
        category,
        description,
        agentIndex:
          agentIndexStr !== undefined ? parseInt(agentIndexStr, 10) : undefined,
        valueLimit: valueLimitStr,
        dailyLimit: dailyLimitStr,
        validDays: parseInt(validDaysStr!, 10),
        fundAmount: fundAmountStr,
        gasAmount: gasAmountStr,
      },
      (step) => info(`  → ${step}`),
    );

    header("Onboarding Complete");
    info(`  EOA Address:          ${result.eoaAddress}`);
    info(`  Agent Address:        ${result.agentAddress}`);
    info(`  Agent Private Key:    ${result.agentPrivateKey}`);
    info(`  Agent ID (on-chain):  ${result.agentId}`);
    info(`  Session Address:      ${result.sessionKeyAddress}`);
    info(`  Session Private Key:  ${result.sessionKeyPrivateKey}`);
    info("");
    info(`  Transactions:`);
    for (const tx of result.txHashes) {
      if (tx.hash) info(`    ${tx.step}: ${tx.hash}`);
    }
    info("");
    info(`  Balances:`);
    info(`    KTT (wallet):  ${result.walletKttBalance}`);
    info(`    KTT (EOA):     ${result.kttBalance}`);
    info(`    Native (EOA):  ${result.kiteBalance}`);
    console.log("");
  } catch (err: any) {
    die(err.message);
  }
}

// ── whoami subcommand ──────────────────────────────────────────────

async function cmdWhoami(args: string[]) {
  const agentIndexStr = findFlag(args, "--agent-index");

  try {
    // Load credential from vars
    const credential = getVar("PRIVATE_KEY");
    if (!credential) die("No credential found. Run: npx kite init");

    const { KitePaymentClient } = await import("./client.js");

    const client = await KitePaymentClient.create({
      seedPhrase: credential,
    });

    const isRegistered = await client
      .getContractService()
      .isUserRegistered(client.address);

    if (agentIndexStr == undefined) {
      info(`  EOA Address:    ${client.address}`);
      info(
        `  EOA Status:         ${isRegistered ? "Registered on-chain" : "Not registered on-chain"}`,
      );
    } else {
      let agentIndex = Number.parseInt(agentIndexStr, 10);
      if (Number.isNaN(agentIndex) || agentIndex < 0) {
        die("Invalid --agent-index value. Must be a non-negative integer.");
      }
      // Derive agent address at the given index
      const { deriveAgentAccount } = await import("./wallet.js");
      const agent = await deriveAgentAccount(
        client.getPrivateKey(),
        agentIndex,
      );

      info(`  EOA Address:    ${client.address}`);
      info(
        `  EOA Status:         ${isRegistered ? "Registered on-chain" : "Not registered on-chain"}`,
      );
      info(`  Agent ${agentIndex}'s Address:  ${agent.address}`);

      // Check agent's on-chain registration status
      try {
        const resolved = await client.resolveAgentByAddress(agent.address);
        const agentId = (resolved as any)[0] ?? (resolved as any).agentId;
        if (agentId && agentId !== zeroAddress) {
          info(`  Agent ID:       ${agentId}`);
          info(`  Status:         Registered on-chain`);
        } else {
          info(`  Status:         Not registered on-chain`);
        }

        // Show stored vars for this agent
        const storedId = getVar(`AGENT_${agentIndex}_ID`);
        if (storedId) info(`  Stored ID (vars): ${storedId}`);

        console.log("");
      } catch (error: any) {
        info(`  Status:         Not registered on-chain`);
        die(error.message);
      }
    }
  } catch (err: any) {
    die(err.message);
  }
}

// ── help ───────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
  Kite Agent Pay CLI

  Configuration:
    kite vars set <key>       Store a secret variable (hidden input)
    kite vars get <key>       Retrieve a variable value
    kite vars list            List stored variable names
    kite vars delete <key>    Delete a variable
    kite vars setup           Check which variables are missing
    kite vars path            Show vars file path

  Setup:
    kite init                 Interactive first-time onboarding
    kite onboard              One-step agent onboarding (register + session key)
    kite whoami               Show current agent identity

  Commands:
    kite call                 Call a paid API endpoint
    kite balance              Show agent token balance
    kite usage                Show usage logs
    kite fund <addr> [amt]    Fund with test tokens
    kite simulate             Run payment simulation

  Options:
    --agent-index <n>         Agent derivation index (default: 0)
    --decide <mode>           Decision mode: auto, rules, ai, cli
    --url <url>               Target a live API URL

  Examples:
    npx kite vars set AGENT_1_SEED
    npx kite init
    npx kite onboard --name "My Agent" --category defi
    npx kite call --agent-index 0
    npx kite call --agent-index 0 --decide rules
    npx kite balance --token "" --show-native
    npx kite whoami --agent-index 1

  Config files:
    ~/.kite-agent-pay/vars.json  Secrets & credentials (local only, mode 0600)
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
      case "vars":
        await cmdVars(args.slice(1));
        break;

      case "init":
        await cmdInit();
        break;

      case "onboard":
        await cmdOnboard(args.slice(1));
        break;

      case "whoami":
        await cmdWhoami(args.slice(1));
        break;
      
      case "session": {
        const { cmdSessions } = await import("./commands/sessions.js");
        await cmdSessions(args.slice(1));
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
