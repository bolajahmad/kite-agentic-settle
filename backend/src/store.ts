import type { Agent, Session, PaymentLog } from "./models/index.js";

export const agents: Record<string, Agent> = {};
export const sessions: Record<string, Session> = {};
export const payments: PaymentLog[] = [];
