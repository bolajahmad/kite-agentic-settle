import {
  executeTransferWithAuthorizationOnChain,
  isVaultNonceUsedOnChain,
  validateSessionOnChain,
} from "./contract-service.js";
import { ethers } from "ethers";

// ─── Types ────────────────────────────────────────────────────────────

export interface X402PaymentPayload {
  scheme: "kite-programmable";
  version: string;
  chainId: number;
  walletContract: string;
  sessionId: string;
  agentId: string;
  sessionKey: string;
  auth: {
    from: string;
    to: string;
    token: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
  /** Full ECDSA signature (65-byte hex, from signTypedData) */
  signature: `0x${string}`;
  /** Legacy nested authorization shape (also supported) */
  authorization?: {
    message: {
      sessionKey: string;
      recipient: string;
      token: string;
      amount: bigint | string;
      nonce: bigint | string;
      deadline: bigint | string;
      walletContract?: string;
      sessionId?: string;
      validAfter?: bigint | string;
    };
    signature: `0x${string}`;
  };
}

export interface SettlementResult {
  txHash: string;
  blockNumber: number;
  sessionKey: string;
  recipient: string;
  amount: bigint;
}

// ─── Decode X-PAYMENT header ──────────────────────────────────────────

export function decodeX402Header(header: string): X402PaymentPayload {
  let raw: string;
  try {
    raw = Buffer.from(header, "base64").toString("utf8");
  } catch {
    throw new Error("X-PAYMENT header is not valid base64");
  }

  let payload: X402PaymentPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("X-PAYMENT header is not valid JSON after base64 decode");
  }

  if (payload.scheme !== "kite-programmable") {
    throw new Error(
      `Unsupported payment scheme: ${payload.scheme}. Expected kite-programmable`,
    );
  }

  // Normalize legacy nested payload (version 1).
  if (!payload.auth && payload.authorization?.message) {
    const msg = payload.authorization.message;
    payload.sessionKey = msg.sessionKey;
    payload.walletContract = msg.walletContract ?? payload.walletContract;
    payload.sessionId = msg.sessionId ?? payload.sessionId;
    payload.auth = {
      from: msg.walletContract ?? payload.walletContract ?? ethers.ZeroAddress,
      to: msg.recipient,
      token: msg.token,
      value: String(msg.amount),
      validAfter: String(msg.validAfter ?? 0),
      validBefore: String(msg.deadline),
      nonce: String(msg.nonce),
    };
  }
  if (!payload.signature && payload.authorization?.signature) {
    payload.signature = payload.authorization.signature;
  }

  if (!payload.walletContract || !payload.sessionId || !payload.auth) {
    throw new Error(
      "Invalid X-PAYMENT payload: walletContract, sessionId, and auth are required",
    );
  }

  return payload;
}

// ─── Validate (pre-settlement) ────────────────────────────────────────

export async function validatePaymentPayload(
  payload: X402PaymentPayload,
  expectedRecipient: string,
  expectedToken: string,
  expectedMinAmount: bigint,
): Promise<void> {
  const amount = BigInt(payload.auth.value);
  const validAfter = BigInt(payload.auth.validAfter);
  const validBefore = BigInt(payload.auth.validBefore);

  // Time window check
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (nowSec < validAfter) {
    throw new Error(
      `Payment signature not yet valid at ${nowSec} (validAfter=${validAfter})`,
    );
  }
  if (validBefore < nowSec) {
    throw new Error(
      `Payment signature expired at ${validBefore} (now ${nowSec})`,
    );
  }

  // Amount check — reject before touching the chain
  if (amount < expectedMinAmount) {
    throw new Error(
      `Insufficient payment: sent ${amount} base units but ${expectedMinAmount} required`,
    );
  }

  // Recipient check (case-insensitive)
  if (payload.auth.to.toLowerCase() !== expectedRecipient.toLowerCase()) {
    throw new Error(
      `Payment recipient ${payload.auth.to} does not match expected ${expectedRecipient}`,
    );
  }

  // Token check
  if (payload.auth.token.toLowerCase() !== expectedToken.toLowerCase()) {
    throw new Error(
      `Payment token ${payload.auth.token} does not match expected ${expectedToken}`,
    );
  }

  if (payload.auth.from.toLowerCase() !== payload.walletContract.toLowerCase()) {
    throw new Error(
      `auth.from ${payload.auth.from} must equal walletContract ${payload.walletContract}`,
    );
  }

  // IdentityRegistry session checks
  const session = await validateSessionOnChain(payload.sessionKey);
  if (!session.active) {
    throw new Error(`Session ${payload.sessionKey} is not active`);
  }
  if (
    session.walletContract.toLowerCase() !== payload.walletContract.toLowerCase()
  ) {
    throw new Error(
      `Session wallet mismatch: payload=${payload.walletContract}, onchain=${session.walletContract}`,
    );
  }
  if (session.validUntil < nowSec) {
    throw new Error(
      `Session ${payload.sessionKey} expired at ${session.validUntil.toString()}`,
    );
  }
  if (BigInt(payload.agentId) !== session.agentId) {
    throw new Error(
      `AgentId mismatch: payload=${payload.agentId}, onchain=${session.agentId.toString()}`,
    );
  }

  const derivedSessionId = ethers.solidityPackedKeccak256(
    ["address", "uint256", "uint256"],
    [payload.sessionKey, session.agentId, session.validUntil],
  );
  if (derivedSessionId.toLowerCase() !== payload.sessionId.toLowerCase()) {
    throw new Error(
      `SessionId mismatch: payload=${payload.sessionId}, derived=${derivedSessionId}`,
    );
  }

  // On-chain nonce check — reject replay before touching the chain.
  const nonceUsed = await isVaultNonceUsedOnChain(
    payload.walletContract,
    payload.auth.nonce,
  );
  if (nonceUsed) {
    throw new Error(`Nonce ${payload.auth.nonce} has already been used`);
  }
}

// ─── Settle on-chain ─────────────────────────────────────────────────

export async function settleX402Payment(
  payload: X402PaymentPayload,
): Promise<SettlementResult> {
  // Support flat signature (from interceptor) or nested authorization shape
  const sig: `0x${string}` =
    payload.signature ?? payload.authorization?.signature;
  if (!sig) throw new Error("No signature found in X-PAYMENT payload");

  const amount = BigInt(payload.auth.value);

  const result = await executeTransferWithAuthorizationOnChain(
    payload.walletContract,
    payload.sessionId,
    {
      from: payload.auth.from,
      to: payload.auth.to,
      token: payload.auth.token,
      value: amount,
      validAfter: BigInt(payload.auth.validAfter),
      validBefore: BigInt(payload.auth.validBefore),
      nonce: payload.auth.nonce,
    },
    sig,
    "0x",
  );

  return {
    txHash: result.txHash,
    blockNumber: result.blockNumber,
    sessionKey: payload.sessionKey,
    recipient: payload.auth.to,
    amount,
  };
}

// ─── Combined: decode → validate → settle ────────────────────────────

export async function processX402Payment(
  xPaymentHeader: string,
  expectedRecipient: string,
  expectedToken: string,
  expectedMinAmount: bigint,
): Promise<SettlementResult> {
  const payload = decodeX402Header(xPaymentHeader);
  console.log({ payload });
  await validatePaymentPayload(
    payload,
    expectedRecipient,
    expectedToken,
    expectedMinAmount,
  );
  return settleX402Payment(payload);
}
