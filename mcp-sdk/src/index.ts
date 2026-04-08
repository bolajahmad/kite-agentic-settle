export { KitePaymentClient } from "./client.js";
export type { KiteClientOptions } from "./client.js";

export { ContractService } from "./contracts.js";
export { ChannelManager } from "./channel.js";
export { BatchManager } from "./batch.js";
export type { BatchLimits, BatchEndReason } from "./batch.js";
export { PaymentInterceptor } from "./interceptor.js";
export { UsageTracker } from "./usage.js";

export {
  createKiteWallet,
  generateSeedPhrase,
  isPrivateKey,
  isSeedPhrase,
  deriveAgentAccount,
  deriveSessionAccount,
} from "./wallet.js";
export { computeReceiptHash, signReceipt, createSignedReceipt, verifyReceipt, validateReceipt, RECEIPT_DOMAIN, RECEIPT_TYPES } from "./receipt.js";
export { TOOLS, handleTool } from "./tools.js";
export type { McpToolDefinition } from "./tools.js";

export { KITE_TESTNET } from "./config.js";
export { decide, checkRules, checkCostModel, askLLM } from "./decide.js";
export type { Decision, DecisionMode, DecisionContext, DecisionResult, SessionRules } from "./decide.js";

export { onboardAgent } from "./onboard.js";
export type { OnboardOptions, OnboardResult } from "./onboard.js";

export {
  getAgentsByOwner,
  getAgentById,
  getSessionsByAgent,
  getPaymentsByAgent,
  getRecentPayments,
  getSessionKeyAdded,
} from "./indexer.js";

export {
  getVar,
  setVar,
  deleteVar,
  listVars,
  hasVar,
  getVarsPath,
  getKiteDir,
  resolveVar,
} from "./vars.js";
export {
  paymentChannelAbi,
  agentRegistryAbi,
  kiteAAWalletAbi,
  walletFactoryAbi,
  erc20Abi,
} from "./abis.js";

export type {
  KiteConfig,
  ChannelConfig,
  Receipt,
  BatchSession,
  ChannelState,
  UsageLog,
  PaymentResult,
  PaymentRequest,
  InterceptorOptions,
} from "./types.js";
export { ChannelStatus, PaymentMode } from "./types.js";
