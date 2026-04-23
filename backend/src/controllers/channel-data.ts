import type { Request, Response } from "express";
import type { ChannelCallReceipt } from "../services/channel-session.js";

// ─── Shared helper ────────────────────────────────────────────────────

function withReceipt(res: Response, data: object): object {
  const receipt: ChannelCallReceipt | undefined = res.locals.channelReceipt;
  const session = res.locals.channelSession;

  return {
    data,
    channelReceipt: receipt
      ? {
          channelId: receipt.channelId,
          sequenceNumber: receipt.sequenceNumber,
          cumulativeCost: receipt.cumulativeCost,
          timestamp: receipt.timestamp,
          providerSignature: receipt.providerSignature,
        }
      : null,
    channel: session
      ? {
          consumer: session.consumer,
          provider: session.provider,
          activatedAt: session.activatedAt,
          expiresAt: session.expiresAt,
        }
      : null,
  };
}

// ─── Dummy data (same dataset as /api/data) ───────────────────────────

const MARKET_DATA: Record<string, object> = {
  BTCUSDT: {
    symbol: "BTCUSDT",
    price: "67842.50",
    change24h: "+2.34%",
    volume24h: "28_412_000_000",
    high24h: "68_100.00",
    low24h: "66_200.00",
    source: "kite-stream-feed",
    timestamp: Date.now(),
  },
  ETHUSDT: {
    symbol: "ETHUSDT",
    price: "3521.10",
    change24h: "-0.87%",
    volume24h: "14_200_000_000",
    high24h: "3590.00",
    low24h: "3470.00",
    source: "kite-stream-feed",
    timestamp: Date.now(),
  },
  SOLUSDT: {
    symbol: "SOLUSDT",
    price: "178.42",
    change24h: "+5.12%",
    volume24h: "3_800_000_000",
    high24h: "181.00",
    low24h: "169.00",
    source: "kite-stream-feed",
    timestamp: Date.now(),
  },
};

const AGENT_INTELLIGENCE: object[] = [
  {
    id: "intel-001",
    category: "defi",
    insight:
      "Uniswap v4 TVL crossed $5B. Concentrated liquidity in ETH/USDC 0.05% pool showing 18% APY.",
    confidence: 0.91,
    generatedAt: new Date().toISOString(),
  },
  {
    id: "intel-002",
    category: "macro",
    insight:
      "On-chain stablecoin transfer volume up 34% WoW — historically a leading indicator of retail re-entry.",
    confidence: 0.78,
    generatedAt: new Date().toISOString(),
  },
  {
    id: "intel-003",
    category: "risk",
    insight:
      "Large unlocks (>1% of supply) in next 7 days: ARB (1.2B), OP (800M).",
    confidence: 0.97,
    generatedAt: new Date().toISOString(),
  },
];

const PROTOCOL_REPORT: object = {
  protocol: "Aave v3",
  chain: "Ethereum",
  totalSupplied: "18_400_000_000",
  totalBorrowed: "6_200_000_000",
  utilizationRate: "33.7%",
  topAssets: [
    { asset: "USDC", supplyApy: "4.82%", borrowApy: "5.91%" },
    { asset: "USDT", supplyApy: "4.61%", borrowApy: "5.70%" },
    { asset: "WETH", supplyApy: "2.10%", borrowApy: "3.04%" },
  ],
  healthScore: 9.2,
  generatedAt: new Date().toISOString(),
};

// ─── Handlers ─────────────────────────────────────────────────────────

/**
 * GET /api/stream/market/:symbol
 * Rate: 0.05 USDT per call (cheaper via channel than per-call)
 */
export const getStreamMarketData = (req: Request, res: Response) => {
  const symbol = (req.params.symbol ?? "").toUpperCase();
  // Freshen timestamp on every call so streaming clients see distinct payloads.
  const data = MARKET_DATA[symbol]
    ? { ...MARKET_DATA[symbol], timestamp: Date.now() }
    : null;

  if (!data) {
    return res.status(404).json({ error: `No data for symbol ${symbol}` });
  }

  res.json(withReceipt(res, data));
};

/**
 * GET /api/stream/intelligence
 * Rate: 0.20 USDT per call
 */
export const getStreamIntelligence = (_req: Request, res: Response) => {
  res.json(
    withReceipt(res, {
      items: AGENT_INTELLIGENCE,
      generatedAt: new Date().toISOString(),
    }),
  );
};

/**
 * GET /api/stream/protocol-report
 * Rate: 0.40 USDT per call
 */
export const getStreamProtocolReport = (_req: Request, res: Response) => {
  res.json(
    withReceipt(res, { ...PROTOCOL_REPORT, generatedAt: new Date().toISOString() }),
  );
};
