export interface KiteConfig {
  rpcUrl: string;
  chainId: number;
  contracts: {
    agentRegistry: string;
    kiteAAWallet: string;
    anchorMerkle: string;
    paymentChannel: string;
    walletFactory?: string;
  };
  token: string;
}

export interface ChannelConfig {
  provider: string;
  token?: string;
  mode: "prepaid" | "postpaid";
  deposit: bigint;
  maxSpend: bigint;
  maxDuration: number;
  ratePerCall: bigint;
}

export interface Receipt {
  requestHash: string;
  responseHash: string;
  callCost: bigint;
  cumulativeCost: bigint;
  nonce: number;
  timestamp: number;
  sessionId?: string;
  provider: string;
  consumer: string;
  signature?: `0x${string}`;
}

export interface BatchSession {
  sessionId: string;
  consumer: string;
  provider: string;
  deposit: bigint;
  cumulativeCost: bigint;
  nonce: number;
  receipts: Receipt[];
  createdAt: number;
}

export interface ChannelState {
  channelId: `0x${string}`;
  consumer: string;
  provider: string;
  token: string;
  mode: number;
  deposit: bigint;
  maxSpend: bigint;
  maxDuration: number;
  openedAt: number;
  expiresAt: number;
  ratePerCall: bigint;
  settledAmount: bigint;
  status: number;
  settlementDeadline: number;
  highestClaimedCost: bigint;
  highestSequenceNumber: number;
}

export enum ChannelStatus {
  Open = 0,
  Active = 1,
  SettlementPending = 2,
  Closed = 3,
}

export enum PaymentMode {
  Prepaid = 0,
  Postpaid = 1,
}

export interface UsageLog {
  agentId: string;
  serviceUrl: string;
  method: string;
  amount: bigint;
  timestamp: number;
  channelId?: string;
  receiptSequence?: number;
  txHash?: string;
}

export interface PaymentResult {
  success: boolean;
  method: "perCall" | "channel" | "batch";
  /** tx hash — only present when the agent self-executed (legacy path) */
  txHash?: string;
  /**
   * Base64-encoded x402 programmable-settlement payload.
   * Present for perCall payments made via KiteAAWallet session key.
   * The facilitator (provider backend) decodes this and calls
   * KiteAAWallet.executePaymentBySig(...) to settle on-chain.
   */
  x402Payload?: string;
  receipt?: Receipt;
  amount: bigint;
}

export interface PaymentRequest {
  url: string;
  price: number;
  asset: string;
  payTo: string;
  scheme: string;
  description?: string;
  merchantName?: string;
}

export interface InterceptorOptions {
  paymentMode?: "perCall" | "channel" | "batch" | "session" | "auto";
  channelId?: `0x${string}`;
  maxPaymentPerCall?: bigint;
  walletAddress?: string;
  sessionKey?: string;
  autoPayEnabled?: boolean;
  onPaymentRequired?: (request: PaymentRequest) => Promise<boolean>;
  onPayment?: (result: PaymentResult) => void;
  onError?: (error: Error) => void;
}
