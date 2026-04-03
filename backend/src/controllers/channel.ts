import { Request, Response } from "express";
import {
  openChannelOnChain,
  activateChannelOnChain,
  closeChannelOnChain,
  closeChannelEmptyOnChain,
  disputeChannelOnChain,
  resolveDisputeOnChain,
  forceCloseExpiredOnChain,
  getChannelOnChain,
  isChannelExpiredOnChain,
  getChannelTimeRemainingOnChain,
  getReceiptHashOnChain,
  getLockedFundsOnChain,
} from "../services/contract-service.js";

const STATUS_NAMES = ["Open", "Active", "Settling", "Closed", "Disputed"];
const MODE_NAMES = ["Prepaid", "Postpaid"];

function isChannelConfigured(): boolean {
  return !!(process.env.PAYMENT_CHANNEL_ADDRESS && process.env.DEPLOYER_PRIVATE_KEY);
}

export const openChannel = async (req: Request, res: Response) => {
  try {
    const { provider, token, mode, deposit, maxDuration, ratePerCall } = req.body;
    if (!provider || !token || mode === undefined || !maxDuration || !ratePerCall) {
      return res.status(400).json({ error: "provider, token, mode, maxDuration, ratePerCall are required" });
    }
    if (!isChannelConfigured()) {
      return res.status(503).json({ error: "PaymentChannel contract not configured" });
    }

    const result = await openChannelOnChain(
      provider, token, mode, BigInt(deposit || 0), maxDuration, BigInt(ratePerCall)
    );
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const activateChannel = async (req: Request, res: Response) => {
  try {
    const { channelId } = req.body;
    if (!channelId) {
      return res.status(400).json({ error: "channelId is required" });
    }
    if (!isChannelConfigured()) {
      return res.status(503).json({ error: "PaymentChannel contract not configured" });
    }

    const result = await activateChannelOnChain(channelId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const closeChannel = async (req: Request, res: Response) => {
  try {
    const { channelId, sequenceNumber, cumulativeCost, timestamp, providerSignature } = req.body;
    if (!channelId || !providerSignature) {
      return res.status(400).json({ error: "channelId and providerSignature are required" });
    }
    if (!isChannelConfigured()) {
      return res.status(503).json({ error: "PaymentChannel contract not configured" });
    }

    const result = await closeChannelOnChain(
      channelId, sequenceNumber || 0, BigInt(cumulativeCost || 0),
      timestamp || Math.floor(Date.now() / 1000), providerSignature
    );
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const closeChannelEmpty = async (req: Request, res: Response) => {
  try {
    const { channelId } = req.body;
    if (!channelId) {
      return res.status(400).json({ error: "channelId is required" });
    }
    if (!isChannelConfigured()) {
      return res.status(503).json({ error: "PaymentChannel contract not configured" });
    }

    const result = await closeChannelEmptyOnChain(channelId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const disputeChannel = async (req: Request, res: Response) => {
  try {
    const { channelId } = req.body;
    if (!channelId) {
      return res.status(400).json({ error: "channelId is required" });
    }
    if (!isChannelConfigured()) {
      return res.status(503).json({ error: "PaymentChannel contract not configured" });
    }

    const result = await disputeChannelOnChain(channelId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const resolveDispute = async (req: Request, res: Response) => {
  try {
    const { channelId, sequenceNumber, cumulativeCost, timestamp, providerSignature } = req.body;
    if (!channelId || !providerSignature) {
      return res.status(400).json({ error: "channelId and providerSignature are required" });
    }
    if (!isChannelConfigured()) {
      return res.status(503).json({ error: "PaymentChannel contract not configured" });
    }

    const result = await resolveDisputeOnChain(
      channelId, sequenceNumber, BigInt(cumulativeCost), timestamp, providerSignature
    );
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const forceCloseExpired = async (req: Request, res: Response) => {
  try {
    const { channelId } = req.body;
    if (!channelId) {
      return res.status(400).json({ error: "channelId is required" });
    }
    if (!isChannelConfigured()) {
      return res.status(503).json({ error: "PaymentChannel contract not configured" });
    }

    const result = await forceCloseExpiredOnChain(channelId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getChannel = async (req: Request, res: Response) => {
  try {
    const { channelId } = req.params;
    if (!channelId) {
      return res.status(400).json({ error: "channelId is required" });
    }
    if (!isChannelConfigured()) {
      return res.status(503).json({ error: "PaymentChannel contract not configured" });
    }

    const ch = await getChannelOnChain(channelId);
    res.json({
      channelId,
      ...ch,
      statusName: STATUS_NAMES[ch.status] || "Unknown",
      modeName: MODE_NAMES[ch.mode] || "Unknown",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getChannelStatus = async (req: Request, res: Response) => {
  try {
    const { channelId } = req.params;
    if (!isChannelConfigured()) {
      return res.status(503).json({ error: "PaymentChannel contract not configured" });
    }

    const ch = await getChannelOnChain(channelId);
    const expired = await isChannelExpiredOnChain(channelId);
    const remaining = await getChannelTimeRemainingOnChain(channelId);

    res.json({
      channelId,
      status: ch.status,
      statusName: STATUS_NAMES[ch.status] || "Unknown",
      expired,
      timeRemainingSeconds: remaining,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getReceiptHash = async (req: Request, res: Response) => {
  try {
    const { channelId, sequenceNumber, cumulativeCost, timestamp } = req.body;
    if (!channelId || sequenceNumber === undefined || cumulativeCost === undefined || !timestamp) {
      return res.status(400).json({ error: "channelId, sequenceNumber, cumulativeCost, timestamp required" });
    }
    if (!isChannelConfigured()) {
      return res.status(503).json({ error: "PaymentChannel contract not configured" });
    }

    const hash = await getReceiptHashOnChain(channelId, sequenceNumber, BigInt(cumulativeCost), timestamp);
    res.json({ hash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getLockedFunds = async (req: Request, res: Response) => {
  try {
    const { wallet, token } = req.query;
    if (!wallet || !token) {
      return res.status(400).json({ error: "wallet and token query params required" });
    }
    if (!isChannelConfigured()) {
      return res.status(503).json({ error: "PaymentChannel contract not configured" });
    }

    const locked = await getLockedFundsOnChain(wallet as string, token as string);
    res.json({ wallet, token, locked });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
