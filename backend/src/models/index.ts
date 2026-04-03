export interface Agent {
  id: string;
  walletAddress: string;
  metadata?: Record<string, any>;
  sessions: string[];
}

export interface Session {
  id: string;
  agentId: string;
  maxBudget: number; // in wei
  perTransactionLimit: number;
  allowedServices: string[];
  remainingBudget: number;
  sessionKeyAddress?: string;
  validUntil?: number;
}

export interface Service {
  id: string;
  name: string;
  url: string;
  pricePerCall: number; // in wei
  dynamicPricingRules?: any;
}

export interface PaymentLog {
  id: string;
  agentId: string;
  serviceId: string;
  sessionId: string;
  amount: number;
  timestamp: number;
  txHash?: string;
}