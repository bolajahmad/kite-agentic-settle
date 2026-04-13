/**
 * Full onboarding flow for the Kite Agent Pay ecosystem.
 *
 * Orchestrates: EOA registration → Agent creation → Session key setup → Funding.
 * Replaces the 5-step frontend wizard with a single programmatic call.
 */

import { formatUnits, parseUnits, stringToHex } from "viem";
import type { ContractService } from "./contracts.js";
import type { KiteConfig } from "./types.js";
import { setVar } from "./vars.js";
import { deriveAgentAccount, deriveSessionAccount } from "./wallet.js";

// ── Types ──────────────────────────────────────────────────────────

export interface OnboardOptions {
  agentName: string;
  category?: string;
  description?: string;
  tags?: string[];
  // Optional: specify an existing agent index to resume registration for.
  // If omitted, a new agent is always created at the next available index.
  agentIndex?: number;
  // Session rules (KTT amounts as human-readable strings)
  valueLimit?: string; // max per tx, default "1"
  dailyLimit?: string; // max daily, default "10"
  validDays?: number; // session validity, default 30
  // Funding (optional, KTT / KITE as human-readable strings)
  fundAmount?: string; // KTT to deposit into AAWallet
  gasAmount?: string; // native KITE to send to agent for gas
}

export interface OnboardResult {
  eoaAddress: string;
  agentAddress: string;
  agentPrivateKey: string;
  agentId: `0x${string}`;
  sessionKeyAddress: string;
  sessionKeyPrivateKey: string;
  txHashes: { step: string; hash: string }[];
  wasAlreadyRegistered: boolean;
  kiteBalance: string;
  kttBalance: string;
  walletKttBalance: string;
  agentIndex: number;
  sessionIndex: number;
  validUntil: number;
}

// ── Core Flow ──────────────────────────────────────────────────────

/**
 * Register an EOA user, create an agent with a session key, and
 * optionally fund the wallet — all in one call.
 *
 * @param contracts  - ContractService initialised with the EOA's account
 * @param eoaPrivateKey - EOA private key bytes (for deterministic derivation)
 * @param eoaAddress    - EOA address
 * @param config        - KiteConfig (network + contract addresses)
 * @param options       - Agent metadata + session rules + funding amounts
 * @param onStep        - Optional callback for progress logging
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

  // ── Step 1: Register EOA as user on KiteAAWallet ────────────────
  log("Checking user registration...");
  const wasAlreadyRegistered = await contracts.isUserRegistered(eoaAddress);

  if (wasAlreadyRegistered) {
    log("EOA already registered.");
  } else {
    log("Registering EOA on KiteAAWallet...");
    const hash = await contracts.registerUser();
    txHashes.push({ step: "Register EOA", hash });
  }

  // ── Step 2: Determine agent index ────────────────────────────────
  log("Reading existing agents...");
  const existingAgents = await contracts.getOwnerAgents(eoaAddress);
  let agentIndex: number;

  if (options.agentIndex !== undefined) {
    // Caller specified an existing agent to resume/update
    agentIndex = options.agentIndex;
    log(`Using specified agent index: ${agentIndex}`);
  } else {
    // Create the next agent
    agentIndex = existingAgents.length;
    log(
      `Found ${existingAgents.length} existing agent(s). Next index: ${agentIndex}`,
    );
  }

  // ── Step 3: Derive agent address deterministically ──────────────
  log("Deriving agent address...");
  const agent = await deriveAgentAccount(eoaPrivateKey, agentIndex);
  log(`Agent address: ${agent.address}`);

  // ── Step 4: Register agent on AgentRegistry (idempotent) ────────
  let agentId: `0x${string}`;
  let agentAlreadyRegistered = false;

  // Check if this agent address is already registered
  try {
    const resolved = await contracts.resolveAgentByAddress(agent.address);
    const resolvedId = (resolved as any)[0] ?? (resolved as any).agentId;
    // A non-zero agentId means the agent is registered
    if (
      resolvedId &&
      resolvedId !==
        "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      agentId = resolvedId as `0x${string}`;
      agentAlreadyRegistered = true;
      log(`Agent already registered. ID: ${agentId}`);
    } else {
      agentId = await registerNewAgent();
    }
  } catch {
    // resolveAgentByAddress may revert for unknown agents
    agentId = await registerNewAgent();
  }

  async function registerNewAgent(): Promise<`0x${string}`> {
    log("Registering agent on-chain...");
    const metadata = JSON.stringify({
      version: "0.1.0",
      name: options.agentName,
      category: options.category || "",
      description: options.description || "",
      tags: options.tags || [],
    });
    const metadataHex = stringToHex(metadata);
    const { txHash: regHash, agentId: newAgentId } =
      await contracts.registerAgent(
        agent.address,
        config.contracts.kiteAAWallet,
        agentIndex,
        metadataHex,
      );
    txHashes.push({ step: "Register Agent", hash: regHash });
    log(`Agent registered. ID: ${newAgentId}`);
    return newAgentId;
  }

  // ── Step 5: Agent is auto-linked to wallet by AgentRegistry ──────
  // The AgentRegistry.registerAgent() call automatically calls
  // KiteAAWallet.addAgentId(agentId, owner), so no separate step needed.
  // Just verify it was linked:
  const userAgentIds = await contracts.getUserAgentIds(eoaAddress);
  const alreadyLinked = userAgentIds.some(
    (id) => id.toLowerCase() === agentId.toLowerCase(),
  );

  if (!alreadyLinked && !agentAlreadyRegistered) {
    // Fallback: if auto-link didn't work (e.g. old registry deployment),
    // manually link it.
    log("Auto-link not detected, manually linking agent to wallet...");
    const addIdHash = await contracts.addAgentId(agentId, eoaAddress);
    txHashes.push({ step: "Link Agent to Wallet", hash: addIdHash });
  } else {
    log("Agent linked to wallet (auto-linked by registry).");
  }

  // ── Step 6: Derive session key deterministically ────────────────
  const sessionIndex = 0; // first session for this agent
  log("Deriving session key...");
  const session = await deriveSessionAccount(
    eoaPrivateKey,
    agentIndex,
    sessionIndex,
  );
  log(`Session key: ${session.address}`);

  // ── Step 7: Add session key rule (skip if session already exists)
  let sessionAlreadyExists = false;

  try {
    const existingSessionKeys = await contracts.getAgentSessionKeys(agentId);
    sessionAlreadyExists = existingSessionKeys.some(
      (key) => key.toLowerCase() === (session.address as string).toLowerCase(),
    );
  } catch {
    // If reading session keys fails, proceed to add
  }

  const valueLimit = parseUnits(options.valueLimit || "1", 18);
  const dailyLimit = parseUnits(options.dailyLimit || "10", 18);
  const validUntil =
    Math.floor(Date.now() / 1000) + (options.validDays || 30) * 86400;

  if (!sessionAlreadyExists) {
    log("Adding session key rule...");
    // Build encrypted session metadata
    const sessionMeta = JSON.stringify({
      name: `${options.agentName}-session-${sessionIndex}`,
      purpose: options.description || "default session",
      agentIndex,
      sessionIndex,
      createdAt: new Date().toISOString(),
    });
    const sessionMetadataHex = stringToHex(sessionMeta) as `0x${string}`;
    try {
      const sessionHash = await contracts.addSessionKeyRule(
        session.address,
        agentId,
        sessionIndex,
        valueLimit,
        dailyLimit,
        validUntil,
        [],
        sessionMetadataHex,
      );
      txHashes.push({ step: "Add Session Key Rule", hash: sessionHash });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      log(`Warning: Could not add session key — ${msg.slice(0, 120)}`);
    }
  } else {
    log("Session key already registered for this agent.");
  }

  // ── Step 8: Store credentials in vars with deterministic tags ──
  log("Storing credentials in vars...");
  try {
    setVar(`AGENT_${agentIndex}_PRIVATE_KEY`, agent.privateKey);
    setVar(`AGENT_${agentIndex}_ADDRESS`, agent.address);
    setVar(`AGENT_${agentIndex}_ID`, agentId);
    setVar(
      `SESSION_${agentIndex}_${sessionIndex}_PRIVATE_KEY`,
      session.privateKey,
    );
    setVar(`SESSION_${agentIndex}_${sessionIndex}_ADDRESS`, session.address);
  } catch {
    log("Warning: Could not persist credentials to vars.");
  }

  // ── Step 9: Read balances ───────────────────────────────────────
  log("Reading balances...");
  const kiteBalance = await contracts.getNativeBalance(eoaAddress);
  const kttBalance = await contracts.getTokenBalance(config.token, eoaAddress);
  const walletKttBalance = await contracts.getUserBalance(
    eoaAddress,
    config.token,
  );

  // ── Step 10: Optional funding ────────────────────────────────────
  if (options.fundAmount && parseFloat(options.fundAmount) > 0) {
    const amount = parseUnits(options.fundAmount, 18);
    log(`Depositing ${options.fundAmount} KTT into wallet...`);
    try {
      const depositHash = await contracts.depositToWallet(config.token, amount);
      txHashes.push({ step: "Deposit KTT", hash: depositHash });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (
        msg.includes("e450d38c") ||
        msg.includes("InsufficientBalance") ||
        msg.includes("insufficient")
      ) {
        log(
          `Skipped KTT deposit — insufficient balance (need ${options.fundAmount} KTT)`,
        );
      } else {
        log(`Skipped KTT deposit — ${msg.slice(0, 120)}`);
      }
    }
  }

  if (options.gasAmount && parseFloat(options.gasAmount) > 0) {
    const amount = parseUnits(options.gasAmount, 18);
    log(`Sending ${options.gasAmount} KITE to agent for gas...`);
    try {
      const gasHash = await contracts.sendNativeToken(agent.address, amount);
      txHashes.push({ step: "Fund Agent Gas", hash: gasHash });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (
        msg.includes("insufficient funds") ||
        msg.includes("insufficient balance")
      ) {
        log(
          `Skipped gas funding — insufficient native balance (need ${options.gasAmount} KITE)`,
        );
      } else {
        log(`Skipped gas funding — ${msg.slice(0, 120)}`);
      }
    }
  }

  log("Onboarding complete!");

  return {
    eoaAddress,
    agentAddress: agent.address,
    agentPrivateKey: agent.privateKey,
    agentId,
    sessionKeyAddress: session.address,
    sessionKeyPrivateKey: session.privateKey,
    txHashes,
    wasAlreadyRegistered,
    kiteBalance: formatUnits(kiteBalance, 18),
    kttBalance: formatUnits(kttBalance, 18),
    walletKttBalance: formatUnits(walletKttBalance, 18),
    agentIndex,
    sessionIndex,
    validUntil,
  };
}
