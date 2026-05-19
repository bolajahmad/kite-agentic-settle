/**
 * Demo 6: Multi-Provider Agent Workflow
 *
 * SCALABILITY PROOF:
 * This demo shows how a single agent identity can interact with multiple
 * providers simultaneously using the same session key. Two payment modes
 * are exercised in the same run:
 *
 *   • x402 per-call  — real localhost:4000 endpoints (/api/data/*)
 *   • x402 per-call  — lightweight mock provider (no on-chain infra needed)
 *
 * WHAT YOU'LL LEARN:
 * - How one agent identity authenticates to multiple providers
 * - How session keys enable multi-provider concurrency
 * - How to track costs per provider with a single agent identity
 * - How agent-based auth eliminates per-provider API keys
 *
 * PREREQUISITES:
 * - Run `npx kite init` to store your EOA seed phrase
 * - Run `npx kite onboard` to register an agent and create a session key
 * - Fund your ClientAgentVault with test USDC
 * - Start backend server at http://localhost:4000
 */

import { createLogger } from "./lib/logger.js";
import { MockProvider } from "./lib/mock-provider.js";
import { createDemoClient, formatUsdc, parseUsdc, wait } from "./lib/setup.js";

const AGENT_ID = "3";
const SESSION_KEY = "0x875255dCe60F03fa645E64792701A57D1B1c678A";
const BACKEND_BASE = "http://localhost:4000";

export async function run() {
  const logger = createLogger();

  logger.header(
    "Demo 6: Multi-Provider Agent Workflow",
    "One agent identity across many providers (x402 per-call)",
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
      allowUnavailableSession: true,
    });

    if (!client.sessionKeyAddress) {
      logger.error("No session key found. Run 'npx kite onboard' to create one.");
      throw new Error("Session key required for multi-provider demo");
    }

    logger.success("Client initialized");
    logger.info(`EOA (owner):  ${client.eoaAddress}`);
    logger.info(`Session key:  ${client.sessionKeyAddress}`);
    logger.info("This SINGLE identity will authenticate to every provider below.");

    // ── Check vault balance ───────────────────────────────────────────
    logger.step("Check ClientAgentVault balance");
    const vaultAddress = await client.getOwnerAAWalletAddress();
    const balanceBefore = await client.getDepositedBalance(undefined, vaultAddress);
    logger.data("Balance Before", {
      formatted: formatUsdc(balanceBefore),
      raw: balanceBefore.toString(),
    });

    if (balanceBefore === 0n) {
      logger.warn("Vault balance is zero. Fund: npx kite fund --amount <amount>");
      logger.info("Demo continues — on-chain settlement may fail.");
    }

    // ── Start mock provider ───────────────────────────────────────────
    logger.step("Start mock analytics provider (x402 per-call)");
    const MOCK_PORT = 3420;
    const MOCK_PRICE = parseUsdc("0.03");
    const mockProvider = new MockProvider({
      port: MOCK_PORT,
      agentAddress: client.eoaAddress,
      pricePerCall: MOCK_PRICE,
    });
    await mockProvider.start();
    logger.success(`Mock AnalyticsAPI started on port ${MOCK_PORT}`);

    // ── Provider catalogue ────────────────────────────────────────────
    const providers: Array<{
      name: string;
      url: string;
      description: string;
      mock?: boolean;
    }> = [
      {
        name: "Kite Intelligence",
        url: `${BACKEND_BASE}/api/data/intelligence`,
        description: "AI on-chain intelligence signals",
      },
      {
        name: "Kite Market Data",
        url: `${BACKEND_BASE}/api/data/market/BTCUSDT`,
        description: "Real-time BTC/USDT market feed",
      },
      {
        name: "Kite Protocol Report",
        url: `${BACKEND_BASE}/api/data/protocol-report`,
        description: "DeFi protocol analytics",
      },
      {
        name: "Mock AnalyticsAPI",
        url: `http://localhost:${MOCK_PORT}`,
        description: "Third-party analytics provider (mock)",
        mock: true,
      },
    ];

    logger.data("Provider Catalogue", {
      providers: providers.map((p) => ({
        name: p.name,
        url: p.url,
        type: p.mock ? "mock x402" : "kite x402",
      })),
    });

    // ── Call each provider ────────────────────────────────────────────
    logger.step("Make API calls across all providers");
    logger.info("Same session key is used for every call — no per-provider keys.\n");

    const costPerProvider = new Map<string, bigint>();
    let totalCalls = 0;

    for (const provider of providers) {
      logger.info(`📞 Calling ${provider.name}...`);
      logger.info(`   ${provider.description}`);

      const t0 = Date.now();
      try {
        const response = await client.fetchWithPayment(
          provider.url,
          { method: "GET", headers: { "Content-Type": "application/json" } },
          { paymentMode: "perCall" },
        );
        const elapsed = Date.now() - t0;

        if (response.ok) {
          const body = await response.json();
          logger.success(`   ✅ ${response.status} OK (${elapsed}ms)`);

          // Log a snippet of the response without flooding the terminal
          const preview = JSON.stringify(body).slice(0, 120);
          logger.info(`   Response: ${preview}${preview.length === 120 ? "…" : ""}`);

          // Track cost — read from response or use known rate
          const reportedCost =
            body?.payment?.amount ?? body?.cost ?? body?.channelReceipt?.cumulativeCost;
          costPerProvider.set(provider.name, reportedCost ? BigInt(reportedCost) : 0n);
          totalCalls++;
        } else {
          const err = await response.json().catch(() => ({}));
          logger.warn(`   ⚠️  ${response.status}: ${JSON.stringify(err).slice(0, 80)}`);
        }
      } catch (err: any) {
        logger.error(`   ❌ ${provider.name} failed: ${err.message}`);
        if (provider.mock) {
          logger.info("   (Mock provider may require a valid Kite receipt — see mock-provider.ts)");
        } else {
          logger.info("   Make sure the backend is running at http://localhost:4000");
        }
      }

      await wait(400);
    }

    // ── Cost attribution ──────────────────────────────────────────────
    logger.step("Cost attribution by provider");

    const balanceAfter = await client.getDepositedBalance(undefined, vaultAddress);
    const totalSpent = balanceBefore - balanceAfter;

    logger.data("Cost Summary", {
      totalCalls,
      totalSpent: formatUsdc(totalSpent),
      vaultBefore: formatUsdc(balanceBefore),
      vaultAfter: formatUsdc(balanceAfter),
      perProvider: providers.map((p) => ({
        provider: p.name,
        reportedCost: costPerProvider.has(p.name)
          ? formatUsdc(costPerProvider.get(p.name)!)
          : "n/a",
      })),
    });

    // ── Agent-based vs traditional comparison ─────────────────────────
    logger.step("Agent-based auth vs Traditional API-key auth");

    logger.info("❌ Traditional (per-provider API keys):");
    logger.info(`   - ${providers.length} separate API keys to manage`);
    logger.info("   - Rotate/revoke each key independently");
    logger.info("   - Separate billing per provider");
    logger.info(`   - Complexity: O(${providers.length}) credentials for ${providers.length} providers`);

    logger.info("\n✅ Kite agent-based:");
    logger.info("   - ONE session key for ALL providers");
    logger.info("   - Revoke the session key to cut ALL providers at once");
    logger.info("   - Unified cost tracking under one agent ID");
    logger.info("   - Complexity: O(1) regardless of provider count");

    // ── Cleanup ───────────────────────────────────────────────────────
    logger.step("Cleanup");
    await mockProvider.stop();
    logger.success("Mock provider stopped");

    logger.complete(
      "Multi-provider demo complete. One agent identity authenticated to " +
        `${providers.length} providers (${providers.filter((p) => !p.mock).length} real, ` +
        `${providers.filter((p) => p.mock).length} mock) with zero per-provider credential management.`,
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
