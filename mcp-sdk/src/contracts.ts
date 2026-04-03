import {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeEventLog,
  keccak256,
  toHex,
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
    agentId: string,
    domain: string,
    agentAddress: string,
    walletContract: string
  ): Promise<{ txHash: string; agentIdBytes32: `0x${string}` }> {
    const agentIdBytes32 = keccak256(toHex(agentId));
    const data = encodeFunctionData({
      abi: agentRegistryAbi,
      functionName: "registerAgent",
      args: [
        agentIdBytes32,
        domain,
        agentAddress as `0x${string}`,
        walletContract as `0x${string}`,
      ],
    });
    const result = await this.sendTx(this.config.contracts.agentRegistry, data);
    return { txHash: result.hash, agentIdBytes32 };
  }

  async registerSession(
    agentId: string,
    sessionKey: string,
    validUntil: number
  ): Promise<string> {
    const agentIdBytes32 = keccak256(toHex(agentId));
    const data = encodeFunctionData({
      abi: agentRegistryAbi,
      functionName: "registerSession",
      args: [agentIdBytes32, sessionKey as `0x${string}`, BigInt(validUntil)],
    });
    const result = await this.sendTx(this.config.contracts.agentRegistry, data);
    return result.hash;
  }

  async getAgent(agentId: string) {
    const agentIdBytes32 = keccak256(toHex(agentId));
    return await this.client.readContract({
      address: this.config.contracts.agentRegistry as `0x${string}`,
      abi: agentRegistryAbi,
      functionName: "getAgent",
      args: [agentIdBytes32],
    });
  }

  async resolveAgentByDomain(domain: string) {
    return await this.client.readContract({
      address: this.config.contracts.agentRegistry as `0x${string}`,
      abi: agentRegistryAbi,
      functionName: "resolveAgentByDomain",
      args: [domain],
    });
  }

  // -- KiteAAWallet --

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
    agentId: string,
    valueLimit: bigint,
    dailyLimit: bigint,
    validUntil: number,
    allowedRecipients: string[]
  ): Promise<string> {
    const agentIdBytes32 = keccak256(toHex(agentId));
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "addSessionKeyRule",
      args: [
        sessionKey as `0x${string}`,
        agentIdBytes32,
        valueLimit,
        dailyLimit,
        BigInt(validUntil),
        allowedRecipients as `0x${string}`[],
      ],
    });
    const result = await this.sendTx(
      this.config.contracts.kiteAAWallet,
      data
    );
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

  async closeChannel(
    channelId: `0x${string}`,
    sequenceNumber: number,
    cumulativeCost: bigint,
    timestamp: number,
    providerSignature: `0x${string}`
  ): Promise<string> {
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
    const result = await this.sendTx(
      this.config.contracts.paymentChannel,
      data
    );
    return result.hash;
  }

  async closeChannelEmpty(channelId: `0x${string}`): Promise<string> {
    const data = encodeFunctionData({
      abi: paymentChannelAbi,
      functionName: "closeChannelEmpty",
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
      maxDuration: Number(result[5]),
      openedAt: Number(result[6]),
      expiresAt: Number(result[7]),
      ratePerCall: result[8],
      settledAmount: result[9],
      status: Number(result[10]),
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
