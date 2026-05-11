/**
 * Demo: Gokite AA SDK — E2E Smoke Test (Native Transfer via UserOperation)
 *
 * GOAL:
 * Verify the Gokite AA SDK works end-to-end on kite_testnet by constructing
 * and sending a minimal UserOperation (0-value native transfer to self).
 *
 * FLOW:
 *  1. Derive AA wallet from EOA private key
 *  2. Check deployment + balance state
 *  3. Check paymaster sponsorship
 *     ─ If sponsorships remain: use sponsored path (ZERO_ADDRESS token)
 *     ─ If exhausted: fund AA wallet with DmUSDT via direct EOA tx, then
 *       send a token-payment UserOp (SDK adds approve calls automatically)
 *  4. Sign and send UserOp via bundler
 *  5. Poll for receipt and confirm on-chain success
 *
 * REQUIREMENTS:
 * - PRIVATE_KEY env var set (`npx kite init`)
 */

import { GokiteAASDK } from "gokite-aa-sdk";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { KITE_TESTNET } from "../src/config.js";
import { getVar } from "../src/vars.js";
import { createLogger } from "./lib/logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const PAYMASTER = "0x9Adcbf85D5c724611a490Ba9eDc4d38d6F39e92d" as const;
// The paymaster's accepted payment token (settlementToken / supportedTokens[1])
// Address from: GokiteAASDK config kite_testnet.settlementToken
const PAYMENT_TOKEN =
  "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63" as `0x${string}`; // Test USD (USDT)
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
// Amount of USDT to transfer to AA wallet to cover paymaster gas fees (token-payment path)
const FUNDING_AMOUNT = parseUnits("1", 18); // 1 USDT

const PAYMASTER_ABI = parseAbi([
  "function maxSponsoredTransactions() view returns (uint256)",
  "function userSponsorship(address user) view returns (uint256)",
  "function maxCostPerSponsoredTransaction() view returns (uint256)",
]);
const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

// ── Main ──────────────────────────────────────────────────────────────────────

export async function run() {
  const logger = createLogger();

  logger.header(
    "Gokite AA SDK — E2E Smoke Test",
    "Construct and send a minimal UserOperation; handle sponsored + token-payment paths",
  );

  // ── Step 1: Load credential ──────────────────────────────────────────────
  logger.step("Load EOA credential");

  const credential = getVar("PRIVATE_KEY");
  if (!credential) {
    throw new Error("No PRIVATE_KEY found. Run 'npx kite init' first.");
  }

  const privateKeyHex = (
    credential.startsWith("0x") ? credential : `0x${credential}`
  ) as `0x${string}`;

  const eoaAccount = privateKeyToAccount(privateKeyHex);
  const ownerAddress = eoaAccount.address;
  logger.info(`EOA:       ${ownerAddress}`);

  // ── Step 2: Initialise SDK + derive AA wallet ────────────────────────────
  logger.step("Initialise GokiteAASDK and derive AA wallet address");

  const aaSdk = new GokiteAASDK(
    KITE_TESTNET.networkName || "",
    KITE_TESTNET.rpcUrl,
    KITE_TESTNET.bundlerUrl,
  );

  const aaWallet = aaSdk.getAccountAddress(ownerAddress) as `0x${string}`;
  logger.info(`AA Wallet: ${aaWallet}`);

  // ── Step 3: On-chain state ───────────────────────────────────────────────
  logger.step("Read on-chain state (deployment + balances)");

  const pubClient = createPublicClient({
    transport: http(KITE_TESTNET.rpcUrl),
  });

  const [isDeployed, kiteBalance, tokenBalance] = await Promise.all([
    aaSdk.isAccountDeloyed(aaWallet),
    pubClient.getBalance({ address: aaWallet }),
    pubClient.readContract({
      address: PAYMENT_TOKEN,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [aaWallet],
    }) as Promise<bigint>,
  ]);

  logger.data("AA Wallet state", {
    deployed: isDeployed,
    kiteBalance: `${formatEther(kiteBalance)} KITE`,
    usdtBalance: `${formatUnits(tokenBalance, 18)} USDT`,
  });

  // ── Step 4: Check paymaster sponsorship ─────────────────────────────────
  logger.step("Query paymaster sponsorship state");

  const [maxSponsored, usedSponsored] = await Promise.all([
    pubClient.readContract({
      address: PAYMASTER,
      abi: PAYMASTER_ABI,
      functionName: "maxSponsoredTransactions",
    }) as Promise<bigint>,
    pubClient.readContract({
      address: PAYMASTER,
      abi: PAYMASTER_ABI,
      functionName: "userSponsorship",
      args: [aaWallet],
    }) as Promise<bigint>,
  ]);

  const remaining = maxSponsored - usedSponsored;
  const sponsored = remaining > 0n;

  logger.data("Paymaster state", {
    maxSponsoredTransactions: maxSponsored.toString(),
    usedSponsorships: usedSponsored.toString(),
    remainingSponsorships: remaining.toString(),
    path: sponsored ? "sponsored (KITE paymaster)" : "token-payment (DmUSDT)",
  });

  // ── Step 5: Define the UserOp request ───────────────────────────────────
  // Simplest possible op: 0-value call to self with empty calldata
  const request = {
    target: ownerAddress, // send to EOA — harmless, no value
    value: 0n,
    callData: "0x" as `0x${string}`,
  };

  // ── Step 6: Sign function ────────────────────────────────────────────────
  const signFunction = async (userOpHash: string): Promise<string> =>
    eoaAccount.signMessage({ message: { raw: userOpHash as Hex } });

  // ── Step 7: Send UserOp via appropriate path ─────────────────────────────
  logger.step(
    sponsored
      ? "Send sponsored UserOp (sendUserOperationAndWait)"
      : "Fund AA wallet with DmUSDT, then send token-payment UserOp",
  );

  let result: { userOpHash: string; status: any };

  if (sponsored) {
    // ── Path A: Sponsored ──────────────────────────────────────────────────
    logger.info("Sponsorship available — using sponsored path...");

    result = await aaSdk.sendUserOperationAndWait(
      ownerAddress,
      request,
      signFunction,
      undefined,
      undefined, // SDK uses config.paymaster
      { maxRetries: 60, interval: 5000 },
    );
  } else {
    // ── Path B: Token payment ──────────────────────────────────────────────
    // 1. Ensure AA wallet has DmUSDT to cover gas
    if (tokenBalance < FUNDING_AMOUNT) {
      logger.info(
        `AA wallet has ${formatUnits(tokenBalance, 18)} USDT — transferring ${formatUnits(FUNDING_AMOUNT, 18)} USDT from EOA...`,
      );

      // Check EOA has enough USDT
      const eoaUsdt = (await pubClient.readContract({
        address: PAYMENT_TOKEN,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [ownerAddress],
      })) as bigint;

      if (eoaUsdt < FUNDING_AMOUNT) {
        throw new Error(
          `EOA has insufficient USDT: ${formatUnits(eoaUsdt, 18)}. Need at least ${formatUnits(FUNDING_AMOUNT, 18)} to fund AA wallet for gas.`,
        );
      }

      // Define the chain so viem can compute fees
      const kiteChain = {
        id: KITE_TESTNET.chainId,
        name: "Kite AI Testnet",
        nativeCurrency: { name: "KITE", symbol: "KITE", decimals: 18 },
        rpcUrls: { default: { http: [KITE_TESTNET.rpcUrl] } },
      } as const;

      const walletClient = createWalletClient({
        account: eoaAccount,
        chain: kiteChain,
        transport: http(KITE_TESTNET.rpcUrl),
      });

      const transferData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [aaWallet, FUNDING_AMOUNT],
      });

      const fundTxHash = await walletClient.sendTransaction({
        to: PAYMENT_TOKEN,
        value: 0n,
        data: transferData,
      });

      logger.info(`DmUSDT transfer tx: ${fundTxHash}`);
      logger.info("Waiting for transfer receipt...");
      await pubClient.waitForTransactionReceipt({ hash: fundTxHash });
      logger.info("Transfer confirmed.");
    } else {
      logger.info(
        `AA wallet already has ${formatUnits(tokenBalance, 18)} USDT — no funding needed.`,
      );
    }

    // 2. Build base UserOp from SDK (no bundler estimation — just constructs calldata + gas defaults)
    logger.info("Building UserOp (no bundler estimation)...");
    const baseUserOp = await (aaSdk as any).createUserOperation(
      ownerAddress,
      request,
    );

    logger.data("Base UserOp gas params", {
      accountGasLimits: baseUserOp.accountGasLimits,
      preVerificationGas: baseUserOp.preVerificationGas?.toString(),
      gasFees: baseUserOp.gasFees,
    });

    // 3. Send with token payment — SDK prepends approve(0)+approve(MAX) to calldata
    //    so the paymaster can do transferFrom in postOp
    logger.info(
      "Sending UserOp with DmUSDT payment (includes approve calls)...",
    );

    result = await aaSdk.sendUserOperationWithPayment(
      ownerAddress,
      request,
      baseUserOp,
      PAYMENT_TOKEN,
      signFunction,
      undefined,
      { maxRetries: 60, interval: 5000 },
    );
  }

  // ── Step 8: Verify result ────────────────────────────────────────────────
  logger.step("Verify UserOp result");

  logger.data("UserOp result", {
    userOpHash: result.userOpHash,
    status: result.status.status,
    transactionHash: result.status.transactionHash ?? "—",
    blockNumber: result.status.blockNumber ?? "—",
    gasUsed: result.status.gasUsed ?? "—",
    reason: result.status.reason ?? "—",
  });

  if (result.status.status !== "success") {
    throw new Error(
      `UserOp did not succeed: ${result.status.reason ?? result.status.status}`,
    );
  }

  // ── Step 9: Check post-op balances ──────────────────────────────────────
  logger.step("Confirm final AA wallet state");

  const [kiteAfter, tokenAfter] = await Promise.all([
    pubClient.getBalance({ address: aaWallet }),
    pubClient.readContract({
      address: PAYMENT_TOKEN,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [aaWallet],
    }) as Promise<bigint>,
  ]);

  logger.data("AA Wallet after", {
    kiteBalance: `${formatEther(kiteAfter)} KITE`,
    usdtBalance: `${formatUnits(tokenAfter, 18)} USDT`,
  });

  logger.complete(
    `AA SDK E2E verified ✓  UserOp ${result.userOpHash} confirmed in block ${result.status.blockNumber}.`,
  );
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
