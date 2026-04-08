/**
 * Multi-Provider Agent Simulation
 *
 * Demonstrates a realistic agent workflow:
 *
 *   1. Onboard — register EOA → agent → session key on-chain
 *   2. Query the Goldsky subgraph to verify on-chain state
 *   3. Interact with two independent provider APIs:
 *      - Weather API  (Provider A) — single endpoint, 0.02 KTT/call
 *      - DeFi API     (Provider B) — mixed pricing:
 *          /price/{symbol}     0.01 KTT
 *          /simulate/{symbol}  0.05 KTT
 *          /audit/{symbol}     0.10 KTT
 *   4. Each provider gets its own batch session (separate deposits)
 *   5. Settle both sessions and print a unified cost report
 *
 * This shows how a single consumer agent can batch calls to
 * multiple providers, each with their own pricing, in parallel
 * sessions — the way a real autonomous agent would operate.
 *
 * Usage:
 *   EOA_SEED="your twelve word seed phrase here" \
 *   npx tsx examples/defi-pricing-sim.ts
 *
 * The EOA_SEED env var (or vars store key) is the master key that
 * owns the agent. It must have KITE for gas on Kite AI Testnet.
 */

import http from "node:http";
import { formatUnits, parseUnits, hexToString } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { KitePaymentClient, KITE_TESTNET } from "../src/index.js";
import type { BatchLimits, BatchEndReason } from "../src/batch.js";
import type { Receipt } from "../src/types.js";
import { verifyReceipt } from "../src/receipt.js";
import { resolveVar } from "../src/vars.js";

// ── Config ─────────────────────────────────────────────────────────

const GOLDSKY_URL =
  "https://api.goldsky.com/api/public/project_cmnn27cgufwam01x895lwbit9/subgraphs/kite-aspl-kite-ai-testnet/1.0/gn";

const TOKEN = KITE_TESTNET.token;

// Two mock providers (separate EOAs)
const WEATHER_PROVIDER = {
  name: "Weather API",
  address: "0xEf7a2Cc08d80AaBB2fE1e75D90f7bb354BB8289c",
  key: "0xbd88d7931ce6ffc84d45264da93b7b63bf945b339ff14742b9cfcff2ce0c0b72",
  port: 4300,
};

const DEFI_PROVIDER = {
  name: "DeFi Pricing API",
  address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  port: 4301,
};

// Endpoint pricing (KTT)
const WEATHER_PRICE = parseUnits("0.02", 18);

const DEFI_PRICES = {
  price: parseUnits("0.01", 18),
  simulate: parseUnits("0.05", 18),
  audit: parseUnits("0.10", 18),
} as const;

type DefiEndpoint = keyof typeof DEFI_PRICES;

// ── Formatting helpers ─────────────────────────────────────────────

const fmt = (n: bigint) => formatUnits(n, 18);

function log(tag: string, data: unknown) {
  const out =
    typeof data === "object" ? JSON.stringify(data, null, 2) : String(data);
  console.log(`  [${tag.padEnd(16)}] ${out}`);
}

function sep(title: string) {
  console.log("");
  console.log(
    `  ═══ ${title} ${"═".repeat(Math.max(0, 58 - title.length))}`,
  );
  console.log("");
}

// ── Mock Weather API ───────────────────────────────────────────────

function createWeatherServer(): http.Server {
  const cities: Record<
    string,
    { temp: number; humidity: number; condition: string }
  > = {
    london: { temp: 14, humidity: 72, condition: "Partly Cloudy" },
    tokyo: { temp: 22, humidity: 58, condition: "Clear" },
    newyork: { temp: 18, humidity: 65, condition: "Overcast" },
    lagos: { temp: 31, humidity: 80, condition: "Thunderstorm" },
    dubai: { temp: 38, humidity: 35, condition: "Sunny" },
    singapore: { temp: 30, humidity: 84, condition: "Rain" },
  };

  return http.createServer((req, res) => {
    const url = new URL(
      req.url || "/",
      `http://localhost:${WEATHER_PROVIDER.port}`,
    );
    const city = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();

    if (!city) {
      res.writeHead(404);
      res.end(
        JSON.stringify({ error: "Provide a city: /london, /tokyo, etc." }),
      );
      return;
    }

    if (!req.headers["x-kite-receipt"]) {
      res.writeHead(402, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          accepts: [
            {
              scheme: "exact",
              price: WEATHER_PRICE.toString(),
              asset: TOKEN,
              payTo: WEATHER_PROVIDER.address,
              description: `Weather data for ${city}`,
            },
          ],
        }),
      );
      return;
    }

    const data = cities[city] || {
      temp: 20,
      humidity: 60,
      condition: "Unknown",
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ city, ...data, timestamp: new Date().toISOString() }),
    );
  });
}

// ── Mock DeFi API ──────────────────────────────────────────────────

function createDefiServer(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(
      req.url || "/",
      `http://localhost:${DEFI_PROVIDER.port}`,
    );
    const parts = url.pathname.split("/").filter(Boolean);
    const endpoint = parts[0] as DefiEndpoint | undefined;
    const symbol = (parts[1] || "").toUpperCase();

    if (!endpoint || !DEFI_PRICES[endpoint]) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Unknown endpoint" }));
      return;
    }

    const price = DEFI_PRICES[endpoint];

    if (!req.headers["x-kite-receipt"]) {
      res.writeHead(402, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          accepts: [
            {
              scheme: "exact",
              price: price.toString(),
              asset: TOKEN,
              payTo: DEFI_PROVIDER.address,
              description: `DeFi ${endpoint} for ${symbol || "?"}`,
            },
          ],
        }),
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getDefiData(endpoint, symbol)));
  });
}

function getDefiData(endpoint: DefiEndpoint, symbol: string): unknown {
  // Deterministic mock data based on symbol hash
  const seed = [...symbol].reduce((h, c) => h + c.charCodeAt(0), 0);

  switch (endpoint) {
    case "price": {
      const prices: Record<string, number> = {
        BTC: 104_820,
        ETH: 2_510,
        SOL: 172,
        KITE: 0.42,
        USDT: 1.0,
      };
      const p = prices[symbol] ?? seed * 1.37;
      return {
        symbol,
        priceUsd: p,
        change24h: `${((seed % 10) - 5) * 0.4}%`,
        timestamp: new Date().toISOString(),
      };
    }
    case "simulate": {
      const prices: Record<string, number> = {
        BTC: 104_820,
        ETH: 2_510,
        SOL: 172,
      };
      const p = prices[symbol] ?? 100;
      return {
        symbol,
        action: "BUY",
        amount: 100,
        estimatedCostUsd: (p * 100).toFixed(2),
        slippage: `${(0.3 + (seed % 5) * 0.1).toFixed(2)}%`,
        gasCostEth: (0.002 + (seed % 3) * 0.001).toFixed(4),
        route:
          symbol === "ETH"
            ? ["USDT", "WETH"]
            : ["USDT", "WETH", symbol],
        timestamp: new Date().toISOString(),
      };
    }
    case "audit": {
      const risk = 20 + (seed % 60);
      return {
        symbol,
        riskScore: risk,
        riskLevel: risk < 40 ? "LOW" : risk < 70 ? "MEDIUM" : "HIGH",
        checks: {
          proxyContract: seed % 2 === 0,
          mintFunction: seed % 3 === 0,
          ownerPrivileges: seed % 4 !== 0,
          liquidityLocked: seed % 5 !== 0,
          auditReport: seed % 2 !== 0,
        },
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// ── Goldsky Subgraph Queries ───────────────────────────────────────

async function querySubgraph(query: string): Promise<any> {
  const resp = await fetch(GOLDSKY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = (await resp.json()) as { data?: any; errors?: any[] };
  if (json.errors) {
    throw new Error(`Subgraph error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

async function queryAgentOnSubgraph(agentAddress: string) {
  const data = await querySubgraph(`{
    agentRegistereds(
      where: { agentAddress: "${agentAddress.toLowerCase()}" }
      first: 1
      orderBy: block_number
      orderDirection: desc
    ) {
      agentId
      agentAddress
      ownerAddress
      walletContract
      agentIndex
      metadata
      transactionHash_
      block_number
    }
  }`);
  return data?.agentRegistereds?.[0] ?? null;
}

async function querySessionsOnSubgraph(agentId: string) {
  const data = await querySubgraph(`{
    sessionRegistereds(
      where: { agentId: "${agentId}" }
      first: 10
      orderBy: block_number
      orderDirection: desc
    ) {
      agentId
      sessionKey
      sessionIndex
      validUntil
      transactionHash_
    }
    sessionKeyAddeds(
      where: { agentId: "${agentId}" }
      first: 10
      orderBy: block_number
      orderDirection: desc
    ) {
      sessionKey
      agentId
      sessionIndex
      valueLimit
      dailyLimit
      validUntil
      metadata
      transactionHash_
    }
  }`);
  return data;
}

async function queryUserRegistration(userAddress: string) {
  const data = await querySubgraph(`{
    userRegistereds(
      where: { user: "${userAddress.toLowerCase()}" }
      first: 1
    ) {
      user
      transactionHash_
      block_number
    }
  }`);
  return data?.userRegistereds?.[0] ?? null;
}

// ── Batch Call Helper ──────────────────────────────────────────────

interface CallResult {
  endpoint: string;
  provider: string;
  cost: bigint;
  receipt: Receipt;
  data: any;
}

async function batchCall(
  batchMgr: ReturnType<KitePaymentClient["getBatchManager"]>,
  sessionId: string,
  cost: bigint,
  providerKey: string,
  consumerAddress: string,
  providerAddress: string,
  url: string,
): Promise<{ receipt: Receipt; data: any } | null> {
  const health = batchMgr.checkSessionHealth(sessionId, cost);
  if (!health.ok) return null;

  const receipt = await batchMgr.recordCall(
    sessionId,
    cost,
    Buffer.from(providerKey.slice(2), "hex"),
    consumerAddress,
    providerAddress,
  );

  const resp = await fetch(url, {
    headers: { "x-kite-receipt": receipt.signature || "paid" },
  });
  const data = await resp.json();

  return { receipt, data };
}

// ── Main Simulation ────────────────────────────────────────────────

async function run() {
  console.log("");
  console.log("  Kite Agent Pay — Multi-Provider Agent Simulation");
  console.log("  ──────────────────────────────────────────────────────");

  // ── Phase 0: Resolve EOA seed ──────────────────────────────────
  sep("PHASE 0 — Resolve EOA Credentials");

  let eoaSeed: string;
  try {
    eoaSeed = resolveVar("$EOA_SEED");
    log("SEED", "Resolved from vars store / env");
  } catch {
    // Generate fresh seed for demo if none provided
    eoaSeed = KitePaymentClient.generateSeedPhrase();
    log("SEED", "No EOA_SEED found — generated fresh seed phrase for demo");
    log(
      "WARNING",
      "Fund this EOA with KITE (gas) on Kite AI Testnet to run on-chain steps",
    );
  }

  // Create the client (EOA-level)
  const client = await KitePaymentClient.create({
    seedPhrase: eoaSeed,
    defaultPaymentMode: "batch",
    agentId: "multi-provider-agent",
  });
  log("EOA", { address: client.address });

  // Check on-chain balances
  const contracts = client.getContractService();
  let kiteBalance: bigint;
  let kttBalance: bigint;
  try {
    kiteBalance = await contracts.getNativeBalance(client.address);
    kttBalance = await contracts.getTokenBalance(TOKEN, client.address);
    log("BALANCE", {
      kite: `${fmt(kiteBalance)} KITE`,
      ktt: `${fmt(kttBalance)} KTT`,
    });
  } catch (err: any) {
    log("BALANCE", `Could not read — ${err.message?.slice(0, 80)}`);
    kiteBalance = 0n;
    kttBalance = 0n;
  }

  const hasGas = kiteBalance > parseUnits("0.01", 18);

  // ── Phase 1: Onboard Agent On-Chain ────────────────────────────
  sep("PHASE 1 — Agent Onboarding");

  let agentId: string | undefined;
  let agentAddress: string | undefined;
  let sessionKeyAddress: string | undefined;

  if (hasGas) {
    log("ONBOARD", "EOA has gas — running on-chain onboarding...");
    try {
      const result = await client.onboard(
        {
          agentName: "MultiSkill Agent",
          category: "defi-weather",
          description:
            "Agent that queries weather and DeFi pricing APIs",
          tags: ["weather", "defi", "pricing", "multi-provider"],
          valueLimit: "1",
          dailyLimit: "10",
          validDays: 30,
        },
        (step) => log("ONBOARD", step),
      );

      agentId = result.agentId;
      agentAddress = result.agentAddress;
      sessionKeyAddress = result.sessionKeyAddress;

      log("RESULT", {
        agentId: result.agentId,
        agentAddress: result.agentAddress,
        agentIndex: result.agentIndex,
        sessionKey: result.sessionKeyAddress,
        sessionIndex: result.sessionIndex,
        validUntil: new Date(result.validUntil * 1000).toISOString(),
        txCount: result.txHashes.length,
        wasAlreadyRegistered: result.wasAlreadyRegistered,
      });

      if (result.txHashes.length > 0) {
        log("TX HASHES", result.txHashes);
      }
    } catch (err: any) {
      log("ONBOARD ERR", err.message?.slice(0, 200));
      log("FALLBACK", "Continuing with off-chain simulation only");
    }
  } else {
    log(
      "SKIP",
      "No gas on EOA — skipping on-chain registration (simulation-only mode)",
    );
    log(
      "HINT",
      `Fund ${client.address} with KITE on Kite AI Testnet, set EOA_SEED env var, and re-run`,
    );
  }

  // ── Phase 2: Verify via Goldsky Subgraph ───────────────────────
  sep("PHASE 2 — Subgraph Verification");

  if (agentAddress) {
    log("QUERY", `Looking up agent ${agentAddress} on Goldsky...`);

    // Give the indexer a moment to catch up
    await new Promise((r) => setTimeout(r, 3000));

    try {
      const agentRecord = await queryAgentOnSubgraph(agentAddress);
      if (agentRecord) {
        log("AGENT FOUND", {
          agentId: agentRecord.agentId,
          agentAddress: agentRecord.agentAddress,
          owner: agentRecord.ownerAddress,
          agentIndex: agentRecord.agentIndex,
          block: agentRecord.block_number,
        });

        // Try to decode metadata
        if (agentRecord.metadata) {
          try {
            const metaStr = hexToString(
              agentRecord.metadata as `0x${string}`,
            );
            const meta = JSON.parse(metaStr);
            log("METADATA", meta);
          } catch {
            log("METADATA", agentRecord.metadata);
          }
        }

        // Query session keys
        if (agentId) {
          const sessions = await querySessionsOnSubgraph(agentId);
          if (sessions?.sessionRegistereds?.length > 0) {
            log(
              "SESSIONS",
              sessions.sessionRegistereds.map((s: any) => ({
                sessionKey: s.sessionKey,
                sessionIndex: s.sessionIndex,
                validUntil: s.validUntil,
              })),
            );
          }
          if (sessions?.sessionKeyAddeds?.length > 0) {
            log(
              "SESSION RULES",
              sessions.sessionKeyAddeds.map((s: any) => ({
                sessionKey: s.sessionKey,
                sessionIndex: s.sessionIndex,
                valueLimit: s.valueLimit,
                dailyLimit: s.dailyLimit,
              })),
            );
          }
        }
      } else {
        log(
          "NOT FOUND",
          "Agent not yet indexed — indexer may still be catching up",
        );
      }
    } catch (err: any) {
      log("SUBGRAPH ERR", err.message?.slice(0, 120));
    }

    // Also check user registration
    try {
      const user = await queryUserRegistration(client.address);
      if (user) {
        log("USER REG", {
          address: user.user,
          block: user.block_number,
          tx: user.transactionHash_,
        });
      }
    } catch {
      // Ignore
    }
  } else {
    log("SKIP", "No on-chain agent — skipping subgraph verification");
  }

  // ── Phase 3: Start Provider Mock Servers ───────────────────────
  sep("PHASE 3 — Provider APIs & Batch Sessions");

  const weatherServer = createWeatherServer();
  const defiServer = createDefiServer();

  await new Promise<void>((r) =>
    weatherServer.listen(WEATHER_PROVIDER.port, r),
  );
  await new Promise<void>((r) =>
    defiServer.listen(DEFI_PROVIDER.port, r),
  );

  log(
    "WEATHER API",
    `http://localhost:${WEATHER_PROVIDER.port}/<city>  — ${fmt(WEATHER_PRICE)} KTT/call`,
  );
  log("DEFI API", {
    base: `http://localhost:${DEFI_PROVIDER.port}`,
    "/price/{sym}": `${fmt(DEFI_PRICES.price)} KTT`,
    "/simulate/{sym}": `${fmt(DEFI_PRICES.simulate)} KTT`,
    "/audit/{sym}": `${fmt(DEFI_PRICES.audit)} KTT`,
  });

  // Open two separate batch sessions — one per provider
  const batchMgr = client.getBatchManager();

  const weatherDeposit = parseUnits("0.20", 18);
  const defiDeposit = parseUnits("0.50", 18);

  const weatherSession = client.startBatchSession(
    WEATHER_PROVIDER.address,
    weatherDeposit,
    { maxDurationSeconds: 300, maxCalls: 20 },
  );

  const defiSession = client.startBatchSession(
    DEFI_PROVIDER.address,
    defiDeposit,
    { maxDurationSeconds: 300, maxCalls: 30 },
  );

  log("SESSION A", {
    provider: WEATHER_PROVIDER.name,
    id: weatherSession.sessionId.slice(0, 18) + "...",
    deposit: `${fmt(weatherDeposit)} KTT`,
  });
  log("SESSION B", {
    provider: DEFI_PROVIDER.name,
    id: defiSession.sessionId.slice(0, 18) + "...",
    deposit: `${fmt(defiDeposit)} KTT`,
  });

  console.log("");

  // ── Phase 4: Agent Workflow — interleaved calls ────────────────
  // A realistic agent might: check weather for travel, check token prices,
  // simulate a trade, audit a contract, check more weather...

  const allResults: CallResult[] = [];

  async function callWeather(city: string) {
    const url = `http://localhost:${WEATHER_PROVIDER.port}/${city}`;
    const res = await batchCall(
      batchMgr,
      weatherSession.sessionId,
      WEATHER_PRICE,
      WEATHER_PROVIDER.key,
      client.address,
      WEATHER_PROVIDER.address,
      url,
    );
    if (!res) return null;
    allResults.push({
      endpoint: `/weather/${city}`,
      provider: WEATHER_PROVIDER.name,
      cost: WEATHER_PRICE,
      receipt: res.receipt,
      data: res.data,
    });
    return res;
  }

  async function callDefi(endpoint: DefiEndpoint, symbol: string) {
    const cost = DEFI_PRICES[endpoint];
    const url = `http://localhost:${DEFI_PROVIDER.port}/${endpoint}/${symbol}`;
    const res = await batchCall(
      batchMgr,
      defiSession.sessionId,
      cost,
      DEFI_PROVIDER.key,
      client.address,
      DEFI_PROVIDER.address,
      url,
    );
    if (!res) return null;
    allResults.push({
      endpoint: `/${endpoint}/${symbol}`,
      provider: DEFI_PROVIDER.name,
      cost,
      receipt: res.receipt,
      data: res.data,
    });
    return res;
  }

  // The agent's "thought process" — interleaved multi-provider calls
  log(
    "AGENT TASK",
    "Checking weather in Lagos before deciding on DeFi trades...",
  );

  const w1 = await callWeather("lagos");
  if (w1) log("WEATHER", `Lagos: ${w1.data.temp}°C, ${w1.data.condition}`);

  log("AGENT TASK", "Hot day in Lagos — checking token prices...");

  const p1 = await callDefi("price", "BTC");
  if (p1) log("PRICE", `BTC: $${p1.data.priceUsd} (${p1.data.change24h})`);

  const p2 = await callDefi("price", "ETH");
  if (p2) log("PRICE", `ETH: $${p2.data.priceUsd} (${p2.data.change24h})`);

  const p3 = await callDefi("price", "KITE");
  if (p3) log("PRICE", `KITE: $${p3.data.priceUsd} (${p3.data.change24h})`);

  log("AGENT TASK", "BTC looks good — simulating a trade...");

  const s1 = await callDefi("simulate", "BTC");
  if (s1)
    log(
      "TRADE SIM",
      `BUY 100 BTC → ~$${s1.data.estimatedCostUsd}, slippage ${s1.data.slippage}`,
    );

  log("AGENT TASK", "Auditing KITE token before investing...");

  const a1 = await callDefi("audit", "KITE");
  if (a1)
    log(
      "AUDIT",
      `KITE risk: ${a1.data.riskScore}/100 (${a1.data.riskLevel})`,
    );

  log(
    "AGENT TASK",
    "Checking weather in Tokyo and Dubai for travel planning...",
  );

  const w2 = await callWeather("tokyo");
  if (w2) log("WEATHER", `Tokyo: ${w2.data.temp}°C, ${w2.data.condition}`);

  const w3 = await callWeather("dubai");
  if (w3) log("WEATHER", `Dubai: ${w3.data.temp}°C, ${w3.data.condition}`);

  log("AGENT TASK", "Simulating ETH trade and auditing SOL...");

  const s2 = await callDefi("simulate", "ETH");
  if (s2)
    log(
      "TRADE SIM",
      `BUY 100 ETH → ~$${s2.data.estimatedCostUsd}, slippage ${s2.data.slippage}`,
    );

  const a2 = await callDefi("audit", "SOL");
  if (a2)
    log(
      "AUDIT",
      `SOL risk: ${a2.data.riskScore}/100 (${a2.data.riskLevel})`,
    );

  log("AGENT TASK", "Final weather check for Singapore...");

  const w4 = await callWeather("singapore");
  if (w4)
    log(
      "WEATHER",
      `Singapore: ${w4.data.temp}°C, ${w4.data.condition}`,
    );

  const p4 = await callDefi("price", "SOL");
  if (p4) log("PRICE", `SOL: $${p4.data.priceUsd} (${p4.data.change24h})`);

  const s3 = await callDefi("simulate", "SOL");
  if (s3)
    log(
      "TRADE SIM",
      `BUY 100 SOL → ~$${s3.data.estimatedCostUsd}, slippage ${s3.data.slippage}`,
    );

  // ── Phase 5: Settle Both Sessions ──────────────────────────────
  sep("PHASE 5 — Settlement");

  const weatherResult = batchMgr.endSession(
    weatherSession.sessionId,
    "manual",
  );
  const defiResult = batchMgr.endSession(defiSession.sessionId, "manual");

  log("WEATHER SESSION", {
    totalCalls: weatherResult.session.receipts.length,
    totalSpent: `${fmt(weatherResult.session.cumulativeCost)} KTT`,
    deposit: `${fmt(weatherResult.session.deposit)} KTT`,
    refund: `${fmt(weatherResult.refund)} KTT`,
  });

  log("DEFI SESSION", {
    totalCalls: defiResult.session.receipts.length,
    totalSpent: `${fmt(defiResult.session.cumulativeCost)} KTT`,
    deposit: `${fmt(defiResult.session.deposit)} KTT`,
    refund: `${fmt(defiResult.refund)} KTT`,
  });

  // Verify final receipts
  for (const [name, result, providerKey] of [
    ["WEATHER", weatherResult, WEATHER_PROVIDER.key],
    ["DEFI", defiResult, DEFI_PROVIDER.key],
  ] as const) {
    if (result.finalReceipt) {
      const signer = privateKeyToAccount(providerKey as `0x${string}`);
      const valid = await verifyReceipt(result.finalReceipt, signer.address);
      log(`${name} RECEIPT`, {
        nonce: result.finalReceipt.nonce,
        cumulativeCost: `${fmt(result.finalReceipt.cumulativeCost)} KTT`,
        verified: valid,
      });
    }
  }

  // ── Unified Cost Report ────────────────────────────────────────
  console.log("");
  sep("COST REPORT");

  const weatherCalls = weatherResult.session.receipts.length;
  const defiPriceCalls = defiResult.session.receipts.filter(
    (r) => r.callCost === DEFI_PRICES.price,
  ).length;
  const defiSimCalls = defiResult.session.receipts.filter(
    (r) => r.callCost === DEFI_PRICES.simulate,
  ).length;
  const defiAuditCalls = defiResult.session.receipts.filter(
    (r) => r.callCost === DEFI_PRICES.audit,
  ).length;

  const totalSpent =
    weatherResult.session.cumulativeCost +
    defiResult.session.cumulativeCost;
  const totalDeposit = weatherDeposit + defiDeposit;
  const totalRefund = weatherResult.refund + defiResult.refund;

  log("BREAKDOWN", {
    weatherCalls: `${weatherCalls} × ${fmt(WEATHER_PRICE)} = ${fmt(BigInt(weatherCalls) * WEATHER_PRICE)} KTT`,
    defiPriceCalls: `${defiPriceCalls} × ${fmt(DEFI_PRICES.price)} = ${fmt(BigInt(defiPriceCalls) * DEFI_PRICES.price)} KTT`,
    defiSimulateCalls: `${defiSimCalls} × ${fmt(DEFI_PRICES.simulate)} = ${fmt(BigInt(defiSimCalls) * DEFI_PRICES.simulate)} KTT`,
    defiAuditCalls: `${defiAuditCalls} × ${fmt(DEFI_PRICES.audit)} = ${fmt(BigInt(defiAuditCalls) * DEFI_PRICES.audit)} KTT`,
  });

  log("TOTALS", {
    totalCalls: allResults.length,
    totalDeposited: `${fmt(totalDeposit)} KTT`,
    totalSpent: `${fmt(totalSpent)} KTT`,
    totalRefund: `${fmt(totalRefund)} KTT`,
    providers: 2,
    batchSessions: 2,
  });

  // Call timeline
  console.log("");
  log("CALL TIMELINE", "");
  allResults.forEach((r, i) => {
    log(
      `  #${(i + 1).toString().padStart(2, "0")}`,
      `${r.provider.padEnd(20)} ${r.endpoint.padEnd(20)} ${fmt(r.cost).padStart(6)} KTT  (cum: ${fmt(r.receipt.cumulativeCost)} KTT)`,
    );
  });

  // Cleanup
  weatherServer.close();
  defiServer.close();

  console.log("");
  log(
    "DONE",
    "Both providers would settle on-chain with their final receipts",
  );
}

// ── Entry ──────────────────────────────────────────────────────────

run().catch((err) => {
  console.error("  FATAL:", err.message || err);
  process.exit(1);
});
