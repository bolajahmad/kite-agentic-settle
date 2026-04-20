import { ethers } from "ethers";
import {
  executePaymentBySigOnChain,
  getPaymentNonceFromChain,
} from "./contract-service.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface X402PaymentPayload {
  scheme: "kite-programmable";
  version: string;
  chainId: number;
  settlementContract?: string;
  sessionKey: string;
  recipient: string;
  token: string;
  amount: string;
  nonce: string;
  deadline: string;
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
      `Unsupported payment scheme: ${payload.scheme}. Expected kite-programmable`
    );
  }

  // Normalize: if flat fields are missing, extract from nested authorization.message
  if (!payload.sessionKey && payload.authorization?.message) {
    const msg = payload.authorization.message;
    payload.sessionKey = msg.sessionKey;
    payload.recipient = msg.recipient;
    payload.token = msg.token;
    payload.amount = String(msg.amount);
    payload.nonce = String(msg.nonce);
    payload.deadline = String(msg.deadline);
  }
  if (!payload.signature && payload.authorization?.signature) {
    payload.signature = payload.authorization.signature;
  }

  return payload;
}

// ─── Validate (pre-settlement) ────────────────────────────────────────

export async function validatePaymentPayload(
  payload: X402PaymentPayload,
  expectedRecipient: string,
  expectedToken: string,
  expectedMinAmount: bigint
): Promise<void> {
  const amount = BigInt(payload.amount);
  const deadline = BigInt(payload.deadline);

  // Deadline check
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (deadline < nowSec) {
    throw new Error(`Payment signature expired at ${deadline} (now ${nowSec})`);
  }

  // Amount check — reject before touching the chain
  if (amount < expectedMinAmount) {
    throw new Error(
      `Insufficient payment: sent ${amount} base units but ${expectedMinAmount} required`
    );
  }

  // Recipient check (case-insensitive)
  if (payload.recipient.toLowerCase() !== expectedRecipient.toLowerCase()) {
    throw new Error(
      `Payment recipient ${payload.recipient} does not match expected ${expectedRecipient}`
    );
  }

  // Token check
  if (payload.token.toLowerCase() !== expectedToken.toLowerCase()) {
    throw new Error(
      `Payment token ${payload.token} does not match expected ${expectedToken}`
    );
  }

  // On-chain nonce check — reject replays before touching the chain
  const onChainNonce = await getPaymentNonceFromChain(payload.sessionKey);
  const payloadNonce = BigInt(payload.nonce);
  if (payloadNonce !== onChainNonce) {
    throw new Error(
      `Nonce mismatch: payload has ${payloadNonce}, contract expects ${onChainNonce}`
    );
  }
}

// ─── Settle on-chain ─────────────────────────────────────────────────

export async function settleX402Payment(
  payload: X402PaymentPayload
): Promise<SettlementResult> {
  // Support flat signature (from interceptor) or nested authorization shape
  const sig: `0x${string}` =
    payload.signature ?? payload.authorization?.signature;
  if (!sig) throw new Error("No signature found in X-PAYMENT payload");

  // Split the 65-byte signature into v, r, s
  const sigBytes = ethers.getBytes(sig);
  if (sigBytes.length !== 65) {
    throw new Error(`Invalid signature length: expected 65 bytes, got ${sigBytes.length}`);
  }
  const r = ethers.hexlify(sigBytes.slice(0, 32));
  const s = ethers.hexlify(sigBytes.slice(32, 64));
  const v = sigBytes[64];

  const amount = BigInt(payload.amount);
  const nonce = BigInt(payload.nonce);
  const deadline = BigInt(payload.deadline);

  const result = await executePaymentBySigOnChain(
    payload.sessionKey,
    payload.recipient,
    payload.token,
    amount,
    nonce,
    deadline,
    v,
    r,
    s
  );

  return {
    txHash: result.txHash,
    blockNumber: result.blockNumber,
    sessionKey: payload.sessionKey,
    recipient: payload.recipient,
    amount,
  };
}

// ─── Combined: decode → validate → settle ────────────────────────────

export async function processX402Payment(
  xPaymentHeader: string,
  expectedRecipient: string,
  expectedToken: string,
  expectedMinAmount: bigint
): Promise<SettlementResult> {
  const payload = decodeX402Header(xPaymentHeader);
  await validatePaymentPayload(
    payload,
    expectedRecipient,
    expectedToken,
    expectedMinAmount
  );
  return settleX402Payment(payload);
}
