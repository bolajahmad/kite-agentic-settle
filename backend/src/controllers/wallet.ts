import { Request, Response } from "express";
import {
  isContractsConfigured,
  getWalletBalance,
  depositToWallet,
  withdrawFromWallet,
  getSessionRuleFromChain,
  isSessionValidOnChain,
  getDailySpendOnChain,
  getAgentSessionKeysOnChain,
} from "../services/contract-service.js";

const TOKEN_ADDRESS = process.env.TESTNET_TOKEN || "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63";

export const getBalance = async (req: Request, res: Response) => {
  try {
    const token = (req.query.token as string) || TOKEN_ADDRESS;
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }
    const balance = await getWalletBalance(token);
    res.json({ balance, token, walletAddress: process.env.KITE_AA_WALLET_ADDRESS });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const deposit = async (req: Request, res: Response) => {
  try {
    const { amount, token } = req.body;
    if (!amount) {
      return res.status(400).json({ error: "amount is required" });
    }
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }
    const result = await depositToWallet(token || TOKEN_ADDRESS, BigInt(amount));
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const withdraw = async (req: Request, res: Response) => {
  try {
    const { amount, token } = req.body;
    if (!amount) {
      return res.status(400).json({ error: "amount is required" });
    }
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }
    const result = await withdrawFromWallet(token || TOKEN_ADDRESS, BigInt(amount));
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getSessionRules = async (req: Request, res: Response) => {
  try {
    const { sessionKey } = req.params;
    if (!sessionKey) {
      return res.status(400).json({ error: "sessionKey address is required" });
    }
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }
    const rule = await getSessionRuleFromChain(sessionKey);
    const valid = await isSessionValidOnChain(sessionKey);
    const dailySpend = await getDailySpendOnChain(sessionKey);
    res.json({ ...rule, isCurrentlyValid: valid, currentDailySpend: dailySpend });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getAgentSessionKeys = async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    if (!agentId) {
      return res.status(400).json({ error: "agentId is required" });
    }
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }
    const keys = await getAgentSessionKeysOnChain(agentId);
    res.json({ agentId, sessionKeys: keys });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
