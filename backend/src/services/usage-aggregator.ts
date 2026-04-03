import { ethers } from "ethers";
import type { PaymentLog } from "../models/index.js";
import { anchorMerkleRoot, isContractsConfigured } from "./contract-service.js";

let usageLogs: PaymentLog[] = [];
let pendingLogs: PaymentLog[] = [];

const ANCHOR_BATCH_SIZE = Number(process.env.ANCHOR_BATCH_SIZE) || 10;

export const logUsage = (payment: PaymentLog) => {
  usageLogs.push(payment);
  pendingLogs.push(payment);

  // Auto-anchor when batch size is reached
  if (pendingLogs.length >= ANCHOR_BATCH_SIZE) {
    anchorPendingLogs().catch((err) =>
      console.error("Auto-anchor failed:", err.message)
    );
  }
};

export const getUsageLogs = () => usageLogs;
export const getPendingCount = () => pendingLogs.length;

// ─── Merkle Tree ──────────────────────────────────────────────────────

function hashLeaf(log: PaymentLog): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "string", "string", "uint256", "uint256"],
      [log.agentId, log.serviceId, log.sessionId, log.amount, log.timestamp]
    )
  );
}

function buildMerkleTree(leaves: string[]): { root: string; layers: string[][] } {
  if (leaves.length === 0) {
    return { root: ethers.ZeroHash, layers: [] };
  }

  // Sort leaves for deterministic tree
  let currentLayer = [...leaves].sort();
  const layers: string[][] = [currentLayer];

  while (currentLayer.length > 1) {
    const nextLayer: string[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      if (i + 1 < currentLayer.length) {
        const [a, b] =
          currentLayer[i] <= currentLayer[i + 1]
            ? [currentLayer[i], currentLayer[i + 1]]
            : [currentLayer[i + 1], currentLayer[i]];
        nextLayer.push(ethers.keccak256(ethers.concat([a, b])));
      } else {
        nextLayer.push(currentLayer[i]); // odd element promoted
      }
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  return { root: currentLayer[0], layers };
}

export function getProof(layers: string[][], leafIndex: number): string[] {
  const proof: string[] = [];
  let idx = leafIndex;

  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i];
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (siblingIdx < layer.length) {
      proof.push(layer[siblingIdx]);
    }
    idx = Math.floor(idx / 2);
  }

  return proof;
}

// ─── Anchor Operations ────────────────────────────────────────────────

export async function anchorPendingLogs(): Promise<{
  root: string;
  logCount: number;
  txHash?: string;
  onChain: boolean;
}> {
  if (pendingLogs.length === 0) {
    throw new Error("No pending logs to anchor");
  }

  const batch = [...pendingLogs];
  const leaves = batch.map(hashLeaf);
  const { root } = buildMerkleTree(leaves);
  const agentIds = [...new Set(batch.map((l) => l.agentId))];

  const metadata = JSON.stringify({
    batchSize: batch.length,
    firstTimestamp: batch[0].timestamp,
    lastTimestamp: batch[batch.length - 1].timestamp,
  });

  let txHash: string | undefined;
  let onChain = false;

  if (isContractsConfigured()) {
    const result = await anchorMerkleRoot(root, batch.length, metadata, agentIds);
    txHash = result.txHash;
    onChain = true;
  }

  // Clear pending after successful anchor
  pendingLogs = [];

  return { root, logCount: batch.length, txHash, onChain };
}

export function buildMerkleTreeFromLogs(logs: PaymentLog[]) {
  const leaves = logs.map(hashLeaf);
  return buildMerkleTree(leaves);
}

export { hashLeaf };