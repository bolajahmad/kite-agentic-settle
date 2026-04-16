/**
 * Operational commands for the Kite CLI.
 *
 * Extracted so `src/cli.ts` can delegate heavy commands here
 * without loading WDK/viem for lightweight commands like `vars`.
 */

import http from "node:http";
import readline from "node:readline";
import {
  createPublicClient,
  formatUnits,
  parseUnits,
  http as viemHttp,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { findFlag } from "../cli.js";
import { TOKENS } from "../config.js";
import type { DecisionMode } from "../decide.js";
import { KITE_TESTNET, KitePaymentClient, createKiteWallet } from "../index.js";
import type { PaymentRequest, PaymentResult } from "../types.js";
import { getVar } from "../vars.js";
import { callApi } from "./call.js";

// ── Constants ──────────────────────────────────────────────────────

const TOKEN = KITE_TESTNET.token;
const MOCK_PORT = 4100;
const SERVICE_PRICE = "100000000000000000"; // 0.1 KITE

// ── Arg parsing ────────────────────────────────────────────────────

interface CmdOpts {
  decide: DecisionMode;
  agentIndex?: string;
  url?: string;
  fundAddress?: string;
  fundAmount?: string;
}

function parseOpts(args: string[], command: string): CmdOpts {
  let decideMode: DecisionMode = "auto";
  let agentIndex: string | undefined;
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
      agentIndex = args[++i];
    } else if (args[i] === "--url" && args[i + 1]) {
      url = args[++i];
    }
  }

  return { decide: decideMode, agentIndex, url, fundAddress, fundAmount };
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
    `  Amount:      ${fmt(result.amount)} KITE`,
    `  Service:     ${url}`,
  ];
  if (result.txHash) {
    lines.push(
      `  Tx Hash:     ${result.txHash}`,
      `  Explorer:    https://testnet.kitescan.ai/tx/${result.txHash}`,
    );
  }
  if (result.receipt?.sessionId) {
    lines.push(
      `  Session:     ${result.receipt.sessionId}`,
      `  Nonce:       ${result.receipt.nonce}`,
      `  Provider:    ${result.receipt.provider}`,
      `  Consumer:    ${result.receipt.consumer}`,
    );
  }
  lines.push(`  Timestamp:   ${new Date().toISOString()}`);
  if (responseBody?.providerSignature) {
    lines.push(
      "",
      "  Provider Receipt (EIP-712 signed):",
      `  Signer:      ${responseBody.receipt?.provider || "unknown"}`,
      `  Signature:   ${responseBody.providerSignature}`,
    );
    if (responseBody.receipt) {
      lines.push(
        `  Service:     ${responseBody.receipt.service}`,
        `  Nonce:       ${responseBody.receipt.nonce}`,
        `  Timestamp:   ${responseBody.receipt.timestamp}`,
      );
    }
  }
  lines.push("──────────────────────────────────────────────────────────", "");
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
  console.log(`  Amount:      ${fmt(req.price)} KITE`);
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

async function showBalance(args: string[]) {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  let tokens: string[] = [];
  const tokenFlag = findFlag(args, "--token");
  if (tokenFlag) {
    const isMultiple =
      tokenFlag.includes(",") && tokenFlag.split(",").length > 1;
    if (isMultiple) {
      tokens = tokenFlag
        .trim()
        .split(",")
        .map((t) => t.trim());
    } else {
      tokens = [tokenFlag.trim()];
    }
  }

  tokens.unshift(zeroAddress); // Ensure default token is included

  const client = await KitePaymentClient.create({
    seedPhrase: credential,
  });

  const agentBalance = await Promise.all(
    tokens.map(async (t) => {
      const token = TOKENS.find(
        ({ address, symbol }) =>
          address.toLowerCase() === t.toLowerCase() ||
          symbol.toLowerCase() == t.toLowerCase(),
      );

      const depBalance = await client.getDepositedTokenBalance(token?.address);
      const balance =
        token?.address == zeroAddress
          ? undefined
          : await client.getTokenBalance(token?.address);
      return {
        ...token,
        balance: formatUnits(depBalance, token?.decimals || 18),
        nativeBalance: balance
          ? formatUnits(balance, token?.decimals || 18)
          : undefined,
      };
    }),
  );

  const showNativeBalance = findFlag(args, "--show-native");

  function displayBalance(tkn: (typeof agentBalance)[0], symbol: string) {
    console.log(`  Token:    ${symbol}`);
    console.log(`  Deposited Balance:  ${tkn.balance} ${symbol} (deposited)`);
    if (showNativeBalance && tkn.address !== zeroAddress)
      console.log(
        `     Balance:       ${tkn.nativeBalance} ${symbol} (wallet)`,
      );
    console.log("");
  }

  agentBalance.forEach((tkn) => displayBalance(tkn, tkn.symbol || "KITE"));
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
  console.log(`  Total spent: ${fmt(total)} KITE`);
  console.log(`  Calls:       ${logs.length}`);

  if (logs.length > 0) {
    console.log("");
    for (const log of logs) {
      console.log(
        `    ${new Date(log.timestamp).toISOString()} | ${log.serviceUrl} | ${fmt(log.amount)} KITE | ${log.txHash || "channel"}`,
      );
    }
  }
}

async function fundWallet(args: string[]) {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const tokenFlag = findFlag(args, "--token");
  const amountFlag = findFlag(args, "--amount");
  if (!amountFlag) {
    throw new Error(
      "Amount is required. Usage: npx kite fund --amount <amount> --token <token>",
    );
  }

  let token = TOKENS.find(
    ({ address, symbol }) =>
      address.toLowerCase() === tokenFlag?.toLowerCase() ||
      symbol.toLowerCase() === tokenFlag?.toLowerCase(),
  );

  if (!token) {
    token = TOKENS.find(({ address }) => address === zeroAddress);
    console.warn(
      `Token "${tokenFlag}" not found. Defaulting to ${token?.symbol || "KITE"}.`,
    );
  }
  const amount = parseUnits(amountFlag || "0", token?.decimals ?? 18);
  const { address } = await createKiteWallet(credential, KITE_TESTNET.rpcUrl);
  const transport = viemHttp(KITE_TESTNET.rpcUrl);
  const publicClient = createPublicClient({ transport });
  const client = await KitePaymentClient.create({
    seedPhrase: credential,
  });

  console.log(`  From:     ${address}`);
  console.log(
    `  To:       KiteAAWallet (${KITE_TESTNET.contracts.kiteAAWallet})`,
  );
  console.log(`  Amount:   ${amountFlag.trim()} ${token?.symbol || "KITE"}`);

  const balance =
    token?.address === zeroAddress
      ? await publicClient.getBalance({
          address: address as `0x${string}`,
        })
      : await client.getTokenBalance(token?.address);

  if (balance < amount) {
    throw new Error(
      `Deployer has insufficient tokens (${fmt(balance)} ${token?.symbol ?? "KITE"})`,
    );
  }

  const data = await client.depositToWallet(amount, token?.address);

  console.log(`  Tx:       ${data}`);
}

async function withdrawFunds(args: string[]) {
  const credential = getVar("PRIVATE_KEY");
  if (!credential) throw new Error("No credential found. Run: npx kite init");

  const tokenFlag = findFlag(args, "--token");
  const amountFlag = findFlag(args, "--amount");
  if (!amountFlag) {
    throw new Error(
      "Amount is required. Usage: npx kite withdraw --amount <amount> --token <token>",
    );
  }

  let token = TOKENS.find(
    ({ address, symbol }) =>
      address.toLowerCase() === tokenFlag?.toLowerCase() ||
      symbol.toLowerCase() === tokenFlag?.toLowerCase(),
  );
  if (!token) {
    token = TOKENS.find(({ address }) => address === zeroAddress);
    console.warn(
      `Token "${tokenFlag}" not found. Defaulting to ${token?.symbol || "KITE"}.`,
    );
  }

  const amount = parseUnits(amountFlag || "0", token?.decimals ?? 18);

  const client = await KitePaymentClient.create({
    seedPhrase: credential,
  });

  console.log(
    `  Withdrawing ${amountFlag.trim()} ${token?.symbol || "KITE"} to owner`,
  );
  console.log(`   Owner Address: ${client.address}`);
  console.log(
    "  Note: This will transfer tokens from the AA wallet to your EOA",
  );

  const data = await client.withdrawFromWallet(amount, token?.address);

  console.log(`  Tx:       ${data}`);
}

// ── Entry point (called from cli.ts) ───────────────────────────────

export async function runAppCommand(command: string, args: string[]) {
  const opts = parseOpts(args, command);

  console.log("  ──────────────────────────────────────────────────────");

  switch (command) {
    case "call":
      await callApi(args);
      break;
    case "balance":
      await showBalance(args);
      break;
    case "usage":
      await showUsage(opts);
      break;
    case "fund":
      await fundWallet(args);
      break;
    case "withdraw":
      await withdrawFunds(args);
      break;
    case "simulate": {
      // Run simulate as a subprocess (it lives outside src/)
      const { execFileSync } = await import("node:child_process");
      const { resolve: pathResolve } = await import("node:path");
      const script = pathResolve(
        import.meta.dirname || ".",
        "../examples/simulate.ts",
      );
      execFileSync("npx", ["tsx", script], {
        stdio: "inherit",
        env: process.env,
      });
      break;
    }
  }
}
