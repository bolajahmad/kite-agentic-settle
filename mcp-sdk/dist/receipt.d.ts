import type { Receipt } from "./types.js";
export declare const RECEIPT_DOMAIN: {
    readonly name: "KitePaymentReceipt";
    readonly version: "1";
    readonly chainId: 2368;
};
export declare const RECEIPT_TYPES: {
    readonly Receipt: readonly [{
        readonly name: "requestHash";
        readonly type: "bytes32";
    }, {
        readonly name: "responseHash";
        readonly type: "bytes32";
    }, {
        readonly name: "callCost";
        readonly type: "uint256";
    }, {
        readonly name: "cumulativeCost";
        readonly type: "uint256";
    }, {
        readonly name: "nonce";
        readonly type: "uint256";
    }, {
        readonly name: "timestamp";
        readonly type: "uint256";
    }, {
        readonly name: "sessionId";
        readonly type: "bytes32";
    }, {
        readonly name: "provider";
        readonly type: "string";
    }, {
        readonly name: "consumer";
        readonly type: "string";
    }];
};
export declare function computeReceiptHash(receipt: Receipt): `0x${string}`;
export declare function signReceipt(privateKey: Uint8Array, receipt: Receipt): Promise<`0x${string}`>;
export declare function createSignedReceipt(privateKey: Uint8Array, params: {
    requestHash?: string;
    responseHash?: string;
    callCost: bigint;
    cumulativeCost: bigint;
    nonce: number;
    timestamp: number;
    sessionId?: string;
    provider: string;
    consumer: string;
}): Promise<Receipt>;
export declare function verifyReceipt(receipt: Receipt, expectedSigner: string): Promise<boolean>;
export declare function validateReceipt(receipt: Receipt, previousReceipt: Receipt | null, ratePerCall: bigint): {
    valid: boolean;
    reason?: string;
};
