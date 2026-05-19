/**
 * Common setup utilities for examples.
 * Handles client creation, session resolution, and cleanup.
 */

import { KITE_TESTNET, KiteSettleClient } from "../../src/index.js";
import { getCredential } from "../../src/vars.js";
import type { Logger } from "./logger.js";

export interface DemoSetupOptions {
  logger?: Logger;
  /**
   * Require specific agentId. If not provided, will attempt to resolve
   * from vars or use EOA mode.
   */
  agentId?: bigint | string;
  /**
   * Specific session key to use. If omitted, SDK auto-selects best session.
   */
  sessionKey?: string;
  /**
   * Allow using unavailable sessions (expired, over capacity).
   * Used for demo purposes or settlement operations.
   */
  allowUnavailableSession?: boolean;
}

/**
 * Create a KiteSettleClient for demo purposes.
 * Attempts agent mode first, falls back to EOA mode if no agent exists.
 */
export async function createDemoClient(
  options: DemoSetupOptions = {},
): Promise<KiteSettleClient> {
  const { logger, agentId, sessionKey, allowUnavailableSession } = options;

  // Try to resolve credential
  let credential: string | undefined;
  try {
    credential = getCredential();
  } catch {
    // No credential stored, will fail later if needed
  }

  // If agentId specified, use agent mode
  if (agentId !== undefined) {
    logger?.info(`Creating client in agent mode (agentId=${agentId})`);
    return await KiteSettleClient.create({
      agentId: BigInt(agentId),
      sessionKey,
      allowUnavailableSession,
    });
  }

  // Try to find any agent for this EOA
  if (credential) {
    logger?.info("Checking for existing agent registration...");
    try {
      const client = await KiteSettleClient.create({ credential });
      if (client.sessionKeyAddress) {
        logger?.success(
          `Found agent with session key: ${client.sessionKeyAddress}`,
        );
        return client;
      }
      logger?.info("No agent found, using EOA mode");
      return client;
    } catch (err) {
      logger?.warn(`Failed to create client: ${err}`);
      throw err;
    }
  }

  // No credential or agent - create read-only client
  logger?.warn("No credential found, creating read-only client");
  return KiteSettleClient.createReadOnly();
}

/**
 * Get demo configuration with sensible defaults
 */
export function getDemoConfig() {
  return {
    ...KITE_TESTNET,
    // Can override indexer URL or other config here if needed
  };
}

/**
 * Format wei amount as readable USDC (6 decimals)
 */
export function formatUsdc(amount: bigint, decimals = 18): string {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  return `${whole}.${fraction.toString()} USDC`;
}

/**
 * Parse USDC amount to wei (6 decimals)
 */
export function parseUsdc(amount: string, decimals = 18): bigint {
  const [whole, fraction = ""] = amount.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(paddedFraction);
}

/**
 * Wait for specified milliseconds (for demo pacing)
 */
export async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get current timestamp in seconds
 */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Format timestamp as readable date
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Check if session is valid (not expired, has capacity)
 */
export function isSessionValid(
  session: { validUntil: bigint | string; valueLimit: bigint | string },
  spent: bigint = 0n,
): { valid: boolean; reason?: string } {
  const nowSec = now();
  const validUntil = Number(session.validUntil);
  const valueLimit = BigInt(session.valueLimit);

  if (validUntil <= nowSec) {
    return {
      valid: false,
      reason: `Expired at ${formatTimestamp(validUntil)}`,
    };
  }

  if (spent >= valueLimit) {
    return {
      valid: false,
      reason: `Capacity exhausted (${formatUsdc(spent)} / ${formatUsdc(valueLimit)})`,
    };
  }

  return { valid: true };
}
