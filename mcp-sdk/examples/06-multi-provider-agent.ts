/**
 * Demo 6: Multi-Provider Agent Workflow
 *
 * SCALABILITY PROOF:
 * This demo shows how a single agent identity (NFT) can interact with multiple
 * providers simultaneously using the same session key. This demonstrates the
 * scalability of Kite's agent-based architecture compared to per-provider
 * credential management.
 *
 * WHAT YOU'LL LEARN:
 * - How one agent identity works across multiple providers
 * - How session keys enable multi-provider concurrency
 * - How to track costs per provider while using single identity
 * - How agent-based auth simplifies credential management
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
  parseUsdc,
  wait,
} from "./lib/setup.js";

export async function run() {
  const logger = createLogger();

  logger.header(
    "Demo 6: Multi-Provider Agent Workflow",
    "One agent identity across many providers"
  );

  try {
    // ── Setup ────────────────────────────────────────────────────────
    logger.step("Initialize Kite client");
    const client = await createDemoClient({ logger });

    if (!client.sessionKeyAddress) {
      logger.error(
        "No session key found. Run 'npx kite onboard' to create one."
      );
      throw new Error("Session key required for multi-provider demo");
    }

    logger.success("Client initialized");
    logger.info(`Agent (EOA): ${client.eoaAddress}`);
    logger.info(`Session key: ${client.sessionKeyAddress}`);
    logger.info(
      "This SINGLE identity will authenticate to multiple providers"
    );

    // ── Start multiple mock providers ─────────────────────────────────
    logger.step("Start multiple API providers");

    const providers = [
      {
        name: "WeatherAPI",
        price: parseUsdc("0.01"),
        port: 3410,
        service: "Weather forecasting",
      },
      {
        name: "MarketDataAPI",
        price: parseUsdc("0.05"),
        port: 3411,
        service: "Real-time market prices",
      },
      {
        name: "TranslationAPI",
        price: parseUsdc("0.02"),
        port: 3412,
        service: "Language translation",
      },
      {
        name: "AnalyticsAPI",
        price: parseUsdc("0.10"),
        port: 3413,
        service: "Data analytics",
      },
    ];

    const mockProviders = await Promise.all(
      providers.map((p) =>
        createMockProvider({
          port: p.port,
          agentAddress: client.eoaAddress,
          pricePerCall: p.price,
        })
      )
    );

    logger.success(`Started ${providers.length} providers`);
    for (const p of providers) {
      logger.info(`  - ${p.name}: ${formatUsdc(p.price)}/call (${p.service})`);
    }

    // ── Make calls to different providers ─────────────────────────────
    logger.step("Make API calls across multiple providers");
    logger.info("Using SAME agent identity and session key for all providers\n");

    const providerCosts = new Map<string, bigint>();

    for (const provider of providers) {
      logger.info(`  📞 Calling ${provider.name}...`);

      const startTime = Date.now();
      const response = await client.fetchWithPayment(
        `http://localhost:${provider.port}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `Request to ${provider.name}`,
          }),
          mode: "perCall",
        }
      );

      const result = await response.json();
      const elapsed = Date.now() - startTime;

      providerCosts.set(
        provider.name,
        (providerCosts.get(provider.name) || 0n) + provider.price
      );

      logger.success(`  ${provider.name} responded in ${elapsed}ms`);
      logger.info(`  Cost: ${formatUsdc(provider.price)}`);
      logger.info(`  Session: ${client.sessionKeyAddress?.slice(0, 10)}...`);

      await wait(300); // Brief pause between calls
    }

    // ── Cost attribution per provider ─────────────────────────────────
    logger.step("Cost attribution by provider");

    const totalCost = Array.from(providerCosts.values()).reduce(
      (sum, cost) => sum + cost,
      0n
    );

    logger.data("Cost Breakdown", {
      providers: Array.from(providerCosts.entries()).map(([name, cost]) => ({
        provider: name,
        cost: formatUsdc(cost),
        percentage: `${((Number(cost) / Number(totalCost)) * 100).toFixed(1)}%`,
      })),
      total: formatUsdc(totalCost),
    });

    logger.info("\n💡 Key insight:");
    logger.info(
      "  Single agent identity + session key worked across ALL providers"
    );
    logger.info("  No per-provider API keys or credentials needed");
    logger.info("  All payments traceable to same agent in indexer");

    // ── Compare to traditional approach ───────────────────────────────
    logger.step("Compare: Agent-based vs Traditional Auth");

    logger.info("❌ Traditional approach (per-provider credentials):");
    logger.info(`  - Need ${providers.length} separate API keys`);
    logger.info("  - Manage expiry/rotation for each key");
    logger.info("  - Separate billing/tracking per provider");
    logger.info("  - Risk: key leakage affects that provider only");
    logger.info("  - Complexity: O(n) credentials for n providers");

    logger.info("\n✅ Kite agent-based approach:");
    logger.info("  - ONE agent identity (NFT) for all providers");
    logger.info("  - ONE session key with unified capacity/expiry");
    logger.info("  - Unified billing tracked by single agent ID");
    logger.info("  - Risk: revoke session key affects all (by design)");
    logger.info("  - Complexity: O(1) credentials for n providers");

    // ── Multi-session scalability ─────────────────────────────────────
    logger.step("Multi-session scalability");

    logger.info("Advanced pattern: Multiple sessions per agent");
    logger.info("\n🔑 Session 1 (High-cost providers):");
    logger.info("  - valueLimit: $100");
    logger.info("  - validUntil: 7 days");
    logger.info("  - Used for: AnalyticsAPI, MarketDataAPI");

    logger.info("\n🔑 Session 2 (Low-cost providers):");
    logger.info("  - valueLimit: $10");
    logger.info("  - validUntil: 1 day");
    logger.info("  - Used for: WeatherAPI, TranslationAPI");

    logger.info("\n💡 Benefits:");
    logger.success("  ✅ Granular risk management per session");
    logger.success("  ✅ Different expiry policies per use case");
    logger.success("  ✅ Parallel workloads without capacity contention");
    logger.success("  ✅ Revoke individual sessions without EOA compromise");

    // ── Real-world use cases ──────────────────────────────────────────
    logger.step("Real-world use cases");

    logger.info("🤖 AI Agent Orchestration:");
    logger.info(
      "  - Single agent calls: LLM API, vector DB, web search, data APIs"
    );
    logger.info("  - All costs tracked under one agent identity");
    logger.info("  - Session capacity = agent's spending budget");

    logger.info("\n🔄 Cross-Provider Workflows:");
    logger.info("  - Fetch data from Provider A");
    logger.info("  - Process via Provider B");
    logger.info("  - Store results at Provider C");
    logger.info("  - All authenticated with same agent identity");

    logger.info("\n📊 Multi-Tenant SaaS:");
    logger.info("  - Each customer gets an agent identity");
    logger.info("  - Agent calls multiple backend services");
    logger.info("  - Per-customer cost attribution via agent ID");
    logger.info("  - Centralized session management per tenant");

    logger.info("\n🌐 Decentralized API Marketplace:");
    logger.info("  - Discover providers via registry");
    logger.info("  - Pay any provider with same agent identity");
    logger.info("  - No pre-registration or API key exchange");
    logger.info("  - Reputation tracked per agent across providers");

    // ── Cleanup ───────────────────────────────────────────────────────
    logger.step("Cleanup resources");
    await Promise.all(mockProviders.map((p) => p.stop()));
    logger.success("All providers stopped");

    logger.complete(
      "Multi-provider agent workflow demonstrated. Single agent identity enables " +
        "seamless authentication across multiple providers, unified cost tracking, " +
        "and O(1) credential management complexity regardless of provider count."
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
