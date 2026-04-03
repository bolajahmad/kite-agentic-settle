import { Router } from "express";
import { registerAgent, createSession, getSessions, listAgents, revokeSession, getAgentById, getAgentSessions } from "../controllers/agents";

const router = Router();

router.get("/list", listAgents);
router.get("/:id", getAgentById);
router.get("/:id/sessions", getAgentSessions);
router.post("/register", registerAgent);
router.post("/session/create", createSession);
router.get("/session/:id", getSessions);
router.delete("/session/:sessionId", revokeSession);

export default router;