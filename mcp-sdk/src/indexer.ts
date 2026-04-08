/**
 * Goldsky subgraph indexer client for Kite Agent Pay.
 *
 * Queries the deployed subgraph for on-chain event data instead of
 * making direct RPC calls for read operations.
 */

const INDEXER_URL =
  "https://api.goldsky.com/api/public/project_cmnn27cgufwam01x895lwbit9/subgraphs/kite-aspl-kite-ai-testnet/1.0/gn";

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
  agentAddress: string;
  walletContract: string;
  ownerAddress: string;
  metadata: string;
  blockNumber: string;
  blockTimestamp: string;
  transactionHash: string;
}

export interface IndexedSession {
  id: string;
  agentId: string;
  sessionKey: string;
  validUntil: string;
  blockTimestamp: string;
  transactionHash: string;
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
  id: string;
  user: string;
  blockTimestamp: string;
  transactionHash: string;
}

// ── Queries ────────────────────────────────────────────────────────

export async function getAgentsByOwner(
  owner: string,
): Promise<IndexedAgent[]> {
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

export async function getAgentById(
  agentId: string,
): Promise<IndexedAgent | null> {
  const data = await query(
    `
    query($agentId: Bytes!) {
      agentRegistereds(where: { agentId: $agentId }, first: 1) {
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
    { agentId },
  );
  return data.agentRegistereds?.[0] || null;
}

export async function getSessionsByAgent(
  agentId: string,
): Promise<IndexedSession[]> {
  const data = await query(
    `
    query($agentId: Bytes!) {
      sessionRegistereds(
        where: { agentId: $agentId }
        orderBy: blockTimestamp
        orderDirection: desc
      ) {
        id
        agentId
        sessionKey
        validUntil
        blockTimestamp
        transactionHash
      }
    }
  `,
    { agentId },
  );
  return data.sessionRegistereds || [];
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
