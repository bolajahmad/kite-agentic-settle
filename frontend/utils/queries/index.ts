import { gql, GraphQLClient } from "graphql-request"

const URL =
  process.env.NEXT_PUBLIC_SUBGRAPH_PUBLIC_URL || "http://localhost:4350/graphql"

export const graphqlClient = new GraphQLClient(URL, {
  headers: {
    "Content-Type": "application/json",
  },
})

export const GET_ALL_EOA_AGENTS = gql`
  query GetAgentRegistered($owner: String!) {
    agentRegistereds(where: { ownerAddress: $owner }) {
      agentId
      agentAddress
      ownerAddress
      agentIndex
      id
      metadata
      transactionHash_
      walletContract
      timestamp_
    }
  }
`

export const GET_ALL_SESSION_KEYS = gql`
  query GetSessionKeys($agentId: String) {
    sessionKeyAddeds(where: { agentId: $agentId }) {
      id
      agentId
      metadata
      metadataHash
      sessionIndex
      user
      sessionKey
      dailyLimit
      contractId_
      block_number
      transactionHash_
      timestamp_
      validUntil
      valueLimit
    }
  }
`
