import {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeEventLog,
  type PublicClient
} from "viem";
import {
  paymentChannelAbi,
  agentRegistryAbi,
  kiteAAWalletAbi,
  walletFactoryAbi,
  erc20Abi,
} from "./abis.js";
import type { KiteConfig, ChannelState } from "./types.js";

export class ContractService {
  private readonly client: PublicClient;
  private readonly config: KiteConfig;
  private readonly wdkAccount: any;

  constructor(config: KiteConfig, wdkAccount: any) {
    this.config = config;
    this.wdkAccount = wdkAccount;
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    });
  }

  // -- Helpers --

  private async sendTx(
    to: string,
    data: `0x${string}`,
    value: bigint = 0n
  ): Promise<{ hash: string; fee: bigint }> {
    return await this.wdkAccount.sendTransaction({ to, value, data });
  }

  private async waitAndDecodeLogs(
    hash: string,
    abi: any,
    eventName: string
  ): Promise<any> {
    const receipt = await this.wdkAccount.getTransactionReceipt(hash);
    if (!receipt) return null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        const d = decoded as { eventName: string; args: Record<string, unknown> };
        if (d.eventName === eventName) return d;
      } catch {
        continue;
      }
    }
    return null;
  }

  // -- Agent Registry --

  async registerAgent(
    agentAddress: string,
    walletContract: string,
    agentIndex: number,
    metadata: `0x${string}`,
  ): Promise<{ txHash: string; agentId: `0x${string}` }> {
    const data = encodeFunctionData({
      abi: agentRegistryAbi,
      functionName: "registerAgent",
      args: [
        agentAddress as `0x${string}`,
        walletContract as `0x${string}`,
        BigInt(agentIndex),
        metadata,
      ],
    });
    const result = await this.sendTx(this.config.contracts.agentRegistry, data);

    // Decode AgentRegistered event to get the on-chain generated agentId
    const event = await this.waitAndDecodeLogs(
      result.hash,
      agentRegistryAbi,
      "AgentRegistered",
    );
    const agentId = event?.args?.agentId as `0x${string}`;
    if (!agentId) throw new Error("Failed to decode AgentRegistered event");

    return { txHash: result.hash, agentId };
  }

  async registerSession(
    agentId: `0x${string}`,
    sessionKey: string,
    sessionIndex: number,
    validUntil: number,
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: agentRegistryAbi,
      functionName: "registerSession",
      args: [agentId, sessionKey as `0x${string}`, BigInt(sessionIndex), BigInt(validUntil)],
    });
    const result = await this.sendTx(this.config.contracts.agentRegistry, data);
    return result.hash;
  }

  async getAgent(agentId: `0x${string}`) {
    return await this.client.readContract({
      address: this.config.contracts.agentRegistry as `0x${string}`,
      abi: agentRegistryAbi,
      functionName: "getAgent",
      args: [agentId],
    });
  }

  async resolveAgentByAddress(agentAddr: string) {
    return await this.client.readContract({
      address: this.config.contracts.agentRegistry as `0x${string}`,
      abi: agentRegistryAbi,
      functionName: "resolveAgentByAddress",
      args: [agentAddr as `0x${string}`],
    });
  }

  async getOwnerAgents(ownerAddr: string): Promise<readonly `0x${string}`[]> {
    return (await this.client.readContract({
      address: this.config.contracts.agentRegistry as `0x${string}`,
      abi: agentRegistryAbi,
      functionName: "getOwnerAgents",
      args: [ownerAddr as `0x${string}`],
    })) as readonly `0x${string}`[];
  }

  // -- KiteAAWallet --

  async registerUser(): Promise<string> {
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "register",
    });
    const result = await this.sendTx(this.config.contracts.kiteAAWallet, data);
    return result.hash;
  }

  async isUserRegistered(address: string): Promise<boolean> {
    return (await this.client.readContract({
      address: this.config.contracts.kiteAAWallet as `0x${string}`,
      abi: kiteAAWalletAbi,
      functionName: "isRegistered",
      args: [address as `0x${string}`],
    })) as boolean;
  }

  async addAgentId(agentId: `0x${string}`, owner: string): Promise<string> {
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "addAgentId",
      args: [agentId, owner as `0x${string}`],
    });
    const result = await this.sendTx(this.config.contracts.kiteAAWallet, data);
    return result.hash;
  }

  async getUserAgentIds(address: string): Promise<readonly `0x${string}`[]> {
    return (await this.client.readContract({
      address: this.config.contracts.kiteAAWallet as `0x${string}`,
      abi: kiteAAWalletAbi,
      functionName: "getUserAgentIds",
      args: [address as `0x${string}`],
    })) as readonly `0x${string}`[];
  }

  async getAgentSessionKeys(agentId: `0x${string}`): Promise<readonly `0x${string}`[]> {
    return (await this.client.readContract({
      address: this.config.contracts.kiteAAWallet as `0x${string}`,
      abi: kiteAAWalletAbi,
      functionName: "getAgentSessionKeys",
      args: [agentId],
    })) as readonly `0x${string}`[];
  }

  async getUserBalance(address: string, token: string): Promise<bigint> {
    return (await this.client.readContract({
      address: this.config.contracts.kiteAAWallet as `0x${string}`,
      abi: kiteAAWalletAbi,
      functionName: "getUserBalance",
      args: [address as `0x${string}`, token as `0x${string}`],
    })) as bigint;
  }

  async getNativeBalance(address: string): Promise<bigint> {
    return await this.client.getBalance({
      address: address as `0x${string}`,
    });
  }

  async sendNativeToken(to: string, value: bigint): Promise<string> {
    const result = await this.sendTx(to, "0x" as `0x${string}`, value);
    return result.hash;
  }

  async depositToWallet(token: string, amount: bigint): Promise<string> {
    // First approve
    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [
        this.config.contracts.kiteAAWallet as `0x${string}`,
        amount,
      ],
    });
    await this.sendTx(token, approveData);

    // Then deposit
    const depositData = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "deposit",
      args: [token as `0x${string}`, amount],
    });
    const result = await this.sendTx(
      this.config.contracts.kiteAAWallet,
      depositData
    );
    return result.hash;
  }

  async addSessionKeyRule(
    sessionKey: string,
    agentId: `0x${string}`,
    sessionIndex: number,
    valueLimit: bigint,
    dailyLimit: bigint,
    validUntil: number,
    blockedProviders: string[],
    metadata: `0x${string}` = "0x",
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "addSessionKeyRule",
      args: [
        sessionKey as `0x${string}`,
        agentId,
        BigInt(sessionIndex),
        valueLimit,
        dailyLimit,
        BigInt(validUntil),
        blockedProviders as `0x${string}`[],
        metadata,
      ],
    });
    const result = await this.sendTx(
      this.config.contracts.kiteAAWallet,
      data,
    );
    return result.hash;
  }

  async updateBlockedProviders(
    sessionKey: string,
    blockedProviders: string[],
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "updateBlockedProviders",
      args: [
        sessionKey as `0x${string}`,
        blockedProviders as `0x${string}`[],
      ],
    });
    const result = await this.sendTx(this.config.contracts.kiteAAWallet, data);
    return result.hash;
  }

  async blockProvider(sessionKey: string, provider: string): Promise<string> {
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "blockProvider",
      args: [sessionKey as `0x${string}`, provider as `0x${string}`],
    });
    const result = await this.sendTx(this.config.contracts.kiteAAWallet, data);
    return result.hash;
  }

  async unblockProvider(sessionKey: string, provider: string): Promise<string> {
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "unblockProvider",
      args: [sessionKey as `0x${string}`, provider as `0x${string}`],
    });
    const result = await this.sendTx(this.config.contracts.kiteAAWallet, data);
    return result.hash;
  }

  async getSessionRule(sessionKey: string) {
    return await this.client.readContract({
      address: this.config.contracts.kiteAAWallet as `0x${string}`,
      abi: kiteAAWalletAbi,
      functionName: "getSessionRule",
      args: [sessionKey as `0x${string}`],
    });
  }

  async getTokenBalance(token: string, address: string): Promise<bigint> {
    return (await this.client.readContract({
      address: token as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    })) as bigint;
  }

  // -- Payment Channel --

  async openChannel(
    provider: string,
    token: string,
    mode: number,
    deposit: bigint,
    maxSpend: bigint,
    maxDuration: number,
    ratePerCall: bigint
  ): Promise<{ txHash: string; channelId: `0x${string}` | undefined }> {
    // Approve deposit for prepaid
    if (mode === 0 && deposit > 0n) {
      const approveData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [
          this.config.contracts.paymentChannel as `0x${string}`,
          deposit,
        ],
      });
      await this.sendTx(token, approveData);
    }

    const data = encodeFunctionData({
      abi: paymentChannelAbi,
      functionName: "openChannel",
      args: [
        provider as `0x${string}`,
        token as `0x${string}`,
        mode,
        deposit,
        maxSpend,
        BigInt(maxDuration),
        ratePerCall,
      ],
    });
    const result = await this.sendTx(
      this.config.contracts.paymentChannel,
      data
    );

    // Decode ChannelOpened event to get channelId
    const event = await this.waitAndDecodeLogs(
      result.hash,
      paymentChannelAbi,
      "ChannelOpened"
    );
    const channelId = event?.args?.channelId as `0x${string}` | undefined;

    return { txHash: result.hash, channelId };
  }

  async activateChannel(channelId: `0x${string}`): Promise<string> {
    const data = encodeFunctionData({
      abi: paymentChannelAbi,
      functionName: "activateChannel",
      args: [channelId],
    });
    const result = await this.sendTx(
      this.config.contracts.paymentChannel,
      data
    );
    return result.hash;
  }

  async initiateSettlement(
    channelId: `0x${string}`,
    sequenceNumber: number,
    cumulativeCost: bigint,
    timestamp: number,
    providerSignature: `0x${string}`,
    merkleRoot: `0x${string}` = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: paymentChannelAbi,
      functionName: "initiateSettlement",
      args: [
        channelId,
        BigInt(sequenceNumber),
        cumulativeCost,
        BigInt(timestamp),
        providerSignature,
        merkleRoot,
      ],
    });
    const result = await this.sendTx(
      this.config.contracts.paymentChannel,
      data
    );
    return result.hash;
  }

  async submitReceipt(
    channelId: `0x${string}`,
    sequenceNumber: number,
    cumulativeCost: bigint,
    timestamp: number,
    providerSignature: `0x${string}`,
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: paymentChannelAbi,
      functionName: "submitReceipt",
      args: [
        channelId,
        BigInt(sequenceNumber),
        cumulativeCost,
        BigInt(timestamp),
        providerSignature,
      ],
    });
    const result = await this.sendTx(
      this.config.contracts.paymentChannel,
      data
    );
    return result.hash;
  }

  async finalize(
    channelId: `0x${string}`,
    merkleRoot: `0x${string}` = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: paymentChannelAbi,
      functionName: "finalize",
      args: [channelId, merkleRoot],
    });
    const result = await this.sendTx(
      this.config.contracts.paymentChannel,
      data
    );
    return result.hash;
  }

  async forceCloseExpired(channelId: `0x${string}`): Promise<string> {
    const data = encodeFunctionData({
      abi: paymentChannelAbi,
      functionName: "forceCloseExpired",
      args: [channelId],
    });
    const result = await this.sendTx(
      this.config.contracts.paymentChannel,
      data
    );
    return result.hash;
  }

  async getChannel(channelId: `0x${string}`): Promise<ChannelState> {
    const result = (await this.client.readContract({
      address: this.config.contracts.paymentChannel as `0x${string}`,
      abi: paymentChannelAbi,
      functionName: "getChannel",
      args: [channelId],
    })) as any;

    return {
      channelId,
      consumer: result[0],
      provider: result[1],
      token: result[2],
      mode: Number(result[3]),
      deposit: result[4],
      maxSpend: result[5],
      maxDuration: Number(result[6]),
      openedAt: Number(result[7]),
      expiresAt: Number(result[8]),
      ratePerCall: result[9],
      settledAmount: result[10],
      status: Number(result[11]),
      settlementDeadline: Number(result[12]),
      highestClaimedCost: result[13],
      highestSequenceNumber: Number(result[14]),
    };
  }

  async getSettlementState(channelId: `0x${string}`): Promise<{
    deadline: number;
    highestCost: bigint;
    highestSeq: number;
    initiator: string;
    challengeOpen: boolean;
  }> {
    const result = (await this.client.readContract({
      address: this.config.contracts.paymentChannel as `0x${string}`,
      abi: paymentChannelAbi,
      functionName: "getSettlementState",
      args: [channelId],
    })) as any;

    return {
      deadline: Number(result[0]),
      highestCost: result[1],
      highestSeq: Number(result[2]),
      initiator: result[3],
      challengeOpen: result[4],
    };
  }

  async getReceiptHash(
    channelId: `0x${string}`,
    sequenceNumber: number,
    cumulativeCost: bigint,
    timestamp: number
  ): Promise<`0x${string}`> {
    return (await this.client.readContract({
      address: this.config.contracts.paymentChannel as `0x${string}`,
      abi: paymentChannelAbi,
      functionName: "getReceiptHash",
      args: [channelId, BigInt(sequenceNumber), cumulativeCost, BigInt(timestamp)],
    })) as `0x${string}`;
  }

  async isChannelExpired(channelId: `0x${string}`): Promise<boolean> {
    return (await this.client.readContract({
      address: this.config.contracts.paymentChannel as `0x${string}`,
      abi: paymentChannelAbi,
      functionName: "isChannelExpired",
      args: [channelId],
    })) as boolean;
  }

  // -- Wallet Factory --

  async deployWalletViaFactory(): Promise<string> {
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

  async getWalletFromFactory(owner: string): Promise<string> {
    if (!this.config.contracts.walletFactory) {
      throw new Error("Wallet factory address not configured");
    }
    return (await this.client.readContract({
      address: this.config.contracts.walletFactory as `0x${string}`,
      abi: walletFactoryAbi,
      functionName: "getWallet",
      args: [owner as `0x${string}`],
    })) as string;
  }

  // -- KiteAAWallet executePayment --

  async executePayment(
    walletAddress: string,
    sessionKey: string,
    recipient: string,
    token: string,
    amount: bigint
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "executePayment",
      args: [
        sessionKey as `0x${string}`,
        recipient as `0x${string}`,
        token as `0x${string}`,
        amount,
      ],
    });
    const result = await this.sendTx(walletAddress, data);
    return result.hash;
  }

  // -- Direct Token Transfer (x402) --

  async transferToken(
    token: string,
    to: string,
    amount: bigint
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [to as `0x${string}`, amount],
    });
    const result = await this.sendTx(token, data);
    return result.hash;
  }

  async getAllowance(
    token: string,
    owner: string,
    spender: string
  ): Promise<bigint> {
    return (await this.client.readContract({
      address: token as `0x${string}`,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner as `0x${string}`, spender as `0x${string}`],
    })) as bigint;
  }
}
