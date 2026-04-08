export const PaymentChannelABI = [
  {
    inputs: [],
    name: "ECDSAInvalidSignature",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "length",
        type: "uint256",
      },
    ],
    name: "ECDSAInvalidSignatureLength",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "s",
        type: "bytes32",
      },
    ],
    name: "ECDSAInvalidSignatureS",
    type: "error",
  },
  {
    inputs: [],
    name: "ReentrancyGuardReentrantCall",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
    ],
    name: "SafeERC20FailedOperation",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
    ],
    name: "ChannelActivated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
    ],
    name: "ChannelClosed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "disputedBy",
        type: "address",
      },
    ],
    name: "ChannelDisputed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "consumer",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "provider",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        indexed: false,
        internalType: "enum PaymentChannel.PaymentMode",
        name: "mode",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "deposit",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "maxDuration",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "ratePerCall",
        type: "uint256",
      },
    ],
    name: "ChannelOpened",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "refund",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "usageMerkleRoot",
        type: "bytes32",
      },
    ],
    name: "ChannelSettled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "finalAmount",
        type: "uint256",
      },
    ],
    name: "DisputeResolved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "wallet",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "FundsLocked",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "wallet",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "FundsUnlocked",
    type: "event",
  },
  {
    inputs: [],
    name: "CLOSE_GRACE_PERIOD",
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
    inputs: [],
    name: "DISPUTE_TIMEOUT",
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
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
    ],
    name: "activateChannel",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    name: "channels",
    outputs: [
      {
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
      {
        internalType: "address",
        name: "consumer",
        type: "address",
      },
      {
        internalType: "address",
        name: "provider",
        type: "address",
      },
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        internalType: "enum PaymentChannel.PaymentMode",
        name: "mode",
        type: "uint8",
      },
      {
        internalType: "uint256",
        name: "deposit",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "maxDuration",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "openedAt",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "expiresAt",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "ratePerCall",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "settledAmount",
        type: "uint256",
      },
      {
        internalType: "bytes32",
        name: "usageMerkleRoot",
        type: "bytes32",
      },
      {
        internalType: "enum PaymentChannel.ChannelStatus",
        name: "status",
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
        name: "channelId",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "sequenceNumber",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "cumulativeCost",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "timestamp",
        type: "uint256",
      },
      {
        internalType: "bytes",
        name: "providerSignature",
        type: "bytes",
      },
      {
        internalType: "bytes32",
        name: "merkleRoot",
        type: "bytes32",
      },
    ],
    name: "closeChannel",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
    ],
    name: "closeChannelEmpty",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
    ],
    name: "disputeChannel",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    name: "disputeDeadline",
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
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
    ],
    name: "finalizeExpiredDispute",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
    ],
    name: "forceCloseExpired",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "sequenceNumber",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "cumulativeCost",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "timestamp",
        type: "uint256",
      },
      {
        internalType: "bytes",
        name: "providerSignature",
        type: "bytes",
      },
      {
        internalType: "bytes32",
        name: "merkleRoot",
        type: "bytes32",
      },
    ],
    name: "forceCloseWithReceipt",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
    ],
    name: "getChannel",
    outputs: [
      {
        internalType: "address",
        name: "consumer",
        type: "address",
      },
      {
        internalType: "address",
        name: "provider",
        type: "address",
      },
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        internalType: "enum PaymentChannel.PaymentMode",
        name: "mode",
        type: "uint8",
      },
      {
        internalType: "uint256",
        name: "deposit",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "maxDuration",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "openedAt",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "expiresAt",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "ratePerCall",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "settledAmount",
        type: "uint256",
      },
      {
        internalType: "enum PaymentChannel.ChannelStatus",
        name: "status",
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
        name: "channelId",
        type: "bytes32",
      },
    ],
    name: "getChannelTimeRemaining",
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
        internalType: "address",
        name: "wallet",
        type: "address",
      },
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
    ],
    name: "getLockedFunds",
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
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "sequenceNumber",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "cumulativeCost",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "timestamp",
        type: "uint256",
      },
    ],
    name: "getReceiptHash",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "channelId",
        type: "bytes32",
      },
    ],
    name: "isChannelExpired",
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
        internalType: "address",
        name: "",
        type: "address",
      },
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "lockedFunds",
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
        internalType: "address",
        name: "provider",
        type: "address",
      },
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        internalType: "enum PaymentChannel.PaymentMode",
        name: "mode",
        type: "uint8",
      },
      {
        internalType: "uint256",
        name: "deposit",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "maxDuration",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "ratePerCall",
        type: "uint256",
      },
    ],
    name: "openChannel",
    outputs: [
      {
        internalType: "bytes32",
        name: "channelId",
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
        name: "channelId",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "sequenceNumber",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "cumulativeCost",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "timestamp",
        type: "uint256",
      },
      {
        internalType: "bytes",
        name: "providerSignature",
        type: "bytes",
      },
      {
        internalType: "bytes32",
        name: "merkleRoot",
        type: "bytes32",
      },
    ],
    name: "resolveDispute",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "totalChannels",
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
] as const;
