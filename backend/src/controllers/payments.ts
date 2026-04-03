import { Request, Response } from "express";
import { approvePayment as mcpApprove, settlePayment as mcpSettle } from "../services/mcp-integration";
import { v4 as uuidv4 } from "uuid";
import { logUsage, getUsageLogs, anchorPendingLogs, getPendingCount } from "../services/usage-aggregator";
import { payments, sessions } from "../store.js";
import {
  isContractsConfigured,
  executePaymentOnChain,
  getSessionRuleFromChain,
  getAnchorOnChain,
  getTotalAnchorsOnChain,
  getAgentAnchorIndicesOnChain,
  verifyLeafOnChain,
} from "../services/contract-service.js";

export const approvePayment = async (req: Request, res: Response) => {
  try {
    const { agentId, serviceId, amount, sessionId } = req.body;
    if (!agentId || !serviceId || !amount) {
      return res.status(400).json({ error: "agentId, serviceId, and amount are required" });
    }

    const session = sessionId ? sessions[sessionId] : undefined;
    const sessionKeyAddress = session?.sessionKeyAddress;

    const approval = await mcpApprove(agentId, serviceId, amount, sessionKeyAddress);
    res.json(approval);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const settlePayment = async (req: Request, res: Response) => {
  try {
    const { authorization, recipient, signature } = req.body;
    if (!authorization || !recipient) {
      return res.status(400).json({ error: "authorization and recipient are required" });
    }

    const result = await mcpSettle(
      process.env.FACILITATOR_URL || "",
      { authorization, recipient, signature }
    );

    const log = {
      id: uuidv4(),
      agentId: authorization.agentId,
      serviceId: authorization.serviceId,
      sessionId: authorization.sessionKey || "unknown",
      amount: authorization.amount,
      timestamp: Date.now(),
      txHash: result.txHash,
    };
    payments.push(log);
    logUsage(log);

    // Update session remaining budget (local tracking)
    if (authorization.sessionKey) {
      for (const session of Object.values(sessions)) {
        if ((session as any).sessionKeyAddress === authorization.sessionKey) {
          (session as any).remainingBudget -= authorization.amount;
          break;
        }
      }
    }

    res.json({ ...result, paymentId: log.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getPaymentHistory = (_req: Request, res: Response) => {
  res.json(payments);
};

export const getUsageLogsHandler = (_req: Request, res: Response) => {
  res.json({ logs: getUsageLogs(), pendingCount: getPendingCount() });
};

export const anchorLogsHandler = async (_req: Request, res: Response) => {
  try {
    const result = await anchorPendingLogs();
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

// ─── x402 Payment Verification (complete the handshake) ──────────────

export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const { sessionKeyAddress, serviceId, amount } = req.body;
    if (!sessionKeyAddress || !amount) {
      return res.status(400).json({ error: "sessionKeyAddress and amount are required" });
    }
    if (!isContractsConfigured()) {
      return res.json({ valid: true, reason: "contracts not configured — skipping on-chain check" });
    }

    const rule = await getSessionRuleFromChain(sessionKeyAddress);
    const errors: string[] = [];

    if (!rule.active) errors.push("Session key is inactive");
    if (BigInt(amount) > BigInt(rule.valueLimit)) errors.push(`Amount exceeds per-tx limit (${rule.valueLimit})`);
    if (rule.validUntil < Math.floor(Date.now() / 1000)) errors.push("Session key has expired");

    if (errors.length > 0) {
      return res.status(402).json({ valid: false, errors });
    }

    res.json({ valid: true, sessionRule: rule });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Direct on-chain payment execution ───────────────────────────────

const TOKEN_ADDRESS = process.env.TESTNET_TOKEN || "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63";

export const executeDirectPayment = async (req: Request, res: Response) => {
  try {
    const { sessionKeyAddress, recipient, amount, token, agentId, serviceId } = req.body;
    if (!sessionKeyAddress || !recipient || !amount) {
      return res.status(400).json({ error: "sessionKeyAddress, recipient, and amount are required" });
    }
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }

    const result = await executePaymentOnChain(
      sessionKeyAddress,
      recipient,
      token || TOKEN_ADDRESS,
      BigInt(amount)
    );

    const log = {
      id: uuidv4(),
      agentId: agentId || "unknown",
      serviceId: serviceId || "direct",
      sessionId: sessionKeyAddress,
      amount: Number(amount),
      timestamp: Date.now(),
      txHash: result.txHash,
    };
    payments.push(log);
    logUsage(log);

    // Update session remaining budget
    for (const session of Object.values(sessions)) {
      if ((session as any).sessionKeyAddress === sessionKeyAddress) {
        (session as any).remainingBudget -= Number(amount);
        break;
      }
    }

    res.json({ success: true, txHash: result.txHash, blockNumber: result.blockNumber, paymentId: log.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Anchor Query ────────────────────────────────────────────────────

export const getAnchorHandler = async (req: Request, res: Response) => {
  try {
    const index = parseInt(req.params.index, 10);
    if (isNaN(index)) {
      return res.status(400).json({ error: "Valid anchor index is required" });
    }
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }
    const anchor = await getAnchorOnChain(index);
    res.json({ index, ...anchor });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getAnchorsOverview = async (_req: Request, res: Response) => {
  try {
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }
    const totalAnchors = await getTotalAnchorsOnChain();
    res.json({ totalAnchors });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getAgentAnchors = async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    if (!agentId) {
      return res.status(400).json({ error: "agentId is required" });
    }
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }
    const indices = await getAgentAnchorIndicesOnChain(agentId);
    res.json({ agentId, anchorIndices: indices });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const verifyAnchorLeaf = async (req: Request, res: Response) => {
  try {
    const { anchorIndex, leaf, proof } = req.body;
    if (anchorIndex === undefined || !leaf || !proof) {
      return res.status(400).json({ error: "anchorIndex, leaf, and proof are required" });
    }
    if (!isContractsConfigured()) {
      return res.status(503).json({ error: "Contracts not configured" });
    }
    const result = await verifyLeafOnChain(anchorIndex, leaf, proof);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};