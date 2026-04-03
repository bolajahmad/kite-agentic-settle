/**
 * Payment Simulation — 3 scenarios
 *
 * Scenario 1: x402 per-call payment with decision cascade
 * Scenario 2: Batch session ended by time-limit
 * Scenario 3: Batch session ended by budget exhaustion
 *
 * Uses mock HTTP servers (no real chain calls) to demonstrate
 * the SDK's payment interceptor, batch manager, and decide engine.
 *
 * Usage:
 *   AGENT_1_SEED="around exit canvas umbrella ill suit wide use renew comfort visit cabin" \
 *   AGENT_2_SEED="rain mirror oven when right various speak poem giraffe kid legend kit" \
 *   npx tsx examples/simulate.ts
 */

import http from "node:http";
import { formatUnits, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { KitePaymentClient, KITE_TESTNET } from "../src/index.js";
import type { BatchLimits, BatchEndReason } from "../src/batch.js";
import { loadAgents, getAgent } from "../src/agents.js";
import { decide } from "../src/decide.js";
import type { PaymentRequest, PaymentResult, Receipt } from "../src/types.js";
import { verifyReceipt } from "../src/receipt.js";

// ── Constants ──────────────────────────────────────────────────────

const USER2_ADDR = "0xEf7a2Cc08d80AaBB2fE1e75D90f7bb354BB8289c";
const USER2_KEY = "0xbd88d7931ce6ffc84d45264da93b7b63bf945b339ff14742b9cfcff2ce0c0b72";
const TOKEN = KITE_TESTNET.token;
const PRICE_PER_CALL = parseUnits("0.1", 18); // 0.1 KTT
const MOCK_PORT_X402 = 4200;
const MOCK_PORT_BATCH = 4201;

function fmt(wei: bigint): string {
  return formatUnits(wei, 18);
}

function sep(title: string) {
  console.log("");
  console.log(`${"=".repeat(66)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(66)}`);
}

function log(label: string, data?: any) {
  if (data == undefined) {
    console.log(`  [${label}]`);
  } else {
    const str = typeof data === "object"
      ? JSON.stringify(data, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2)
      : String(data);
    console.log(`  [${label}] ${str}`);
  }
}

// ── Mock x402 Server ───────────────────────────────────────────────

function startMockServer(port: number): Promise<http.Server> {
  const providerAccount = privateKeyToAccount(USER2_KEY as `0x${string}`);

  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const xPayment = req.headers["x-payment"] as string | undefined;
      const xSessionId = req.headers["x-session-id"] as string | undefined;

      // If no payment proof, return 402
      if (!xPayment && !xSessionId) {
        res.writeHead(402, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Payment Required",
          accepts: [{
            scheme: "gokite-aa",
            network: "kite-testnet",
            maxAmountRequired: PRICE_PER_CALL.toString(),
            resource: req.url,
            description: "Weather API - real-time data",
            payTo: USER2_ADDR,
            asset: TOKEN,
            merchantName: "Weather Co.",
          }],
          x402Version: 1,
        }));
        return;
      }

      // Payment proof received — sign a provider receipt and return data
      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const nonce = BigInt(Date.now());

      const providerSig = await providerAccount.signTypedData({
        domain: { name: "KitePaymentReceipt", version: "1", chainId: 2368 },
        types: {
          PaymentReceipt: [
            { name: "txHash", type: "string" },
            { name: "amount", type: "string" },
            { name: "service", type: "string" },
            { name: "provider", type: "address" },
            { name: "timestamp", type: "uint256" },
            { name: "nonce", type: "uint256" },
          ],
        },
        primaryType: "PaymentReceipt",
        message: {
          txHash: xPayment || xSessionId || "batch",
          amount: PRICE_PER_CALL.toString(),
          service: req.url || "/weather",
          provider: USER2_ADDR as `0x${string}`,
          timestamp,
          nonce,
        },
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        location: "Kite City",
        temperature: "24C",
        condition: "Sunny",
        provider: "Weather Co.",
        paymentMethod: xPayment ? "x402" : "batch",
        providerSignature: providerSig,
      }));
    });

    server.listen(port, () => resolve(server));
  });
}

// ── Scenario 1: x402 Per-Call with Decision Cascade ────────────────

async function scenario1() {
  sep("SCENARIO 1: x402 Per-Call Payment with Decision Cascade");

  const agents = loadAgents();
  const agentCfg = getAgent(agents, "agent-1");
  log("AGENT", { id: agentCfg.id, name: agentCfg.name });
  log("RULES", agentCfg.rules);

  const server = await startMockServer(MOCK_PORT_X402);
  const apiUrl = `http://localhost:${MOCK_PORT_X402}/weather/kite-city`;

  const client = await KitePaymentClient.create({
    seedPhrase: agentCfg.seed,
    defaultPaymentMode: "x402",
    walletAddress: agentCfg.wallet,
    agentId: agentCfg.id,
  });

  log("ADDRESS", client.address);
  const balance = await client.getTokenBalance();
  log("BALANCE", `${fmt(balance)} KTT`);

  // Call 1: should auto-approve (price 0.1 < requireApprovalAbove 1.0)
  log("CALL 1", "Expecting auto-approve via rules (0.1 KTT < 1.0 KTT threshold)");

  const req1: PaymentRequest = {
    url: apiUrl,
    price: PRICE_PER_CALL,
    asset: TOKEN,
    payTo: USER2_ADDR,
    scheme: "gokite-aa",
    description: "Weather API",
    merchantName: "Weather Co.",
  };

  const decision1 = await decide({
    request: req1,
    rules: agentCfg.rules,
    balance,
    totalSpentThisSession: 0n,
    callCount: 0,
  }, "auto");

  log("DECISION", { decision: decision1.decision, tier: decision1.tier, reason: decision1.reason });

  // Actually call via interceptor
  let lastResult: PaymentResult | undefined;
  const resp1 = await client.fetch(apiUrl, undefined, {
    onPayment: (r) => { lastResult = r; },
    onPaymentRequired: async () => decision1.decision === "approve",
  });

  if (resp1.status === 200) {
    const body = await resp1.json();
    log("RESPONSE", { status: 200, data: body.location, method: lastResult?.method });
    if (lastResult?.txHash) log("TX", lastResult.txHash);
  } else {
    log("RESPONSE", { status: resp1.status, message: "Payment declined" });
  }

  // Call 2: simulate a high-priced call that trips maxPerCall for agent-2
  log("CALL 2", "Simulate agent-2 with maxPerCall=0.2 KTT receiving a 0.1 KTT request");
  const agent2Cfg = getAgent(agents, "agent-2");

  const decision2 = await decide({
    request: req1,
    rules: agent2Cfg.rules,
    balance,
    totalSpentThisSession: 0n,
    callCount: 0,
  }, "rules");

  log("DECISION", { decision: decision2.decision, tier: decision2.tier, reason: decision2.reason });

  // Call 3: simulate a price that exceeds agent-2's maxPerCall
  const expensiveReq: PaymentRequest = {
    ...req1,
    price: parseUnits("0.3", 18), // 0.3 > agent-2's 0.2 maxPerCall
  };

  const decision3 = await decide({
    request: expensiveReq,
    rules: agent2Cfg.rules,
    balance,
    totalSpentThisSession: 0n,
    callCount: 0,
  }, "rules");

  log("CALL 3", "Price 0.3 KTT exceeds agent-2 maxPerCall 0.2 KTT");
  log("DECISION", { decision: decision3.decision, tier: decision3.tier, reason: decision3.reason });

  server.close();
  log("DONE", "Scenario 1 complete");
}

// ── Scenario 2: Batch Session Ended by Time-Limit ──────────────────

async function scenario2() {
  sep("SCENARIO 2: Batch Session — Time-Limit Expiry");

  const agents = loadAgents();
  const agentCfg = getAgent(agents, "agent-1");
  log("AGENT", { id: agentCfg.id, name: agentCfg.name });

  const client = await KitePaymentClient.create({
    seedPhrase: agentCfg.seed,
    defaultPaymentMode: "batch",
    walletAddress: agentCfg.wallet,
    agentId: agentCfg.id,
  });

  log("ADDRESS", client.address);

  // Start a batch session with a very short time limit (2 seconds)
  const deposit = parseUnits("1", 18); // 1 KTT
  const limits: BatchLimits = {
    maxDurationSeconds: 2, // 2 seconds — we'll trip this
    maxCalls: 100,
    maxDeposit: parseUnits("5", 18),
  };

  const session = client.startBatchSession(USER2_ADDR, deposit, limits);
  log("SESSION STARTED", {
    sessionId: session.sessionId.slice(0, 18) + "...",
    deposit: fmt(deposit) + " KTT",
    timeLimit: "2 seconds",
    maxCalls: 100,
  });

  const batchMgr = client.getBatchManager();
  const keyPair = (client as any).wdkAccount?.keyPair;

  // We'll simulate using the batch manager directly (since fetch would hit network)
  // Make 3 successful calls
  for (let i = 1; i <= 3; i++) {
    const health = batchMgr.checkSessionHealth(session.sessionId, PRICE_PER_CALL);
    if (!health.ok) {
      log(`CALL ${i}`, `BLOCKED — [${health.reason}] ${health.detail}`);
      break;
    }

    // Use a deterministic test key for signing (since wdkAccount.keyPair may not be available directly)
    const receipt = await batchMgr.recordCall(
      session.sessionId,
      PRICE_PER_CALL,
      Buffer.from("e805f6bb7d74d0836f5a4181a7a0e424bbb9efb9b76b6f164823962ba3680eb9", "hex"),
      client.address,
      USER2_ADDR
    );

    log(`CALL ${i}`, {
      nonce: receipt.nonce,
      callCost: fmt(receipt.callCost) + " KTT",
      cumulative: fmt(receipt.cumulativeCost) + " KTT",
      signed: !!receipt.signature,
    });
  }

  // Wait for the time limit to expire
  log("WAITING", "Sleeping 3 seconds to expire the 2s time limit...");
  await new Promise((r) => setTimeout(r, 3000));

  // Try call 4 — should be blocked by time-limit
  const health4 = batchMgr.checkSessionHealth(session.sessionId, PRICE_PER_CALL);
  log("CALL 4", `Health check: ok=${health4.ok}, reason=${health4.reason}`);
  if (!health4.ok) {
    log("BLOCKED", health4.detail);
  }

  // End the session
  const result = batchMgr.endSession(session.sessionId, health4.reason as any || "time-limit");

  log("SESSION ENDED", {
    reason: result.reason,
    totalCalls: result.session.receipts.length,
    totalSpent: fmt(result.session.cumulativeCost) + " KTT",
    refund: fmt(result.refund) + " KTT",
    hasFinalReceipt: !!result.finalReceipt,
  });

  if (result.finalReceipt) {
    log("FINAL RECEIPT", {
      nonce: result.finalReceipt.nonce,
      cumulativeCost: fmt(result.finalReceipt.cumulativeCost) + " KTT",
      provider: result.finalReceipt.provider,
      consumer: result.finalReceipt.consumer,
      signature: result.finalReceipt.signature?.slice(0, 20) + "...",
    });
  }

  log("DONE", "Scenario 2 complete — provider would settle with final receipt on-chain and refund unused deposit");
}

// ── Scenario 3: Batch Session Ended by Budget Exhaustion ───────────

async function scenario3() {
  sep("SCENARIO 3: Batch Session — Budget Exhaustion");

  const agents = loadAgents();
  const agentCfg = getAgent(agents, "agent-2");
  log("AGENT", { id: agentCfg.id, name: agentCfg.name });
  log("BATCH CONFIG", agentCfg.batch);

  const client = await KitePaymentClient.create({
    seedPhrase: agentCfg.seed,
    defaultPaymentMode: "batch",
    walletAddress: agentCfg.wallet,
    agentId: agentCfg.id,
  });

  log("ADDRESS", client.address);

  // Start a batch session with a small deposit (0.35 KTT — fits 3 calls at 0.1 each, not 4)
  const deposit = parseUnits("0.35", 18);
  const limits: BatchLimits = {
    maxDurationSeconds: 600, // 10 minutes — won't trip this
    maxCalls: 50,
    maxDeposit: parseUnits("0.5", 18),
  };

  const session = client.startBatchSession(USER2_ADDR, deposit, limits);
  log("SESSION STARTED", {
    sessionId: session.sessionId.slice(0, 18) + "...",
    deposit: fmt(deposit) + " KTT",
    pricePerCall: fmt(PRICE_PER_CALL) + " KTT",
    maxCallsBeforeBudget: `${Number(deposit / PRICE_PER_CALL)} full calls (3), remainder ${fmt(deposit % PRICE_PER_CALL)} KTT`,
  });

  const batchMgr = client.getBatchManager();

  // Make calls until budget is exhausted
  let callNum = 0;
  let lastReceipt: Receipt | undefined;
  let endReason: BatchEndReason = "manual";

  while (true) {
    callNum++;
    const health = batchMgr.checkSessionHealth(session.sessionId, PRICE_PER_CALL);

    if (!health.ok) {
      log(`CALL ${callNum}`, `BLOCKED — [${health.reason}] ${health.detail}`);
      endReason = health.reason!;
      break;
    }

    const remaining = batchMgr.remainingDeposit(session.sessionId);
    log(`CALL ${callNum}`, `Remaining before call: ${fmt(remaining)} KTT`);

    const receipt = await batchMgr.recordCall(
      session.sessionId,
      PRICE_PER_CALL,
      Buffer.from("bd88d7931ce6ffc84d45264da93b7b63bf945b339ff14742b9cfcff2ce0c0b72", "hex"),
      client.address,
      USER2_ADDR
    );

    lastReceipt = receipt;

    log(`CALL ${callNum}`, {
      nonce: receipt.nonce,
      callCost: fmt(receipt.callCost) + " KTT",
      cumulative: fmt(receipt.cumulativeCost) + " KTT",
      remainingAfter: fmt(batchMgr.remainingDeposit(session.sessionId)) + " KTT",
    });
  }

  // End the session
  const result = batchMgr.endSession(session.sessionId, endReason);

  log("SESSION ENDED", {
    reason: result.reason,
    totalCalls: result.session.receipts.length,
    totalSpent: fmt(result.session.cumulativeCost) + " KTT",
    deposit: fmt(result.session.deposit) + " KTT",
    refund: fmt(result.refund) + " KTT",
  });

  if (result.finalReceipt) {
    log("FINAL RECEIPT", {
      nonce: result.finalReceipt.nonce,
      cumulativeCost: fmt(result.finalReceipt.cumulativeCost) + " KTT",
      signature: result.finalReceipt.signature?.slice(0, 20) + "...",
    });

    // Verify the final receipt signature against the key that actually signed
    const signerAccount = privateKeyToAccount("0xbd88d7931ce6ffc84d45264da93b7b63bf945b339ff14742b9cfcff2ce0c0b72");
    const valid = await verifyReceipt(result.finalReceipt, signerAccount.address);
    log("RECEIPT VERIFIED", valid);
  }

  log("DONE", "Scenario 3 complete — agent hit budget limit, provider settles for actual usage, 0.05 KTT refunded");
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("  Kite Agent Pay — Payment Simulation");
  console.log("  ──────────────────────────────────────────────────────");

  await scenario1();
  await scenario2();
  await scenario3();

  console.log("");
  sep("ALL SCENARIOS COMPLETE");
  console.log("");
}

// Export for programmatic use (e.g., from CLI)
export const runSimulation = main;

// Run directly when invoked as a script
const isDirectRun =
  process.argv[1]?.includes("simulate") ||
  process.argv[1]?.endsWith("simulate.ts");
if (isDirectRun) {
  main().catch((err) => {
    console.error("  FATAL:", err.message || err);
    process.exit(1);
  });
}
