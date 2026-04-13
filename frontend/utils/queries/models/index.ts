export interface IAgentMetadata {
  version: string
  name: string
  category: string
  description: string
  tags: string[]
}

export interface IAgent {
  agentId: string
  agentAddress: string
  agentIndex: string
  walletContract: string
  ownerAddress: string
  metadata: IAgentMetadata
  blockNumber: number
  blockTimestamp: number
  transactionHash: string
  sessions: ISession[]
}

export interface ISessionMetadata {
  name: string
  purpose: string
  agentIndex: number
  sessionIndex: number
  createdAt: string
}

export interface ISession {
  id: string
  agentId: string
  metadata: ISessionMetadata
  metadataHash: string
  sessionIndex: string
  user: string
  sessionKey: string
  dailyLimit: string
  contractId: string
  blockNumber: string
  transactionHash: string
  timestamp: string
  validUntil: string
  valueLimit: string
}
