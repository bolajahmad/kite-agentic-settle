/**
 * /api/stream — Channel-payment-gated data routes.
 *
 * These endpoints implement the full multi-step channel protocol:
 *
 *   1. Bare request  → 402 with x402 + channelOptions
 *   2. First request with X-Channel-Id
 *                   → server verifies & activates channel on-chain,
 *                     returns data + signed receipt (seq=1)
 *   3. Subsequent requests with X-Channel-Id + X-Last-Receipt-*
 *                   → server validates continuity, returns data + new receipt
 *
 * All receipts use the same EIP-712 digest that PaymentChannel.sol verifies
 * on-chain during settlement.
 */

import { Router } from "express";
import { parseUnits } from "viem";
import {
  getStreamIntelligence,
  getStreamMarketData,
  getStreamProtocolReport,
} from "../controllers/channel-data.js";
import { requireChannelPayment } from "../middlewares/channel-payment.js";

const router = Router();

const TOKEN_DECIMALS = 18;

// ─── GET /api/stream/market/:symbol ──────────────────────────────────
// Rate: 0.05 USDT per call (discounted vs per-call /api/data/market)
router.get(
  "/market/:symbol",
  requireChannelPayment({
    ratePerCall: parseUnits("0.05", TOKEN_DECIMALS),
    description:
      "Live market data stream — 0.05 USDT per call via payment channel",
    recommendedDeposit: parseUnits("0.05", TOKEN_DECIMALS), // 10 calls
    maxDuration: 3600, // 1 hour
  }),
  getStreamMarketData,
);

// ─── GET /api/stream/intelligence ─────────────────────────────────────
// Rate: 0.20 USDT per call
router.get(
  "/intelligence",
  requireChannelPayment({
    ratePerCall: parseUnits("0.20", TOKEN_DECIMALS),
    description:
      "AI intelligence stream — 0.20 USDT per call via payment channel",
    recommendedDeposit: parseUnits("0.2", TOKEN_DECIMALS), // 10 calls
    maxDuration: 3600,
  }),
  getStreamIntelligence,
);

// ─── GET /api/stream/protocol-report ──────────────────────────────────
// Rate: 0.40 USDT per call
router.get(
  "/protocol-report",
  requireChannelPayment({
    ratePerCall: parseUnits("0.40", TOKEN_DECIMALS),
    description:
      "Protocol analytics stream — 0.40 USDT per call via payment channel",
    recommendedDeposit: parseUnits("0.4", TOKEN_DECIMALS), // 10 calls
    maxDuration: 3600,
  }),
  getStreamProtocolReport,
);

export default router;
