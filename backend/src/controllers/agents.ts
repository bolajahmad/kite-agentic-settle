import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { agents, sessions } from "../store.js";
import {
  isContractsConfigured,
  registerAgentOnChain,
  addSessionKeyRuleOnChain,
  registerSessionOnChain,
  generateSessionKey,
  revokeSessionKeyOnChain,
} from "../services/contract-service.js";

export const registerAgent = async (req: Request, res: Response) => {
  try {
    const { walletAddress, metadata, agentDomain } = req.body;
    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required" });
    }

    const id = uuidv4();
    const agent = { id, walletAddress, metadata, sessions: [] as string[] };

    // Register on-chain if contracts are deployed
    let onChainTx: string | undefined;
    if (isContractsConfigured()) {
      const result = await registerAgentOnChain(
        id,
        agentDomain || `agent.${id}.kite`,
        walletAddress,
        process.env.KITE_AA_WALLET_ADDRESS!
      );
      onChainTx = result.txHash;
    }

    agents[id] = agent;
    res.json({ ...agent, onChainTx });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const createSession = async (req: Request, res: Response) => {
  try {
    const { agentId, maxBudget, perTransactionLimit, allowedServices, durationSeconds } = req.body;
    if (!agents[agentId]) {
      return res.status(404).json({ error: "Agent not found" });
    }
    if (!maxBudget || !perTransactionLimit) {
      return res.status(400).json({ error: "maxBudget and perTransactionLimit are required" });
    }

    const id = uuidv4();
    const validUntil = Math.floor(Date.now() / 1000) + (durationSeconds || 86400); // default 24h
    const sessionKey = generateSessionKey();

    const session = {
      id,
      agentId,
      maxBudget,
      perTransactionLimit,
      allowedServices: allowedServices || [],
      remainingBudget: maxBudget,
      sessionKeyAddress: sessionKey.address,
      validUntil,
    };

    // Register session key on-chain
    let onChainTxs: string[] = [];
    if (isContractsConfigured()) {
      // 1. Add session key rule on KiteAAWallet
      const walletResult = await addSessionKeyRuleOnChain(
        sessionKey.address,
        agentId,
        BigInt(perTransactionLimit),
        BigInt(maxBudget),
        validUntil,
        [] // no recipient restriction for PoC
      );
      onChainTxs.push(walletResult.txHash);

      // 2. Register session on AgentRegistry
      const registryResult = await registerSessionOnChain(
        agentId,
        sessionKey.address,
        validUntil
      );
      onChainTxs.push(registryResult.txHash);
    }

    sessions[id] = session;
    agents[agentId].sessions.push(id);

    res.json({
      ...session,
      sessionKeyPrivateKey: sessionKey.privateKey, // PoC only — in prod, returned only to agent
      onChainTxs,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getSessions = (req: Request, res: Response) => {
  const sessionId = req.params.id;
  if (!sessions[sessionId]) {
    return res.status(404).json({ error: "Session not found" });
  }
  res.json(sessions[sessionId]);
};

export const listAgents = (_req: Request, res: Response) => {
  res.json(Object.values(agents));
};

export const revokeSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const session = sessions[sessionId];
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    let onChainTx: string | undefined;
    if (isContractsConfigured() && session.sessionKeyAddress) {
      const result = await revokeSessionKeyOnChain(session.sessionKeyAddress);
      onChainTx = result.txHash;
    }

    delete sessions[sessionId];
    const agent = agents[session.agentId];
    if (agent) {
      agent.sessions = agent.sessions.filter((s: string) => s !== sessionId);
    }

    res.json({ revoked: true, sessionId, onChainTx });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getAgentById = (req: Request, res: Response) => {
  const { id } = req.params;
  const agent = agents[id];
  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }
  res.json(agent);
};

export const getAgentSessions = (req: Request, res: Response) => {
  const { id } = req.params;
  const agent = agents[id];
  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }
  const agentSessions = agent.sessions.map((sid: string) => sessions[sid]).filter(Boolean);
  res.json(agentSessions);
};