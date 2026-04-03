import { Router } from "express";
import {
  resolveByDomain,
  resolveByAddress,
  getAgentOnChain,
  getAgentBySession,
  getOwnerAgents,
} from "../controllers/registry.js";

const router = Router();

router.get("/resolve/domain/:domain", resolveByDomain);
router.get("/resolve/address/:address", resolveByAddress);
router.get("/agent/:agentId", getAgentOnChain);
router.get("/session/:sessionKey", getAgentBySession);
router.get("/owner/:owner", getOwnerAgents);

export default router;
