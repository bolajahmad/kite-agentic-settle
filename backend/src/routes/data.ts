import { Router } from "express";
import { parseUnits } from "viem";
import { requireX402Payment } from "../middlewares/x402.js";
import {
  getMarketData,
  getIntelligence,
  getProtocolReport,
} from "../controllers/data.js";

const router = Router();

// ─── Payment config helpers ───────────────────────────────────────────
// DmUSDT (Kite testnet demo token) has 18 decimals.
// Use parseUnits to convert human-readable amounts to base units.
const TOKEN_DECIMALS = 18;

function paymentConfig(
  amountUsdt: string,
  description: string
) {
  return {
    amount: parseUnits(amountUsdt, TOKEN_DECIMALS),
    token: process.env.USDT_TOKEN_ADDRESS ?? process.env.TOKEN_ADDRESS ?? "",
    recipient: process.env.FACILITATOR_RECIPIENT_ADDRESS ?? process.env.DEPLOYER_ADDRESS ?? "",
    description,
  };
}

// ─── Protected routes ─────────────────────────────────────────────────

/**
 * GET /api/data/market/:symbol
 * Cost: 0.10 USDT
 *
 * Returns simulated real-time market data for a given trading pair symbol
 * (e.g. BTCUSDT, ETHUSDT, SOLUSDT).
 */
router.get(
  "/market/:symbol",
  requireX402Payment(paymentConfig("0.10", "Market data feed — 0.10 USDT per query")),
  getMarketData
);

/**
 * GET /api/data/intelligence
 * Cost: 0.25 USDT
 *
 * Returns curated AI-generated on-chain intelligence signals.
 */
router.get(
  "/intelligence",
  requireX402Payment(paymentConfig("0.25", "AI intelligence feed — 0.25 USDT per query")),
  getIntelligence
);

/**
 * GET /api/data/protocol-report
 * Cost: 0.50 USDT
 *
 * Returns a full DeFi protocol analytics report.
 */
router.get(
  "/protocol-report",
  requireX402Payment(paymentConfig("0.50", "Protocol analytics report — 0.50 USDT per query")),
  getProtocolReport
);

export default router;
