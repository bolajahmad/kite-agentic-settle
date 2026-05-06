/**
 * Demo 1: Per-Call Payment with x402
 *
 * VALUE PROPOSITION:
 * This demo shows the fundamental value of Kite Agent Pay — programmable
 * micropayments using EIP-712 signed receipts that settle on-chain through
 * KiteAAWallet contracts. No pre-funding, no channel setup, just pay-as-you-go.
 *
 * WHAT YOU'LL LEARN:
 * - How x402 payment challenges work (402 Payment Required)
 * - Difference between regular fetch (fails with 402) vs Kite fetch (auto-pays)
 * - How EIP-712 receipts are signed using session keys
 * - How the SDK automatically handles payment negotiation
 * - How receipts settle on-chain via KiteAAWallet
 *
 * PREREQUISITES:
 * - Run `npx kite init` to store your EOA seed phrase
 * - Run `npx kite onboard` to register an agent and create a session key
 * - Fund your KiteAAWallet with test USDC
 * - Update AGENT_ID and SESSION_KEY below with your values
 *
 * USAGE:
 * - Make sure a payment-required provider is running at http://localhost:4000
 * - Run: npm run demo 1
 */

// Demo configuration - replace with your agent and session
const AGENT_ID = "2";
const SESSION_KEY = "0xb06ccc215fdcff276b82edce185fa7733be16fb4";

import { createLogger } from "./lib/logger.js";
import { createDemoClient, formatUsdc } from "./lib/setup.js";

export async function run() {
  const logger = createLogger();

  logger.header(
    "Demo 1: Per-Call Payment with x402",
    "Pay-as-you-go programmable micropayments",
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

    logger.success("Client initialized in agent mode");
    logger.info(`Active address: ${client.address}`);
    logger.info(`EOA address: ${client.eoaAddress}`);
    if (client.sessionKeyAddress) {
      logger.info(`Session key: ${client.sessionKeyAddress}`);
    }

    // ── Check wallet balance ──────────────────────────────────────────
    logger.step("Check KiteAAWallet balance");
    const balance = await client.getDepositedBalance();
    logger.data("Balance Before Calls", {
      raw: balance.toString(),
      formatted: formatUsdc(balance),
    });

    if (balance === 0n) {
      logger.warn(
        "Wallet balance is zero. Fund your wallet with: npx kite fund --amount <amount>",
      );
      logger.info(
        "Demo will continue to show payment flow (on-chain settlement may fail)",
      );
    }

    const providerUrl = "http://localhost:4000/api/data/protocol-report";

    // ── Attempt 1: Regular fetch (NO payment) ────────────────────────
    logger.step(
      "Attempt 1: Make API call using standard fetch (NO payment handler)",
    );
    logger.info("Expected: Provider returns 402 Payment Required");

    let startTime = Date.now();
    try {
      const response = await fetch(providerUrl, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      const elapsed = Date.now() - startTime;

      if (response.status === 402) {
        logger.error(
          ` Received HTTP ${response.status} Payment Required (${elapsed}ms)`,
        );

        const offer = await response.json();
        logger.data("Payment Challenge (WWW-Authenticate header)", {
          payTo: offer.accepts?.[0]?.payTo || "provider address",
          amount:
            formatUsdc(offer.accepts?.[0]?.maxAmountRequired) + "USDC" ||
            "amount required",
          token: offer.accepts?.[0]?.asset || "payment token",
        });

        logger.info(
          "Without Kite SDK, the client must manually handle this 402 response:",
        );
        logger.info("  1. Parse the payment challenge");
        logger.info("  2. Create and sign an EIP-712 receipt");
        logger.info(
          "  3. Retry request with Authorization: x402-receipt header",
        );
      } else {
        logger.warn(
          `Unexpected status ${response.status} - provider may not require payment`,
        );
      }
    } catch (err: any) {
      logger.error(`Connection failed: ${err.message}`);
      logger.warn("Make sure the provider is running at http://localhost:4000");
    }

    // ── Attempt 2: Kite fetchWithPayment (AUTO payment) ──────────────
    logger.step(
      "Attempt 2: Make API call using Kite SDK (WITH payment handler)",
    );
    logger.info("Expected: SDK automatically handles 402 and pays provider");

    startTime = Date.now();
    try {
      const response = await client.fetchWithPayment(
        providerUrl,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
        {
          paymentMode: "perCall",
        },
      );
      const elapsed = Date.now() - startTime;

      if (response.ok) {
        logger.success(` Received HTTP ${response.status} OK (${elapsed}ms)`);

        const result = await response.json();
        logger.data("API Response", result);

        logger.info("\n What happened:");
        logger.info("  1. Provider returned 402 Payment Required");
        logger.info("  2. SDK parsed the payment challenge automatically");
        logger.info(
          "  3. SDK created EIP-712 signed receipt using session key",
        );
        logger.info("  4. SDK retried request with x402-receipt header");
        logger.info("  5. Provider validated receipt and returned 200 OK");
      } else {
        logger.warn(`Received HTTP ${response.status} (${elapsed}ms)`);
        const errorData = await response.json().catch(() => ({}));
        logger.data("Error Response", errorData);

        if (response.status === 402) {
          logger.error(
            "Payment negotiation failed - check session key validity and wallet balance",
          );
        }
      }
    } catch (err: any) {
      logger.error(`Payment flow failed: ${err.message}`);
      logger.info("Common causes:");
      logger.info("  - Provider not running at http://localhost:4000");
      logger.info("  - Session key not registered or expired");
      logger.info("  - Insufficient wallet balance");
      logger.info("  - Session capacity exhausted");
      if (err.stack) {
        console.error(err.stack);
      }
    }

    // ── Check balance after payment ───────────────────────────────────
    logger.step("Check wallet balance after payment");
    const balanceAfter = await client.getDepositedBalance();
    logger.data("Balance After Calls", {
      raw: balanceAfter.toString(),
      formatted: formatUsdc(balanceAfter),
    });

    const spent = balance - balanceAfter;
    if (spent > 0n) {
      logger.success(`Payment settled: ${formatUsdc(spent)} spent`);
    } else {
      logger.info("No balance change (payment may be pending or failed)");
    }

    logger.complete(
      "Per-call x402 payment flow demonstrated. Standard fetch gets 402 error. " +
        "Kite SDK automatically handles payment negotiation with EIP-712 receipts.",
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
