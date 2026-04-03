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
 * npx kite whoami [--agent id]  Show current agent identity
 *
 * npx kite call [--agent id]    Call a paid API endpoint
 * npx kite balance [--agent id] Show agent token balance
 * npx kite usage [--agent id]   Show usage logs
 * npx kite fund <addr> [amt]    Fund wallet with test tokens
 * npx kite simulate             Run payment simulation
 */
import readline from "node:readline";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getVar, setVar, deleteVar, listVars, hasVar, getVarsPath, } from "./vars.js";
import { loadAgents, getAgent } from "./agents.js";
// ── Helpers ────────────────────────────────────────────────────────
function prompt(question, hidden = false) {
    return new Promise((res) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        if (hidden && process.stdin.isTTY) {
            // Hide input for secrets
            process.stdout.write(question);
            const stdin = process.stdin;
            const wasRaw = stdin.isRaw;
            stdin.setRawMode(true);
            stdin.resume();
            stdin.setEncoding("utf-8");
            let value = "";
            const onData = (ch) => {
                const c = ch.toString();
                if (c === "\n" || c === "\r" || c === "\u0004") {
                    stdin.setRawMode(wasRaw ?? false);
                    stdin.pause();
                    stdin.removeListener("data", onData);
                    rl.close();
                    process.stdout.write("\n");
                    res(value);
                }
                else if (c === "\u0003") {
                    // Ctrl+C
                    process.exit(1);
                }
                else if (c === "\u007F" || c === "\b") {
                    // Backspace
                    if (value.length > 0) {
                        value = value.slice(0, -1);
                        process.stdout.write("\b \b");
                    }
                }
                else {
                    value += c;
                    process.stdout.write("*");
                }
            };
            stdin.on("data", onData);
        }
        else {
            rl.question(question, (answer) => {
                rl.close();
                res(answer.trim());
            });
        }
    });
}
function info(msg) {
    console.log(`  ${msg}`);
}
function header(title) {
    console.log("");
    console.log(`  ${title}`);
    console.log(`  ${"─".repeat(50)}`);
}
function die(msg) {
    console.error(`\n  Error: ${msg}\n`);
    process.exit(1);
}
// ── Args ───────────────────────────────────────────────────────────
function getCliArgs() {
    return process.argv.slice(2);
}
function findFlag(args, flag) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1])
        return args[idx + 1];
    return undefined;
}
// ── vars subcommand ────────────────────────────────────────────────
async function cmdVars(args) {
    const sub = args[0];
    switch (sub) {
        case "set": {
            const key = args[1];
            if (!key)
                die("Usage: kite vars set <key>");
            const value = await prompt(`  Enter value for ${key}: `, true);
            if (!value)
                die("Value cannot be empty");
            setVar(key, value);
            info(`✓ Stored "${key}" in ${getVarsPath()}`);
            break;
        }
        case "get": {
            const key = args[1];
            if (!key)
                die("Usage: kite vars get <key>");
            const val = getVar(key);
            if (val === undefined)
                die(`Variable "${key}" is not set`);
            console.log(val);
            break;
        }
        case "list": {
            const keys = listVars();
            if (keys.length === 0) {
                info("No variables stored yet.");
                info(`Run: npx kite vars set <key>`);
            }
            else {
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
            if (!key)
                die("Usage: kite vars delete <key>");
            if (deleteVar(key)) {
                info(`✓ Deleted "${key}"`);
            }
            else {
                die(`Variable "${key}" does not exist`);
            }
            break;
        }
        case "path": {
            console.log(getVarsPath());
            break;
        }
        case "setup": {
            // Show which vars are referenced in agents.json but not yet stored
            try {
                const agentsPath = resolve(process.cwd(), "agents.json");
                if (!existsSync(agentsPath)) {
                    info("No agents.json found. Run: npx kite init");
                    return;
                }
                const raw = JSON.parse((await import("node:fs")).readFileSync(agentsPath, "utf-8"));
                const needed = [];
                for (const [, agent] of Object.entries(raw.agents)) {
                    if (agent.seed.startsWith("$")) {
                        const key = agent.seed.slice(1);
                        if (!hasVar(key) && !process.env[key]) {
                            needed.push(key);
                        }
                    }
                }
                if (needed.length === 0) {
                    info("All required variables are set. ✓");
                }
                else {
                    header("Missing Variables");
                    for (const k of needed) {
                        info(`  ${k}  — Run: npx kite vars set ${k}`);
                    }
                    console.log("");
                }
            }
            catch (err) {
                die(err.message);
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
    header("Kite Agent Pay — Setup");
    const agentsPath = resolve(process.cwd(), "agents.json");
    if (existsSync(agentsPath)) {
        const overwrite = await prompt("  agents.json already exists. Overwrite? (y/N): ");
        if (overwrite.toLowerCase() !== "y") {
            info("Aborted.");
            return;
        }
    }
    const agents = {
        defaultAgent: "",
        agents: {},
    };
    let addMore = true;
    let agentNum = 0;
    while (addMore) {
        agentNum++;
        console.log("");
        info(`── Agent ${agentNum} ──`);
        const id = (await prompt(`  Agent ID (e.g. agent-${agentNum}): `)) ||
            `agent-${agentNum}`;
        const name = (await prompt("  Agent name: ")) || `Agent ${agentNum}`;
        const wallet = await prompt("  KiteAA Wallet address (0x...): ");
        if (!wallet.startsWith("0x"))
            die("Wallet must start with 0x");
        // Seed phrase — store in vars
        const seedVarKey = `${id.toUpperCase().replace(/-/g, "_")}_SEED`;
        info(`Seed will be stored as: ${seedVarKey}`);
        const seed = await prompt("  Seed phrase: ", true);
        if (!seed)
            die("Seed phrase cannot be empty");
        setVar(seedVarKey, seed);
        info(`✓ Stored ${seedVarKey}`);
        // Rules with defaults
        info("");
        info("Payment rules (press Enter for defaults):");
        const maxPerCall = (await prompt("  Max per call in KTT [0.5]: ")) || "0.5";
        const maxPerSession = (await prompt("  Max per session in KTT [5.0]: ")) || "5.0";
        const approvalAbove = (await prompt("  Require approval above KTT [1.0]: ")) || "1.0";
        const rules = {
            maxPerCall: toWei(maxPerCall),
            maxPerSession: toWei(maxPerSession),
            allowedProviders: [],
            blockedProviders: [],
            requireApprovalAbove: toWei(approvalAbove),
        };
        // Batch config with defaults
        info("");
        info("Batch session config (press Enter for defaults):");
        const batchMaxDeposit = (await prompt("  Max batch deposit in KTT [1.0]: ")) || "1.0";
        const batchDuration = (await prompt("  Max batch duration in seconds [300]: ")) || "300";
        const batchCalls = (await prompt("  Max calls per batch [20]: ")) || "20";
        const batch = {
            maxDeposit: toWei(batchMaxDeposit),
            maxDurationSeconds: parseInt(batchDuration, 10),
            maxCalls: parseInt(batchCalls, 10),
        };
        agents.agents[id] = {
            name,
            seed: `$${seedVarKey}`,
            wallet,
            rules,
            batch,
        };
        if (!agents.defaultAgent)
            agents.defaultAgent = id;
        const more = await prompt("\n  Add another agent? (y/N): ");
        addMore = more.toLowerCase() === "y";
    }
    writeFileSync(agentsPath, JSON.stringify(agents, null, 2) + "\n");
    info(`\n✓ Created ${agentsPath}`);
    info(`✓ Secrets stored in ${getVarsPath()}`);
    info("");
    info("Next steps:");
    info(`  npx kite whoami          — verify identity`);
    info(`  npx kite balance         — check token balance`);
    info(`  npx kite call            — make a paid API call`);
    console.log("");
}
function toWei(ktt) {
    // Simple conversion: multiply by 1e18
    const parts = ktt.split(".");
    const whole = parts[0] || "0";
    const frac = (parts[1] || "").padEnd(18, "0").slice(0, 18);
    return (BigInt(whole) * 10n ** 18n + BigInt(frac)).toString();
}
// ── whoami subcommand ──────────────────────────────────────────────
async function cmdWhoami(args) {
    const agentId = findFlag(args, "--agent");
    try {
        const agents = loadAgents();
        const agent = getAgent(agents, agentId);
        // Lazy import to avoid loading WDK for vars commands
        const { KitePaymentClient } = await import("./client.js");
        const client = await KitePaymentClient.create({
            seedPhrase: agent.seed,
            walletAddress: agent.wallet,
        });
        header(`Agent: ${agent.id}`);
        info(`  Name:      ${agent.name}`);
        info(`  Address:   ${client.address}`);
        info(`  Wallet:    ${agent.wallet}`);
        info(`  Rules:`);
        info(`    Max/call:    ${fmtWei(agent.rules.maxPerCall)} KTT`);
        info(`    Max/session: ${fmtWei(agent.rules.maxPerSession)} KTT`);
        info(`    Approve < :  ${fmtWei(agent.rules.requireApprovalAbove)} KTT`);
        if (agent.batch) {
            info(`  Batch:`);
            info(`    Max deposit: ${fmtWei(agent.batch.maxDeposit)} KTT`);
            info(`    Duration:    ${agent.batch.maxDurationSeconds}s`);
            info(`    Max calls:   ${agent.batch.maxCalls}`);
        }
        console.log("");
    }
    catch (err) {
        die(err.message);
    }
}
function fmtWei(wei) {
    const n = BigInt(wei);
    const whole = n / 10n ** 18n;
    const frac = n % 10n ** 18n;
    if (frac === 0n)
        return whole.toString();
    const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
    return `${whole}.${fracStr}`;
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
    kite whoami               Show current agent identity

  Commands:
    kite call                 Call a paid API endpoint
    kite balance              Show agent token balance
    kite usage                Show usage logs
    kite fund <addr> [amt]    Fund with test tokens
    kite simulate             Run payment simulation

  Options:
    --agent <id>              Agent ID from agents.json
    --decide <mode>           Decision mode: auto, rules, ai, cli
    --url <url>               Target a live API URL

  Examples:
    npx kite vars set AGENT_1_SEED
    npx kite init
    npx kite call --agent agent-1
    npx kite call --agent agent-1 --decide rules
    npx kite balance
    npx kite whoami --agent agent-2

  Config files:
    agents.json               Agent metadata (committable, no secrets)
    ~/.kite-agent-pay/vars.json  Secrets (local only, mode 0600)
`);
}
// ── Main router ────────────────────────────────────────────────────
async function main() {
    const args = getCliArgs();
    const command = args[0] || "help";
    console.log("");
    console.log("  Kite Agent Pay");
    try {
        switch (command) {
            case "vars":
                await cmdVars(args.slice(1));
                break;
            case "init":
                await cmdInit();
                break;
            case "whoami":
                await cmdWhoami(args.slice(1));
                break;
            case "call":
            case "balance":
            case "usage":
            case "fund":
            case "simulate": {
                // Delegate to the app module (lazy import to keep vars/init fast)
                const { runAppCommand } = await import("./app-commands");
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
    }
    catch (err) {
        die(err.message);
    }
}
main();
