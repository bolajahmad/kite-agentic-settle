/**
 * Full onboarding flow for the ClientAgentVault + IdentityRegistry architecture.
 *
 * Orchestrates:
 *   1. Ensure the user's AA wallet exists (create via WalletFactory if needed)
 *   2. Register agent NFT (agentId) on IdentityRegistry
 *   3. Derive session key pair + create session rule on vault and registry
 */

import { GokiteAASDK } from "gokite-aa-sdk";
import { encodeFunctionData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { clientAgentVaultAbi } from "./abis.js";
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

  // ── Step 1: Derive AA wallet address from EOA via GokiteAASDK ───
  log("Resolving AA wallet address from EOA...");

  let aaWalletAddress = options.walletContract;
  const createdAaWallet = false;
  let aaSdk: GokiteAASDK | undefined;

  if (!aaWalletAddress) {
    // Primary: deterministic derivation via GokiteAASDK (same as bkp.ts pattern)
    if (config.networkName && config.bundlerUrl) {
      aaSdk = new GokiteAASDK(
        config.networkName,
        config.rpcUrl,
        config.bundlerUrl,
      );
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

  // ── Step 2: Register agent NFT on IdentityRegistry ──────────────
  log("Registering agent on IdentityRegistry...");
  const { txHash: regHash, agentId } = await contracts.registerAgentOnRegistry(
    options.agentURI,
  );
  txHashes.push({ step: "Register Agent", hash: regHash });
  log(`Agent registered. agentId: ${agentId}`);

  // ── Step 3: Derive session key (agentId-bound) ───────────────────
  const sessionIndex = options.sessionIndex ?? 0;
  log("Deriving session key...");
  const session = await deriveSessionForAgent(
    eoaPrivateKey,
    agentId,
    sessionIndex,
  );
  log(`Session key: ${session.address}`);

  // ── Step 4: Store session private key (plain) ──────────────────
  // Encryption was removed — storing the seed alongside the encrypted blob
  // was equivalent to storing the key in plain text anyway.
  const encryptedSessionKey = ""; // deprecated field, kept for API compat
  const sessionSeed = ""; // deprecated field, kept for API compat

  // ── Step 4: Create vault session + register session rule ─────────
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

  log("Creating vault session...");
  let createVaultSessionHash: string | undefined;

  if (aaSdk) {
    // Send createSession as a UserOperation through the bundler
    const eoaAccount = privateKeyToAccount(
      `0x${Buffer.from(eoaPrivateKey).toString("hex")}` as `0x${string}`,
    );
    const signFunction = async (userOpHash: string): Promise<string> =>
      eoaAccount.signMessage({ message: { raw: userOpHash as Hex } });

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

    const result = await aaSdk.sendUserOperationAndWait(
      eoaAddress,
      {
        target: "0xF7681F4f70a2F2d114D03e6B93189cb549B8A503",
        value: 0n,
        callData: createSessionCalldata,
      },
      signFunction,
      undefined,
      undefined,
      { maxRetries: 40, interval: 5000 },
    );
    if ((result.status as any).status !== "success") {
      throw new Error(
        (result.status as any).reason ?? "createSession UserOp did not succeed",
      );
    }
    createVaultSessionHash =
      (result.status as any).transactionHash ?? result.userOpHash;
    log(`Vault session created via UserOp: ${createVaultSessionHash}`);
  } else {
    // Fallback: direct tx (for non-GokiteAASDK vault implementations)
    createVaultSessionHash = await contracts.createVaultSession({
      walletContract: aaWalletAddress,
      sessionId,
      sessionKey: session.address,
      rules: vaultRules,
    });
  }
  txHashes.push({
    step: "Create Vault Session",
    hash: createVaultSessionHash ?? "",
  });

  log("Registering session on IdentityRegistry...");
  const registerSessionHash = await contracts.registerSessionOnRegistry({
    agentId,
    sessionKey: session.address,
    user: eoaAddress,
    walletContract: aaWalletAddress,
    validUntil: BigInt(validUntil),
    blockedAgents: options.blockedAgents ?? [],
  });
  txHashes.push({ step: "Register Session Rule", hash: registerSessionHash });

  // ── Step 5: Persist credentials in vars ─────────────────────────
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
