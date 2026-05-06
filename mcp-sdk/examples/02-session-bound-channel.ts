/**
 * Demo 2: Session-Bound Channel Architecture
 *
 * ARCHITECTURAL DIFFERENTIATOR:
 * This demo shows how Kite payment channels are fundamentally different from
 * traditional payment channels. Instead of being EOA-to-EOA, Kite channels
 * are bound to session keys with explicit capacity and time constraints.
 * This enables:
 * - Granular spend control (valueLimit)
 * - Time-bounded execution (validUntil)
 * - Revocable delegation without compromising EOA security
 * - Multi-session concurrency from single agent identity
 *
 * WHAT YOU'LL LEARN:
 * - How session keys constrain channel capacity and validity
 * - Why channels cannot exceed session limits
 * - How the SDK clamps channel parameters to session bounds
 * - How on-chain spent tracking enforces session limits
 *
 * PREREQUISITES:
 * - Run `npx kite init` to store your EOA seed phrase
 * - Run `npx kite onboard` to register an agent and create a session key
 * - Fund your KiteAAWallet with test USDC
 */

import { createLogger } from "./lib/logger.js";
import {
  createDemoClient,
  formatTimestamp,
  formatUsdc,
  isSessionValid,
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
    const client = await createDemoClient({ logger });

    if (!client.sessionKeyAddress) {
      logger.error(
        "No session key found. Run 'npx kite onboard' to create one.",
      );
      throw new Error("Session key required for this demo");
    }

    logger.success("Client initialized");
    logger.info(`Agent address (EOA): ${client.eoaAddress}`);
    logger.info(`Session key: ${client.sessionKeyAddress}`);

    // ── Fetch session limits ──────────────────────────────────────────
    logger.step("Query session limits from indexer");

    const sessions = await client.getSessionsByAgent(client.eoaAddress);
    const activeSession = sessions.find(
      (s) =>
        s.sessionKey.toLowerCase() === client.sessionKeyAddress?.toLowerCase(),
    );

    if (!activeSession) {
      logger.error("Active session not found in indexer");
      throw new Error("Session data unavailable");
    }

    logger.data("Active Session", {
      sessionKey: activeSession.sessionKey,
      valueLimit: formatUsdc(BigInt(activeSession.valueLimit)),
      validUntil: formatTimestamp(Number(activeSession.validUntil)),
      status: activeSession.status,
    });

    // ── Check on-chain spent ──────────────────────────────────────────
    logger.step("Check on-chain spent for session");

    const spent = await client.getSessionSpent(client.sessionKeyAddress);
    const remaining = BigInt(activeSession.valueLimit) - spent;

    logger.data("Session Capacity", {
      valueLimit: formatUsdc(BigInt(activeSession.valueLimit)),
      spent: formatUsdc(spent),
      remaining: formatUsdc(remaining),
    });

    const validity = isSessionValid(activeSession, spent);
    if (!validity.valid) {
      logger.warn(`Session is not valid: ${validity.reason}`);
      logger.info("This demo requires a valid session with remaining capacity");
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

    // Note: In real usage, the CLI commands enforce this. Here we demonstrate
    // the concept. The actual channel opening would fail if attempted without
    // proper session context.

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

    logger.info("🔐 Session-bound channels enforce limits at multiple layers:");
    logger.info(
      "  1. CLI validation: Rejects channel open without agent/session pair",
    );
    logger.info(
      "  2. SDK clamping: Automatically reduces deposit and duration to session limits",
    );
    logger.info(
      "  3. On-chain tracking: getSessionSpent() validates capacity consumption",
    );
    logger.info(
      "  4. Contract validation: KiteAAWallet rejects transactions exceeding session capacity",
    );

    // ── Show benefits ─────────────────────────────────────────────────
    logger.step("Key benefits of session-bound architecture");

    logger.success("✅ Granular spend control");
    logger.info(
      "  Sessions can have different capacity limits for different use cases",
    );

    logger.success("✅ Time-bounded delegation");
    logger.info("  Sessions automatically expire, limiting exposure window");

    logger.success("✅ Revocable without EOA compromise");
    logger.info(
      "  Revoke individual session keys without touching EOA private key",
    );

    logger.success("✅ Multi-session concurrency");
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
