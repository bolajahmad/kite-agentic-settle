import { Router } from "express";
import {
  approvePayment,
  settlePayment,
  getPaymentHistory,
  getUsageLogsHandler,
  anchorLogsHandler,
  verifyPayment,
  executeDirectPayment,
  getAnchorHandler,
  getAnchorsOverview,
  getAgentAnchors,
  verifyAnchorLeaf,
} from "../controllers/payments";
import { policyEnforcer } from "../middlewares/policy-enforcer";

const router = Router();

router.post("/approve", policyEnforcer, approvePayment);
router.post("/settle", settlePayment);
router.post("/verify", verifyPayment);
router.post("/execute", executeDirectPayment);
router.get("/history", getPaymentHistory);
router.get("/usage", getUsageLogsHandler);
router.post("/anchor", anchorLogsHandler);
router.get("/anchor/overview", getAnchorsOverview);
router.get("/anchor/:index", getAnchorHandler);
router.get("/anchor/agent/:agentId", getAgentAnchors);
router.post("/anchor/verify-leaf", verifyAnchorLeaf);

export default router;