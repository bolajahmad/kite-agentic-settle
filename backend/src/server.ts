import bodyParser from "body-parser";
import cors from "cors";
import "dotenv/config";
import express from "express";
import { errorHandler } from "./middlewares/error-handler";
import streamRoutes from "./routes/channel-data.js";
import dataRoutes from "./routes/data";
import flexRoutes from "./routes/flex-data.js";
import {
  isContractsConfigured,
  startChannelWatcher,
  startSettlementWatcher,
} from "./services/contract-service";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: Date.now(),
    contractsConfigured: isContractsConfigured(),
    env: {
      agentRegistry: !!process.env.AGENT_REGISTRY_ADDRESS,
      aaWallet: !!process.env.KITE_AA_WALLET_ADDRESS,
      anchorMerkle: !!process.env.ANCHOR_MERKLE_ADDRESS,
      paymentChannel: !!process.env.PAYMENT_CHANNEL_ADDRESS,
      deployer: !!process.env.DEPLOYER_PRIVATE_KEY,
    },
  });
});

// ─── x402 pay-per-use data API ────────────────────────────────────────
// Routes under /api/data require a valid X-PAYMENT header (kite-programmable
// scheme). The facilitator settles on-chain before the data is returned.
app.use("/api/data", dataRoutes);

// ─── Channel (batch/stream) data API ──────────────────────────────────
// Routes under /api/stream use payment channels.  Step 1 returns a 402 with
// channel metadata; subsequent calls carry X-Channel-Id and accumulate cost
// via provider-signed receipts that anchor to the PaymentChannel contract.
app.use("/api/stream", streamRoutes);

// ─── Flex (dual-mode) data API ─────────────────────────────────────────
// Routes under /api/flex accept EITHER x402 (per-call) OR channel payment.
// The consumer picks the mode; the combined 402 challenge advertises both.
app.use("/api/flex", flexRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startChannelWatcher();
  startSettlementWatcher();
});
