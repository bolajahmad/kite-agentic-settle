/**
 * Goldsky subgraph indexer client for Kite Agent Pay.
 *
 * Queries the deployed subgraph for on-chain event data instead of
 * making direct RPC calls for read operations.
 */

const INDEXER_URL =
  "https://api.goldsky.com/api/public/project_cmnn27cgufwam01x895lwbit9/subgraphs/kitesettle/0.1.0/gn";

// ── GraphQL Helper ─────────────────────────────────────────────────

async function query(
  graphql: string,
  variables?: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: graphql, variables }),
  });
  if (!res.ok) {
    throw new Error(`Indexer error: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { data?: any; errors?: any[] };
  if (json.errors) {
    throw new Error(`Indexer query error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// ── Types ──────────────────────────────────────────────────────────

export interface IndexedAgent {
  id: string;
  agentId: string;
  aaWallet: {
    address: string;
    id: string;
  };
  owner: IndexedUserRegistered;
  metadata: string;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

export interface IndexedSession {
  id: string;
  agentId: string;
  sessionKey: string;
  sessionId: string;
  validUntil: string;
  blockedAgents: string[];
  maxLimit: string;
  metadataHash: string;
  valueLimit: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  agent: IndexedAgent;
}

export interface IndexedPayment {
  id: string;
  sessionKey: string;
  agentId: string;
  recipient: string;
  token: string;
  amount: string;
  blockTimestamp: string;
  transactionHash: string;
}

export interface IndexedSessionKeyAdded {
  id: string;
  sessionKey: string;
  user: string;
  agentId: string;
  valueLimit: string;
  dailyLimit: string;
  validUntil: string;
  blockTimestamp: string;
  transactionHash: string;
}

export interface IndexedChannel {
  id: string;
  channelId: string;
  user: { id: string; address: string };
  provider: string;
  agent: { id: string; agentId: string };
  session: { id: string; sessionKey: string };
  walletContract: string;
  mode: string;
  token: string;
  deposit: string;
  maxSpend: string;
  maxPerCall: string;
  status: string;
  openedAt: string;
  expiresAt: string;
  closedAt?: string | null;
  settlementInitiator?: string | null;
  settlementDeadline?: string | null;
  highestClaimedCost?: string | null;
  highestSequenceNumber?: string | null;
  settledAmount: string;
  refundAmount: string;
  usageMerkleRoot?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IndexedUserRegistered {
  address: string;
  aaWallet: {
    address: string;
    id: string;
  };
  id: string;
  blockTimestamp: string;
  transactionHash: string;
  agents: IndexedAgent[];
  sessions: IndexedSession[];
  blockedProviders: string[];
}

// ── Queries ────────────────────────────────────────────────────────

export async function getAgentsByOwner(owner: string): Promise<IndexedAgent[]> {
  const data = await query(
    `
    query($owner: String!) {
      agentRegistereds(
        where: { ownerAddress: $owner }
        orderBy: blockTimestamp
        orderDirection: desc
      ) {
        id
        agentId
        agentAddress
        aaWallet {
          address
          id
        }
        ownerAddress
        metadata
        blockNumber
        blockTimestamp
        transactionHash
      }
    }
  `,
    { owner: owner.toLowerCase() },
  );
  return data.agentRegistereds || [];
}

export async function getAgentById(id: string): Promise<IndexedAgent | null> {
  const data = await query(
    `
    query($id: Bytes!) {
      agent(id: $id) {
        id
        agentId
        active
        aaWallet {
          id
          address
        }
        owner {
          id
          address
          aaWallet {
            id
            address
          }
        }
        sessions {
          sessionKey
          id
        }
        metadata
        createdAt
        updatedAt
      }
    }
  `,
    { id },
  );
  return data.agent || null;
}

export async function getUserById(
  id: string,
): Promise<IndexedUserRegistered | null> {
  const data = await query(
    `
    query($id: String!) {
      user(id: $id) {
        address
        aaWallet {
          address
          id
        }
        id
        agents {
          id
          agentId
          aaWallet {
            address
            id
          }
          owner {
            id
            address
          }
          metadata
          createdAt
          updatedAt
          active
        }
        sessions {
          id
          sessionKey
          sessionId
          validUntil
          blockedAgents
          maxLimit
          valueLimit
          status
          createdAt
          updatedAt
          agent {
            id
            agentId
            aaWallet {
              address
              id
            }
            owner {
              id
              address
            }
            metadata
            createdAt
            updatedAt
            active
          }
        }
      }
    }
  `,
    { id: id.toLowerCase() },
  );
  return data.user || null;
}

export async function getSessionsByAgent(
  agentId: string,
  limit: number = 10,
  offset: number = 0,
): Promise<IndexedSession[]> {
  const data = await query(
    `
    query($agentId: String!, $first: Int!, $skip: Int!) {
      sessions(
        where: { agent: $agentId }
        orderBy: createdAt
        orderDirection: desc
        first: $first
        skip: $skip
      ) {
        id
        blockedAgents
        createdAt
        maxLimit
        sessionKey
        sessionId
        updatedAt
        valueLimit
        status
        validUntil
        agent {
          agentId
        }
      }
    }
  `,
    { agentId, first: limit, skip: offset },
  );
  return data.sessions || [];
}

export async function getSessionByKey(
  sessionKey: string,
): Promise<IndexedSession | null> {
  const data = await query(
    `
    query($id: String!) {
      session(id: $id) {
        id
        blockedAgents
        createdAt
        maxLimit
        sessionKey
        sessionId
        updatedAt
        valueLimit
        status
        validUntil
        agent {
          agentId
        }
      }
    }
  `,
    { id: sessionKey.toLowerCase() },
  );

  if (!data.session) return null;

  return {
    ...data.session,
    agentId: data.session.agent?.agentId ?? "",
  };
}

export async function getPaymentsByAgent(
  agentId: string,
): Promise<IndexedPayment[]> {
  const data = await query(
    `
    query($agentId: Bytes!) {
      paymentExecuteds(
        where: { agentId: $agentId }
        orderBy: blockTimestamp
        orderDirection: desc
      ) {
        id
        sessionKey
        agentId
        recipient
        token
        amount
        blockTimestamp
        transactionHash
      }
    }
  `,
    { agentId },
  );
  return data.paymentExecuteds || [];
}

export async function getRecentPayments(
  limit: number = 20,
): Promise<IndexedPayment[]> {
  const data = await query(
    `
    query($limit: Int!) {
      paymentExecuteds(
        first: $limit
        orderBy: blockTimestamp
        orderDirection: desc
      ) {
        id
        sessionKey
        agentId
        recipient
        token
        amount
        blockTimestamp
        transactionHash
      }
    }
  `,
    { limit },
  );
  return data.paymentExecuteds || [];
}

export async function getSessionKeyAdded(
  sessionKey: string,
): Promise<IndexedSessionKeyAdded | null> {
  const data = await query(
    `
    query($sessionKey: String!) {
      sessionKeyAddeds(where: { sessionKey: $sessionKey }, first: 1) {
        id
        sessionKey
        user
        agentId
        valueLimit
        dailyLimit
        validUntil
        blockTimestamp
        transactionHash
      }
    }
  `,
    { sessionKey: sessionKey.toLowerCase() },
  );
  return data.sessionKeyAddeds?.[0] || null;
}

export async function getActiveSessionsForAgent(
  agentId: string,
): Promise<IndexedSession[]> {
  console.log({ agentId });
  const data = await query(
    `
    query($agentId: String!) {
      sessions(
        where: { agent: $agentId, status: "ACTIVE" }
        orderDirection: desc
      ) {
        id
        blockedAgents
        maxLimit
        metadataHash
        sessionId
        sessionKey
        valueLimit
        status
        validUntil
        agent {
          agentId
          metadata
          id
        }
      }
    }
  `,
    { agentId },
  );
  return data.sessions || [];
}

export async function getUserAgentsWithActiveSessions(
  userId: string,
): Promise<IndexedUserRegistered | null> {
  const data = await query(
    `
    query($userId: String!) {
      user(id: $userId) {
        address
        agents(where: { sessions_: { status: "ACTIVE" } }) {
          id
          metadata
          sessions {
            sessionKey
            sessionId
            status
          }
        }
        aaWallet {
          address
          id
        }
      }
    }
  `,
    { userId: userId.toLowerCase() },
  );
  return data.user || null;
}

export async function getChannelsByAgent(
  agentId: string,
  limit: number = 10,
  offset: number = 0,
): Promise<IndexedChannel[]> {
  const data = await query(
    `
    query($agentId: String!, $first: Int!, $skip: Int!) {
      channels(
        where: { agent: $agentId }
        orderBy: openedAt
        orderDirection: desc
        first: $first
        skip: $skip
      ) {
        id
        channelId
        user { id address }
        provider
        agent { id agentId }
        session { id sessionKey }
        mode
        token
        deposit
        maxSpend
        maxPerCall
        status
        openedAt
        expiresAt
        closedAt
        settlementDeadline
        highestClaimedCost
        highestSequenceNumber
        settledAmount
        refundAmount
        usageMerkleRoot
        createdAt
        updatedAt
      }
    }
  `,
    { agentId: agentId.toLowerCase(), first: limit, skip: offset },
  );
  return data.channels || [];
}

export async function getChannelById(
  channelId: string,
): Promise<IndexedChannel | null> {
  const data = await query(
    `
    query($id: String!) {
      channel(id: $id) {
        id
        channelId
        user { id address }
        provider
        agent { id agentId }
        session { id sessionKey }
        mode
        token
        deposit
        maxSpend
        maxPerCall
        status
        openedAt
        expiresAt
        closedAt
        settlementDeadline
        highestClaimedCost
        highestSequenceNumber
        settledAmount
        refundAmount
        usageMerkleRoot
        createdAt
        updatedAt
      }
    }
  `,
    { id: channelId.toLowerCase() },
  );
  return data.channel || null;
}

// ── Rich Payment queries (uses the Payment entity with full relations) ──────

const PAYMENT_FULL_FRAGMENT = `
  id
  type
  amount
  token
  recipient
  timestamp
  txHash
  nonce
  change
  session { id sessionKey }
  agent { agentId }
  channel { id channelId }
`;

/** Richer payment record returned by the payments entity. */
export interface IndexedPaymentFull {
  id: string;
  /** "PerCall" | "BatchCall" | "BatchTime" */
  type: string;
  amount: string;
  token: string;
  recipient: string;
  timestamp: string;
  txHash: string;
  nonce?: string;
  change?: string;
  session: { id: string; sessionKey: string };
  agent: { agentId: string };
  channel?: { id: string; channelId: string } | null;
}

/**
 * All payments made by a given agent (by agent entity ID, e.g. "0x01" for agentId=1).
 * Use `BigInt(numericId).toString(16)` prefixed with "0x" to form the entity ID.
 */
export async function getPaymentsByAgentFull(
  agentEntityId: string,
  limit: number = 20,
  offset: number = 0,
): Promise<IndexedPaymentFull[]> {
  const data = await query(
    `
    query($agentId: String!, $first: Int!, $skip: Int!) {
      payments(
        where: { agent: $agentId }
        orderBy: timestamp
        orderDirection: desc
        first: $first
        skip: $skip
      ) {
        ${PAYMENT_FULL_FRAGMENT}
      }
    }
  `,
    { agentId: agentEntityId.toLowerCase(), first: limit, skip: offset },
  );
  return data.payments || [];
}

/**
 * All payments for a given session (by session entity ID = sessionKey address hex).
 */
export async function getPaymentsBySession(
  sessionKey: string,
  limit: number = 20,
  offset: number = 0,
): Promise<IndexedPaymentFull[]> {
  const data = await query(
    `
    query($sessionId: String!, $first: Int!, $skip: Int!) {
      payments(
        where: { session: $sessionId }
        orderBy: timestamp
        orderDirection: desc
        first: $first
        skip: $skip
      ) {
        ${PAYMENT_FULL_FRAGMENT}
      }
    }
  `,
    { sessionId: sessionKey.toLowerCase(), first: limit, skip: offset },
  );
  return data.payments || [];
}

export async function getSessionSpentFromIndexer(
  sessionKey: string,
  pageSize: number = 100,
): Promise<bigint> {
  let offset = 0;
  let total = 0n;

  while (true) {
    const payments = await getPaymentsBySession(sessionKey, pageSize, offset);
    if (payments.length === 0) break;

    for (const payment of payments) {
      total += BigInt(payment.amount);
    }

    if (payments.length < pageSize) break;
    offset += pageSize;
  }

  return total;
}

/**
 * All payments made by a given owner/user (by EOA address, lowercase).
 */
export async function getPaymentsByOwnerFull(
  ownerAddress: string,
  limit: number = 20,
  offset: number = 0,
): Promise<IndexedPaymentFull[]> {
  const data = await query(
    `
    query($userId: String!, $first: Int!, $skip: Int!) {
      payments(
        where: { user: $userId }
        orderBy: timestamp
        orderDirection: desc
        first: $first
        skip: $skip
      ) {
        ${PAYMENT_FULL_FRAGMENT}
      }
    }
  `,
    { userId: ownerAddress.toLowerCase(), first: limit, skip: offset },
  );
  return data.payments || [];
}
