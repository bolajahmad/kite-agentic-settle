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
  wallet: string;
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
  validUntil: string;
  blockTimestamp: string;
  transactionHash: string;
  blockedAgents: string[];
  maxLimit: string;
  metadataHash: string;
  valueLimit: string;
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

export interface IndexedUserRegistered {
  address: string;
  wallet: string;
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
        walletContract
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
        wallet
        owner {
          id
          address
          blockedProviders
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

export async function getSessionsByAgent(
  agentId: string,
): Promise<IndexedSession[]> {
  console.log({ agentId });
  const data = await query(
    `
    query($agentId: String!) {
      sessions(
        where: { agent: $agentId }
        orderDirection: desc
      ) {
        id
        blockedAgents
        maxLimit
        metadataHash
        sessionKey
        valueLimit
        status
        validUntil
      }
    }
  `,
    { agentId },
  );
  return data.sessions || [];
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
): Promise<any | null> {
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
            status
          }
        }
        wallet
      }
    }
  `,
    { userId: userId.toLowerCase() },
  );
  return data.user || null;
}
