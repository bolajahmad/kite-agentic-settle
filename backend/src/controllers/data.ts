import type { Request, Response } from "express";

// ─── Dummy dataset ────────────────────────────────────────────────────
// These are the "premium" payloads returned after successful payment.

const MARKET_DATA: Record<string, object> = {
  BTCUSDT: {
    symbol: "BTCUSDT",
    price: "67842.50",
    change24h: "+2.34%",
    volume24h: "28_412_000_000",
    high24h: "68_100.00",
    low24h: "66_200.00",
    source: "kite-data-feed",
    timestamp: Date.now(),
  },
  ETHUSDT: {
    symbol: "ETHUSDT",
    price: "3521.10",
    change24h: "-0.87%",
    volume24h: "14_200_000_000",
    high24h: "3590.00",
    low24h: "3470.00",
    source: "kite-data-feed",
    timestamp: Date.now(),
  },
  SOLUSDT: {
    symbol: "SOLUSDT",
    price: "178.42",
    change24h: "+5.12%",
    volume24h: "3_800_000_000",
    high24h: "181.00",
    low24h: "169.00",
    source: "kite-data-feed",
    timestamp: Date.now(),
  },
};

const AGENT_INTELLIGENCE: object[] = [
  {
    id: "intel-001",
    category: "defi",
    insight: "Uniswap v4 TVL crossed $5B. Concentrated liquidity positions in ETH/USDC 0.05% pool showing 18% APY.",
    confidence: 0.91,
    generatedAt: new Date().toISOString(),
  },
  {
    id: "intel-002",
    category: "macro",
    insight: "On-chain stablecoin transfer volume up 34% WoW, historically a leading indicator of retail re-entry.",
    confidence: 0.78,
    generatedAt: new Date().toISOString(),
  },
  {
    id: "intel-003",
    category: "risk",
    insight:
      "Large unlocks (>1% of supply) scheduled in next 7 days: ARB (1.2B tokens), OP (800M tokens).",
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
 * GET /api/data/market/:symbol
 * Returns real-time (simulated) market data for a trading pair.
 * Protected: 0.10 USDT per call.
 */
export const getMarketData = (req: Request, res: Response) => {
  const symbol = (req.params.symbol ?? "").toUpperCase();
  const data = MARKET_DATA[symbol];
  if (!data) {
    return res.status(404).json({ error: `No data for symbol ${symbol}` });
  }

  res.json({
    data,
    payment: {
      settled: true,
      txHash: res.locals.payment?.txHash,
      amount: res.locals.payment?.amount?.toString(),
    },
  });
};

/**
 * GET /api/data/intelligence
 * Returns curated AI-generated on-chain intelligence signals.
 * Protected: 0.25 USDT per call.
 */
export const getIntelligence = (_req: Request, res: Response) => {
  res.json({
    data: AGENT_INTELLIGENCE,
    payment: {
      settled: true,
      txHash: res.locals.payment?.txHash,
      amount: res.locals.payment?.amount?.toString(),
    },
  });
};

/**
 * GET /api/data/protocol-report
 * Returns a full protocol analytics report.
 * Protected: 0.50 USDT per call.
 */
export const getProtocolReport = (_req: Request, res: Response) => {
  res.json({
    data: PROTOCOL_REPORT,
    payment: {
      settled: true,
      txHash: res.locals.payment?.txHash,
      amount: res.locals.payment?.amount?.toString(),
    },
  });
};
