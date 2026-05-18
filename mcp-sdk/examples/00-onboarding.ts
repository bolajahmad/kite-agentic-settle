/**
 * Demo 0: Full Agent Onboarding
 *
 * VALUE PROPOSITION:
 * Shows the complete one-time setup flow for a Kite agent — from a raw EOA
 * private key to a fully registered agent with a live session key and funded
 * AA wallet, all orchestrated through the SDK in a handful of lines.
 *
 * WHAT YOU'LL SEE:
 * 1. Derive and (optionally) deploy the AA wallet (GokiteAccount) for the EOA
 * 2. Register an agent NFT on IdentityRegistry
 * 3. Create a session rule on the ClientAgentVault
 * 4. Tie the session key to the IdentityRegistry
 * 5. Fund the AA wallet with native KITE, DmUSDT, and PaymentToken (testnet)
 * 6. Print a final summary showing all on-chain state
 *
 * PREREQUISITES:
 * - Run `npx kite init` to store your EOA private key / seed phrase
 * - Your EOA must have a small amount of KITE (for native funding step)
 *   and ideally some DmUSDT / USDT testnet tokens
 *
 * USAGE:
 *   npm run demo 0
 *   npm run demo onboard
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { KITE_TESTNET, KiteSettleClient } from "../src/index.js";
import { prompt } from "../src/utils/index.js";
import { getCredential, setCredential } from "../src/vars.js";
import { createLogger } from "./lib/logger.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const DM_USDT = KITE_TESTNET.token as `0x${string}`; // 0xd4a87...
const PAYMENT_TOKEN =
  "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63" as `0x${string}`;

// Small funding amounts — just enough to exercise the payment demos
const NATIVE_FUND = parseUnits("0.001", 18); // 0.001 KITE
const STABLE_FUND = parseUnits("0.1", 18); // 1 unit of StableToken (DmUSDT or USDT testnet)

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const kiteChain = {
  id: KITE_TESTNET.chainId,
  name: "Kite AI Testnet",
  nativeCurrency: { name: "KITE", symbol: "KITE", decimals: 18 },
  rpcUrls: { default: { http: [KITE_TESTNET.rpcUrl] } },
} as const;

// ── Main ───────────────────────────────────────────────────────────────────────
export async function run() {
  const logger = createLogger();

  logger.header(
    "Demo 0: Full Agent Onboarding",
    "EOA → AA Wallet → Agent NFT → Session Key → Funded Vault",
  );

  // ── Step 1: Load credential ──────────────────────────────────────────────
  logger.step("Load EOA credential");

  let credential = getCredential();
  if (!credential) {
    logger.info("No credential found in local config.");
    logger.info("Enter your EOA private key or seed phrase to continue.");
    logger.info(
      "(It will be saved to ~/.kite-agent-pay/config.json for future runs)\n",
    );
    const entered = await prompt("  Seed phrase or private key: ", true);
    if (!entered || !entered.trim()) {
      throw new Error("No credential provided. Aborting.");
    }
    setCredential(entered.trim());
    credential = entered.trim();
    logger.info("  Credential saved.\n");
  }

  const privateKeyHex = (
    credential.startsWith("0x") ? credential : `0x${credential}`
  ) as `0x${string}`;
  const eoaAccount = privateKeyToAccount(privateKeyHex);
  logger.info(`EOA address: ${eoaAccount.address}`);

  // ── Step 2: Read initial on-chain state ─────────────────────────────────
  logger.step("Read initial on-chain state");

  const pubClient = createPublicClient({
    transport: http(KITE_TESTNET.rpcUrl),
  });

  const { GokiteAASDK } = await import("gokite-aa-sdk");
  const aaSdk = new GokiteAASDK(
    KITE_TESTNET.networkName || "kite_testnet",
    KITE_TESTNET.rpcUrl,
    KITE_TESTNET.bundlerUrl,
  );

  const aaWallet = aaSdk.getAccountAddress(eoaAccount.address) as `0x${string}`;
  const isDeployed = await aaSdk.isAccountDeloyed(aaWallet);

  const [
    eoaNative,
    eoaDmUsdt,
    eoaPaymentToken,
    aaNative,
    aaDmUsdt,
    aaPaymentToken,
  ] = await Promise.all([
    pubClient.getBalance({ address: eoaAccount.address }),
    pubClient
      .readContract({
        address: DM_USDT,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [eoaAccount.address],
      })
      .catch(() => 0n) as Promise<bigint>,
    pubClient
      .readContract({
        address: PAYMENT_TOKEN,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [eoaAccount.address],
      })
      .catch(() => 0n) as Promise<bigint>,
    pubClient.getBalance({ address: aaWallet }),
    pubClient
      .readContract({
        address: DM_USDT,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [aaWallet],
      })
      .catch(() => 0n) as Promise<bigint>,
    pubClient
      .readContract({
        address: PAYMENT_TOKEN,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [aaWallet],
      })
      .catch(() => 0n) as Promise<bigint>,
  ]);

  logger.data("EOA", {
    address: eoaAccount.address,
    KITE: `${formatEther(eoaNative)} KITE`,
    DmUSDT: `${formatUnits(eoaDmUsdt, 18)} DmUSDT`,
    USDT: `${formatUnits(eoaPaymentToken, 18)} USDT`,
  });
  logger.data("AA Wallet (before)", {
    address: aaWallet,
    deployed: isDeployed,
    KITE: `${formatEther(aaNative)} KITE`,
    DmUSDT: `${formatUnits(aaDmUsdt, 18)} DmUSDT`,
    USDT: `${formatUnits(aaPaymentToken, 18)} USDT`,
  });

  // ── Step 3: Check existing agents ───────────────────────────────────────
  logger.step("Check for existing agent registration");

  const sdkClient = await KiteSettleClient.create({ credential });
  const existingAgents = await sdkClient
    .getAgentsByOwner(eoaAccount.address)
    .catch(() => []);

  let agentId: bigint | undefined;
  let sessionKeyAddress: string | undefined;
  let aaWalletAddress: string = aaWallet;

  if (existingAgents.length > 0) {
    const agent = existingAgents[0];
    agentId = BigInt(agent.agentId ?? 0);
    logger.info(
      `Found ${existingAgents.length} existing agent(s). Skipping onboarding.`,
    );
    logger.info(`Active agent: ID=${agentId}`);

    // Try to find a stored session key for this agent
    const { getVar } = await import("../src/vars.js");
    sessionKeyAddress =
      getVar(`SESSION_${agentId}_0_ADDRESS`) ?? "not found in local vars";
  } else {
    // ── Step 4: Pre-flight check ─────────────────────────────────────────
    logger.step("Pre-flight: verify USDT gas balance for onboarding");

    const MIN_USDT = parseUnits("0.1", 18);
    const totalUsdt = aaPaymentToken + eoaPaymentToken;

    if (totalUsdt < MIN_USDT) {
      logger.warn(
        `Insufficient PaymentToken (USDT) for gas sponsoring:\n` +
          `  AA wallet : ${formatUnits(aaPaymentToken, 18)} USDT\n` +
          `  EOA       : ${formatUnits(eoaPaymentToken, 18)} USDT\n` +
          `  Required  : ≥ 1 USDT (combined)\n\n` +
          `  Get testnet USDT at https://docs.gokite.ai/faucet\n` +
          `  Then run:  npx kite fund --token usdt --amount 1\n`,
      );
      logger.complete("Demo aborted — add USDT to continue.");
      return;
    }

    // ── Step 5: Run full onboarding ──────────────────────────────────────
    logger.step("Onboard: deploy AA wallet → register agent → create session");

    const agentURI = JSON.stringify({
      name: "Kite Demo Agent",
      description:
        "Onboarding demo agent — created by the kite-agentic-pay example suite.",
      version: "1.0.0",
    });

    const result = await sdkClient.onboard(
      {
        agentURI,
        validDays: 30,
        sessionRule: {
          timeWindow: 86400n, // 1 day window
          budget: parseUnits("10.0", 18), // 10 USDT lifetime budget
        },
      },
      (step) => logger.info(`  → ${step}`),
    );

    agentId = BigInt(result.agentId);
    sessionKeyAddress = result.sessionKeyAddress;
    aaWalletAddress = result.aaWalletAddress;

    logger.success("Onboarding complete");
    logger.data("Result", {
      EOA: result.eoaAddress,
      "AA Wallet": result.aaWalletAddress,
      "Agent ID": result.agentId.toString(),
      "Session ID": result.sessionId,
      "Session Key": result.sessionKeyAddress,
    });
    for (const tx of result.txHashes) {
      if (tx.hash) logger.info(`  ${tx.step}: ${tx.hash}`);
    }
  }

  // ── Step 5: Fund AA wallet ───────────────────────────────────────────────
  logger.step("Fund AA wallet with small test token amounts");

  const walletClient = createWalletClient({
    account: eoaAccount,
    chain: kiteChain,
    transport: http(KITE_TESTNET.rpcUrl),
  });

  // 5a. Native KITE
  if (eoaNative >= NATIVE_FUND + parseUnits("0.005", 18)) {
    try {
      logger.info(`Sending ${formatEther(NATIVE_FUND)} KITE to AA wallet...`);
      const nativeTx = await walletClient.sendTransaction({
        to: aaWalletAddress as `0x${string}`,
        value: NATIVE_FUND,
      });
      await pubClient.waitForTransactionReceipt({ hash: nativeTx });
      logger.info(`  KITE sent: ${nativeTx}`);
    } catch (err: any) {
      logger.warn(`  Native KITE funding skipped: ${err.message}`);
    }
  } else {
    logger.warn(
      `  Native KITE funding skipped: EOA balance too low (${formatEther(eoaNative)} KITE)`,
    );
  }

  // 5b. DmUSDT
  if (eoaDmUsdt >= STABLE_FUND) {
    try {
      logger.info(
        `Sending ${formatUnits(STABLE_FUND, 18)} DmUSDT to AA wallet...`,
      );
      const dmTx = await walletClient.sendTransaction({
        to: DM_USDT,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [aaWalletAddress as `0x${string}`, STABLE_FUND],
        }),
      });
      await pubClient.waitForTransactionReceipt({ hash: dmTx });
      logger.info(`  DmUSDT sent: ${dmTx}`);
    } catch (err: any) {
      logger.warn(`  DmUSDT funding skipped: ${err.message}`);
    }
  } else {
    logger.warn(
      `  DmUSDT funding skipped: EOA balance too low (${formatUnits(eoaDmUsdt, 18)} DmUSDT)`,
    );
  }

  // 5c. PaymentToken (USDT testnet — for paymaster gas payments)
  if (eoaPaymentToken >= STABLE_FUND) {
    try {
      logger.info(
        `Sending ${formatUnits(STABLE_FUND, 18)} USDT to AA wallet...`,
      );
      const ptTx = await walletClient.sendTransaction({
        to: PAYMENT_TOKEN,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [aaWalletAddress as `0x${string}`, STABLE_FUND],
        }),
      });
      await pubClient.waitForTransactionReceipt({ hash: ptTx });
      logger.info(`  USDT sent: ${ptTx}`);
    } catch (err: any) {
      logger.warn(`  USDT funding skipped: ${err.message}`);
    }
  } else {
    logger.warn(
      `  USDT funding skipped: EOA balance too low (${formatUnits(eoaPaymentToken, 18)} USDT)`,
    );
  }

  // ── Step 6: Final state ──────────────────────────────────────────────────
  logger.step("Final on-chain state");

  const [finalNative, finalDmUsdt, finalPaymentToken, finalDeployed] =
    await Promise.all([
      pubClient.getBalance({ address: aaWalletAddress as `0x${string}` }),
      pubClient
        .readContract({
          address: DM_USDT,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [aaWalletAddress as `0x${string}`],
        })
        .catch(() => 0n) as Promise<bigint>,
      pubClient
        .readContract({
          address: PAYMENT_TOKEN,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [aaWalletAddress as `0x${string}`],
        })
        .catch(() => 0n) as Promise<bigint>,
      aaSdk.isAccountDeloyed(aaWalletAddress),
    ]);

  logger.data("AA Wallet (after)", {
    address: aaWalletAddress,
    deployed: finalDeployed,
    KITE: `${formatEther(finalNative)} KITE`,
    DmUSDT: `${formatUnits(finalDmUsdt, 18)} DmUSDT`,
    USDT: `${formatUnits(finalPaymentToken, 18)} USDT`,
  });

  logger.data("Agent Identity", {
    EOA: eoaAccount.address,
    "Agent ID": agentId?.toString() ?? "n/a",
    "Session Key": sessionKeyAddress ?? "n/a",
    "Next step": "npm run demo 1  — per-call payment with x402",
  });

  logger.complete("Onboarding demo finished");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await run();
  } catch (err: any) {
    console.error("\nFatal error:", err.message ?? err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}
