/**
 * Merkle tree utilities for channel receipt audit trails.
 *
 * Each API call within a payment channel produces a leaf:
 *
 *   leaf_i = keccak256(abi.encodePacked(
 *     channelId,        bytes32
 *     sequenceNumber,   uint256
 *     callCost,         uint256   ← cost of THIS call
 *     cumulativeCost,   uint256   ← running total through this call
 *     timestamp,        uint256
 *     keccak256(url),   bytes32   ← which endpoint was called
 *     requestHash,      bytes32   ← hash of request body / params
 *     responseHash,     bytes32   ← hash of response body
 *     providerSig       bytes     ← provider's channel-receipt signature
 *   ))
 *
 * The tree uses sorted-pair hashing, which is the same algorithm
 * AnchorMerkle.sol's verifyLeaf() uses — so any leaf produced here can
 * be verified on-chain without contract changes.
 *
 * The root is submitted to PaymentChannel.initiateSettlement() / finalize()
 * as `merkleRoot`, and separately to AnchorMerkle.anchorRoot() for long-term
 * auditability.
 */

import { encodePacked, keccak256, toHex } from "viem";

// ── Leaf inputs ────────────────────────────────────────────────────────────

export interface MerkleLeafInput {
  channelId: `0x${string}`;
  sequenceNumber: number;
  callCost: bigint;
  cumulativeCost: bigint;
  timestamp: number;
  url: string;
  requestHash: `0x${string}`;
  responseHash: `0x${string}`;
  providerSignature: `0x${string}`;
}

// ── Leaf hash ──────────────────────────────────────────────────────────────

/**
 * Compute the leaf hash for a single call.
 * Must match any on-chain verification logic exactly.
 */
export function computeLeafHash(input: MerkleLeafInput): `0x${string}` {
  const urlHash = keccak256(toHex(input.url));
  return keccak256(
    encodePacked(
      ["bytes32", "uint256", "uint256", "uint256", "uint256", "bytes32", "bytes32", "bytes32", "bytes"],
      [
        input.channelId,
        BigInt(input.sequenceNumber),
        input.callCost,
        input.cumulativeCost,
        BigInt(input.timestamp),
        urlHash,
        input.requestHash,
        input.responseHash,
        input.providerSignature,
      ],
    ),
  );
}

// ── Tree construction ──────────────────────────────────────────────────────

/**
 * Sort-pair hash used at every internal node — matches AnchorMerkle.verifyLeaf.
 */
function hashPair(a: `0x${string}`, b: `0x${string}`): `0x${string}` {
  if (a <= b) {
    return keccak256(encodePacked(["bytes32", "bytes32"], [a, b]));
  }
  return keccak256(encodePacked(["bytes32", "bytes32"], [b, a]));
}

/**
 * Build a Merkle root from an ordered array of leaf hashes.
 * Returns `0x000...000` for an empty array.
 */
export function buildMerkleRoot(leaves: `0x${string}`[]): `0x${string}` {
  if (leaves.length === 0) {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  if (leaves.length === 1) return leaves[0];

  let layer = [...leaves];
  while (layer.length > 1) {
    const next: `0x${string}`[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        next.push(hashPair(layer[i], layer[i + 1]));
      } else {
        // Odd leaf: promote as-is (OpenZeppelin-style)
        next.push(layer[i]);
      }
    }
    layer = next;
  }
  return layer[0];
}

/**
 * Compute a Merkle proof for the leaf at `index` in `leaves`.
 * The proof can be verified on-chain via AnchorMerkle.verifyLeaf().
 */
export function getMerkleProof(
  leaves: `0x${string}`[],
  index: number,
): `0x${string}`[] {
  if (leaves.length === 0 || index >= leaves.length) return [];
  if (leaves.length === 1) return [];

  const proof: `0x${string}`[] = [];
  let layer = [...leaves];
  let idx = index;

  while (layer.length > 1) {
    const next: `0x${string}`[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        next.push(hashPair(layer[i], layer[i + 1]));
        // If our target index is one of this pair, record the sibling
        if (i === idx) proof.push(layer[i + 1]);
        else if (i + 1 === idx) proof.push(layer[i]);
      } else {
        next.push(layer[i]);
      }
    }
    idx = Math.floor(idx / 2);
    layer = next;
  }

  return proof;
}

/**
 * Verify a leaf against a known root using a proof.
 * Replicates AnchorMerkle.verifyLeaf's logic exactly.
 */
export function verifyMerkleProof(
  leaf: `0x${string}`,
  proof: `0x${string}`[],
  root: `0x${string}`,
): boolean {
  let computed = leaf;
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed.toLowerCase() === root.toLowerCase();
}
