import { createKiteWallet, generateSeedPhrase } from "./wallet.js";
import { ContractService } from "./contracts.js";
import { ChannelManager } from "./channel.js";
import { BatchManager } from "./batch.js";
import { PaymentInterceptor } from "./interceptor.js";
import { UsageTracker } from "./usage.js";
import { KITE_TESTNET } from "./config.js";
export class KitePaymentClient {
    address;
    config;
    wdkAccount;
    wdk;
    contractService;
    channelManager;
    batchManager;
    interceptor;
    usage;
    agentId;
    constructor(address, config, wdk, wdkAccount, contractService, channelManager, batchManager, interceptor, usage, agentId) {
        this.address = address;
        this.config = config;
        this.wdk = wdk;
        this.wdkAccount = wdkAccount;
        this.contractService = contractService;
        this.channelManager = channelManager;
        this.batchManager = batchManager;
        this.interceptor = interceptor;
        this.usage = usage;
        this.agentId = agentId;
    }
    static async create(options) {
        const config = {
            ...KITE_TESTNET,
            ...options.config,
            contracts: {
                ...KITE_TESTNET.contracts,
                ...options.config?.contracts,
            },
        };
        const { wdk, account, address } = await createKiteWallet(options.seedPhrase, config.rpcUrl);
        const contractService = new ContractService(config, account);
        const keyPair = account.keyPair;
        if (!keyPair?.privateKey)
            throw new Error("Could not extract private key from WDK account");
        const privateKey = keyPair.privateKey;
        const channelManager = new ChannelManager(contractService, config.token, privateKey, address);
        const batchManager = new BatchManager();
        const usage = new UsageTracker();
        const agentId = options.agentId || address;
        const interceptor = new PaymentInterceptor(channelManager, contractService, usage, agentId, privateKey, address, {
            paymentMode: options.defaultPaymentMode || "auto",
            walletAddress: options.walletAddress,
            sessionKey: options.sessionKey || address,
        });
        interceptor.setBatchManager(batchManager);
        return new KitePaymentClient(address, config, wdk, account, contractService, channelManager, batchManager, interceptor, usage, agentId);
    }
    static generateSeedPhrase() {
        return generateSeedPhrase();
    }
    // -- Agent Registration --
    async registerAgent(name, domain, walletContract) {
        const wallet = walletContract || this.config.contracts.kiteAAWallet;
        return await this.contractService.registerAgent(name, domain, this.address, wallet);
    }
    async getAgent(agentId) {
        return await this.contractService.getAgent(agentId);
    }
    async resolveAgentByDomain(domain) {
        return await this.contractService.resolveAgentByDomain(domain);
    }
    // -- Session Keys --
    async registerSession(agentId, sessionKey, validUntil) {
        return await this.contractService.registerSession(agentId, sessionKey, validUntil);
    }
    // -- Wallet --
    async depositToWallet(amount, token) {
        return await this.contractService.depositToWallet(token || this.config.token, amount);
    }
    async getTokenBalance(token) {
        return await this.contractService.getTokenBalance(token || this.config.token, this.address);
    }
    // -- Payment Channels --
    async openChannel(channelConfig) {
        const result = await this.channelManager.openChannel(channelConfig);
        this.interceptor.setChannelForProvider(channelConfig.provider, result.channelId);
        return result;
    }
    async activateChannel(channelId) {
        return await this.channelManager.activateChannel(channelId);
    }
    async closeChannel(channelId) {
        const channel = await this.channelManager.getChannel(channelId);
        this.interceptor.removeChannelForProvider(channel.provider);
        return await this.channelManager.closeChannel(channelId);
    }
    async getChannel(channelId) {
        return await this.channelManager.getChannel(channelId);
    }
    // -- Receipts --
    async signReceiptAsProvider(channelId, callCost, consumerAddress, requestHash, responseHash) {
        return await this.channelManager.signReceiptAsProvider(channelId, callCost, consumerAddress, requestHash, responseHash);
    }
    async verifyAndStoreReceipt(channelId, receipt, providerAddress, ratePerCall) {
        return await this.channelManager.verifyAndStoreReceipt(channelId, receipt, providerAddress, ratePerCall);
    }
    getReceipts(channelId) {
        return this.channelManager.getReceipts(channelId);
    }
    // -- Batch Sessions (A2) --
    startBatchSession(provider, deposit, limits) {
        return this.batchManager.startSession(this.address, provider, deposit, limits);
    }
    endBatchSession(sessionId, reason) {
        return this.batchManager.endSession(sessionId, reason);
    }
    getBatchSession(sessionId) {
        return this.batchManager.getSession(sessionId);
    }
    getActiveBatchSessions() {
        return this.batchManager.getActiveSessions();
    }
    canAffordBatchCall(sessionId, callCost) {
        return this.batchManager.canAfford(sessionId, callCost);
    }
    getBatchManager() {
        return this.batchManager;
    }
    // -- Intercepted Fetch --
    async fetch(url, init, options) {
        return await this.interceptor.fetch(url, init, options);
    }
    setChannelForProvider(provider, channelId) {
        this.interceptor.setChannelForProvider(provider, channelId);
    }
    // -- Usage --
    getUsageLogs() {
        return this.usage.getLogs();
    }
    getTotalSpent() {
        return this.usage.getTotalSpent();
    }
    // -- Contracts (advanced) --
    getContractService() {
        return this.contractService;
    }
    getChannelManager() {
        return this.channelManager;
    }
}
