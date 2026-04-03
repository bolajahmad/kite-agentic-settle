import {
  keccak256,
  toBytes,
  toHex,
  verifyTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Receipt } from "./types.js";

// EIP-712 domain for Kite payment receipts
export const RECEIPT_DOMAIN = {
  name: "KitePaymentReceipt",
  version: "1",
  chainId: 2368,
} as const;

// EIP-712 type definition matching the Receipt struct
export const RECEIPT_TYPES = {
  Receipt: [
    { name: "requestHash", type: "bytes32" },
    { name: "responseHash", type: "bytes32" },
    { name: "callCost", type: "uint256" },
    { name: "cumulativeCost", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "timestamp", type: "uint256" },
    { name: "sessionId", type: "bytes32" },
    { name: "provider", type: "string" },
    { name: "consumer", type: "string" },
  ],
} as const;

// Convert a receipt to EIP-712 message values
function receiptToMessage(receipt: Receipt) {
  const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;
  return {
    requestHash: (receipt.requestHash || ZERO_HASH) as `0x${string}`,
    responseHash: (receipt.responseHash || ZERO_HASH) as `0x${string}`,
    callCost: receipt.callCost,
    cumulativeCost: receipt.cumulativeCost,
    nonce: BigInt(receipt.nonce),
    timestamp: BigInt(receipt.timestamp),
    sessionId: receipt.sessionId
      ? keccak256(toBytes(receipt.sessionId))
      : ZERO_HASH,
    provider: receipt.provider,
    consumer: receipt.consumer,
  };
}

// Compute a keccak256 hash of the receipt fields (for quick comparison)
export function computeReceiptHash(receipt: Receipt): `0x${string}` {
  const msg = receiptToMessage(receipt);
  return keccak256(
    toBytes(
      JSON.stringify(msg, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
    )
  );
}

// Sign a receipt using EIP-712 typed data signature
export async function signReceipt(
  privateKey: Uint8Array,
  receipt: Receipt
): Promise<`0x${string}`> {
  const privateKeyHex = `0x${Buffer.from(privateKey).toString("hex")}` as `0x${string}`;
  const account = privateKeyToAccount(privateKeyHex);

  return await account.signTypedData({
    domain: RECEIPT_DOMAIN,
    types: RECEIPT_TYPES,
    primaryType: "Receipt",
    message: receiptToMessage(receipt),
  });
}

// Build a complete receipt object with EIP-712 signature
export async function createSignedReceipt(
  privateKey: Uint8Array,
  params: {
    requestHash?: string;
    responseHash?: string;
    callCost: bigint;
    cumulativeCost: bigint;
    nonce: number;
    timestamp: number;
    sessionId?: string;
    provider: string;
    consumer: string;
  }
): Promise<Receipt> {
  const receipt: Receipt = {
    requestHash: params.requestHash || "",
    responseHash: params.responseHash || "",
    callCost: params.callCost,
    cumulativeCost: params.cumulativeCost,
    nonce: params.nonce,
    timestamp: params.timestamp,
    sessionId: params.sessionId,
    provider: params.provider,
    consumer: params.consumer,
  };

  receipt.signature = await signReceipt(privateKey, receipt);
  return receipt;
}

// Verify a receipt's EIP-712 signature against an expected signer address
export async function verifyReceipt(
  receipt: Receipt,
  expectedSigner: string
): Promise<boolean> {
  if (!receipt.signature) return false;

  const valid = await verifyTypedData({
    address: expectedSigner as `0x${string}`,
    domain: RECEIPT_DOMAIN,
    types: RECEIPT_TYPES,
    primaryType: "Receipt",
    message: receiptToMessage(receipt),
    signature: receipt.signature,
  });

  return valid;
}

// Validate receipt fields against previous receipt and rate
export function validateReceipt(
  receipt: Receipt,
  previousReceipt: Receipt | null,
  ratePerCall: bigint
): { valid: boolean; reason?: string } {
  // Nonce must increment
  if (previousReceipt && receipt.nonce <= previousReceipt.nonce) {
    return { valid: false, reason: "Nonce did not increment" };
  }

  // Cumulative cost must be >= previous
  if (previousReceipt && receipt.cumulativeCost < previousReceipt.cumulativeCost) {
    return { valid: false, reason: "Cumulative cost decreased" };
  }

  // Cost increment should match call cost
  const prevCost = previousReceipt?.cumulativeCost ?? 0n;
  if (receipt.cumulativeCost - prevCost !== receipt.callCost) {
    return { valid: false, reason: "Call cost mismatch with cumulative delta" };
  }

  // Call cost should not exceed rate
  if (receipt.callCost > ratePerCall) {
    return { valid: false, reason: "Call cost exceeds agreed rate" };
  }

  return { valid: true };
}
