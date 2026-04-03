export declare const paymentChannelAbi: readonly [{
    readonly name: "openChannel";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "provider";
    }, {
        readonly type: "address";
        readonly name: "token";
    }, {
        readonly type: "uint8";
        readonly name: "mode";
    }, {
        readonly type: "uint256";
        readonly name: "deposit";
    }, {
        readonly type: "uint256";
        readonly name: "maxDuration";
    }, {
        readonly type: "uint256";
        readonly name: "ratePerCall";
    }];
    readonly outputs: readonly [{
        readonly type: "bytes32";
    }];
}, {
    readonly name: "activateChannel";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "closeChannel";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
    }, {
        readonly type: "uint256";
        readonly name: "sequenceNumber";
    }, {
        readonly type: "uint256";
        readonly name: "cumulativeCost";
    }, {
        readonly type: "uint256";
        readonly name: "timestamp";
    }, {
        readonly type: "bytes";
        readonly name: "providerSignature";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "closeChannelEmpty";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "forceCloseExpired";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "forceCloseWithReceipt";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
    }, {
        readonly type: "uint256";
        readonly name: "sequenceNumber";
    }, {
        readonly type: "uint256";
        readonly name: "cumulativeCost";
    }, {
        readonly type: "uint256";
        readonly name: "timestamp";
    }, {
        readonly type: "bytes";
        readonly name: "providerSignature";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "disputeChannel";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "resolveDispute";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
    }, {
        readonly type: "uint256";
        readonly name: "sequenceNumber";
    }, {
        readonly type: "uint256";
        readonly name: "cumulativeCost";
    }, {
        readonly type: "uint256";
        readonly name: "timestamp";
    }, {
        readonly type: "bytes";
        readonly name: "providerSignature";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "getChannel";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
    }];
    readonly outputs: readonly [{
        readonly type: "address";
        readonly name: "consumer";
    }, {
        readonly type: "address";
        readonly name: "provider";
    }, {
        readonly type: "address";
        readonly name: "token";
    }, {
        readonly type: "uint8";
        readonly name: "mode";
    }, {
        readonly type: "uint256";
        readonly name: "deposit";
    }, {
        readonly type: "uint256";
        readonly name: "maxDuration";
    }, {
        readonly type: "uint256";
        readonly name: "openedAt";
    }, {
        readonly type: "uint256";
        readonly name: "expiresAt";
    }, {
        readonly type: "uint256";
        readonly name: "ratePerCall";
    }, {
        readonly type: "uint256";
        readonly name: "settledAmount";
    }, {
        readonly type: "uint8";
        readonly name: "status";
    }];
}, {
    readonly name: "getReceiptHash";
    readonly type: "function";
    readonly stateMutability: "pure";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
    }, {
        readonly type: "uint256";
        readonly name: "sequenceNumber";
    }, {
        readonly type: "uint256";
        readonly name: "cumulativeCost";
    }, {
        readonly type: "uint256";
        readonly name: "timestamp";
    }];
    readonly outputs: readonly [{
        readonly type: "bytes32";
    }];
}, {
    readonly name: "isChannelExpired";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly name: "getChannelTimeRemaining";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "lockedFunds";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "wallet";
    }, {
        readonly type: "address";
        readonly name: "token";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "ChannelOpened";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "consumer";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "provider";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "token";
    }, {
        readonly type: "uint8";
        readonly name: "mode";
    }, {
        readonly type: "uint256";
        readonly name: "deposit";
    }, {
        readonly type: "uint256";
        readonly name: "maxDuration";
    }, {
        readonly type: "uint256";
        readonly name: "ratePerCall";
    }];
}, {
    readonly name: "ChannelActivated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
        readonly indexed: true;
    }];
}, {
    readonly name: "ChannelSettled";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }, {
        readonly type: "uint256";
        readonly name: "refund";
    }];
}, {
    readonly name: "ChannelClosed";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "channelId";
        readonly indexed: true;
    }];
}];
export declare const agentRegistryAbi: readonly [{
    readonly name: "registerAgent";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "agentId";
    }, {
        readonly type: "string";
        readonly name: "agentDomain";
    }, {
        readonly type: "address";
        readonly name: "agentAddress";
    }, {
        readonly type: "address";
        readonly name: "walletContract";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "registerSession";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "agentId";
    }, {
        readonly type: "address";
        readonly name: "sessionKey";
    }, {
        readonly type: "uint256";
        readonly name: "validUntil";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "deactivateAgent";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "agentId";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "deactivateSession";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "getAgent";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "agentId";
    }];
    readonly outputs: readonly [{
        readonly type: "string";
        readonly name: "agentDomain";
    }, {
        readonly type: "address";
        readonly name: "agentAddress";
    }, {
        readonly type: "address";
        readonly name: "walletContract";
    }, {
        readonly type: "address";
        readonly name: "ownerAddr";
    }, {
        readonly type: "bool";
        readonly name: "active";
    }];
}, {
    readonly name: "resolveAgentByDomain";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "string";
        readonly name: "domain";
    }];
    readonly outputs: readonly [{
        readonly type: "bytes32";
        readonly name: "agentId";
    }, {
        readonly type: "address";
        readonly name: "agentAddress";
    }, {
        readonly type: "address";
        readonly name: "walletContract";
    }, {
        readonly type: "bool";
        readonly name: "active";
    }];
}, {
    readonly name: "resolveAgentByAddress";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "agentAddr";
    }];
    readonly outputs: readonly [{
        readonly type: "bytes32";
        readonly name: "agentId";
    }, {
        readonly type: "string";
        readonly name: "agentDomain";
    }, {
        readonly type: "address";
        readonly name: "walletContract";
    }, {
        readonly type: "bool";
        readonly name: "active";
    }];
}, {
    readonly name: "getAgentBySession";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
    }];
    readonly outputs: readonly [{
        readonly type: "bytes32";
        readonly name: "agentId";
    }, {
        readonly type: "string";
        readonly name: "agentDomain";
    }, {
        readonly type: "address";
        readonly name: "agentAddress";
    }, {
        readonly type: "bool";
        readonly name: "agentActive";
    }, {
        readonly type: "bool";
        readonly name: "sessionActive";
    }, {
        readonly type: "uint256";
        readonly name: "sessionValidUntil";
    }];
}, {
    readonly name: "getOwnerAgents";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "ownerAddr";
    }];
    readonly outputs: readonly [{
        readonly type: "bytes32[]";
    }];
}];
export declare const kiteAAWalletAbi: readonly [{
    readonly name: "deposit";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "token";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "withdraw";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "token";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "executePayment";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
    }, {
        readonly type: "address";
        readonly name: "recipient";
    }, {
        readonly type: "address";
        readonly name: "token";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "addSessionKeyRule";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKeyAddress";
    }, {
        readonly type: "bytes32";
        readonly name: "agentId";
    }, {
        readonly type: "uint256";
        readonly name: "valueLimit";
    }, {
        readonly type: "uint256";
        readonly name: "dailyLimit";
    }, {
        readonly type: "uint256";
        readonly name: "validUntil";
    }, {
        readonly type: "address[]";
        readonly name: "allowedRecipients";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "revokeSessionKey";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKeyAddress";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "setAgentRegistry";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "_registry";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "getSessionRule";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
    }];
    readonly outputs: readonly [{
        readonly type: "bytes32";
        readonly name: "agentId";
    }, {
        readonly type: "uint256";
        readonly name: "valueLimit";
    }, {
        readonly type: "uint256";
        readonly name: "dailyLimit";
    }, {
        readonly type: "uint256";
        readonly name: "validUntil";
    }, {
        readonly type: "bool";
        readonly name: "active";
    }];
}, {
    readonly name: "isSessionValid";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly name: "getAgentSessionKeys";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "agentId";
    }];
    readonly outputs: readonly [{
        readonly type: "address[]";
    }];
}, {
    readonly name: "getDailySpend";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
        readonly name: "spent";
    }, {
        readonly type: "uint256";
        readonly name: "windowStart";
    }];
}];
export declare const walletFactoryAbi: readonly [{
    readonly name: "deployWallet";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "getWallet";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "owner";
    }];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "totalWallets";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}];
export declare const erc20Abi: readonly [{
    readonly name: "approve";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "spender";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly name: "balanceOf";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "account";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "allowance";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "owner";
    }, {
        readonly type: "address";
        readonly name: "spender";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "transfer";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "to";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}];
