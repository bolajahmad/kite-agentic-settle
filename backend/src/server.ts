import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import agentRoutes from "./routes/agent";
import serviceRoutes from "./routes/service";
import paymentRoutes from "./routes/payment";
import walletRoutes from "./routes/wallet";
import registryRoutes from "./routes/registry";
import channelRoutes from "./routes/channel";
import dataRoutes from "./routes/data";
import streamRoutes from "./routes/channel-data.js";
import { errorHandler } from "./middlewares/error-handler";
import { isContractsConfigured, startChannelWatcher } from "./services/contract-service";

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

app.use("/api/agent", agentRoutes);
app.use("/api/service", serviceRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/registry", registryRoutes);
app.use("/api/channel", channelRoutes);

// ─── x402 pay-per-use data API ────────────────────────────────────────
// Routes under /api/data require a valid X-PAYMENT header (kite-programmable
// scheme). The facilitator settles on-chain before the data is returned.
app.use("/api/data", dataRoutes);

// ─── Channel (batch/stream) data API ──────────────────────────────────
// Routes under /api/stream use payment channels.  Step 1 returns a 402 with
// channel metadata; subsequent calls carry X-Channel-Id and accumulate cost
// via provider-signed receipts that anchor to the PaymentChannel contract.
app.use("/api/stream", streamRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startChannelWatcher();
});