/**
 * Operational commands for the Kite CLI.
 *
 * Extracted so `src/cli.ts` can delegate heavy commands here
 * without loading WDK/viem for lightweight commands like `vars`.
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
import { KitePaymentClient, KITE_TESTNET, erc20Abi } from "./index.js";
import { decide } from "./decide.js";
import { resolveVar, getVar } from "./vars.js";
import type { DecisionMode, SessionRules } from "./decide.js";
import type { PaymentRequest, PaymentResult } from "./types.js";

// ── Constants ──────────────────────────────────────────────────────

const TOKEN = KITE_TESTNET.token;
const MOCK_PORT = 4100;
const SERVICE_PRICE = "100000000000000000"; // 0.1 KTT

// ── Arg parsing ────────────────────────────────────────────────────

interface CmdOpts {
  decide: DecisionMode;
  agentId?: string;
  url?: string;
  fundAddress?: string;
  fundAmount?: string;
}

function parseOpts(args: string[], command: string): CmdOpts {
  let decideMode: DecisionMode = "auto";
  let agentId: string | undefined;
  let url: string | undefined;
  let fundAddress: string | undefined;
  let fundAmount: string | undefined;

  if (command === "fund") {
    // Positional: fund <address> [amount] (skip flags)
    const positional = args.filter((a) => !a.startsWith("--"));
    fundAddress = positional[0];
    fundAmount = positional[1];
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--decide" && args[i + 1]) {
      decideMode = args[++i] as DecisionMode;
    } else if (args[i] === "--agent" && args[i + 1]) {
      agentId = args[++i];
    } else if (args[i] === "--url" && args[i + 1]) {
      url = args[++i];
    }
  }

  return { decide: decideMode, agentId, url, fundAddress, fundAmount };
}

// ── Formatting ─────────────────────────────────────────────────────

function fmt(wei: bigint): string {
  return formatUnits(wei, 18);
}

function formatReceipt(
  result: PaymentResult,
  url: string,
  responseBody?: any
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
    lines.push(
      `  Tx Hash:     ${result.txHash}`,
      `  Explorer:    https://testnet.kitescan.ai/tx/${result.txHash}`
    );
  }
  if (result.receipt?.sessionId) {
    lines.push(
      `  Session:     ${result.receipt.sessionId}`,
      `  Nonce:       ${result.receipt.nonce}`,
      `  Provider:    ${result.receipt.provider}`,
      `  Consumer:    ${result.receipt.consumer}`
    );
  }
  lines.push(`  Timestamp:   ${new Date().toISOString()}`);
  if (responseBody?.providerSignature) {
    lines.push(
      "",
      "  Provider Receipt (EIP-712 signed):",
      `  Signer:      ${responseBody.receipt?.provider || "unknown"}`,
      `  Signature:   ${responseBody.providerSignature}`
    );
    if (responseBody.receipt) {
      lines.push(
        `  Service:     ${responseBody.receipt.service}`,
        `  Nonce:       ${responseBody.receipt.nonce}`,
        `  Timestamp:   ${responseBody.receipt.timestamp}`
      );
    }
  }
  lines.push(
    "──────────────────────────────────────────────────────────",
    ""
  );
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

function startMockAPI(providerKey: `0x${string}`): Promise<http.Server> {
  const providerAddr = privateKeyToAccount(providerKey).address;
  const providerAccount = privateKeyToAccount(providerKey);

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
                payTo: providerAddr,
                asset: TOKEN,
                maxTimeoutSeconds: 300,
                merchantName: "Weather Co.",
              },
            ],
            x402Version: 1,
          })
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
            provider: providerAddr as `0x${string}`,
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
              provider: providerAddr,
              timestamp: timestamp.toString(),
              nonce: nonce.toString(),
            },
            providerSignature,
          })
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

async function callApi(opts: CmdOpts) {
  const credential = getVar("AGENT_SEED") || getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  console.log(`  Decide:   ${opts.decide}`);

  let server: http.Server | null = null;
  let apiUrl: string;

  if (opts.url) {
    apiUrl = opts.url;
    console.log(`  Target:   ${apiUrl} (live)`);
  } else {
    // Mock API needs a provider key — try vars store, then env, then fallback
    let providerKey: `0x${string}`;
    try {
      const raw = resolveVar("$PROVIDER_KEY");
      providerKey = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
    } catch {
      // Fallback for local dev / demos
      providerKey =
        "0xbd88d7931ce6ffc84d45264da93b7b63bf945b339ff14742b9cfcff2ce0c0b72" as `0x${string}`;
    }

    server = await startMockAPI(providerKey);
    apiUrl = `http://localhost:${MOCK_PORT}/weather/kite-city`;
    console.log(`  Target:   ${apiUrl} (mock)`);
  }

  console.log("");

  const client = await KitePaymentClient.create({
    seedPhrase: credential,
    defaultPaymentMode: "x402" as const,
  });

  console.log(`  Address:  ${client.address}`);

  const balance = await client.getTokenBalance();
  console.log(`  Balance:  ${fmt(balance)} KTT`);
  console.log("");

  let lastPaymentResult: PaymentResult | undefined;

  const fetchOpts: any = {
    onPayment: (result: PaymentResult) => {
      lastPaymentResult = result;
    },
  };

  // Default rules sourced from vars/on-chain
  const defaultRules: SessionRules = {
    maxPerCall: parseUnits("1", 18).toString(),
    maxPerSession: parseUnits("10", 18).toString(),
    blockedProviders: [],
    requireApprovalAbove: parseUnits("0.5", 18).toString(),
  };

  if (opts.decide === "cli") {
    fetchOpts.onPaymentRequired = promptForPayment;
  } else {
    fetchOpts.onPaymentRequired = async (
      req: PaymentRequest
    ): Promise<boolean> => {
      const ctx = {
        request: req,
        rules: defaultRules,
        balance: await client.getTokenBalance(),
        totalSpentThisSession: client.getTotalSpent(),
        callCount: client.getUsageLogs().length,
        openaiApiKey: process.env.OPENAI_API_KEY,
      };

      const result = await decide(ctx, opts.decide);
      console.log(
        `  Decision: ${result.decision} [${result.tier}] — ${result.reason}`
      );
      return result.decision !== "reject";
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

async function showBalance(opts: CmdOpts) {
  const credential = getVar("AGENT_SEED") || getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const client = await KitePaymentClient.create({
    seedPhrase: credential,
  });

  const agentBalance = await client.getTokenBalance();
  console.log(`  Address:  ${client.address}`);
  console.log(`  Balance:  ${fmt(agentBalance)} KTT`);
}

async function showUsage(opts: CmdOpts) {
  const credential = getVar("AGENT_SEED") || getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const client = await KitePaymentClient.create({
    seedPhrase: credential,
  });

  const logs = client.getUsageLogs();
  const total = client.getTotalSpent();

  console.log(`  Address:     ${client.address}`);
  console.log(`  Total spent: ${fmt(total)} KTT`);
  console.log(`  Calls:       ${logs.length}`);

  if (logs.length > 0) {
    console.log("");
    for (const log of logs) {
      console.log(
        `    ${new Date(log.timestamp).toISOString()} | ${log.serviceUrl} | ${fmt(log.amount)} KTT | ${log.txHash || "channel"}`
      );
    }
  }
}

async function fundWallet(opts: CmdOpts) {
  // DEPLOYER_KEY from vars store → env → error
  let deployerKey: string;
  try {
    deployerKey = resolveVar("$DEPLOYER_KEY");
  } catch {
    throw new Error(
      "Deployer key not found.\n" +
        "  Run:  npx kite vars set DEPLOYER_KEY"
    );
  }

  if (!opts.fundAddress) {
    throw new Error("Usage: kite fund <address> [amount]");
  }

  const amount = parseUnits(opts.fundAmount || "10", 18);
  const account = privateKeyToAccount(
    `0x${deployerKey.replace("0x", "")}` as `0x${string}`
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

// ── Entry point (called from cli.ts) ───────────────────────────────

export async function runAppCommand(command: string, args: string[]) {
  const opts = parseOpts(args, command);

  console.log("  ──────────────────────────────────────────────────────");

  switch (command) {
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
    case "simulate": {
      // Run simulate as a subprocess (it lives outside src/)
      const { execFileSync } = await import("node:child_process");
      const { resolve: pathResolve } = await import("node:path");
      const script = pathResolve(import.meta.dirname || ".", "../examples/simulate.ts");
      execFileSync("npx", ["tsx", script], { stdio: "inherit", env: process.env });
      break;
    }
  }
}
