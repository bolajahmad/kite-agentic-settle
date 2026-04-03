/**
 * Unified CLI entry point for Kite Agent Pay SDK
 *
 * Usage:
 *   npx tsx examples/app.ts call
 *   npx tsx examples/app.ts call --decide ai
 *   npx tsx examples/app.ts call --decide cli --url https://some-live-api.com/data
 *   npx tsx examples/app.ts call --agent agent-2 --decide rules
 *   npx tsx examples/app.ts balance
 *   npx tsx examples/app.ts usage
 *   npx tsx examples/app.ts fund <address> [amount]
 *
 * Env:
 *   DEPLOYER_KEY      - deployer key for gas funding (fund command)
 *   OPENAI_API_KEY    - OpenAI key (for --decide ai)
 */

import http from "node:http";
import readline from "node:readline";
import {
  formatUnits,
  parseUnits,
  createPublicClient,
  createWalletClient,
  http as viemHttp,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { KitePaymentClient, KITE_TESTNET, erc20Abi } from "../src/index.js";
import { loadAgents, getAgent } from "../src/agents.js";
import { decide } from "../src/decide.js";
import type { DecisionMode } from "../src/decide.js";
import type { PaymentRequest, PaymentResult } from "../src/types.js";

// ── Defaults ───────────────────────────────────────────────────────

const USER2_ADDR = "0xEf7a2Cc08d80AaBB2fE1e75D90f7bb354BB8289c";
const TOKEN = KITE_TESTNET.token;
const MOCK_PORT = 4100;
const SERVICE_PRICE = "100000000000000000"; // 0.1 KTT
const USER2_KEY =
  "0xbd88d7931ce6ffc84d45264da93b7b63bf945b339ff14742b9cfcff2ce0c0b72" as `0x${string}`;

// ── CLI arg parsing ────────────────────────────────────────────────

interface CliArgs {
  command: string;
  decide: DecisionMode;
  agentId?: string;
  url?: string;
  // fund command
  fundAddress?: string;
  fundAmount?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  let decideMode: DecisionMode = "auto";
  let agentId: string | undefined;
  let url: string | undefined;
  let fundAddress: string | undefined;
  let fundAmount: string | undefined;

  // For fund command, positional args
  if (command === "fund") {
    fundAddress = args[1];
    fundAmount = args[2];
  }

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--decide" && args[i + 1]) {
      decideMode = args[++i] as DecisionMode;
    } else if (args[i] === "--agent" && args[i + 1]) {
      agentId = args[++i];
    } else if (args[i] === "--url" && args[i + 1]) {
      url = args[++i];
    }
  }

  return { command, decide: decideMode, agentId, url, fundAddress, fundAmount };
}

// ── Formatting ─────────────────────────────────────────────────────

function fmt(wei: bigint): string {
  return formatUnits(wei, 18);
}

function formatReceipt(
  result: PaymentResult,
  url: string,
  responseBody?: any,
): string {
  let lines = [
    "",
    "── Payment Receipt ───────────────────────────────────────",
    `  Status:      ${result.success ? "SUCCESS" : "FAILED"}`,
    `  Method:      ${result.method}`,
    `  Amount:      ${fmt(result.amount)} KTT`,
    `  Service:     ${url}`,
  ];
  if (result.txHash) {
    lines = lines.concat([
      `  Tx Hash:     ${result.txHash}`,
      `  Explorer:    https://testnet.kitescan.ai/tx/${result.txHash}`,
    ]);
  }
  if (result.receipt) {
    if (result.receipt.sessionId)
      lines = lines.concat([
        `  Session:     ${result.receipt.sessionId}`,
        `  Nonce:       ${result.receipt.nonce}`,
        `  Provider:    ${result.receipt.provider}`,
        `  Consumer:    ${result.receipt.consumer}`,
      ]);
  }
  lines.push(`  Timestamp:   ${new Date().toISOString()}`);
  if (responseBody?.providerSignature) {
    lines = lines.concat([
      "",
      "  Provider Receipt (EIP-712 signed):",
      `  Signer:      ${responseBody.receipt?.provider || "unknown"}`,
      `  Signature:   ${responseBody.providerSignature}`,
    ]);
    if (responseBody.receipt) {
      lines = lines.concat([
        `  Service:     ${responseBody.receipt.service}`,
        `  Nonce:       ${responseBody.receipt.nonce}`,
        `  Timestamp:   ${responseBody.receipt.timestamp}`,
      ]);
    }
  }
  lines = lines.concat([
    "──────────────────────────────────────────────────────────",
    "",
  ]);
  return lines.join("\n");
}

// ── Interactive prompt ─────────────────────────────────────────────

function askUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function promptForPayment(req: PaymentRequest): Promise<boolean> {
  console.log("");
  console.log("── Payment Required ──────────────────────────────────────");
  console.log(`  Service:     ${req.url}`);
  console.log(`  Amount:      ${fmt(req.price)} KTT`);
  console.log(`  Pay To:      ${req.payTo}`);
  console.log(`  Asset:       ${req.asset}`);
  console.log(`  Scheme:      ${req.scheme}`);
  if (req.description) console.log(`  Description: ${req.description}`);
  if (req.merchantName) console.log(`  Merchant:    ${req.merchantName}`);
  console.log("──────────────────────────────────────────────────────────");
  console.log("");

  const answer = await askUser("  Approve payment? (yes/no): ");
  return answer === "yes" || answer === "y";
}

// ── Mock weather API ───────────────────────────────────────────────

const EIP712_DOMAIN = {
  name: "KitePaymentReceipt",
  version: "1",
  chainId: 2368,
} as const;

const EIP712_TYPES = {
  PaymentReceipt: [
    { name: "txHash", type: "string" },
    { name: "amount", type: "string" },
    { name: "service", type: "string" },
    { name: "provider", type: "address" },
    { name: "timestamp", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

function startMockAPI(): Promise<http.Server> {
  const providerAccount = privateKeyToAccount(USER2_KEY);

  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const xPayment = req.headers["x-payment"] as string | undefined;

      if (!xPayment) {
        res.writeHead(402, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Payment Required",
            accepts: [
              {
                scheme: "gokite-aa",
                network: "kite-testnet",
                maxAmountRequired: SERVICE_PRICE,
                resource: req.url,
                description: "Weather API - real-time weather data",
                mimeType: "application/json",
                payTo: USER2_ADDR,
                asset: TOKEN,
                maxTimeoutSeconds: 300,
                merchantName: "Weather Co.",
              },
            ],
            x402Version: 1,
          }),
        );
        return;
      }

      try {
        const timestamp = BigInt(Math.floor(Date.now() / 1000));
        const nonce = BigInt(Date.now());
        const service = req.url || "/weather/kite-city";

        const providerSignature = await providerAccount.signTypedData({
          domain: EIP712_DOMAIN,
          types: EIP712_TYPES,
          primaryType: "PaymentReceipt",
          message: {
            txHash: xPayment,
            amount: SERVICE_PRICE,
            service,
            provider: USER2_ADDR as `0x${string}`,
            timestamp,
            nonce,
          },
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            location: "Kite City",
            temperature: "24°C",
            condition: "Sunny with light clouds",
            humidity: "45%",
            wind: "12 km/h NE",
            forecast: "Clear skies expected through the evening",
            provider: "Weather Co.",
            paymentTx: xPayment,
            receipt: {
              txHash: xPayment,
              amount: SERVICE_PRICE,
              service,
              provider: USER2_ADDR,
              timestamp: timestamp.toString(),
              nonce: nonce.toString(),
            },
            providerSignature,
          }),
        );
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    server.listen(MOCK_PORT, () => resolve(server));
  });
}

// ── Commands ───────────────────────────────────────────────────────

async function callApi(opts: CliArgs) {
  // Load agent config
  const agents = loadAgents();
  const agent = getAgent(agents, opts.agentId);
  console.log(`  Agent:    ${agent.id} (${agent.name})`);
  console.log(`  Decide:   ${opts.decide}`);

  let server: http.Server | null = null;
  let apiUrl: string;

  if (opts.url) {
    apiUrl = opts.url;
    console.log(`  Target:   ${apiUrl} (live)`);
  } else {
    server = await startMockAPI();
    apiUrl = `http://localhost:${MOCK_PORT}/weather/kite-city`;
    console.log(`  Target:   ${apiUrl} (mock)`);
  }

  console.log(`  Wallet:   ${agent.wallet}`);
  console.log("");

  const client = await KitePaymentClient.create({
    seedPhrase: agent.seed,
    defaultPaymentMode: "x402" as const,
    walletAddress: agent.wallet,
    agentId: agent.id,
  });

  console.log(`  Address:  ${client.address}`);

  const balance = await client.getTokenBalance();
  console.log(`  Balance:  ${fmt(balance)} KTT`);
  console.log("");

  let lastPaymentResult: PaymentResult | undefined;

  // Build the payment decision callback using the 3-tier cascade
  const fetchOpts: any = {
    onPayment: (result: PaymentResult) => {
      lastPaymentResult = result;
    },
  };

  if (opts.decide === "cli") {
    // CLI mode: always prompt interactively
    fetchOpts.onPaymentRequired = promptForPayment;
  } else {
    // auto/rules/ai mode: use the decide cascade
    fetchOpts.onPaymentRequired = async (
      req: PaymentRequest,
    ): Promise<boolean> => {
      const ctx = {
        request: req,
        rules: agent.rules,
        balance: await client.getTokenBalance(),
        totalSpentThisSession: client.getTotalSpent(),
        callCount: client.getUsageLogs().length,
        openaiApiKey: process.env.OPENAI_API_KEY,
      };

      const result = await decide(ctx, opts.decide);
      console.log(
        `  Decision: ${result.decision} [${result.tier}] — ${result.reason}`,
      );

      if (result.decision === "reject") {
        return false;
      }
      return true;
    };
  }

  console.log(`  Calling ${apiUrl}...`);
  console.log("");

  const t0 = Date.now();
  const response = await client.fetch(apiUrl, undefined, fetchOpts);
  const elapsed = Date.now() - t0;

  if (response.status === 402) {
    console.log(`  Status: ${response.status} Payment Required`);
    console.log(`  The agent was not charged.`);
    console.log(`  Reason: payment was declined`);
  } else {
    const body = await response.json();
    console.log(`  Status:  ${response.status} OK`);
    console.log(`  Data:    ${JSON.stringify(body, null, 2)}`);
    console.log(`  Time:    ${elapsed}ms`);

    if (lastPaymentResult) {
      console.log(formatReceipt(lastPaymentResult, apiUrl, body));
    }
  }

  if (server) server.close();
}

async function showBalance(opts: CliArgs) {
  const agents = loadAgents();
  const agent = getAgent(agents, opts.agentId);

  const client = await KitePaymentClient.create({
    seedPhrase: agent.seed,
    walletAddress: agent.wallet,
  });

  const agentBalance = await client.getTokenBalance();
  console.log(`  Agent:    ${agent.id} (${agent.name})`);
  console.log(`  Address:  ${client.address}`);
  console.log(`  Balance:  ${fmt(agentBalance)} KTT`);
}

async function showUsage(opts: CliArgs) {
  const agents = loadAgents();
  const agent = getAgent(agents, opts.agentId);

  const client = await KitePaymentClient.create({
    seedPhrase: agent.seed,
    walletAddress: agent.wallet,
  });

  const logs = client.getUsageLogs();
  const total = client.getTotalSpent();

  console.log(`  Agent:       ${agent.id} (${agent.name})`);
  console.log(`  Address:     ${client.address}`);
  console.log(`  Total spent: ${fmt(total)} KTT`);
  console.log(`  Calls:       ${logs.length}`);

  if (logs.length > 0) {
    console.log("");
    for (const log of logs) {
      console.log(
        `    ${new Date(log.timestamp).toISOString()} | ${log.serviceUrl} | ${fmt(log.amount)} KTT | ${log.txHash || "channel"}`,
      );
    }
  }
}

async function fundWallet(opts: CliArgs) {
  const deployerKey = process.env.DEPLOYER_KEY;
  if (!deployerKey) {
    throw new Error("Set DEPLOYER_KEY env var");
  }
  if (!opts.fundAddress) {
    throw new Error("Usage: fund <address> [amount]");
  }

  const amount = parseUnits(opts.fundAmount || "10", 18);
  const account = privateKeyToAccount(
    `0x${deployerKey.replace("0x", "")}` as `0x${string}`,
  );
  const transport = viemHttp(KITE_TESTNET.rpcUrl);
  const publicClient = createPublicClient({ transport });
  const walletClient = createWalletClient({ account, transport });

  console.log(`  From:     ${account.address}`);
  console.log(`  To:       ${opts.fundAddress}`);
  console.log(`  Amount:   ${opts.fundAmount || "10"} tokens`);

  const balance = (await publicClient.readContract({
    address: TOKEN as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  if (balance < amount) {
    throw new Error(`Deployer has insufficient tokens (${fmt(balance)} KTT)`);
  }

  const chain = {
    id: KITE_TESTNET.chainId,
    name: "Kite Ozone Testnet",
    nativeCurrency: { name: "KITE", symbol: "KITE", decimals: 18 },
    rpcUrls: { default: { http: [KITE_TESTNET.rpcUrl] } },
  };

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [opts.fundAddress as `0x${string}`, amount],
  });

  const hash = await walletClient.sendTransaction({
    to: TOKEN as `0x${string}`,
    data,
    chain,
  });

  console.log(`  Tx:       ${hash}`);
  console.log("  Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  Block:    ${receipt.blockNumber}`);
  console.log("  Done.");
}

function showHelp() {
  console.log(`
  Kite Agent Pay CLI

  Commands:
    call                 Call a paid API endpoint
    balance              Show agent token balance
    usage                Show usage logs for this session
    fund <addr> [amt]    Fund an address with test tokens (needs DEPLOYER_KEY)
    help                 Show this message

  Options:
    --decide <mode>      Decision mode: auto (default), rules, ai, cli
    --agent <id>         Agent ID from agents.json (default: agents.json defaultAgent)
    --url <url>          Live API URL (default: local mock)

  Decision Modes:
    auto     3-tier cascade: rules -> cost model -> LLM fallback
    rules    Rule-based only (reject if inconclusive)
    ai       Rules + cost + LLM (needs OPENAI_API_KEY)
    cli      Interactive prompt for every payment

  Examples:
    npx tsx examples/app.ts call
    npx tsx examples/app.ts call --decide cli
    npx tsx examples/app.ts call --decide ai --agent agent-2
    npx tsx examples/app.ts call --url https://api.example.com/data
    npx tsx examples/app.ts balance --agent agent-2
    npx tsx examples/app.ts fund 0x1234...abcd 5
  `);
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log("");
  console.log("  Kite Agent Pay");
  console.log("  ──────────────────────────────────────────────────────");

  try {
    switch (opts.command) {
      case "call":
        await callApi(opts);
        break;
      case "balance":
        await showBalance(opts);
        break;
      case "usage":
        await showUsage(opts);
        break;
      case "fund":
        await fundWallet(opts);
        break;
      case "help":
      default:
        showHelp();
        break;
    }
  } catch (err: any) {
    console.error(`  Error: ${err.message}`);
    process.exit(1);
  }
}

main();
