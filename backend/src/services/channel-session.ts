/**
 * In-memory session store for active payment channels.
 *
 * Each entry tracks the running cumulative cost, sequence number, and last
 * signed receipt for one channel.  The provider (backend signer) is the
 * source of truth — a client cannot claim a higher sequence number than what
 * we have recorded.
 */

export interface ChannelCallReceipt {
  channelId: string;
  sequenceNumber: number;
  /** bigint serialised as decimal string (matching client-side type) */
  cumulativeCost: string;
  timestamp: number;
  providerSignature: string;
}

export interface ChannelSession {
  channelId: string;
  /** On-chain consumer address (the agent / EOA that opened the channel). */
  consumer: string;
  /** On-chain provider address (must match backend's recipient). */
  provider: string;
  token: string;
  /** Rate charged per successful API call, in token base units. */
  ratePerCall: bigint;
  sequenceNumber: number;
  cumulativeCost: bigint;
  /** Last receipt signed by this provider, or null before any call. */
  lastReceipt: ChannelCallReceipt | null;
  activatedAt: number;
  /** Unix seconds when the channel expires (copied from on-chain expiresAt). */
  expiresAt: number;
}

/** channelId (hex string) → session */
const sessions = new Map<string, ChannelSession>();

export function getSession(channelId: string): ChannelSession | undefined {
  return sessions.get(channelId.toLowerCase());
}

export function upsertSession(session: ChannelSession): void {
  sessions.set(session.channelId.toLowerCase(), session);
}

export function recordReceipt(
  channelId: string,
  receipt: ChannelCallReceipt,
): void {
  const session = sessions.get(channelId.toLowerCase());
  if (!session) return;
  session.lastReceipt = receipt;
  session.sequenceNumber = receipt.sequenceNumber;
  session.cumulativeCost = BigInt(receipt.cumulativeCost);
}

export function getAllSessions(): ChannelSession[] {
  return Array.from(sessions.values());
}

/** Remove expired / closed sessions (call periodically if desired). */
export function pruneExpiredSessions(): number {
  const now = Math.floor(Date.now() / 1000);
  let pruned = 0;
  for (const [key, session] of sessions.entries()) {
    if (session.expiresAt > 0 && now > session.expiresAt + 3600) {
      sessions.delete(key);
      pruned++;
    }
  }
  return pruned;
}
