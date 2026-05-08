// ── Primary entry point ────────────────────────────────────────────
// Import KiteSettleClient for all new consumer and provider code.
export { KiteSettleClient } from "./kite-settle-client.js";
export type { KiteSettleClientOptions } from "./kite-settle-client.js";

export type { BatchEndReason, BatchLimits } from "./batch.js";

export {
  computeReceiptHash,
  createSignedReceipt,
  RECEIPT_DOMAIN,
  RECEIPT_TYPES,
  signReceipt,
  validateReceipt,
  verifyReceipt,
} from "./receipt.js";
export {
  createKiteWallet,
  deriveAgentAccount,
  deriveSessionAccount,
  generateSeedPhrase,
  isPrivateKey,
  isSeedPhrase,
} from "./wallet.js";

export { KITE_TESTNET } from "./config.js";
export { askLLM, checkCostModel, checkRules, decide } from "./decide.js";
export type {
  Decision,
  DecisionContext,
  DecisionMode,
  DecisionResult,
  SessionRules,
} from "./decide.js";

export { onboardAgent } from "./onboard.js";
export type { OnboardOptions, OnboardResult } from "./onboard.js";

export {
  getAgentById,
  getAgentsByOwner,
  getPaymentsByAgent,
  getRecentPayments,
  getSessionKeyAdded,
  getSessionsByAgent,
} from "./indexer.js";

export {
  erc20Abi,
  kiteAAWalletAbi,
  paymentChannelAbi,
  walletFactoryAbi,
} from "./abis.js";
export {
  deleteVar,
  getKiteDir,
  getVar,
  getVarsPath,
  hasVar,
  listVars,
  resolveVar,
  setVar,
} from "./vars.js";

export { ChannelStatus, PaymentMode } from "./types.js";
export type {
  BatchSession,
  ChannelConfig,
  ChannelState,
  InterceptorOptions,
  KiteConfig,
  PaymentRequest,
  PaymentResult,
  Receipt,
  UsageLog,
} from "./types.js";
