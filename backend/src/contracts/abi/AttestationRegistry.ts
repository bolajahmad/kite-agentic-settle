export const AttestationRegistryABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_identityRegistry",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address",
      },
    ],
    name: "OwnableInvalidOwner",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address",
      },
    ],
    name: "OwnableUnauthorizedAccount",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "address",
        name: "giver",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint64",
        name: "feedbackIndex",
        type: "uint64",
      },
      {
        indexed: false,
        internalType: "int128",
        name: "value",
        type: "int128",
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "valueDecimals",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "string",
        name: "tag1",
        type: "string",
      },
      {
        indexed: false,
        internalType: "string",
        name: "tag2",
        type: "string",
      },
    ],
    name: "FeedbackGiven",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "address",
        name: "giver",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint64",
        name: "feedbackIndex",
        type: "uint64",
      },
    ],
    name: "FeedbackRevoked",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "registry",
        type: "address",
      },
    ],
    name: "IdentityRegistryUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "merkleRoot",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "logCount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "string",
        name: "ipfsURI",
        type: "string",
      },
      {
        indexed: false,
        internalType: "address",
        name: "validator",
        type: "address",
      },
    ],
    name: "MerkleRootAnchored",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address",
      },
    ],
    name: "OwnershipTransferred",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "address",
        name: "giver",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint64",
        name: "feedbackIndex",
        type: "uint64",
      },
    ],
    name: "ResponseAppended",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "submitter",
        type: "address",
      },
    ],
    name: "SubmitterAdded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "submitter",
        type: "address",
      },
    ],
    name: "SubmitterRemoved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "requestKey",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "address",
        name: "validatorAddress",
        type: "address",
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "requestHash",
        type: "bytes32",
      },
    ],
    name: "ValidationRequested",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "requestKey",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "validatorAddress",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "response",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "string",
        name: "tag",
        type: "string",
      },
    ],
    name: "ValidationResponded",
    type: "event",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "submitter",
        type: "address",
      },
    ],
    name: "addSubmitter",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        internalType: "bytes32",
        name: "merkleRoot",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "logCount",
        type: "uint256",
      },
      {
        internalType: "string",
        name: "ipfsURI",
        type: "string",
      },
      {
        internalType: "address",
        name: "validator",
        type: "address",
      },
    ],
    name: "anchorRoot",
    outputs: [
      {
        internalType: "bytes32",
        name: "requestKey",
        type: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "giver",
        type: "address",
      },
      {
        internalType: "uint64",
        name: "feedbackIndex",
        type: "uint64",
      },
      {
        internalType: "string",
        name: "responseURI",
        type: "string",
      },
      {
        internalType: "bytes32",
        name: "responseHash",
        type: "bytes32",
      },
    ],
    name: "appendResponse",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "authorizedSubmitters",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
    ],
    name: "getAgentGivers",
    outputs: [
      {
        internalType: "address[]",
        name: "",
        type: "address[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
    ],
    name: "getAgentRoots",
    outputs: [
      {
        internalType: "bytes32[]",
        name: "",
        type: "bytes32[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
    ],
    name: "getAgentValidations",
    outputs: [
      {
        internalType: "bytes32[]",
        name: "",
        type: "bytes32[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "merkleRoot",
        type: "bytes32",
      },
    ],
    name: "getAnchor",
    outputs: [
      {
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "logCount",
        type: "uint256",
      },
      {
        internalType: "string",
        name: "ipfsURI",
        type: "string",
      },
      {
        internalType: "address",
        name: "validator",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "anchoredAt",
        type: "uint256",
      },
      {
        internalType: "bytes32",
        name: "validationKey",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "giver",
        type: "address",
      },
    ],
    name: "getFeedbackCount",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        internalType: "address[]",
        name: "giverAddresses",
        type: "address[]",
      },
      {
        internalType: "string",
        name: "tag1",
        type: "string",
      },
      {
        internalType: "string",
        name: "tag2",
        type: "string",
      },
    ],
    name: "getSummaryFeedback",
    outputs: [
      {
        internalType: "uint64",
        name: "count",
        type: "uint64",
      },
      {
        internalType: "int128",
        name: "summaryValue",
        type: "int128",
      },
      {
        internalType: "uint8",
        name: "summaryValueDecimals",
        type: "uint8",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "requestKey",
        type: "bytes32",
      },
    ],
    name: "getValidationStatus",
    outputs: [
      {
        internalType: "address",
        name: "validatorAddress",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        internalType: "uint8",
        name: "response",
        type: "uint8",
      },
      {
        internalType: "bytes32",
        name: "responseHash",
        type: "bytes32",
      },
      {
        internalType: "string",
        name: "tag",
        type: "string",
      },
      {
        internalType: "uint256",
        name: "lastUpdate",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "responded",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        internalType: "address[]",
        name: "validatorAddresses",
        type: "address[]",
      },
      {
        internalType: "string",
        name: "tag",
        type: "string",
      },
    ],
    name: "getValidationSummary",
    outputs: [
      {
        internalType: "uint64",
        name: "count",
        type: "uint64",
      },
      {
        internalType: "uint8",
        name: "averageResponse",
        type: "uint8",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "validatorAddress",
        type: "address",
      },
    ],
    name: "getValidatorRequests",
    outputs: [
      {
        internalType: "bytes32[]",
        name: "",
        type: "bytes32[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        internalType: "int128",
        name: "value",
        type: "int128",
      },
      {
        internalType: "uint8",
        name: "valueDecimals",
        type: "uint8",
      },
      {
        internalType: "string",
        name: "tag1",
        type: "string",
      },
      {
        internalType: "string",
        name: "tag2",
        type: "string",
      },
      {
        internalType: "string",
        name: "endpoint",
        type: "string",
      },
      {
        internalType: "string",
        name: "feedbackURI",
        type: "string",
      },
      {
        internalType: "bytes32",
        name: "feedbackHash",
        type: "bytes32",
      },
    ],
    name: "giveFeedback",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "identityRegistry",
    outputs: [
      {
        internalType: "contract IIdentityRegistry",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "giver",
        type: "address",
      },
      {
        internalType: "uint64",
        name: "feedbackIndex",
        type: "uint64",
      },
    ],
    name: "readFeedback",
    outputs: [
      {
        internalType: "int128",
        name: "value",
        type: "int128",
      },
      {
        internalType: "uint8",
        name: "valueDecimals",
        type: "uint8",
      },
      {
        internalType: "string",
        name: "tag1",
        type: "string",
      },
      {
        internalType: "string",
        name: "tag2",
        type: "string",
      },
      {
        internalType: "bool",
        name: "isRevoked",
        type: "bool",
      },
      {
        internalType: "bool",
        name: "hasResponse",
        type: "bool",
      },
      {
        internalType: "string",
        name: "responseURI",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "submitter",
        type: "address",
      },
    ],
    name: "removeSubmitter",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        internalType: "uint64",
        name: "feedbackIndex",
        type: "uint64",
      },
    ],
    name: "revokeFeedback",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_registry",
        type: "address",
      },
    ],
    name: "setIdentityRegistry",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newOwner",
        type: "address",
      },
    ],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "validatorAddress",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "agentId",
        type: "uint256",
      },
      {
        internalType: "string",
        name: "requestURI",
        type: "string",
      },
      {
        internalType: "bytes32",
        name: "requestHash",
        type: "bytes32",
      },
    ],
    name: "validationRequest",
    outputs: [
      {
        internalType: "bytes32",
        name: "requestKey",
        type: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "requestKey",
        type: "bytes32",
      },
      {
        internalType: "uint8",
        name: "response",
        type: "uint8",
      },
      {
        internalType: "string",
        name: "responseURI",
        type: "string",
      },
      {
        internalType: "bytes32",
        name: "responseHash",
        type: "bytes32",
      },
      {
        internalType: "string",
        name: "tag",
        type: "string",
      },
    ],
    name: "validationResponse",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "merkleRoot",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "leaf",
        type: "bytes32",
      },
      {
        internalType: "bytes32[]",
        name: "proof",
        type: "bytes32[]",
      },
    ],
    name: "verifyLeaf",
    outputs: [
      {
        internalType: "bool",
        name: "valid",
        type: "bool",
      },
    ],
    stateMutability: "pure",
    type: "function",
  },
] as const;
