export declare function createKiteWallet(seedPhrase: string, rpcUrl: string): Promise<{
    wdk: any;
    account: any;
    address: string;
}>;
export declare function generateSeedPhrase(): string;
