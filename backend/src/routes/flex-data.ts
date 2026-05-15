/**
 * /api/flex — Dual-mode data routes (x402 per-call OR payment channel).
 *
 * Each route advertises BOTH payment modes. The consumer picks:
 *
 *   x402 mode (per-call):
 *     - Send X-PAYMENT header with EIP-712 signed receipt
 *     - Settled on-chain per request via facilitator
 *     - Higher cost per call, no channel setup required
 *
 *   Channel mode (batch):
 *     - Open a PaymentChannel on-chain first
 *     - Send X-Channel-Id + X-Payment-Mode: channel
 *     - Charged at a discounted rate per call
 *     - Settled lazily when the channel is closed
 *
 * If neither header is present the server returns 402 with:
 *   - `accepts[]`      — x402 offers
 *   - `channelOptions` — channel metadata
 *   - `paymentModes`   — ["x402", "channel"]
 *
 * The response body is identical in both modes.  Channel-mode responses
 * also include a `channelReceipt` object so the client can track cumulative
 * cost without querying the chain.
 */

import { Router } from "express";
import { parseUnits } from "viem";
import {
  getStreamIntelligence,
  getStreamMarketData,
  getStreamProtocolReport,
} from "../controllers/channel-data.js";
import { requireFlexPayment } from "../middlewares/flex-payment.js";

const router = Router();

const TOKEN_DECIMALS = 18;

// ─── Token addresses ──────────────────────────────────────────────────
// x402 mode settles via the facilitator; channel mode settles on-chain
// via PaymentChannel.  Both use the same token addresses.
const DM_USDT_TOKEN =
  process.env.DM_USDT_TOKEN ??
  process.env.TESTNET_TOKEN ??
  "0xd4A87dA836399f9ea548b5f8f8fF8fB80B8eD78F";
const PAYMENT_TOKEN =
  process.env.PAYMENT_TOKEN_ADDRESS ??
  process.env.SETTLEMENT_TOKEN_ADDRESS ??
  "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63";
const FACILITATOR_RECIPIENT =
  process.env.FACILITATOR_RECIPIENT_ADDRESS ??
  process.env.DEPLOYER_ADDRESS ??
  "";

// ─── Config helpers ───────────────────────────────────────────────────

function x402Config(
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
    recipient: FACILITATOR_RECIPIENT,
    description,
  };
}

function channelConfig(
  ratePerCall: string,
  description: string,
) {
  return {
    ratePerCall: parseUnits(ratePerCall, TOKEN_DECIMALS),
    description,
    recommendedDeposit: parseUnits(ratePerCall, TOKEN_DECIMALS) * 10n,
    maxDuration: 3600,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────

/**
 * GET /api/flex/market/:symbol
 *
 * x402 cost:   0.40 DmUSDT / 0.04 PaymentToken (per-call)
 * Channel rate: 0.05 DmUSDT per call (discounted for bulk/stream)
 *
 * Returns live market data for the given trading pair.
 */
router.get(
  "/market/:symbol",
  requireFlexPayment(
    x402Config("0.40", "0.04", "Market data feed (flex)"),
    channelConfig("0.05", "Live market data stream — 0.05 USDT per call"),
  ),
  getStreamMarketData,
);

/**
 * GET /api/flex/intelligence
 *
 * x402 cost:   0.40 DmUSDT / 0.04 PaymentToken (per-call)
 * Channel rate: 0.20 DmUSDT per call
 *
 * Returns AI-generated on-chain intelligence signals.
 */
router.get(
  "/intelligence",
  requireFlexPayment(
    x402Config("0.40", "0.04", "AI intelligence feed (flex)"),
    channelConfig("0.20", "Intelligence feed — 0.20 USDT per call"),
  ),
  getStreamIntelligence,
);

/**
 * GET /api/flex/protocol-report
 *
 * x402 cost:   0.60 DmUSDT / 0.06 PaymentToken (per-call)
 * Channel rate: 0.40 DmUSDT per call
 *
 * Returns DeFi protocol analytics and risk report.
 */
router.get(
  "/protocol-report",
  requireFlexPayment(
    x402Config("0.60", "0.06", "Protocol risk report (flex)"),
    channelConfig("0.40", "Protocol report stream — 0.40 USDT per call"),
  ),
  getStreamProtocolReport,
);

export default router;
