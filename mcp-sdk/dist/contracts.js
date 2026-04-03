import { createPublicClient, http, encodeFunctionData, decodeEventLog, keccak256, toHex } from "viem";
import { paymentChannelAbi, agentRegistryAbi, kiteAAWalletAbi, walletFactoryAbi, erc20Abi, } from "./abis.js";
export class ContractService {
    client;
    config;
    wdkAccount;
    constructor(config, wdkAccount) {
        this.config = config;
        this.wdkAccount = wdkAccount;
        this.client = createPublicClient({
            transport: http(config.rpcUrl),
        });
    }
    // -- Helpers --
    async sendTx(to, data, value = 0n) {
        return await this.wdkAccount.sendTransaction({ to, value, data });
    }
    async waitAndDecodeLogs(hash, abi, eventName) {
        const receipt = await this.wdkAccount.getTransactionReceipt(hash);
        if (!receipt)
            return null;
        for (const log of receipt.logs) {
            try {
                const decoded = decodeEventLog({
                    abi,
                    data: log.data,
                    topics: log.topics,
                });
                const d = decoded;
                if (d.eventName === eventName)
                    return d;
            }
            catch {
                continue;
            }
        }
        return null;
    }
    // -- Agent Registry --
    async registerAgent(agentId, domain, agentAddress, walletContract) {
        const agentIdBytes32 = keccak256(toHex(agentId));
        const data = encodeFunctionData({
            abi: agentRegistryAbi,
            functionName: "registerAgent",
            args: [
                agentIdBytes32,
                domain,
                agentAddress,
                walletContract,
            ],
        });
        const result = await this.sendTx(this.config.contracts.agentRegistry, data);
        return { txHash: result.hash, agentIdBytes32 };
    }
    async registerSession(agentId, sessionKey, validUntil) {
        const agentIdBytes32 = keccak256(toHex(agentId));
        const data = encodeFunctionData({
            abi: agentRegistryAbi,
            functionName: "registerSession",
            args: [agentIdBytes32, sessionKey, BigInt(validUntil)],
        });
        const result = await this.sendTx(this.config.contracts.agentRegistry, data);
        return result.hash;
    }
    async getAgent(agentId) {
        const agentIdBytes32 = keccak256(toHex(agentId));
        return await this.client.readContract({
            address: this.config.contracts.agentRegistry,
            abi: agentRegistryAbi,
            functionName: "getAgent",
            args: [agentIdBytes32],
        });
    }
    async resolveAgentByDomain(domain) {
        return await this.client.readContract({
            address: this.config.contracts.agentRegistry,
            abi: agentRegistryAbi,
            functionName: "resolveAgentByDomain",
            args: [domain],
        });
    }
    // -- KiteAAWallet --
    async depositToWallet(token, amount) {
        // First approve
        const approveData = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [
                this.config.contracts.kiteAAWallet,
                amount,
            ],
        });
        await this.sendTx(token, approveData);
        // Then deposit
        const depositData = encodeFunctionData({
            abi: kiteAAWalletAbi,
            functionName: "deposit",
            args: [token, amount],
        });
        const result = await this.sendTx(this.config.contracts.kiteAAWallet, depositData);
        return result.hash;
    }
    async addSessionKeyRule(sessionKey, agentId, valueLimit, dailyLimit, validUntil, allowedRecipients) {
        const agentIdBytes32 = keccak256(toHex(agentId));
        const data = encodeFunctionData({
            abi: kiteAAWalletAbi,
            functionName: "addSessionKeyRule",
            args: [
                sessionKey,
                agentIdBytes32,
                valueLimit,
                dailyLimit,
                BigInt(validUntil),
                allowedRecipients,
            ],
        });
        const result = await this.sendTx(this.config.contracts.kiteAAWallet, data);
        return result.hash;
    }
    async getSessionRule(sessionKey) {
        return await this.client.readContract({
            address: this.config.contracts.kiteAAWallet,
            abi: kiteAAWalletAbi,
            functionName: "getSessionRule",
            args: [sessionKey],
        });
    }
    async getTokenBalance(token, address) {
        return (await this.client.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
        }));
    }
    // -- Payment Channel --
    async openChannel(provider, token, mode, deposit, maxDuration, ratePerCall) {
        // Approve deposit for prepaid
        if (mode === 0 && deposit > 0n) {
            const approveData = encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [
                    this.config.contracts.paymentChannel,
                    deposit,
                ],
            });
            await this.sendTx(token, approveData);
        }
        const data = encodeFunctionData({
            abi: paymentChannelAbi,
            functionName: "openChannel",
            args: [
                provider,
                token,
                mode,
                deposit,
                BigInt(maxDuration),
                ratePerCall,
            ],
        });
        const result = await this.sendTx(this.config.contracts.paymentChannel, data);
        // Decode ChannelOpened event to get channelId
        const event = await this.waitAndDecodeLogs(result.hash, paymentChannelAbi, "ChannelOpened");
        const channelId = event?.args?.channelId;
        return { txHash: result.hash, channelId };
    }
    async activateChannel(channelId) {
        const data = encodeFunctionData({
            abi: paymentChannelAbi,
            functionName: "activateChannel",
            args: [channelId],
        });
        const result = await this.sendTx(this.config.contracts.paymentChannel, data);
        return result.hash;
    }
    async closeChannel(channelId, sequenceNumber, cumulativeCost, timestamp, providerSignature) {
        const data = encodeFunctionData({
            abi: paymentChannelAbi,
            functionName: "closeChannel",
            args: [
                channelId,
                BigInt(sequenceNumber),
                cumulativeCost,
                BigInt(timestamp),
                providerSignature,
            ],
        });
        const result = await this.sendTx(this.config.contracts.paymentChannel, data);
        return result.hash;
    }
    async closeChannelEmpty(channelId) {
        const data = encodeFunctionData({
            abi: paymentChannelAbi,
            functionName: "closeChannelEmpty",
            args: [channelId],
        });
        const result = await this.sendTx(this.config.contracts.paymentChannel, data);
        return result.hash;
    }
    async getChannel(channelId) {
        const result = (await this.client.readContract({
            address: this.config.contracts.paymentChannel,
            abi: paymentChannelAbi,
            functionName: "getChannel",
            args: [channelId],
        }));
        return {
            channelId,
            consumer: result[0],
            provider: result[1],
            token: result[2],
            mode: Number(result[3]),
            deposit: result[4],
            maxDuration: Number(result[5]),
            openedAt: Number(result[6]),
            expiresAt: Number(result[7]),
            ratePerCall: result[8],
            settledAmount: result[9],
            status: Number(result[10]),
        };
    }
    async getReceiptHash(channelId, sequenceNumber, cumulativeCost, timestamp) {
        return (await this.client.readContract({
            address: this.config.contracts.paymentChannel,
            abi: paymentChannelAbi,
            functionName: "getReceiptHash",
            args: [channelId, BigInt(sequenceNumber), cumulativeCost, BigInt(timestamp)],
        }));
    }
    async isChannelExpired(channelId) {
        return (await this.client.readContract({
            address: this.config.contracts.paymentChannel,
            abi: paymentChannelAbi,
            functionName: "isChannelExpired",
            args: [channelId],
        }));
    }
    // -- Wallet Factory --
    async deployWalletViaFactory() {
        if (!this.config.contracts.walletFactory) {
            throw new Error("Wallet factory address not configured");
        }
        const data = encodeFunctionData({
            abi: walletFactoryAbi,
            functionName: "deployWallet",
        });
        const result = await this.sendTx(this.config.contracts.walletFactory, data);
        return result.hash;
    }
    async getWalletFromFactory(owner) {
        if (!this.config.contracts.walletFactory) {
            throw new Error("Wallet factory address not configured");
        }
        return (await this.client.readContract({
            address: this.config.contracts.walletFactory,
            abi: walletFactoryAbi,
            functionName: "getWallet",
            args: [owner],
        }));
    }
    // -- KiteAAWallet executePayment --
    async executePayment(walletAddress, sessionKey, recipient, token, amount) {
        const data = encodeFunctionData({
            abi: kiteAAWalletAbi,
            functionName: "executePayment",
            args: [
                sessionKey,
                recipient,
                token,
                amount,
            ],
        });
        const result = await this.sendTx(walletAddress, data);
        return result.hash;
    }
    // -- Direct Token Transfer (x402) --
    async transferToken(token, to, amount) {
        const data = encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [to, amount],
        });
        const result = await this.sendTx(token, data);
        return result.hash;
    }
    async getAllowance(token, owner, spender) {
        return (await this.client.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "allowance",
            args: [owner, spender],
        }));
    }
}
