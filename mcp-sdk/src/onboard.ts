/**
 * Full onboarding flow for the Kite Agent Pay ecosystem (IdentityRegistry v2).
 *
 * Orchestrates:
 *   1. EOA registration on KiteAAWallet
 *   2. Agent NFT mint on IdentityRegistry (EIP-8004 agentURI)
 *   3. Session key derivation (agentId-bound, encrypted with seed phrase)
 *   4. Session key rule registration on IdentityRegistry via KiteAAWallet
 *   5. Optional KTT deposit into KiteAAWallet
 */

import { formatUnits, parseUnits } from "viem";
import type { ContractService } from "./contracts.js";
import type { KiteConfig } from "./types.js";
import { setVar } from "./vars.js";
import {
  deriveSessionForAgent,
  encryptSessionKey,
  generateSeedPhrase,
} from "./wallet.js";

// ── Types ──────────────────────────────────────────────────────────

export interface OnboardOptions {
  /** EIP-8004 agent URI (IPFS/base64) string. Required. */
  agentURI: string;
  /** Seed phrase for encrypting the session key. Generated if omitted. */
  sessionSeed?: string;
  /** Per-transaction spending limit (human-readable token amount). Default: "1". */
  valueLimit?: string;
  /** Lifetime session spending cap. Default: "10". */
  maxValueAllowed?: string;
  /** Session validity in days. Default: 30. */
  validDays?: number;
  /** agentIds blocked from using this session key. */
  blockedAgents?: bigint[];
  /** KTT amount to deposit into KiteAAWallet. Optional. */
  fundAmount?: string;
  gasAmount?: string;
}

export interface OnboardResult {
  eoaAddress: string;
  agentId: bigint;
  agentURI: string;
  sessionKeyAddress: string;
  /** Encrypted session key blob (store privately; decrypt with sessionSeed). */
  encryptedSessionKey: string;
  /** The seed phrase used for encryption. MUST be stored securely by the user. */
  sessionSeed: string;
  txHashes: { step: string; hash: string }[];
  wasAlreadyRegistered: boolean;
  walletUSDTBalance: string;
  validUntil: number;
  // Compat fields (legacy consumers)
  agentAddress: string;
  agentPrivateKey: string;
  sessionKeyPrivateKey: string;
  kiteBalance: string;
  usdtBalance: string;
  agentIndex: number;
  sessionIndex: number;
}

// ── Core Flow ──────────────────────────────────────────────────────

/**
 * Register an EOA user, mint an agent NFT, derive + encrypt a session key,
 * and optionally fund the KiteAAWallet — all in one call.
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

  // ── Step 1: Register EOA on KiteAAWallet ────────────────────────
  log("Checking user registration...");
  const wasAlreadyRegistered = await contracts.isUserRegistered(eoaAddress);
  if (wasAlreadyRegistered) {
    log("User already registered.");
  } else {
    log("Registering user on KiteAAWallet...");
    const hash = await contracts.registerUser();
    txHashes.push({ step: "Register User", hash });
  }

  // ── Step 2: Register agent NFT on IdentityRegistry ──────────────
  log("Registering agent on IdentityRegistry...");
  const { txHash: regHash, agentId } = await contracts.registerAgentOnRegistry(
    options.agentURI,
  );
  txHashes.push({ step: "Register Agent", hash: regHash });
  log(`Agent registered. agentId: ${agentId}`);

  // ── Step 3: Derive session key (agentId-bound) ───────────────────
  const sessionIndex = 0;
  log("Deriving session key...");
  const session = await deriveSessionForAgent(
    eoaPrivateKey,
    agentId,
    sessionIndex,
  );
  log(`Session key: ${session.address}`);

  // ── Step 4: Encrypt session key ──────────────────────────────────
  const sessionSeed = options.sessionSeed ?? generateSeedPhrase();
  const encryptedSessionKey = encryptSessionKey(
    session.privateKey,
    sessionSeed,
  );

  // ── Step 5: Register session key rule ───────────────────────────
  const valueLimit = parseUnits(options.valueLimit ?? "1", 18);
  const maxValueAllowed = parseUnits(options.maxValueAllowed ?? "10", 18);
  const validUntil =
    Math.floor(Date.now() / 1000) + (options.validDays ?? 7) * 86400;

  log("Registering session key rule...");

  try {
    const sessionHash = await contracts.addSessionKeyRule(
      agentId,
      session.address,
      valueLimit,
      maxValueAllowed,
      BigInt(validUntil),
      options.blockedAgents ?? [],
    );
    txHashes.push({ step: "Add Session Key Rule", hash: sessionHash });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    log(`Warning: Could not add session key rule — ${msg.slice(0, 120)}`);
  }

  // ── Step 6: Persist credentials in vars ─────────────────────────
  log("Storing credentials in vars...");
  try {
    setVar(`AGENT_${agentId}_ID`, agentId.toString());
    setVar(`AGENT_${agentId}_URI`, options.agentURI);
    setVar(`SESSION_${agentId}_${sessionIndex}_ADDRESS`, session.address);
    setVar(`SESSION_${agentId}_${sessionIndex}_ENCRYPTED`, encryptedSessionKey);
  } catch {
    log("Warning: Could not persist credentials to vars.");
  }

  // ── Step 7: Optional USDT deposit ────────────────────────────────
  if (options.fundAmount && Number.parseFloat(options.fundAmount) > 0) {
    const amount = parseUnits(options.fundAmount, 18);
    log(`Depositing ${options.fundAmount} USDT into wallet...`);
    try {
      const depositHash = await contracts.depositToWallet(config.token, amount);
      txHashes.push({ step: "Deposit USDT", hash: depositHash });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      log(`Skipped USDT deposit — ${msg.slice(0, 120)}`);
    }
  }

  // ── Step 8: Read final balances ──────────────────────────────────
  const walletUSDTBalance = await contracts.getDepositedTokenBalance(
    config.token as `0x${string}`,
    eoaAddress as `0x${string}`,
  );

  log("Onboarding complete!");

  return {
    eoaAddress,
    agentId,
    agentURI: options.agentURI,
    sessionKeyAddress: session.address,
    encryptedSessionKey,
    sessionSeed,
    txHashes,
    wasAlreadyRegistered,
    walletUSDTBalance: formatUnits(walletUSDTBalance, 18),
    validUntil,
    // Compat fields
    agentAddress: eoaAddress,
    agentPrivateKey: "",
    sessionKeyPrivateKey: session.privateKey,
    kiteBalance: "0",
    usdtBalance: formatUnits(walletUSDTBalance, 18),
    agentIndex: 0,
    sessionIndex: 0,
  };
}
