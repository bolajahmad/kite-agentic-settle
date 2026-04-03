import { Request, Response } from "express";
import {
  isContractsConfigured,
  getAgentFromChain,
  resolveAgentByDomainOnChain,
  resolveAgentByAddressOnChain,
  getAgentBySessionOnChain,
  getOwnerAgentsOnChain,
} from "../services/contract-service.js";

export const resolveByDomain = async (req: Request, res: Response) => {
  try {
    const { domain } = req.params;
    if (!domain) {
      return res.status(400).json({ error: "domain is required" });
    }
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }
    const result = await resolveAgentByDomainOnChain(domain);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const resolveByAddress = async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    if (!address) {
      return res.status(400).json({ error: "address is required" });
    }
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }
    const result = await resolveAgentByAddressOnChain(address);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getAgentOnChain = async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    if (!agentId) {
      return res.status(400).json({ error: "agentId is required" });
    }
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }
    const result = await getAgentFromChain(agentId);
    res.json({ agentId, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getAgentBySession = async (req: Request, res: Response) => {
  try {
    const { sessionKey } = req.params;
    if (!sessionKey) {
      return res.status(400).json({ error: "sessionKey is required" });
    }
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }
    const result = await getAgentBySessionOnChain(sessionKey);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getOwnerAgents = async (req: Request, res: Response) => {
  try {
    const { owner } = req.params;
    if (!owner) {
      return res.status(400).json({ error: "owner address is required" });
    }
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }
    const agentIds = await getOwnerAgentsOnChain(owner);
    res.json({ owner, agentIds });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
