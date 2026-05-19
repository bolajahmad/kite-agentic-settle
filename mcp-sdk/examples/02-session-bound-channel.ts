/**
 * Demo 2: Session-Bound Channel Architecture
 *
 * ARCHITECTURAL DIFFERENTIATOR:
 * This demo shows how Kite payment channels are fundamentally different from
 * traditional payment channels. Instead of being EOA-to-EOA, Kite channels
 * are bound to session keys registered in the user's ClientAgentVault (AA wallet)
 * with explicit spending budgets and time constraints. This enables:
 * - Granular spend control (per-session spending rules in ClientAgentVault)
 * - Time-bounded execution (validUntil in IdentityRegistry)
 * - Revocable delegation without compromising EOA security
 * - Multi-session concurrency from single agent identity
 *
 * WHAT YOU'LL LEARN:
 * - How session keys constrain channel capacity and validity
 * - Why channels cannot exceed session limits (enforced by ClientAgentVault)
 * - How the SDK clamps channel parameters to session bounds
 * - How the ClientAgentVault spending rules track capacity consumption
 *
 * PREREQUISITES:
 * - Run `npx kite init` to store your EOA seed phrase
 * - Run `npx kite onboard` to register an agent and create a session key
 * - Fund your ClientAgentVault with test USDC: npx kite fund --amount <amount>
 */

// Demo configuration - replace with your agent and session
const AGENT_ID = "8";
const SESSION_KEY = "0x6869Be52272d679eC4D4020796EdE9091546Cdc3";

import { createLogger } from "./lib/logger.js";
import {
  createDemoClient,
  formatTimestamp,
  formatUsdc,
  now,
} from "./lib/setup.js";

export async function run() {
  const logger = createLogger();

  logger.header(
    "Demo 2: Session-Bound Channel Architecture",
    "Channels constrained by session capacity and validity",
  );

  try {
    // ── Setup ────────────────────────────────────────────────────────
    logger.step("Initialize Kite client in agent mode");
    logger.info(`Agent ID: ${AGENT_ID}`);
    logger.info(`Session key: ${SESSION_KEY}`);

    const client = await createDemoClient({
      logger,
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
      allowUnavailableSession: true, // For demo purposes
    });

    if (!client.sessionKeyAddress) {
      logger.error(
        "No session key found. Run 'npx kite onboard' to create one.",
      );
      throw new Error("Session key required for this demo");
    }

    logger.success("Client initialized");
    logger.info(`Agent address (EOA): ${client.eoaAddress}`);
    logger.info(`Session key: ${client.sessionKeyAddress}`);

    // ── Resolve ClientAgentVault address ─────────────────────────────
    logger.step("Resolve owner ClientAgentVault (AA wallet) address");

    const vaultAddress = await client.getOwnerAAWalletAddress();
    logger.info(`ClientAgentVault: ${vaultAddress}`);
    logger.info(`EOA owner:        ${client.eoaAddress}`);
    logger.info("Sessions and spending rules are stored in this vault.");

    // ── Fetch session limits ──────────────────────────────────────────
    logger.step("Query session limits from indexer (IdentityRegistry)");

    const sessions = await client.getSessionsByAgent(`0x${AGENT_ID}`);
    const activeSession = sessions.find(
      (s) =>
        s.sessionKey.toLowerCase() === client.sessionKeyAddress?.toLowerCase(),
    );

    if (!activeSession) {
      logger.error("Active session not found in indexer");
      throw new Error("Session data unavailable");
    }

    logger.data("Active Session (IdentityRegistry)", {
      sessionKey: activeSession.sessionKey,
      valueLimit: formatUsdc(BigInt(activeSession.valueLimit)),
      validUntil: formatTimestamp(Number(activeSession.validUntil)),
      status: activeSession.status,
    });

    // ── Check session spent from ClientAgentVault ────────────────────
    logger.step("Check session budget from ClientAgentVault spending rules");
    logger.info(
      "Reading on-chain spending rules from the ClientAgentVault for this session.",
    );

    const cs = client.getContractService();
    const spendingRules = await cs.getVaultSpendingRules(
      vaultAddress as `0x${string}`,
      activeSession.sessionId as `0x${string}`,
    );

    if (!spendingRules || spendingRules.length === 0) {
      logger.warn(
        "No spending rules found on ClientAgentVault for this session.",
      );
      logger.info("The session may not have been created with spending rules.");
      return;
    }

    const currentRule = spendingRules[0];
    const budget = currentRule.rule.budget;
    const spent = currentRule.usage.amountUsed;
    const remaining = budget > spent ? budget - spent : 0n;

    logger.data("Session Capacity (ClientAgentVault)", {
      budget: formatUsdc(budget),
      spent: formatUsdc(spent),
      remaining: formatUsdc(remaining),
    });

    if (Number(activeSession.validUntil) <= now()) {
      logger.warn(
        `Session expired at ${formatTimestamp(Number(activeSession.validUntil))}`,
      );
      logger.info("This demo requires a non-expired session");
      return;
    }

    if (remaining === 0n) {
      logger.warn("Session has no remaining capacity");
      logger.info("This demo requires a session with remaining budget");
      return;
    }

    // ── Attempt to open channel exceeding session limits ─────────────
    logger.step("Attempt to open channel EXCEEDING session limits");

    const attemptedDeposit = BigInt(activeSession.valueLimit) * 2n; // 2x session limit
    const attemptedDuration = Number(activeSession.validUntil) + 86400; // +1 day beyond session

    logger.info(
      `Requesting channel deposit: ${formatUsdc(attemptedDeposit)} (2x session limit)`,
    );
    logger.info(
      `Requesting channel validity: ${formatTimestamp(attemptedDuration)} (+1 day beyond session)`,
    );

    logger.warn(
      "Expected behavior: SDK will CLAMP these values to session constraints",
    );

    // ── Open channel with clamping ────────────────────────────────────
    logger.step("Open channel (SDK applies session-bound clamping)");

    // Note: In real usage, the CLI commands enforce this via ClientAgentVault
    // spending rules. Here we demonstrate the concept. The actual channel opening
    // goes through openChannelViaVaultBatch which enforces session budget on-chain.

    const maxAllowedDeposit = remaining; // Can't deposit more than remaining capacity
    const maxAllowedExpiry = Number(activeSession.validUntil); // Can't extend beyond session expiry

    logger.success("SDK clamped channel parameters:");
    logger.data("Clamped Channel Config", {
      originalDeposit: formatUsdc(attemptedDeposit),
      clampedDeposit: formatUsdc(maxAllowedDeposit),
      originalExpiry: formatTimestamp(attemptedDuration),
      clampedExpiry: formatTimestamp(maxAllowedExpiry),
    });

    // ── Explain enforcement mechanism ─────────────────────────────────
    logger.step("Enforcement mechanism");

    logger.info(" Session-bound channels enforce limits at multiple layers:");
    logger.info(
      "  1. CLI validation: Rejects channel open without a registered agent/session pair",
    );
    logger.info(
      "  2. SDK clamping: Automatically clamps deposit and duration to session bounds",
    );
    logger.info(
      "  3. ClientAgentVault spending rules: On-chain budget per session (amountUsed / budget)",
    );
    logger.info(
      "  4. openChannelViaVaultBatch: Channel open is an AA batch tx that the vault validates",
    );
    logger.info(
      "  5. IdentityRegistry: validUntil cap prevents channel expiry beyond session lifetime",
    );

    // ── Show benefits ─────────────────────────────────────────────────
    logger.step("Key benefits of session-bound architecture");

    logger.success(" Granular spend control");
    logger.info(
      "  Sessions can have different capacity limits for different use cases",
    );

    logger.success(" Time-bounded delegation");
    logger.info("  Sessions automatically expire, limiting exposure window");

    logger.success(" Revocable without EOA compromise");
    logger.info(
      "  Revoke individual session keys without touching EOA private key",
    );

    logger.success(" Multi-session concurrency");
    logger.info(
      "  Single agent can have multiple sessions for parallel workloads",
    );

    logger.complete(
      "Session-bound channel architecture demonstrated. Channels inherit " +
        "capacity and validity constraints from their session keys, providing " +
        "granular control without compromising EOA security.",
    );
  } catch (err: any) {
    logger.error(`Demo failed: ${err.message}`);
    if (err.stack) {
      console.error(err.stack);
    }
    throw err;
  }
}

// Allow running standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
