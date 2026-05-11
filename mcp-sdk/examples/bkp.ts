/**
 * Demo: Gokite AA SDK — E2E Smoke Test (Batch Token Transfer Comparison)
 *
 * GOAL:
 * Verify the Gokite AA SDK works end-to-end on kite_testnet by constructing
 * and sending batch UserOperations that compare two token source models:
 *   A) funds leave the AA wallet via transfer()
 *   B) funds leave the EOA via transferFrom() after EOA approve()
 *
 * FLOW:
 *  1. Derive AA wallet from EOA private key
 *  2. Check deployment + balances (gas payment token + DmUSDT)
 *  3. Build and execute two batch requests (AA-source and EOA-source)
 *  4. Check paymaster sponsorship
 *     - If sponsorships remain: sponsored path
 *     - If exhausted: token-payment path with settlement token (USDT)
 *  5. Sign, send, and verify both UserOps
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
const DM_USDT = KITE_TESTNET.token as `0x${string}`;
const RECIPIENT = "0x34017FF894d74DAE0e37083E11c8cd4f001D52C1" as `0x${string}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
// Amount of USDT to transfer to AA wallet to cover paymaster gas fees (token-payment path)
const FUNDING_AMOUNT = parseUnits("1", 18); // 1 USDT
const AA_SOURCE_TRANSFER = parseUnits("1", 18); // 1 DmUSDT leaves AA wallet
const EOA_SOURCE_TRANSFER = parseUnits("0.5", 18); // 0.5 DmUSDT leaves EOA via transferFrom

const PAYMASTER_ABI = parseAbi([
  "function maxSponsoredTransactions() view returns (uint256)",
  "function userSponsorship(address user) view returns (uint256)",
  "function maxCostPerSponsoredTransaction() view returns (uint256)",
]);
const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
]);

// ── Main ──────────────────────────────────────────────────────────────────────

export async function run() {
  const logger = createLogger();

  logger.header(
    "Gokite AA SDK — E2E Smoke Test",
    "Compare AA-source transfer vs EOA-source transferFrom (with EOA approve)",
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

  const [
    isDeployed,
    kiteBalance,
    paymentTokenBalance,
    dmUsdtBalance,
    eoaDmUsdtBalance,
  ] = await Promise.all([
    aaSdk.isAccountDeloyed(aaWallet),
    pubClient.getBalance({ address: aaWallet }),
    pubClient.readContract({
      address: PAYMENT_TOKEN,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [aaWallet],
    }) as Promise<bigint>,
    pubClient.readContract({
      address: DM_USDT,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [aaWallet],
    }) as Promise<bigint>,
    pubClient.readContract({
      address: DM_USDT,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [ownerAddress],
    }) as Promise<bigint>,
  ]);

  logger.data("AA Wallet state", {
    deployed: isDeployed,
    kiteBalance: `${formatEther(kiteBalance)} KITE`,
    usdtBalance: `${formatUnits(paymentTokenBalance, 18)} USDT`,
    dmUsdtBalance: `${formatUnits(dmUsdtBalance, 18)} DmUSDT`,
    eoaDmUsdtBalance: `${formatUnits(eoaDmUsdtBalance, 18)} DmUSDT`,
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
    path: sponsored ? "sponsored (KITE paymaster)" : "token-payment (USDT)",
  });

  // ── Step 5: Ensure source balances for both comparison cases ─────────────
  if (dmUsdtBalance < AA_SOURCE_TRANSFER) {
    logger.step("Fund AA wallet with DmUSDT for AA-source transfer");
    logger.info(
      `AA wallet has ${formatUnits(dmUsdtBalance, 18)} DmUSDT — transferring ${formatUnits(AA_SOURCE_TRANSFER, 18)} DmUSDT from EOA...`,
    );

    if (eoaDmUsdtBalance < AA_SOURCE_TRANSFER) {
      throw new Error(
        `EOA has insufficient DmUSDT: ${formatUnits(eoaDmUsdtBalance, 18)}. Need at least ${formatUnits(AA_SOURCE_TRANSFER, 18)} to fund AA wallet source path.`,
      );
    }

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

    const fundDmUsdtData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [aaWallet, AA_SOURCE_TRANSFER],
    });

    const fundDmUsdtTx = await walletClient.sendTransaction({
      to: DM_USDT,
      value: 0n,
      data: fundDmUsdtData,
    });

    logger.info(`DmUSDT funding tx: ${fundDmUsdtTx}`);
    logger.info("Waiting for transfer receipt...");
    await pubClient.waitForTransactionReceipt({ hash: fundDmUsdtTx });
    logger.info("Transfer confirmed.");
  }

  // For the EOA-source path, AA wallet spends EOA funds via transferFrom.
  // This requires EOA -> AA wallet allowance to be set first (outside UserOp).
  const eoaToAaAllowance = await pubClient.readContract({
    address: DM_USDT,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [ownerAddress, aaWallet],
  });

  logger.data("EOA -> AA allowance (DmUSDT)", {
    allowance: `${formatUnits(eoaToAaAllowance, 18)} DmUSDT`,
    required: `${formatUnits(EOA_SOURCE_TRANSFER, 18)} DmUSDT`,
  });

  if (eoaToAaAllowance < EOA_SOURCE_TRANSFER) {
    logger.step("Approve AA wallet to spend EOA DmUSDT");
    logger.info(
      "EOA signs a direct approve tx. This cannot be done by UserOp because approve() must be called by token owner (EOA).",
    );

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

    const approveData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [aaWallet, EOA_SOURCE_TRANSFER],
    });

    const approveTxHash = await walletClient.sendTransaction({
      to: DM_USDT,
      value: 0n,
      data: approveData,
    });

    logger.info(`EOA approve tx: ${approveTxHash}`);
    await pubClient.waitForTransactionReceipt({ hash: approveTxHash });
    logger.info("Approval confirmed.");
  }

  // ── Step 6: Define the two batch requests to compare ─────────────────────
  const aaSourceBatchRequest = {
    targets: [DM_USDT],
    values: [0n],
    callDatas: [
      encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [RECIPIENT, AA_SOURCE_TRANSFER],
      }),
    ],
  };

  const eoaSourceBatchRequest = {
    targets: [DM_USDT],
    values: [0n],
    callDatas: [
      encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transferFrom",
        args: [ownerAddress, RECIPIENT, EOA_SOURCE_TRANSFER],
      }),
    ],
  };

  logger.data("Comparison requests", {
    recipient: RECIPIENT,
    aaSource: `${formatUnits(AA_SOURCE_TRANSFER, 18)} DmUSDT via transfer()`,
    eoaSource: `${formatUnits(EOA_SOURCE_TRANSFER, 18)} DmUSDT via transferFrom()`,
  });

  // ── Step 7: Sign function ────────────────────────────────────────────────
  const signFunction = async (userOpHash: string): Promise<string> =>
    eoaAccount.signMessage({ message: { raw: userOpHash as Hex } });

  // ── Step 8: Send UserOps via appropriate path ────────────────────────────
  logger.step(
    sponsored
      ? "Send sponsored comparison UserOps"
      : "Send token-payment comparison UserOps",
  );

  let aaSourceResult: { userOpHash: string; status: any };
  let eoaSourceResult: { userOpHash: string; status: any };

  if (sponsored) {
    // ── Path A: Sponsored ──────────────────────────────────────────────────
    logger.info("Sponsorship available — using sponsored path...");

    aaSourceResult = await aaSdk.sendUserOperationAndWait(
      ownerAddress,
      aaSourceBatchRequest,
      signFunction,
      undefined,
      undefined,
      { maxRetries: 60, interval: 5000 },
    );

    eoaSourceResult = await aaSdk.sendUserOperationAndWait(
      ownerAddress,
      eoaSourceBatchRequest,
      signFunction,
      undefined,
      undefined, // SDK uses config.paymaster
      { maxRetries: 60, interval: 5000 },
    );
  } else {
    // ── Path B: Token payment ──────────────────────────────────────────────
    // 1. Ensure AA wallet has settlement token (USDT) to cover gas
    if (paymentTokenBalance < FUNDING_AMOUNT) {
      logger.info(
        `AA wallet has ${formatUnits(paymentTokenBalance, 18)} USDT — transferring ${formatUnits(FUNDING_AMOUNT, 18)} USDT from EOA...`,
      );

      // Check EOA has enough USDT
      const eoaUsdt = await pubClient.readContract({
        address: PAYMENT_TOKEN,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [ownerAddress],
      });

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

      logger.info(`USDT funding tx: ${fundTxHash}`);
      logger.info("Waiting for transfer receipt...");
      await pubClient.waitForTransactionReceipt({ hash: fundTxHash });
      logger.info("Transfer confirmed.");
    } else {
      logger.info(
        `AA wallet already has ${formatUnits(paymentTokenBalance, 18)} USDT — no funding needed.`,
      );
    }

    // 2. Build base UserOp from SDK (no bundler estimation — just constructs calldata + gas defaults)
    logger.info("Building batch UserOp (no bundler estimation)...");
    const aaSourceBaseUserOp = await (aaSdk as any).createUserOperation(
      ownerAddress,
      aaSourceBatchRequest,
    );

    const eoaSourceBaseUserOp = await (aaSdk as any).createUserOperation(
      ownerAddress,
      eoaSourceBatchRequest,
    );

    logger.data("AA-source base UserOp gas params", {
      accountGasLimits: aaSourceBaseUserOp.accountGasLimits,
      preVerificationGas: aaSourceBaseUserOp.preVerificationGas?.toString(),
      gasFees: aaSourceBaseUserOp.gasFees,
    });

    logger.data("EOA-source base UserOp gas params", {
      accountGasLimits: eoaSourceBaseUserOp.accountGasLimits,
      preVerificationGas: eoaSourceBaseUserOp.preVerificationGas?.toString(),
      gasFees: eoaSourceBaseUserOp.gasFees,
    });

    logger.info(
      "Sending AA-source batch UserOp with USDT payment (includes paymaster approve calls)...",
    );

    aaSourceResult = await aaSdk.sendUserOperationWithPayment(
      ownerAddress,
      aaSourceBatchRequest,
      aaSourceBaseUserOp,
      PAYMENT_TOKEN,
      signFunction,
      undefined,
      { maxRetries: 60, interval: 5000 },
    );

    logger.info(
      "Sending EOA-source batch UserOp with USDT payment (includes paymaster approve calls)...",
    );

    eoaSourceResult = await aaSdk.sendUserOperationWithPayment(
      ownerAddress,
      eoaSourceBatchRequest,
      eoaSourceBaseUserOp,
      PAYMENT_TOKEN,
      signFunction,
      undefined,
      { maxRetries: 60, interval: 5000 },
    );
  }

  // ── Step 9: Verify result ────────────────────────────────────────────────
  logger.step("Verify UserOp result");

  logger.data("AA-source UserOp result", {
    userOpHash: aaSourceResult.userOpHash,
    status: aaSourceResult.status.status,
    transactionHash: aaSourceResult.status.transactionHash ?? "—",
    blockNumber: aaSourceResult.status.blockNumber ?? "—",
    gasUsed: aaSourceResult.status.gasUsed ?? "—",
    reason: aaSourceResult.status.reason ?? "—",
  });

  logger.data("EOA-source UserOp result", {
    userOpHash: eoaSourceResult.userOpHash,
    status: eoaSourceResult.status.status,
    transactionHash: eoaSourceResult.status.transactionHash ?? "—",
    blockNumber: eoaSourceResult.status.blockNumber ?? "—",
    gasUsed: eoaSourceResult.status.gasUsed ?? "—",
    reason: eoaSourceResult.status.reason ?? "—",
  });

  if (aaSourceResult.status.status !== "success") {
    throw new Error(
      `AA-source UserOp did not succeed: ${aaSourceResult.status.reason ?? aaSourceResult.status.status}`,
    );
  }

  if (eoaSourceResult.status.status !== "success") {
    throw new Error(
      `EOA-source UserOp did not succeed: ${eoaSourceResult.status.reason ?? eoaSourceResult.status.status}`,
    );
  }

  // ── Step 10: Check post-op balances ─────────────────────────────────────
  logger.step("Confirm final AA wallet state");

  const [
    kiteAfter,
    tokenAfter,
    dmUsdtAfter,
    eoaDmUsdtAfter,
    recipientDmUsdtAfter,
  ] = await Promise.all([
    pubClient.getBalance({ address: aaWallet }),
    pubClient.readContract({
      address: PAYMENT_TOKEN,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [aaWallet],
    }) as Promise<bigint>,
    pubClient.readContract({
      address: DM_USDT,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [aaWallet],
    }) as Promise<bigint>,
    pubClient.readContract({
      address: DM_USDT,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [ownerAddress],
    }) as Promise<bigint>,
    pubClient.readContract({
      address: DM_USDT,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [RECIPIENT],
    }) as Promise<bigint>,
  ]);

  logger.data("AA Wallet after", {
    kiteBalance: `${formatEther(kiteAfter)} KITE`,
    usdtBalance: `${formatUnits(tokenAfter, 18)} USDT`,
    dmUsdtBalance: `${formatUnits(dmUsdtAfter, 18)} DmUSDT`,
    eoaDmUsdtBalance: `${formatUnits(eoaDmUsdtAfter, 18)} DmUSDT`,
    recipientDmUsdtBalance: `${formatUnits(recipientDmUsdtAfter, 18)} DmUSDT`,
  });

  logger.complete(
    `AA SDK comparison verified ✓  AA-source UserOp ${aaSourceResult.userOpHash}; EOA-source UserOp ${eoaSourceResult.userOpHash}`,
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
