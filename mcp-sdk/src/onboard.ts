/**
 * Full onboarding flow for the ClientAgentVault + IdentityRegistry architecture.
 *
 * Orchestrates:
 *   1. Resolve and deploy the user's AA wallet (if not already deployed)
 *   2. Register agent NFT (agentId) on IdentityRegistry
 *   3. Derive session key pair
 *   4. Create session rule on vault + register session key on IdentityRegistry
 *   5. Ensure gas-sponsoring path is funded when sponsorship credits are exhausted
 */

import { GokiteAASDK } from "gokite-aa-sdk";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { clientAgentVaultAbi, identityRegistryAbi } from "./abis.js";
import type { ContractService } from "./contracts.js";
import type { KiteConfig } from "./types.js";
import { deriveSessionId, hashProvider } from "./utils/session-id.js";
import { setVar } from "./vars.js";
import { deriveSessionForAgent } from "./wallet.js";

// ── Types ──────────────────────────────────────────────────────────

export interface OnboardOptions {
  /** EIP-8004 agent URI (IPFS/base64) string. Optional. */
  agentURI?: string;
  /** Optional AA wallet override. If omitted, onboarding resolves/creates one. */
  walletContract?: string;
  /** Session key index for deterministic derivation. Default: 0. */
  sessionIndex?: number;
  /** Session validity in days. Default: 30. */
  validDays?: number;
  /** agentIds blocked from using this session key. */
  blockedAgents?: bigint[];
  /** Optional vault spending rule to apply during session creation. */
  sessionRule?: {
    timeWindow: bigint;
    budget: bigint;
    /** Optional provider allowlist as addresses. Will be hashed to bytes32. */
    targetProviders?: string[];
    /** Optional override; default is current timestamp. */
    initialWindowStartTime?: bigint;
  };
  /** If true (default), deploys AA wallet upfront when not yet deployed. */
  ensureWalletDeployment?: boolean;
  /** Optional gas-sponsoring controls for token-payment fallback. */
  gasSponsoring?: {
    /** Explicit paymaster settlement token. If omitted, derived from AA SDK config. */
    paymentTokenAddress?: `0x${string}`;
    /** Token amount to top up when fallback is needed. If omitted, defaults to 1 token unit. */
    paymentTokenTopUpAmount?: bigint;
    /** Minimum balance target for paymaster token in AA wallet. Defaults to topUpAmount. */
    minPaymentTokenBalance?: bigint;
  };
}

export interface OnboardResult {
  eoaAddress: string;
  aaWalletAddress: string;
  createdAaWallet: boolean;
  agentId: bigint;
  agentURI?: string;
  sessionId: `0x${string}`;
  sessionKeyAddress: string;
  /** @deprecated Always empty string — encryption removed. */
  encryptedSessionKey: string;
  /** @deprecated Always empty string — encryption removed. */
  sessionSeed: string;
  txHashes: { step: string; hash: string }[];
  validUntil: number;
  // Compat fields (legacy consumers)
  agentAddress: string;
  agentPrivateKey: string;
  sessionKeyPrivateKey: string;
  kiteBalance: string;
  usdtBalance: string;
  walletUSDTBalance: string;
  wasAlreadyRegistered: boolean;
  agentIndex: number;
  sessionIndex: number;
}

interface UserOpSendResult {
  userOpHash: string;
  txHash: string;
}

const paymasterAbi = parseAbi([
  "function maxSponsoredTransactions() view returns (uint256)",
  "function userSponsorship(address user) view returns (uint256)",
]);

const erc20ReadAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

function sdkConfigFromInstance(aaSdk: GokiteAASDK): any {
  return (aaSdk as any).config ?? (aaSdk as any)._config;
}

function resolvePaymasterPaymentToken(
  aaSdk: GokiteAASDK,
  options: OnboardOptions,
): `0x${string}` | undefined {
  if (options.gasSponsoring?.paymentTokenAddress) {
    return options.gasSponsoring.paymentTokenAddress;
  }

  const sdkConfig = sdkConfigFromInstance(aaSdk);
  if (sdkConfig?.settlementToken) {
    return sdkConfig.settlementToken as `0x${string}`;
  }

  const fallback = sdkConfig?.supportedTokens?.[1]?.address;
  if (fallback) return fallback as `0x${string}`;

  return undefined;
}

async function getDefaultTokenUnit(
  rpcUrl: string,
  token: `0x${string}`,
): Promise<bigint> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const decimals = (await client.readContract({
    address: token,
    abi: erc20ReadAbi,
    functionName: "decimals",
  })) as number;

  return 10n ** BigInt(decimals);
}

async function hasSponsorshipCredit(
  aaSdk: GokiteAASDK,
  rpcUrl: string,
  aaWalletAddress: `0x${string}`,
): Promise<boolean> {
  const sdkConfig = sdkConfigFromInstance(aaSdk);
  const paymaster = sdkConfig?.paymaster as `0x${string}` | undefined;
  if (!paymaster) return false;

  const client = createPublicClient({ transport: http(rpcUrl) });

  const [maxSponsored, usedSponsored] = await Promise.all([
    client.readContract({
      address: paymaster,
      abi: paymasterAbi,
      functionName: "maxSponsoredTransactions",
    }) as Promise<bigint>,
    client.readContract({
      address: paymaster,
      abi: paymasterAbi,
      functionName: "userSponsorship",
      args: [aaWalletAddress],
    }) as Promise<bigint>,
  ]);

  return maxSponsored > usedSponsored;
}

async function ensurePaymasterTokenBalance(
  contracts: ContractService,
  config: KiteConfig,
  aaWalletAddress: `0x${string}`,
  eoaAddress: string,
  paymentToken: `0x${string}`,
  options: OnboardOptions,
  log: (msg: string) => void,
  txHashes: { step: string; hash: string }[],
): Promise<void> {
  const topUpAmount =
    options.gasSponsoring?.paymentTokenTopUpAmount ??
    (await getDefaultTokenUnit(config.rpcUrl, paymentToken));
  const minTarget = options.gasSponsoring?.minPaymentTokenBalance ?? topUpAmount;

  const [walletBalance, eoaBalance] = await Promise.all([
    contracts.getTokenBalance(paymentToken, aaWalletAddress),
    contracts.getTokenBalance(paymentToken, eoaAddress as `0x${string}`),
  ]);

  if (walletBalance >= minTarget) return;

  if (eoaBalance < topUpAmount) {
    throw new Error(
      `EOA has insufficient paymaster token balance for gas sponsoring. wallet=${walletBalance.toString()} min=${minTarget.toString()} eoa=${eoaBalance.toString()} topUp=${topUpAmount.toString()}`,
    );
  }

  log(
    `Funding AA wallet with paymaster settlement token for gas sponsoring fallback (${paymentToken})...`,
  );
  const fundHash = await contracts.transferToken(
    paymentToken,
    aaWalletAddress,
    topUpAmount,
  );
  txHashes.push({ step: "Fund Gas Sponsoring Token", hash: fundHash });
}

async function sendUserOperationWithSponsoringFallback(params: {
  aaSdk: GokiteAASDK;
  contracts: ContractService;
  config: KiteConfig;
  options: OnboardOptions;
  eoaPrivateKey: Uint8Array;
  eoaAddress: string;
  aaWalletAddress: `0x${string}`;
  request: { target: `0x${string}`; value: bigint; callData: `0x${string}` };
  log: (msg: string) => void;
  txHashes: { step: string; hash: string }[];
  stepName: string;
}): Promise<UserOpSendResult> {
  const {
    aaSdk,
    contracts,
    config,
    options,
    eoaPrivateKey,
    eoaAddress,
    aaWalletAddress,
    request,
    log,
    txHashes,
    stepName,
  } = params;

  const eoaAccount = privateKeyToAccount(
    `0x${Buffer.from(eoaPrivateKey).toString("hex")}` as `0x${string}`,
  );
  const signFunction = async (userOpHash: string): Promise<string> =>
    eoaAccount.signMessage({ message: { raw: userOpHash as Hex } });

  const sponsored = await hasSponsorshipCredit(
    aaSdk,
    config.rpcUrl,
    aaWalletAddress,
  );

  if (sponsored) {
    log(`${stepName}: using sponsored paymaster path...`);
    const result = await aaSdk.sendUserOperationAndWait(
      eoaAddress,
      request,
      signFunction,
      undefined,
      undefined,
      { maxRetries: 60, interval: 5000 },
    );

    const status = result.status as any;
    if (status.status !== "success") {
      throw new Error(status.reason ?? `${stepName} UserOp did not succeed`);
    }

    const txHash = (status.transactionHash ?? result.userOpHash) as string;
    txHashes.push({ step: stepName, hash: txHash });
    return { userOpHash: result.userOpHash, txHash };
  }

  const paymentToken = resolvePaymasterPaymentToken(aaSdk, options);
  if (!paymentToken) {
    throw new Error(
      "Sponsorship exhausted and no settlement token could be resolved for token-payment fallback.",
    );
  }

  await ensurePaymasterTokenBalance(
    contracts,
    config,
    aaWalletAddress,
    eoaAddress,
    paymentToken,
    options,
    log,
    txHashes,
  );

  log(`${stepName}: sponsorship exhausted; using token-payment fallback (${paymentToken})...`);
  const baseUserOp = await (aaSdk as any).createUserOperation(eoaAddress, request);
  const result = await aaSdk.sendUserOperationWithPayment(
    eoaAddress,
    request,
    baseUserOp,
    paymentToken,
    signFunction,
    undefined,
    { maxRetries: 60, interval: 5000 },
  );

  const status = result.status as any;
  if (status.status !== "success") {
    throw new Error(status.reason ?? `${stepName} UserOp did not succeed`);
  }

  const txHash = (status.transactionHash ?? result.userOpHash) as string;
  txHashes.push({ step: stepName, hash: txHash });
  return { userOpHash: result.userOpHash, txHash };
}

// ── Core Flow ──────────────────────────────────────────────────────

/**
 * Ensure AA wallet, mint an agent NFT, derive a session key pair,
 * create the session on vault, and register session identity on-chain.
 *
 * @param contracts     ContractService initialised with the EOA's account
 * @param eoaPrivateKey EOA private key bytes (for session derivation)
 * @param eoaAddress    EOA address
 * @param config        KiteConfig (network + contract addresses)
 * @param options       Agent metadata + session rules + funding amounts
 * @param onStep        Optional callback for progress logging
 */
export async function onboardAgent(
  contracts: ContractService,
  eoaPrivateKey: Uint8Array,
  eoaAddress: string,
  config: KiteConfig,
  options: OnboardOptions,
  onStep?: (step: string) => void,
): Promise<OnboardResult> {
  const txHashes: { step: string; hash: string }[] = [];
  const log = (msg: string) => onStep?.(msg);
  const shouldEnsureDeployment = options.ensureWalletDeployment ?? true;

  // ── Step 1: Resolve AA wallet address from EOA via GokiteAASDK ──────────
  log("Resolving AA wallet address from EOA...");

  let aaWalletAddress = options.walletContract;
  let createdAaWallet = false;
  let aaSdk: GokiteAASDK | undefined;

  if (config.networkName && config.bundlerUrl) {
    aaSdk = new GokiteAASDK(config.networkName, config.rpcUrl, config.bundlerUrl);
  }

  if (!aaWalletAddress) {
    if (aaSdk) {
      aaWalletAddress = aaSdk.getAccountAddress(eoaAddress) as `0x${string}`;
      log(`AA wallet derived: ${aaWalletAddress}`);
    } else if (config.contracts.walletFactory) {
      const existing = await contracts.getWalletFromFactory(eoaAddress);
      if (
        existing &&
        existing.toLowerCase() !== "0x0000000000000000000000000000000000000000"
      ) {
        aaWalletAddress = existing;
      }
    } else if (config.contracts.kiteAAWallet) {
      aaWalletAddress = config.contracts.kiteAAWallet;
    }
  }

  if (!aaWalletAddress) {
    throw new Error(
      "No AA wallet available. Configure networkName+bundlerUrl, walletFactory, or kiteAAWallet.",
    );
  }

  // ── Step 2: Ensure wallet deployment (if requested) ─────────────────────
  if (shouldEnsureDeployment) {
    if (aaSdk) {
      const deployed = await aaSdk.isAccountDeloyed(aaWalletAddress);
      if (!deployed) {
        log("AA wallet not deployed yet. Deploying wallet with a bootstrap UserOperation...");

        await sendUserOperationWithSponsoringFallback({
          aaSdk,
          contracts,
          config,
          options,
          eoaPrivateKey,
          eoaAddress,
          aaWalletAddress: aaWalletAddress as `0x${string}`,
          request: {
            target: eoaAddress as `0x${string}`,
            value: 0n,
            callData: "0x",
          },
          log,
          txHashes,
          stepName: "Deploy AA Wallet",
        });

        createdAaWallet = true;
      }
    } else if (config.contracts.walletFactory) {
      const existing = await contracts.getWalletFromFactory(eoaAddress);
      if (
        !existing ||
        existing.toLowerCase() === "0x0000000000000000000000000000000000000000"
      ) {
        log("No wallet found in WalletFactory. Deploying via factory...");
        const deployHash = await contracts.deployWalletViaFactory();
        txHashes.push({ step: "Deploy AA Wallet", hash: deployHash });
        createdAaWallet = true;
        const resolved = await contracts.getWalletFromFactory(eoaAddress);
        if (
          resolved &&
          resolved.toLowerCase() !== "0x0000000000000000000000000000000000000000"
        ) {
          aaWalletAddress = resolved;
        }
      }
    }
  }

  // ── Step 3: Register agent NFT on IdentityRegistry ──────────────────────
  log("Registering agent on IdentityRegistry...");
  const { txHash: regHash, agentId } = await contracts.registerAgentOnRegistry(
    options.agentURI,
  );
  txHashes.push({ step: "Register Agent", hash: regHash });
  log(`Agent registered. agentId: ${agentId}`);

  // ── Step 4: Derive session key (agentId-bound) ─────────────────────────
  const sessionIndex = options.sessionIndex ?? 0;
  log("Deriving session key...");
  const session = await deriveSessionForAgent(
    eoaPrivateKey,
    agentId,
    sessionIndex,
  );
  log(`Session key: ${session.address}`);

  // ── Step 5: Store session private key (plain) ──────────────────────────
  // Encryption was removed — storing the seed alongside the encrypted blob
  // was equivalent to storing the key in plain text anyway.
  const encryptedSessionKey = ""; // deprecated field, kept for API compat
  const sessionSeed = ""; // deprecated field, kept for API compat

  // ── Step 6: Create vault session + register session rule ───────────────
  const validUntil =
    Math.floor(Date.now() / 1000) + (options.validDays ?? 7) * 86400;
  const sessionId = deriveSessionId(
    session.address as `0x${string}`,
    agentId,
    BigInt(validUntil),
  );

  const now = BigInt(Math.floor(Date.now() / 1000));
  const vaultRules = options.sessionRule
    ? [
        {
          timeWindow: options.sessionRule.timeWindow,
          budget: options.sessionRule.budget,
          initialWindowStartTime:
            options.sessionRule.initialWindowStartTime ?? now,
          targetProviders: (options.sessionRule.targetProviders ?? []).map(
            (provider) => hashProvider(provider as `0x${string}`),
          ),
        },
      ]
    : [];

  log("Creating vault session and registering on IdentityRegistry...");

  if (aaSdk) {
    // ── Step 5a: Create session on vault via UserOp ──────────────────────
    const createSessionCalldata = encodeFunctionData({
      abi: clientAgentVaultAbi,
      functionName: "createSession",
      args: [
        sessionId,
        session.address as `0x${string}`,
        vaultRules.map((r) => ({
          timeWindow: r.timeWindow,
          budget: r.budget,
          initialWindowStartTime: r.initialWindowStartTime,
          targetProviders: r.targetProviders,
        })),
      ],
    });

    log("Sending createSession UserOp...");
    const createSessionResult = await sendUserOperationWithSponsoringFallback({
      aaSdk,
      contracts,
      config,
      options,
      eoaPrivateKey,
      eoaAddress,
      aaWalletAddress: aaWalletAddress as `0x${string}`,
      request: {
        target: aaWalletAddress as `0x${string}`,
        value: 0n,
        callData: createSessionCalldata,
      },
      log,
      txHashes,
      stepName: "Create Vault Session",
    });

    log(`Vault session created. Confirming on-chain state...`);

    // ── Step 5b: Verify session exists on vault before proceeding ────────
    const sessionExistsOnVault = await new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        try {
          const publicClient = createPublicClient({
            transport: http(config.rpcUrl),
          });
          const exists = (await publicClient.readContract({
            address: aaWalletAddress as `0x${string}`,
            abi: clientAgentVaultAbi,
            functionName: "sessionExists",
            args: [sessionId],
          })) as boolean;

          if (exists) {
            clearInterval(checkInterval);
            resolve(true);
          }
        } catch (e) {
          // Ignore read errors and keep polling
        }
      }, 1000);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, 30000);
    });

    if (!sessionExistsOnVault) {
      log("WARNING: Session not confirmed on vault after 30s. Proceeding anyway...");
    } else {
      log("✓ Session confirmed on vault.");
    }

    // ── Step 5c: Register session on IdentityRegistry ────────────────────
    log("Registering session on IdentityRegistry...");
    const registerSessionHash = await contracts.registerSessionOnRegistry({
      agentId,
      sessionKey: session.address,
      user: eoaAddress,
      walletContract: aaWalletAddress,
      validUntil: BigInt(validUntil),
      blockedAgents: options.blockedAgents ?? [],
    });

    txHashes.push({
      step: "Create Vault Session",
      hash: createSessionResult.txHash,
    });
    txHashes.push({
      step: "Register Session Rule",
      hash: registerSessionHash,
    });
  } else {
    // Fallback: direct tx (for non-GokiteAASDK vault implementations)
    const createVaultSessionHash = await contracts.createVaultSession({
      walletContract: aaWalletAddress,
      sessionId,
      sessionKey: session.address,
      rules: vaultRules,
    });
    txHashes.push({
      step: "Create Vault Session",
      hash: createVaultSessionHash ?? "",
    });

    // Allow time for createSession to be confirmed
    log("Waiting for vault session confirmation...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const registerSessionHash = await contracts.registerSessionOnRegistry({
      agentId,
      sessionKey: session.address,
      user: eoaAddress,
      walletContract: aaWalletAddress,
      validUntil: BigInt(validUntil),
      blockedAgents: options.blockedAgents ?? [],
    });
    txHashes.push({
      step: "Register Session Rule",
      hash: registerSessionHash,
    });
  }

  // ── Step 7: Persist credentials in vars ────────────────────────────────
  log("Storing credentials in vars...");
  try {
    setVar(`AGENT_${agentId}_ID`, agentId.toString());
    if (options.agentURI) setVar(`AGENT_${agentId}_URI`, options.agentURI);
    setVar(`AGENT_${agentId}_WALLET`, aaWalletAddress);
    setVar(`SESSION_${agentId}_${sessionIndex}_ID`, sessionId);
    setVar(`SESSION_${agentId}_${sessionIndex}_ADDRESS`, session.address);
    setVar(
      `SESSION_${agentId}_${sessionIndex}_PRIVATE_KEY`,
      session.privateKey,
    );
  } catch {
    log("Warning: Could not persist credentials to vars.");
  }

  log("Onboarding complete!");

  return {
    eoaAddress,
    aaWalletAddress,
    createdAaWallet,
    agentId,
    agentURI: options.agentURI,
    sessionId,
    sessionKeyAddress: session.address,
    encryptedSessionKey,
    sessionSeed,
    txHashes,
    validUntil,
    // Compat fields
    agentAddress: eoaAddress,
    agentPrivateKey: "",
    sessionKeyPrivateKey: session.privateKey,
    kiteBalance: "0",
    usdtBalance: "0",
    walletUSDTBalance: "0",
    wasAlreadyRegistered: false,
    agentIndex: 0,
    sessionIndex,
  };
}
