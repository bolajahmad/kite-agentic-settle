/**
 * Demo 4: Stream Channel Flow
 *
 * TIME-GOVERNED EXECUTION:
 * This demo shows how stream channels enable scheduled, time-bounded API
 * execution. Unlike batch channels (count/value limited), stream channels
 * are primarily time-limited — perfect for recurring tasks, monitoring,
 * and scheduled data collection within a time window.
 *
 * WHAT YOU'LL LEARN:
 * - How to open a stream channel with time bounds
 * - How stream calls execute within a scheduled window
 * - How time expiry automatically closes the channel
 * - How stream channels differ from batch channels
 *
 * PREREQUISITES:
 * - Run `npx kite init` to store your EOA seed phrase
 * - Run `npx kite onboard` to register an agent and create a session key
 * - Fund your KiteAAWallet with test USDC
 */

import { createLogger } from "./lib/logger.js";
import { createMockProvider } from "./lib/mock-provider.js";
import {
  createDemoClient,
  formatUsdc,
  formatTimestamp,
  now,
  parseUsdc,
  wait,
} from "./lib/setup.js";

export async function run() {
  const logger = createLogger();

  logger.header(
    "Demo 4: Stream Channel Flow",
    "Time-bounded scheduled API execution"
  );

  try {
    // ── Setup ────────────────────────────────────────────────────────
    logger.step("Initialize Kite client");
    const client = await createDemoClient({ logger });

    if (!client.sessionKeyAddress) {
      logger.error(
        "No session key found. Run 'npx kite onboard' to create one."
      );
      throw new Error("Session key required for stream channels");
    }

    logger.success("Client initialized");
    logger.info(`Session key: ${client.sessionKeyAddress}`);

    // ── Start mock provider ───────────────────────────────────────────
    logger.step("Start mock provider");
    const pricePerCall = parseUsdc("0.02"); // $0.02 per call
    const provider = await createMockProvider({
      port: 3404,
      agentAddress: client.eoaAddress,
      pricePerCall,
    });
    logger.success("Provider started");
    logger.info(`Price per call: ${formatUsdc(pricePerCall)}`);

    // ── Open stream channel ───────────────────────────────────────────
    logger.step("Open stream channel with time window");

    const streamConfig = {
      startTime: now(),
      endTime: now() + 60, // 60-second window
      maxValue: parseUsdc("1.00"), // Max $1.00 within window
      intervalSeconds: 10, // Call every 10 seconds
    };

    logger.data("Stream Configuration", {
      startTime: formatTimestamp(streamConfig.startTime),
      endTime: formatTimestamp(streamConfig.endTime),
      duration: `${streamConfig.endTime - streamConfig.startTime} seconds`,
      maxValue: formatUsdc(streamConfig.maxValue),
      callInterval: `${streamConfig.intervalSeconds} seconds`,
      estimatedCalls: Math.floor(
        (streamConfig.endTime - streamConfig.startTime) /
          streamConfig.intervalSeconds
      ),
    });

    const streamState = {
      callCount: 0,
      totalValue: 0n,
      calls: [] as Array<{ timestamp: number; cost: bigint }>,
    };

    logger.success("Stream channel opened (simulated)");

    // ── Execute stream calls ──────────────────────────────────────────
    logger.step("Execute scheduled stream calls");

    logger.info(
      "Stream will execute calls at regular intervals within time window..."
    );
    logger.info(
      "(Demo accelerated: running 3 calls with 2s intervals instead of 10s)\n"
    );

    for (let i = 1; i <= 3; i++) {
      const currentTime = now();
      const timeRemaining = streamConfig.endTime - currentTime;

      if (timeRemaining <= 0) {
        logger.warn("Stream window expired, stopping execution");
        break;
      }

      logger.info(`  ⏰ Scheduled call ${i} at ${formatTimestamp(currentTime)}`);
      logger.info(`  Time remaining in window: ${timeRemaining}s`);

      const response = await client.fetchWithPayment(provider.getUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `Stream query ${i}`,
          timestamp: currentTime,
        }),
        mode: "perCall",
      });

      const result = await response.json();

      streamState.callCount++;
      streamState.totalValue += pricePerCall;
      streamState.calls.push({
        timestamp: currentTime,
        cost: pricePerCall,
      });

      logger.success(`  Call ${i} completed`);
      logger.info(`  Cost: ${formatUsdc(pricePerCall)}`);
      logger.info(
        `  Running total: ${formatUsdc(streamState.totalValue)}\n`
      );

      // Wait for next interval (accelerated for demo)
      if (i < 3) {
        await wait(2000); // 2 seconds instead of 10
      }
    }

    // ── Show stream state ─────────────────────────────────────────────
    logger.step("Inspect stream channel state");

    const avgInterval =
      streamState.calls.length > 1
        ? (streamState.calls[streamState.calls.length - 1].timestamp -
            streamState.calls[0].timestamp) /
          (streamState.calls.length - 1)
        : 0;

    logger.data("Stream Summary", {
      totalCalls: streamState.callCount,
      totalValue: formatUsdc(streamState.totalValue),
      avgInterval: `${avgInterval.toFixed(1)}s`,
      costPerCall: formatUsdc(pricePerCall),
      timeWindowUsed: `${streamState.calls[streamState.calls.length - 1].timestamp - streamState.calls[0].timestamp}s`,
    });

    // ── Time expiry handling ──────────────────────────────────────────
    logger.step("Handle time expiry");

    logger.info("🕐 Stream channel behavior on time expiry:");
    logger.info("  - Automatically prevents new calls after endTime");
    logger.info("  - Unsettled calls remain in local state");
    logger.info("  - Settlement can occur after expiry (grace period)");
    logger.info("  - Force-close available if settlement fails");

    // ── Compare stream vs batch ───────────────────────────────────────
    logger.step("Stream vs Batch channels");

    logger.info("Stream channels:");
    logger.success("  ✅ Time-bounded execution (perfect for scheduled tasks)");
    logger.success("  ✅ Automatic interval pacing");
    logger.success("  ✅ Predictable expiry behavior");
    logger.info("  ⚠️  Requires time synchronization");

    logger.info("\nBatch channels:");
    logger.success("  ✅ Count/value-bounded execution");
    logger.success("  ✅ Flexible call timing");
    logger.success("  ✅ Resume after interruption");
    logger.info("  ⚠️  Manual settlement trigger required");

    // ── Use cases ─────────────────────────────────────────────────────
    logger.step("Ideal use cases for stream channels");

    logger.info("📊 Monitoring & Observability:");
    logger.info("  - Poll metrics every N seconds");
    logger.info("  - Collect logs within maintenance window");
    logger.info("  - Health checks on schedule");

    logger.info("\n🔄 Recurring Data Collection:");
    logger.info("  - Fetch market prices every interval");
    logger.info("  - Sync state periodically");
    logger.info("  - Schedule report generation");

    logger.info("\n⏲️  Time-bounded Workflows:");
    logger.info("  - Execute tasks during business hours");
    logger.info("  - Rate-limited API consumption");
    logger.info("  - Deadline-constrained processing");

    // ── Cleanup ───────────────────────────────────────────────────────
    logger.step("Cleanup resources");
    await provider.stop();
    logger.success("Provider stopped");

    logger.complete(
      "Stream channel flow demonstrated. Time-bounded execution with scheduled " +
        "intervals enables predictable, automated API workflows with automatic " +
        "expiry handling."
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
