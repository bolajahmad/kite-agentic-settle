import { Router } from "express";
import {
  getBalance,
  deposit,
  withdraw,
  getSessionRules,
  getAgentSessionKeys,
} from "../controllers/wallet.js";

const router = Router();

router.get("/balance", getBalance);
router.post("/deposit", deposit);
router.post("/withdraw", withdraw);
router.get("/session-rules/:sessionKey", getSessionRules);
router.get("/session-keys/:agentId", getAgentSessionKeys);

export default router;
