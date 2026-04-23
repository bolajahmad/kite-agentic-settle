/**
 * Per-channel persistent store.
 *
 * Each channel gets its own JSON file at:
 *   ~/.kite-agent-pay/channels/<channelId>.json
 *
 * This stores the full audit trail — all provider-signed receipts,
 * EIP-712 audit receipts, Merkle leaves, and the running root — so
 * the consumer can settle and anchor at any time without contacting
 * the provider again.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeLeafHash, buildMerkleRoot, type MerkleLeafInput } from "./merkle.js";
import { getKiteDir } from "./vars.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** Minimal settlement receipt returned per call by the provider. */
export interface ChannelCallReceipt {
  channelId: `0x${string}`;
  sequenceNumber: number;
  /** Cost of this specific call (token base units as decimal string). */
  callCost: string;
  /** Running total through this call (token base units as decimal string). */
  cumulativeCost: string;
  timestamp: number;
  /** Provider's raw signature: keccak256(abi.encodePacked(channelId, seq, cumCost, ts)) */
  providerSignature: `0x${string}`;
}

/** Richer EIP-712 audit receipt returned alongside the settlement receipt. */
export interface AuditReceipt {
  url: string;
  requestHash: `0x${string}`;
  responseHash: `0x${string}`;
  /** EIP-712 provider signature over the full Receipt struct. */
  providerEIP712Signature: `0x${string}`;
}

/** Combined record stored for each call. */
export interface StoredCallRecord {
  channelReceipt: ChannelCallReceipt;
  auditReceipt: AuditReceipt;
  /** Precomputed leaf hash for this call. */
  leafHash: `0x${string}`;
}

/** Full stored channel state. */
export interface StoredChannel {
  channelId: `0x${string}`;
  provider: `0x${string}`;
  token: string;
  /** Initial endpoint used when opening the channel (for display only). */
  openUrl?: string;
  agentAddress: string;
  agentIndex: number;
  /** Maximum per-call cost agreed at channel open (bigint as decimal string). */
  maxPerCall: string;
  /** Total deposit locked (bigint as decimal string). */
  deposit: string;
  /** Hard cap on total spend (bigint as decimal string). */
  maxSpend: string;
  durationSecs: number;
  openedAt: number;
  openTxHash: string;
  /** Running cumulative cost (bigint as decimal string). */
  cumulativeCost: string;
  callCount: number;
  /** All per-call records, in order. */
  calls: StoredCallRecord[];
  /** All leaf hashes for the Merkle tree, in order. */
  leaves: `0x${string}`[];
  /** Current Merkle root (recomputed after each call). */
  merkleRoot: `0x${string}`;
  /** Provider's declared maxRatePerCall from the 402 handshake. */
  providerMaxRatePerCall?: string;
}

// ── Paths ──────────────────────────────────────────────────────────────────

function channelsDir(): string {
  return join(getKiteDir(), "channels");
}

function channelFile(channelId: string): string {
  return join(channelsDir(), `${channelId.toLowerCase()}.json`);
}

function ensureChannelsDir(): void {
  const dir = channelsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export function loadChannel(channelId: string): StoredChannel | null {
  const path = channelFile(channelId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as StoredChannel;
  } catch {
    return null;
  }
}

export function saveChannel(channel: StoredChannel): void {
  ensureChannelsDir();
  writeFileSync(
    channelFile(channel.channelId),
    JSON.stringify(channel, null, 2) + "\n",
    { mode: 0o600 },
  );
}

export function listChannels(): StoredChannel[] {
  ensureChannelsDir();
  const dir = channelsDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf-8")) as StoredChannel;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as StoredChannel[];
}

export function deleteChannel(channelId: string): boolean {
  const path = channelFile(channelId);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

// ── Append a call result ───────────────────────────────────────────────────

/**
 * Append a completed call's receipts to the channel store.
 * Computes the leaf hash, appends it to the leaves array,
 * and recomputes the Merkle root.
 *
 * @returns the updated channel (already persisted)
 */
export function appendCallResult(
  channelId: string,
  channelReceipt: ChannelCallReceipt,
  auditReceipt: AuditReceipt,
): StoredChannel {
  const channel = loadChannel(channelId);
  if (!channel) {
    throw new Error(`Channel ${channelId} not found in local store.`);
  }

  const leafInput: MerkleLeafInput = {
    channelId: channelReceipt.channelId,
    sequenceNumber: channelReceipt.sequenceNumber,
    callCost: BigInt(channelReceipt.callCost),
    cumulativeCost: BigInt(channelReceipt.cumulativeCost),
    timestamp: channelReceipt.timestamp,
    url: auditReceipt.url,
    requestHash: auditReceipt.requestHash,
    responseHash: auditReceipt.responseHash,
    providerSignature: channelReceipt.providerSignature,
  };

  const leafHash = computeLeafHash(leafInput);

  const record: StoredCallRecord = { channelReceipt, auditReceipt, leafHash };
  channel.calls.push(record);
  channel.leaves.push(leafHash);
  channel.callCount = channel.calls.length;
  channel.cumulativeCost = channelReceipt.cumulativeCost;
  channel.merkleRoot = buildMerkleRoot(channel.leaves);

  saveChannel(channel);
  return channel;
}

// ── Factory ────────────────────────────────────────────────────────────────

/** Create and persist a fresh channel record (no calls yet). */
export function createChannelRecord(
  params: Omit<StoredChannel, "cumulativeCost" | "callCount" | "calls" | "leaves" | "merkleRoot">,
): StoredChannel {
  const channel: StoredChannel = {
    ...params,
    cumulativeCost: "0",
    callCount: 0,
    calls: [],
    leaves: [],
    merkleRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
  };
  saveChannel(channel);
  return channel;
}
