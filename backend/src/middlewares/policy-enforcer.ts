import { Request, Response, NextFunction } from "express";
import { sessions } from "../store.js";

export const policyEnforcer = (req: Request, res: Response, next: NextFunction) => {
  const sessionId = req.headers["x-session-id"] as string;
  if (!sessionId || !sessions[sessionId]) {
    return res.status(403).json({ error: "Invalid session" });
  }

  const session = sessions[sessionId];
  const amount = req.body.amount || 0;

  if (amount > session.perTransactionLimit) {
    return res.status(402).json({ error: "Exceeds per-transaction limit" });
  }
  if (amount > session.remainingBudget) {
    return res.status(402).json({ error: "Insufficient session budget" });
  }

  next();
};