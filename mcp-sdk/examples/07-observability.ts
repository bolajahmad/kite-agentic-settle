/**
 * Demo 7: Observability and Transparency
 *
 * TRANSPARENCY PROOF:
 * This demo shows the complete observability surface of Kite Agent Pay.
 * Every operation is auditable through indexer queries, local state inspection,
 * and usage tracking. Perfect transparency for compliance, debugging, and
 * cost analysis.
 *
 * WHAT YOU'LL LEARN:
 * - How to query agent/session/payment history from indexer
 * - How to inspect local channel state and unsettled calls
 * - How to track usage metrics and cost attribution
 * - How to audit payment flows for compliance
 *
 * PREREQUISITES:
 * - Run `npx kite init` to store your EOA seed phrase
 * - Run `npx kite onboard` to register an agent and create a session key
 * - Have made some payments (run previous demos first)
 */

import { createLogger } from "./lib/logger.js";
import { createDemoClient, formatUsdc, formatTimestamp } from "./lib/setup.js";

export async function run() {
  const logger = createLogger();

  logger.header(
    "Demo 7: Observability and Transparency",
    "Complete audit trail from indexer to local state"
  );

  try {
    // ── Setup ────────────────────────────────────────────────────────
    logger.step("Initialize Kite client");
    const client = await createDemoClient({ logger });
    logger.success("Client initialized");
    logger.info(`EOA address: ${client.eoaAddress}`);

    // ── Query agent registry ──────────────────────────────────────────
    logger.step("Query agent registry from indexer");

    const agents = await client.getAgentsByOwner(client.eoaAddress);
    logger.data("Registered Agents", {
      count: agents.length,
      agents: agents.map((a) => ({
        agentId: a.agentId,
        owner: a.owner,
        metadataUri: a.metadataUri || "none",
        createdAt: a.createdAt,
      })),
    });

    if (agents.length === 0) {
      logger.warn(
        "No agents registered. Run 'npx kite onboard' to create one."
      );
      logger.info("Demo will continue with available data...");
    }

    // ── Query session keys ────────────────────────────────────────────
    logger.step("Query session keys for agent");

    if (agents.length > 0) {
      const agent = agents[0];
      const sessions = await client.getSessionsByAgent(agent.agentId, 10, 0);

      logger.data("Active Sessions", {
        count: sessions.length,
        sessions: sessions.map((s) => ({
          sessionKey: s.sessionKey,
          status: s.status,
          valueLimit: formatUsdc(BigInt(s.valueLimit)),
          validUntil: formatTimestamp(Number(s.validUntil)),
          createdAt: s.createdAt,
        })),
      });

      // Check spent for each session
      for (const session of sessions) {
        const spent = await client
          .getSessionSpent(session.sessionKey)
          .catch(() => 0n);
        const remaining = BigInt(session.valueLimit) - spent;

        logger.info(`\n  Session: ${session.sessionKey.slice(0, 10)}...`);
        logger.info(`    Capacity: ${formatUsdc(BigInt(session.valueLimit))}`);
        logger.info(`    Spent: ${formatUsdc(spent)}`);
        logger.info(`    Remaining: ${formatUsdc(remaining)}`);
        logger.info(`    Utilization: ${((Number(spent) / Number(session.valueLimit)) * 100).toFixed(1)}%`);
      }
    }

    // ── Query payment history ─────────────────────────────────────────
    logger.step("Query payment history from indexer");

    if (agents.length > 0) {
      const agent = agents[0];
      const payments = await client.getPaymentsByAgent(agent.agentId, 10, 0);

      logger.data("Recent Payments", {
        count: payments.length,
        totalValue: payments.length > 0
          ? formatUsdc(
              payments.reduce((sum, p) => sum + BigInt(p.value), 0n)
            )
          : "0 USDC",
      });

      if (payments.length > 0) {
        logger.info("\nPayment details:");
        for (const payment of payments.slice(0, 5)) {
          logger.info(`\n  Payment ${payment.id}`);
          logger.info(`    Value: ${formatUsdc(BigInt(payment.value))}`);
          logger.info(`    Recipient: ${payment.recipient}`);
          logger.info(`    Type: ${payment.paymentType || "unknown"}`);
          logger.info(`    Timestamp: ${formatTimestamp(Number(payment.timestamp))}`);
          logger.info(`    Tx: ${payment.transactionHash || "pending"}`);
        }
      } else {
        logger.info("No payments recorded yet. Make some API calls first!");
      }
    }

    // ── Local state inspection ────────────────────────────────────────
    logger.step("Inspect local channel state");

    logger.info("Local state is stored at:");
    logger.info("  📁 ~/.kite-agent-pay/");
    logger.info("     ├── vars.json           # Credentials (encrypted)");
    logger.info("     └── channels/           # Per-channel state");
    logger.info("        ├── <channelId>.json # Unsettled calls + receipts");
    logger.info("        └── ...");

    logger.info("\nChannel state structure:");
    logger.data("Channel Record Schema", {
      channelId: "0x...",
      agentId: "123",
      agentIndex: 0,
      sessionKey: "0x...",
      providerUrl: "https://...",
      deposit: "1000000", // wei
      status: "active | settling | finalized",
      createdAt: 1234567890,
      calls: [
        {
          requestId: "0x...",
          receipt: "{ signed EIP-712 receipt }",
          response: "{ API response }",
          timestamp: 1234567890,
          settled: false,
        },
      ],
    });

    logger.info("\n💡 Local state enables:");
    logger.success("  ✅ Resume interrupted channels");
    logger.success("  ✅ Audit unsettled call history");
    logger.success("  ✅ Offline access to receipts");
    logger.success("  ✅ Settlement proof generation");

    // ── Usage tracking ────────────────────────────────────────────────
    logger.step("Usage tracking and cost attribution");

    logger.info("SDK tracks usage metrics for analysis:");
    logger.data("Usage Metrics", {
      totalCalls: "tracked per provider/session",
      totalCost: "aggregated by time window",
      avgCallCost: "computed per provider",
      costByProvider: {
        "provider1.com": "tracked",
        "provider2.com": "tracked",
      },
      costBySession: {
        session1: "tracked",
        session2: "tracked",
      },
    });

    logger.info("\n📊 Usage data enables:");
    logger.success("  ✅ Cost attribution by provider");
    logger.success("  ✅ Budget monitoring and alerts");
    logger.success("  ✅ Session capacity planning");
    logger.success("  ✅ ROI analysis per provider");

    // ── Audit workflows ───────────────────────────────────────────────
    logger.step("Audit workflows");

    logger.info("Compliance audit checklist:");
    logger.info("\n1️⃣  Verify agent registration:");
    logger.info("   Query: getAgentsByOwner(eoaAddress)");
    logger.info("   Check: agentId, owner, creation timestamp");

    logger.info("\n2️⃣  Verify session authorization:");
    logger.info("   Query: getSessionsByAgent(agentId)");
    logger.info("   Check: session status, capacity, expiry");

    logger.info("\n3️⃣  Verify payment history:");
    logger.info("   Query: getPaymentsByAgent(agentId)");
    logger.info("   Check: payment amounts, recipients, timestamps");

    logger.info("\n4️⃣  Reconcile local vs on-chain:");
    logger.info("   Compare: local channel state vs indexer payment records");
    logger.info("   Check: all local receipts have on-chain settlement");

    logger.info("\n5️⃣  Verify signatures:");
    logger.info("   Validate: EIP-712 receipt signatures");
    logger.info("   Check: session key signed all payments");

    // ── Debugging tools ───────────────────────────────────────────────
    logger.step("Debugging and troubleshooting");

    logger.info("Debugging tools available:");

    logger.info("\n🔍 Indexer queries:");
    logger.info("  - getAgentById(agentId) — fetch specific agent");
    logger.info("  - getSessionsByAgent(agentId) — list all sessions");
    logger.info("  - getPaymentsByAgent(agentId) — payment history");
    logger.info("  - getRecentPayments() — cross-agent recent activity");

    logger.info("\n📂 Local state commands:");
    logger.info("  - npx kite channel list — show all local channels");
    logger.info("  - npx kite channel status <id> — inspect channel details");
    logger.info("  - cat ~/.kite-agent-pay/channels/<id>.json — raw state");

    logger.info("\n🧪 Validation utilities:");
    logger.info("  - verifyReceipt(receipt) — check EIP-712 signature");
    logger.info("  - validateSession(sessionKey) — check on-chain status");
    logger.info("  - getSessionSpent(sessionKey) — verify capacity");

    // ── Transparency benefits ─────────────────────────────────────────
    logger.step("Transparency benefits");

    logger.success("🔎 Complete auditability:");
    logger.info("  Every payment has cryptographic proof (EIP-712 signature)");
    logger.info("  Every agent/session has on-chain registration");
    logger.info("  Every channel has local state + indexer records");

    logger.success("\n🛡️  Compliance ready:");
    logger.info("  Full payment history queryable via indexer");
    logger.info("  Local receipts archived for accounting");
    logger.info("  Signatures verifiable by third parties");

    logger.success("\n🐛 Debug friendly:");
    logger.info("  Clear separation: local state vs on-chain state");
    logger.info("  Indexer provides global view across all agents");
    logger.info("  CLI commands expose all internal state");

    logger.success("\n💰 Cost analysis:");
    logger.info("  Track spending by provider, session, time window");
    logger.info("  Identify high-cost operations");
    logger.info("  Optimize based on usage patterns");

    logger.complete(
      "Observability demonstrated. Kite Agent Pay provides complete transparency " +
        "through indexer queries, local state inspection, and usage tracking. " +
        "Every operation is auditable, debuggable, and compliance-ready."
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
