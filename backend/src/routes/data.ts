import { Router } from "express";
import { parseUnits } from "viem";
import {
  getIntelligence,
  getMarketData,
  getProtocolReport,
} from "../controllers/data.js";
import { requireX402Payment } from "../middlewares/x402.js";

const router = Router();

// ─── Payment config helpers ───────────────────────────────────────────
// DmUSDT (Kite testnet demo token) has 18 decimals.
// Use parseUnits to convert human-readable amounts to base units.
const TOKEN_DECIMALS = 18;
const DM_USDT_TOKEN =
  process.env.DM_USDT_TOKEN ??
  process.env.TESTNET_TOKEN ??
  "0xd4A87dA836399f9ea548b5f8f8fF8fB80B8eD78F";
const PAYMENT_TOKEN =
  process.env.PAYMENT_TOKEN_ADDRESS ??
  process.env.SETTLEMENT_TOKEN_ADDRESS ??
  "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63";

function paymentConfig(
  dmUsdtAmount: string,
  paymentTokenAmount: string,
  description: string,
) {
  return {
    offers: [
      {
        amount: parseUnits(dmUsdtAmount, TOKEN_DECIMALS),
        token: DM_USDT_TOKEN,
        description: `${description} (DmUSDT)`,
      },
      {
        amount: parseUnits(paymentTokenAmount, TOKEN_DECIMALS),
        token: PAYMENT_TOKEN,
        description: `${description} (PaymentToken)`,
      },
    ],
    recipient:
      process.env.FACILITATOR_RECIPIENT_ADDRESS ??
      process.env.DEPLOYER_ADDRESS ??
      "",
    description,
  };
}

// ─── Protected routes ─────────────────────────────────────────────────

/**
 * GET /api/data/market/:symbol
 * Cost: 0.40 DmUSDT or 0.04 PaymentToken
 *
 * Returns simulated real-time market data for a given trading pair symbol
 * (e.g. BTCUSDT, ETHUSDT, SOLUSDT).
 */
router.get(
  "/market/:symbol",
  requireX402Payment(
    paymentConfig("0.40", "0.04", "Market data feed per query"),
  ),
  getMarketData,
);

/**
 * GET /api/data/intelligence
 * Cost: 0.40 DmUSDT or 0.04 PaymentToken
 *
 * Returns curated AI-generated on-chain intelligence signals.
 */
router.get(
  "/intelligence",
  requireX402Payment(
    paymentConfig("0.40", "0.04", "AI intelligence feed per query"),
  ),
  getIntelligence,
);

/**
 * GET /api/data/protocol-report
 * Cost: 0.40 DmUSDT or 0.04 PaymentToken
 *
 * Returns a full DeFi protocol analytics report.
 */
router.get(
  "/protocol-report",
  requireX402Payment(
    paymentConfig("0.40", "0.04", "Protocol analytics report per query"),
  ),
  getProtocolReport,
);

export default router;
