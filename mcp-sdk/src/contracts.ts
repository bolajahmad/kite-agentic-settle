import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  formatUnits,
  http,
  type PublicClient,
} from "viem";
import {
  erc20Abi,
  identityRegistryAbi,
  kiteAAWalletAbi,
  paymentChannelAbi,
  walletFactoryAbi,
} from "./abis.js";
import type { ChannelState, KiteConfig } from "./types.js";

export class ContractService {
  private readonly client: PublicClient;
  private readonly config: KiteConfig;
  private readonly wdkAccount: any;
  /** The EOA address — owner of KiteAAWallet funds. */
  private readonly eoaAddress: string;

  constructor(config: KiteConfig, wdkAccount: any, eoaAddress?: string) {
    this.config = config;
    this.wdkAccount = wdkAccount;
    this.eoaAddress = eoaAddress ?? (wdkAccount.getAddress() as string);
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    });
  }

  getChainId(): number {
    return this.config.chainId;
  }

  getKiteAAWalletAddress(): string {
    return this.config.contracts.kiteAAWallet;
  }

  // -- Helpers --

  private async sendTx(
    to: string,
    data: `0x${string}`,
    value: bigint = 0n,
  ): Promise<{ hash: string; fee: bigint }> {
    try {
      return await this.wdkAccount.sendTransaction({ to, value, data });
    } catch (err: any) {
      console.log({ err });
      const reason =
        err?.cause?.reason ??
        err?.cause?.shortMessage ??
        err?.shortMessage ??
        err?.message ??
        String(err);
      console.error(`[sendTx] Failed calling ${to}:`, reason);
      throw new Error(reason);
    }
  }

  private async waitAndDecodeLogs(
    hash: string,
    abi: any,
    eventName: string,
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
        const d = decoded as {
          eventName: string;
          args: Record<string, unknown>;
        };
        if (d.eventName === eventName) return d;
      } catch {
        continue;
      }
    }
    return null;
  }

  // -- Agent Registry --

  // -- Agent / IdentityRegistry --

  /**
   * Register an agent NFT on IdentityRegistry.
   * Returns the on-chain agentId (ERC-721 tokenId) decoded from the Registered event.
   */
  async registerAgentOnRegistry(
    agentURI?: string,
  ): Promise<{ txHash: string; agentId: bigint }> {
    const data = encodeFunctionData({
      abi: identityRegistryAbi,
      functionName: "register",
      args: agentURI ? [agentURI] : undefined,
    });
    const result = await this.sendTx(
      this.config.contracts.identityRegistry,
      data,
    );
    const event = await this.waitAndDecodeLogs(
      result.hash,
      identityRegistryAbi,
      "Registered",
    );
    const agentId = event?.args?.agentId as bigint;
    if (agentId === undefined)
      throw new Error("Failed to decode Registered event");
    return { txHash: result.hash, agentId };
  }

  /** Register a session key on IdentityRegistry (via KiteAAWallet proxy). */
  async registerSessionOnRegistry(
    agentId: bigint,
    sessionKey: string,
    user: string,
    walletContract: string,
    valueLimit: bigint,
    maxValueAllowed: bigint,
    validUntil: bigint,
    blockedAgents: bigint[] = [],
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: identityRegistryAbi,
      functionName: "registerSession",
      args: [
        agentId,
        sessionKey as `0x${string}`,
        user as `0x${string}`,
        walletContract as `0x${string}`,
        valueLimit,
        maxValueAllowed,
        validUntil,
        blockedAgents,
      ],
    });
    const result = await this.sendTx(
      this.config.contracts.identityRegistry,
      data,
    );
    return result.hash;
  }

  /** Get the URI for an agent NFT. */
  async getAgentURI(agentId: bigint): Promise<string> {
    return (await this.client.readContract({
      address: this.config.contracts.identityRegistry as `0x${string}`,
      abi: identityRegistryAbi,
      functionName: "agentURI",
      args: [agentId],
    })) as string;
  }

  /** Update the URI for an agent NFT (caller must be the agent NFT owner). */
  async setAgentURI(agentId: bigint, newURI: string): Promise<string> {
    const data = encodeFunctionData({
      abi: identityRegistryAbi,
      functionName: "setAgentURI",
      args: [agentId, newURI],
    });
    const result = await this.sendTx(
      this.config.contracts.identityRegistry,
      data,
    );
    return result.hash;
  }

  /** Get the EOA owner of an agent NFT. */
  async getAgentOwner(agentId: bigint): Promise<string> {
    return (await this.client.readContract({
      address: this.config.contracts.identityRegistry as `0x${string}`,
      abi: identityRegistryAbi,
      functionName: "ownerOf",
      args: [agentId],
    })) as string;
  }

  // ── IdentityRegistry session queries ─────────────────────────────

  /** Read session status from IdentityRegistry. */
  async validateSession(sessionKey: string) {
    return await this.client.readContract({
      address: this.config.contracts.identityRegistry as `0x${string}`,
      abi: identityRegistryAbi,
      functionName: "validateSession",
      args: [sessionKey as `0x${string}`],
    });
  }

  /** Full session rule including blockedProviders array. */
  async getSessionFromRegistry(sessionKey: string) {
    return await this.client.readContract({
      address: this.config.contracts.identityRegistry as `0x${string}`,
      abi: identityRegistryAbi,
      functionName: "getSession",
      args: [sessionKey as `0x${string}`],
    });
  }

  /** All session keys ever registered for the given agent (by IdentityRegistry tokenId). */
  /** All session keys ever registered for the given agent. */
  async getAgentSessionsFromRegistry(
    agentId: bigint,
  ): Promise<readonly `0x${string}`[]> {
    return (await this.client.readContract({
      address: this.config.contracts.identityRegistry as `0x${string}`,
      abi: identityRegistryAbi,
      functionName: "getAgentSessions",
      args: [agentId],
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
    return await this.client.readContract({
      address: this.config.contracts.kiteAAWallet as `0x${string}`,
      abi: kiteAAWalletAbi,
      functionName: "isRegistered",
      args: [address as `0x${string}`],
    });
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
      args: [this.config.contracts.kiteAAWallet as `0x${string}`, amount],
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
      depositData,
    );
    return result.hash;
  }

  async withdrawFromWallet(token: string, amount: bigint): Promise<string> {
    const withdrawData = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "withdraw",
      args: [token as `0x${string}`, amount],
    });
    const result = await this.sendTx(
      this.config.contracts.kiteAAWallet,
      withdrawData,
    );
    return result.hash;
  }

  async addSessionKeyRule(
    agentId: bigint,
    sessionKey: string,
    valueLimit: bigint,
    maxValueAllowed: bigint,
    validUntil: bigint,
    blockedAgents: bigint[] = [],
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "addSessionKeyRule",
      args: [
        agentId,
        sessionKey as `0x${string}`,
        valueLimit,
        maxValueAllowed,
        validUntil,
        blockedAgents,
      ],
    });
    const result = await this.sendTx(this.config.contracts.kiteAAWallet, data);
    return result.hash;
  }

  /** Block or unblock a provider at the user level (applies to all sessions). */
  async setBlockedProvider(
    provider: string,
    blocked: boolean,
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "setBlockedProvider",
      args: [provider as `0x${string}`, blocked],
    });
    const result = await this.sendTx(this.config.contracts.kiteAAWallet, data);
    return result.hash;
  }

  async revokeSessionKey(sessionKey: string): Promise<string> {
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "revokeSessionKey",
      args: [sessionKey as `0x${string}`],
    });
    const result = await this.sendTx(this.config.contracts.kiteAAWallet, data);
    return result.hash;
  }

  async isNonceUsed(sessionKey: string, nonce: bigint): Promise<boolean> {
    return await this.client.readContract({
      address: this.config.contracts.kiteAAWallet as `0x${string}`,
      abi: kiteAAWalletAbi,
      functionName: "isNonceUsed",
      args: [sessionKey as `0x${string}`, nonce],
    });
  }

  async getSessionSpent(sessionKey: string): Promise<bigint> {
    return await this.client.readContract({
      address: this.config.contracts.kiteAAWallet as `0x${string}`,
      abi: kiteAAWalletAbi,
      functionName: "getSessionSpent",
      args: [sessionKey as `0x${string}`],
    });
  }

  async getDepositedTokenBalance(
    token: `0x${string}`,
    address: `0x${string}`,
  ): Promise<bigint> {
    return await this.client.readContract({
      address: this.config.contracts.kiteAAWallet as `0x${string}`,
      abi: kiteAAWalletAbi,
      functionName: "getUserBalance",
      args: [address, token],
    });
  }

  async getTokenBalance(
    token: `0x${string}`,
    address: `0x${string}`,
  ): Promise<bigint> {
    return await this.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
  }

  // -- Payment Channel --

  async openChannel(
    provider: string,
    token: string,
    mode: number,
    deposit: bigint,
    maxSpend: bigint,
    maxDuration: number,
    maxPerCall: bigint,
  ): Promise<{ txHash: string; channelId: `0x${string}` | undefined }> {
    const signerAddress = this.wdkAccount.getAddress() as string;
    const user = this.eoaAddress as `0x${string}`;
    const walletContract = this.config.contracts.kiteAAWallet as `0x${string}`;

    // ── Pre-flight diagnostics ──────────────────────────────────────
    // Balance check: for prepaid the deposit comes from the EOA's
    // KiteAAWallet balance — the agent/signer itself has no ERC20 tokens.
    let balance = 0n;
    if (mode === 0 && deposit > 0n) {
      balance = await this.getDepositedTokenBalance(
        token as `0x${string}`,
        user,
      );
    }

    if (mode === 0) {
      if (balance < deposit) {
        throw new Error(
          `Insufficient KiteAAWallet balance: have ${formatUnits(balance, 18)}, need ${formatUnits(deposit, 18)}`,
        );
      }
    }

    // No ERC20 approve needed — KiteAAWallet.withdrawForChannel transfers
    // directly from the wallet contract to PaymentChannel.

    // ── Simulate the call to surface the revert reason ──────────────
    try {
      await this.client.simulateContract({
        address: this.config.contracts.paymentChannel as `0x${string}`,
        abi: paymentChannelAbi,
        functionName: "openChannel",
        args: [
          provider as `0x${string}`,
          token as `0x${string}`,
          mode,
          deposit,
          maxSpend,
          BigInt(maxDuration),
          maxPerCall,
          walletContract,
        ],
        account: signerAddress as `0x${string}`,
      });
    } catch (simErr: any) {
      const reason =
        simErr?.cause?.reason ??
        simErr?.shortMessage ??
        simErr?.message ??
        String(simErr);
      throw new Error(`openChannel simulation failed: ${reason}`);
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
        maxPerCall,
        walletContract,
      ],
    });
    const result = await this.sendTx(
      this.config.contracts.paymentChannel,
      data,
    );
    console.log(`[openChannel] Tx: ${result.hash}`);

    // Decode ChannelOpened event to get channelId
    const event = await this.waitAndDecodeLogs(
      result.hash,
      paymentChannelAbi,
      "ChannelOpened",
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
      data,
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
      data,
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
      data,
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
      data,
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
      data,
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
      maxPerCall: result[9],
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
    timestamp: number,
  ): Promise<`0x${string}`> {
    return (await this.client.readContract({
      address: this.config.contracts.paymentChannel as `0x${string}`,
      abi: paymentChannelAbi,
      functionName: "getReceiptHash",
      args: [
        channelId,
        BigInt(sequenceNumber),
        cumulativeCost,
        BigInt(timestamp),
      ],
    })) as `0x${string}`;
  }

  async isChannelExpired(channelId: `0x${string}`): Promise<boolean> {
    return await this.client.readContract({
      address: this.config.contracts.paymentChannel as `0x${string}`,
      abi: paymentChannelAbi,
      functionName: "isChannelExpired",
      args: [channelId],
    });
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
    agentId: bigint,
    sessionKey: string,
    recipient: string,
    token: string,
    amount: bigint,
    nonce: bigint,
    deadline: bigint,
    sig: `0x${string}`,
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "executePayment",
      args: [
        agentId,
        sessionKey as `0x${string}`,
        recipient as `0x${string}`,
        token as `0x${string}`,
        amount,
        nonce,
        deadline,
        sig,
      ],
    });
    const result = await this.sendTx(walletAddress, data);
    return result.hash;
  }

  // -- Direct Token Transfer (x402) --

  async transferToken(
    token: string,
    to: string,
    amount: bigint,
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
    spender: string,
  ): Promise<bigint> {
    return (await this.client.readContract({
      address: token as `0x${string}`,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner as `0x${string}`, spender as `0x${string}`],
    })) as bigint;
  }
}
