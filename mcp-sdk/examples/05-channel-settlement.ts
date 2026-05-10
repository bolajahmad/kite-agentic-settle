/**
 * Demo 5: Channel Settlement and Finalization
 *
 * CLOSURE SEMANTICS:
 * This demo shows the complete channel lifecycle from open -> calls -> settlement ->
 * finalization. It demonstrates both cooperative settlement (normal case) and
 * force-close (dispute resolution), explaining when each is appropriate.
 *
 * WHAT YOU'LL LEARN:
 * - How cooperative settlement works (consumer and provider agree)
 * - How force-close works (consumer closes unilaterally)
 * - When to use each closure method
 * - How settlement affects local state and on-chain records
 *
 * PREREQUISITES:
 * - Run `npx kite init` to store your EOA seed phrase
 * - Run `npx kite onboard` to register an agent and create a session key
 * - Fund your KiteAAWallet with test USDC
 */

import { createLogger } from "./lib/logger.js";
import {
  formatTimestamp,
  formatUsdc,
  now,
  parseUsdc,
} from "./lib/setup.js";

export async function run() {
  const logger = createLogger();

  logger.header(
    "Demo 5: Channel Settlement and Finalization",
    "Cooperative closure vs force-close scenarios",
  );

  try {
    // -- Setup ---------------------------------------------------------
    logger.step("Initialize settlement walkthrough context");
    logger.success("Using narrative simulation mode");
    logger.info("No on-chain transaction is required in this demo.");

    // -- Scenario 1: Cooperative Settlement ---------------------------
    logger.step("Scenario 1: Cooperative Settlement (Normal Case)");

    logger.info("Setup:");
    logger.info("  - Channel opened with $10 deposit");
    logger.info("  - 5 API calls made, totaling $2.50");
    logger.info("  - Both parties agree on final balance");
    logger.info("  - Provider signs settlement proof");

    const cooperativeChannel = {
      channelId: "0x1234...cooperative",
      deposit: parseUsdc("10.00"),
      spent: parseUsdc("2.50"),
      unsettledCalls: 5,
    };

    logger.data("Channel State Before Settlement", {
      deposit: formatUsdc(cooperativeChannel.deposit),
      spent: formatUsdc(cooperativeChannel.spent),
      unsettledCalls: cooperativeChannel.unsettledCalls,
      refundDue: formatUsdc(
        cooperativeChannel.deposit - cooperativeChannel.spent,
      ),
    });

    logger.info("\nCooperative settlement steps:");
    logger.info("  1. Consumer requests settlement from provider");
    logger.info("  2. Provider aggregates unsettled receipts");
    logger.info("  3. Provider generates merkle proof of calls");
    logger.info("  4. Provider signs settlement with final balance");
    logger.info("  5. Consumer submits settlement tx to PaymentChannel");
    logger.info("  6. Contract validates signatures and merkle proof");
    logger.info("  7. Contract transfers spent amount to provider");
    logger.info("  8. Contract refunds remaining deposit to consumer");
    logger.info("  9. Channel marked as FINALIZED on-chain");
    logger.info("  10. Local state cleared from ~/.kite-agent-pay/channels/");

    logger.success("Cooperative settlement completed");
    logger.data("Settlement Result", {
      paidToProvider: formatUsdc(cooperativeChannel.spent),
      refundedToConsumer: formatUsdc(
        cooperativeChannel.deposit - cooperativeChannel.spent,
      ),
      gasUsed: "~80,000 gas",
      status: "FINALIZED",
    });

    logger.info("\nBenefits of cooperative settlement:");
    logger.success("  Fast and efficient (single tx)");
    logger.success("  Both parties cryptographically agree");
    logger.success("  Immediate fund release");
    logger.success("  Clean state cleanup");

    // -- Scenario 2: Force-Close -------------------------------------
    logger.separator();
    logger.step("Scenario 2: Force-Close (Dispute Resolution)");

    logger.info("Setup:");
    logger.info("  - Channel opened with $10 deposit");
    logger.info("  - 3 API calls made, totaling $1.50");
    logger.info("  - Provider is unresponsive (offline, dispute, etc.)");
    logger.info("  - Consumer needs to recover remaining funds");

    const forceCloseChannel = {
      channelId: "0x5678...forceclose",
      deposit: parseUsdc("10.00"),
      spent: parseUsdc("1.50"),
      unsettledCalls: 3,
      disputeTimeout: 86400,
    };

    logger.data("Channel State Before Force-Close", {
      deposit: formatUsdc(forceCloseChannel.deposit),
      spent: formatUsdc(forceCloseChannel.spent),
      unsettledCalls: forceCloseChannel.unsettledCalls,
      providerStatus: "OFFLINE",
    });

    logger.info("\nForce-close steps:");
    logger.info("  1. Consumer calls initiateClose() on PaymentChannel");
    logger.info(
      `  2. Contract starts dispute timer (${forceCloseChannel.disputeTimeout}s)`,
    );
    logger.info("  3. Provider has chance to challenge with proof");
    logger.info("  4. If provider does not challenge, consumer can finalize");
    logger.info("  5. Consumer calls finalizeClose() after timeout");
    logger.info("  6. Contract refunds remaining deposit to consumer");
    logger.info("  7. Provider loses access to unsettled receipts");

    const closeInitiatedAt = now();
    const canFinalizeAt = closeInitiatedAt + forceCloseChannel.disputeTimeout;

    logger.warn("Dispute window active");
    logger.data("Force-Close Timeline", {
      closeInitiatedAt: formatTimestamp(closeInitiatedAt),
      canFinalizeAt: formatTimestamp(canFinalizeAt),
      waitTime: `${forceCloseChannel.disputeTimeout / 3600} hours`,
    });

    logger.info("\n(Demo skips actual wait time)");
    logger.success("Force-close finalized (simulated)");

    logger.data("Force-Close Result", {
      refundedToConsumer: formatUsdc(
        forceCloseChannel.deposit - forceCloseChannel.spent,
      ),
      providerLost: formatUsdc(forceCloseChannel.spent),
      gasUsed: "~120,000 gas (2 txs: initiate + finalize)",
      status: "CLOSED",
    });

    logger.warn("\nDownsides of force-close:");
    logger.info("  Requires waiting for dispute timeout");
    logger.info("  Higher gas cost (2 transactions)");
    logger.info("  Funds locked during dispute window");
    logger.info("  Provider may lose unsettled funds (if offline)");

    // -- When to use each method -------------------------------------
    logger.separator();
    logger.step("Decision guide: Which settlement method?");

    logger.info("Use COOPERATIVE SETTLEMENT when:");
    logger.success("  Provider is responsive and online");
    logger.success("  Both parties agree on call history");
    logger.success("  Normal channel closure (no dispute)");
    logger.success("  Fast and efficient settlement is preferred");

    logger.info("\nUse FORCE-CLOSE when:");
    logger.warn("  Provider is offline or unresponsive");
    logger.warn("  Dispute over unsettled receipts");
    logger.warn("  Provider refuses to cooperate");
    logger.warn("  Consumer needs to recover funds urgently");

    // -- Best practices -----------------------------------------------
    logger.separator();
    logger.step("Best practices for channel closure");

    logger.info("Regular settlement:");
    logger.info(
      "  - Settle channels periodically (do not wait until maxValue is reached)",
    );
    logger.info("  - Reduces risk exposure for both parties");
    logger.info("  - Keeps local state small and manageable");

    logger.info("\nMonitor channel health:");
    logger.info("  - Track unsettled call count and value");
    logger.info("  - Alert if provider becomes unresponsive during active channel");
    logger.info("  - Use indexer to verify on-chain channel status");

    logger.info("\nDispute prevention:");
    logger.info("  - Keep local receipts until settlement confirmed on-chain");
    logger.info("  - Log all channel operations for audit");
    logger.info("  - Verify provider signatures on settlement proofs");

    logger.info("\nState cleanup:");
    logger.info("  - Delete local channel state only after on-chain finalization");
    logger.info(
      "  - Archive settled channel records for accounting/compliance",
    );
    logger.info("  - Verify refund received before considering channel closed");

    logger.complete(
      "Channel settlement lifecycle demonstrated. Cooperative settlement is preferred for normal operations, while force-close remains a last-resort dispute path.",
    );
  } catch (err: any) {
    logger.error(`Demo failed: ${err.message}`);
    if (err.stack) {
      console.error(err.stack);
    }
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await run();
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}
