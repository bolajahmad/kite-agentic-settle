/**
 * Operational commands for the Kite CLI.
 *
 * Extracted so `src/cli.ts` can delegate heavy commands here
 * without loading WDK/viem for lightweight commands like `vars`.
 */

import { formatUnits, parseUnits, zeroAddress } from "viem";
import { TOKENS } from "../../config.js";
import type { DecisionMode } from "../../decide.js";
import { KITE_TESTNET, KiteSettleClient } from "../../index.js";
import { getVar } from "../../vars.js";
import { findFlag } from "../index.js";
import { callApi } from "./call.js";

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

  const client = await KiteSettleClient.create({ credential });

  const agentBalance = await Promise.all(
    tokens.map(async (t) => {
      const token = TOKENS.find(
        ({ address, symbol }) =>
          address.toLowerCase() === t.toLowerCase() ||
          symbol.toLowerCase() == t.toLowerCase(),
      );

      const depBalance = await client.getDepositedBalance(token?.address);
      const balance =
        token?.address == zeroAddress
          ? undefined
          : await client.getWalletBalance(token?.address);
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

  const client = await KiteSettleClient.create({ credential });

  const logs = client.getUsageLogs();
  const total = client.getTotalSpent();

  console.log(`  Address:     ${client.eoaAddress}`);
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
  const client = await KiteSettleClient.create({ credential });

  console.log(`  From:     ${client.eoaAddress}`);
  console.log(
    `  To:       KiteAAWallet (${KITE_TESTNET.contracts.kiteAAWallet})`,
  );
  console.log(`  Amount:   ${amountFlag.trim()} ${token?.symbol || "KITE"}`);

  const balance =
    token?.address === zeroAddress
      ? await client
          .getEoaClient()
          .getContractService()
          .getNativeBalance(client.eoaAddress as `0x${string}`)
          .catch(() => 0n)
      : await client.getWalletBalance(token?.address);

  if (balance < amount) {
    throw new Error(
      `Deployer has insufficient tokens (${fmt(balance)} ${token?.symbol ?? "KITE"})`,
    );
  }

  const data = await client.deposit(amount, token?.address);

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

  const client = await KiteSettleClient.create({ credential });

  console.log(
    `  Withdrawing ${amountFlag.trim()} ${token?.symbol || "KITE"} to owner`,
  );
  console.log(`   Owner Address: ${client.eoaAddress}`);
  console.log(
    "  Note: This will transfer tokens from the AA wallet to your EOA",
  );

  const data = await client.withdraw(amount, token?.address);

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
