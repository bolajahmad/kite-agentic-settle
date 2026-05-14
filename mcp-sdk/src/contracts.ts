import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  formatUnits,
  http,
  zeroAddress,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  clientAgentVaultAbi,
  erc20Abi,
  identityRegistryAbi,
  kiteAAWalletAbi,
  paymentChannelAbi,
  walletFactoryAbi,
} from "./abis.js";
import type { ChannelState, KiteConfig } from "./types.js";
import { getCredential } from "./vars.js";

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
    const wallet = this.config.contracts.kiteAAWallet;
    if (!wallet) {
      throw new Error(
        "kiteAAWallet is not configured. Pass walletContract dynamically or set config.contracts.kiteAAWallet.",
      );
    }
    return wallet;
  }

  async resolveWalletContractForSession(
    sessionKey: string,
  ): Promise<`0x${string}` | null> {
    try {
      const session = (await this.validateSession(sessionKey)) as readonly [
        boolean,
        bigint,
        `0x${string}`,
        `0x${string}`,
        bigint,
      ];
      const walletContract = session[3];
      if (
        walletContract &&
        walletContract !== "0x0000000000000000000000000000000000000000"
      ) {
        return walletContract;
      }
    } catch {
      // Session may not exist yet. Callers can fall back to agent-level wallet resolution.
    }
    return null;
  }

  async getAgentWalletFromRegistry(
    agentId: bigint,
  ): Promise<{ walletContract: `0x${string}`; user: `0x${string}` } | null> {
    const result = (await this.client.readContract({
      address: this.config.contracts.identityRegistry as `0x${string}`,
      abi: identityRegistryAbi,
      functionName: "getAgentWallet",
      args: [agentId],
    })) as readonly [`0x${string}`, `0x${string}`];

    const walletContract = result[0];
    const user = result[1];
    if (
      !walletContract ||
      walletContract === "0x0000000000000000000000000000000000000000"
    ) {
      return null;
    }
    return { walletContract, user };
  }

  async getWalletUserBalance(
    walletContract: `0x${string}`,
    _walletOwner: `0x${string}`,
    token: `0x${string}`,
  ): Promise<bigint> {
    return (await this.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletContract],
    })) as bigint;
  }

  async getAvailableBalance(
    walletContract: `0x${string}`,
    token: `0x${string}`,
  ): Promise<bigint> {
    return (await this.client.readContract({
      address: walletContract,
      abi: clientAgentVaultAbi,
      functionName: "getAvailableBalance",
      args: [token],
    })) as bigint;
  }

  async getDeposit(walletContract: `0x${string}`): Promise<bigint> {
    return (await this.client.readContract({
      address: walletContract,
      abi: clientAgentVaultAbi,
      functionName: "getDeposit",
      args: [],
    })) as bigint;
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

  /** Register a session key on IdentityRegistry. */
  async registerSessionOnRegistry(params: {
    agentId: bigint;
    sessionKey: string;
    user: string;
    walletContract: string;
    validUntil: bigint;
    blockedAgents?: bigint[];
  }): Promise<string> {
    const data = encodeFunctionData({
      abi: identityRegistryAbi,
      functionName: "registerSession",
      args: [
        params.agentId,
        params.sessionKey as `0x${string}`,
        params.user as `0x${string}`,
        params.walletContract as `0x${string}`,
        params.validUntil,
        params.blockedAgents ?? [],
      ],
    });
    const result = await this.sendTx(
      this.config.contracts.identityRegistry,
      data,
    );
    return result.hash;
  }

  /** Revoke a session on IdentityRegistry. */
  async revokeSessionOnRegistry(sessionKey: string): Promise<string> {
    const data = encodeFunctionData({
      abi: identityRegistryAbi,
      functionName: "revokeSession",
      args: [sessionKey as `0x${string}`],
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

  /** Full session rule*/
  async getSessionFromRegistry(sessionKey: string) {
    try {
      return await this.client.readContract({
        address: this.config.contracts.identityRegistry as `0x${string}`,
        abi: identityRegistryAbi,
        functionName: "getSession",
        args: [sessionKey as `0x${string}`],
      });
    } catch {
      // Some deployed versions expose a different getSession return shape.
      // Fall back to validateSession and normalize to the expected tuple shape.
      const [active, agentId, user, walletContract, validUntil] =
        (await this.validateSession(sessionKey)) as readonly [
          boolean,
          bigint,
          `0x${string}`,
          `0x${string}`,
          bigint,
        ];
      return [agentId, user, walletContract, validUntil, [], active] as const;
    }
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
    const walletContract = this.getKiteAAWalletAddress();
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "register",
    });
    const result = await this.sendTx(walletContract, data);
    return result.hash;
  }

  async isUserRegistered(address: string): Promise<boolean> {
    const walletContract = this.getKiteAAWalletAddress();
    return await this.client.readContract({
      address: walletContract as `0x${string}`,
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

  async resolveOwnerVaultWalletAddress(): Promise<`0x${string}`> {
    const { GokiteAASDK } = await import("gokite-aa-sdk");
    const aaSdk = new GokiteAASDK(
      this.config.networkName || "kite_testnet",
      this.config.rpcUrl,
      this.config.bundlerUrl || "",
    );

    return aaSdk.getAccountAddress(
      this.eoaAddress as `0x${string}`,
    ) as `0x${string}`;
  }

  async depositToWallet(token: string, amount: bigint): Promise<string> {
    const walletContract = await this.resolveOwnerVaultWalletAddress();

    if ((token as `0x${string}`) === zeroAddress) {
      const depositData = encodeFunctionData({
        abi: clientAgentVaultAbi,
        functionName: "addDeposit",
        args: [],
      });
      const result = await this.sendTx(walletContract, depositData, amount);
      return result.hash;
    }

    const supported = await this.isVaultTokenSupported(
      walletContract,
      token as `0x${string}`,
    );
    if (!supported) {
      await this.addVaultSupportedToken(walletContract, token as `0x${string}`);
    }

    const transferData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [walletContract, amount],
    });
    const result = await this.sendTx(token, transferData);
    return result.hash;
  }

  async withdrawFromWallet(token: string, amount: bigint): Promise<string> {
    const walletContract = await this.resolveOwnerVaultWalletAddress();

    if ((token as `0x${string}`) === zeroAddress) {
      const withdrawData = encodeFunctionData({
        abi: clientAgentVaultAbi,
        functionName: "withdrawDepositTo",
        args: [this.eoaAddress as `0x${string}`, amount],
      });
      const result = await this.sendTx(walletContract, withdrawData);
      return result.hash;
    }

    const transferOutData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [this.eoaAddress as `0x${string}`, amount],
    });
    const executeData = encodeFunctionData({
      abi: clientAgentVaultAbi,
      functionName: "execute",
      args: [token as `0x${string}`, 0n, transferOutData],
    });
    const result = await this.sendTx(walletContract, executeData);
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
    const walletContract = this.getKiteAAWalletAddress();
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
    const result = await this.sendTx(walletContract, data);
    return result.hash;
  }

  /** Block or unblock a provider at the user level (applies to all sessions). */
  async setBlockedProvider(
    provider: string,
    blocked: boolean,
  ): Promise<string> {
    const walletContract = this.getKiteAAWalletAddress();
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "setBlockedProvider",
      args: [provider as `0x${string}`, blocked],
    });
    const result = await this.sendTx(walletContract, data);
    return result.hash;
  }

  async revokeSessionKey(sessionKey: string): Promise<string> {
    const walletContract = this.getKiteAAWalletAddress();
    const data = encodeFunctionData({
      abi: kiteAAWalletAbi,
      functionName: "revokeSessionKey",
      args: [sessionKey as `0x${string}`],
    });
    const result = await this.sendTx(walletContract, data);
    return result.hash;
  }

  async isNonceUsed(sessionKey: string, nonce: bigint): Promise<boolean> {
    const walletContract = this.getKiteAAWalletAddress();
    return await this.client.readContract({
      address: walletContract as `0x${string}`,
      abi: kiteAAWalletAbi,
      functionName: "isNonceUsed",
      args: [sessionKey as `0x${string}`, nonce],
    });
  }

  async getSessionSpent(sessionKey: string): Promise<bigint> {
    const walletContract = this.getKiteAAWalletAddress();
    return await this.client.readContract({
      address: walletContract as `0x${string}`,
      abi: kiteAAWalletAbi,
      functionName: "getSessionSpent",
      args: [sessionKey as `0x${string}`],
    });
  }

  async getDepositedTokenBalance(
    token: `0x${string}`,
    address: `0x${string}`,
  ): Promise<bigint> {
    return await this.getTokenBalance(token, address);
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
    walletContractOverride?: string,
  ): Promise<{ txHash: string; channelId: `0x${string}` | undefined }> {
    const signerAddress = this.wdkAccount.getAddress() as string;
    const user = this.eoaAddress as `0x${string}`;
    let walletContract = walletContractOverride as `0x${string}` | undefined;

    if (!walletContract) {
      const resolvedWallet =
        await this.resolveWalletContractForSession(signerAddress);
      if (resolvedWallet) {
        walletContract = resolvedWallet;
      }
    }
    if (!walletContract) {
      walletContract = this.config.contracts.kiteAAWallet as
        | `0x${string}`
        | undefined;
    }
    if (!walletContract) {
      throw new Error(
        "Unable to resolve walletContract for channel open. Pass channelConfig.walletContract or configure contracts.kiteAAWallet.",
      );
    }

    // ── Pre-flight diagnostics ──────────────────────────────────────
    // Balance check: for prepaid the deposit comes from the AA wallet's
    // ERC-20 balance, which PaymentChannel pulls via transferFrom.
    let balance = 0n;
    if (mode === 0 && deposit > 0n) {
      balance = await this.getWalletUserBalance(
        walletContract,
        user,
        token as `0x${string}`,
      );
    }

    if (mode === 0) {
      if (balance < deposit) {
        throw new Error(
          `Insufficient AA wallet balance: have ${formatUnits(balance, 18)}, need ${formatUnits(deposit, 18)}`,
        );
      }
    }

    // The AA wallet must have approved PaymentChannel before openChannel.

    // ── Simulate the call to surface the revert reason ──────────────
    try {
      await this.client.simulateContract({
        address: this.config.contracts.paymentChannel as `0x${string}`,
        abi: paymentChannelAbi,
        functionName: "openChannel",
        args: [
          signerAddress as `0x${string}`,
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
        signerAddress as `0x${string}`,
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

    // Decode ChannelOpened event to get channelId
    const event = await this.waitAndDecodeLogs(
      result.hash,
      paymentChannelAbi,
      "ChannelOpened",
    );
    const channelId = event?.args?.channelId as `0x${string}` | undefined;

    return { txHash: result.hash, channelId };
  }

  /**
   * Opens a payment channel via ClientVault.executeBatch using GokiteAASDK.
   * Sends a proper UserOp (not a raw tx) so the session key never pays gas.
   *
   * The batch atomically:
   *  1. ERC20.approve(paymentChannel, maxSpend)   — from walletContract
   *  2. PaymentChannel.openChannel(sessionKey, …) — msg.sender == walletContract
   *
   * The bundler handles gas sponsorship via the configured paymaster.
   */
  async openChannelViaVaultBatch(
    sessionKeyAddress: `0x${string}`,
    walletContract: `0x${string}`,
    provider: string,
    token: string,
    mode: number,
    deposit: bigint,
    maxSpend: bigint,
    maxDuration: number,
    maxPerCall: bigint,
  ): Promise<{ txHash: string; channelId: `0x${string}` | undefined }> {
    // Initialize GokiteAASDK for proper UserOp submission
    const { GokiteAASDK } = await import("gokite-aa-sdk");
    const aaSdk = new GokiteAASDK(
      this.config.networkName || "kite_testnet",
      this.config.rpcUrl,
      this.config.bundlerUrl || "",
    );

    const derivedAaWallet = aaSdk.getAccountAddress(
      this.eoaAddress as `0x${string}`,
    ) as `0x${string}`;
    if (derivedAaWallet.toLowerCase() !== walletContract.toLowerCase()) {
      throw new Error(
        `AA wallet mismatch: session resolves to ${walletContract}, but GokiteAASDK(owner=${this.eoaAddress}) derives ${derivedAaWallet}`,
      );
    }

    // Build batch calldata for executeBatch on the wallet
    const batchRequest = {
      targets: [
        token as `0x${string}`,
        this.config.contracts.paymentChannel as `0x${string}`,
      ],
      values: [0n, 0n],
      callDatas: [
        // 1. approve — token allows paymentChannel to spend maxSpend
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [
            this.config.contracts.paymentChannel as `0x${string}`,
            maxSpend,
          ],
        }),
        // 2. openChannel — pass sessionKey explicitly; walletContract is msg.sender
        encodeFunctionData({
          abi: paymentChannelAbi,
          functionName: "openChannel",
          args: [
            sessionKeyAddress,
            provider as `0x${string}`,
            token as `0x${string}`,
            mode,
            deposit,
            maxSpend,
            BigInt(maxDuration),
            maxPerCall,
            walletContract,
          ],
        }),
      ],
    };

    // Extract private key for signing
    const keyPair = (this.wdkAccount as any)?.keyPair;
    if (!keyPair?.privateKey) {
      throw new Error(
        "Session key private key not available for UserOp signing",
      );
    }
    const pkHex =
      `0x${Buffer.from(keyPair.privateKey).toString("hex")}` as `0x${string}`;
    const sessionAccount = privateKeyToAccount(pkHex);

    // Sign functions for UserOp:
    // 1) session-key signature (desired path)
    // 2) owner EOA signature (bkp-compatible fallback)
    const signerStrategies: Array<{
      label: string;
      sign: (userOpHash: string) => Promise<string>;
    }> = [
      {
        label: "session-key",
        sign: async (userOpHash: string) =>
          sessionAccount.signMessage({ message: { raw: userOpHash as Hex } }),
      },
    ];

    const ownerPkRaw =
      process.env.PRIVATE_KEY ??
      getCredential() ??
      process.env.EOA_PRIVATE_KEY;
    if (ownerPkRaw) {
      const ownerPk = (
        ownerPkRaw.startsWith("0x") ? ownerPkRaw : `0x${ownerPkRaw}`
      ) as `0x${string}`;
      const ownerAccount = privateKeyToAccount(ownerPk);
      if (
        ownerAccount.address.toLowerCase() === this.eoaAddress.toLowerCase()
      ) {
        signerStrategies.push({
          label: "owner-eoa",
          sign: async (userOpHash: string) =>
            ownerAccount.signMessage({
              message: { raw: userOpHash as Hex },
            }),
        });
      }
    }

    const decodeChannelOpened = async (txHash: string) => {
      const event = await this.waitAndDecodeLogs(
        txHash,
        paymentChannelAbi,
        "ChannelOpened",
      );
      const channelId = event?.args?.channelId as `0x${string}` | undefined;
      return { txHash, channelId };
    };

    let lastError: Error | null = null;
    for (const strategy of signerStrategies) {
      try {
        console.log(
          `  Sending UserOp to bundler for gasless channel open via AA (signer=${strategy.label})...`,
        );

        const sponsoredResult = await aaSdk.sendUserOperationAndWait(
          this.eoaAddress as `0x${string}`,
          batchRequest,
          strategy.sign,
          undefined,
          undefined,
          { maxRetries: 60, interval: 5000 },
        );
        const sponsoredStatus = (sponsoredResult as any).status as
          | {
              status?: string;
              transactionHash?: `0x${string}`;
              reason?: string;
            }
          | undefined;
        if (sponsoredStatus?.status && sponsoredStatus.status !== "success") {
          throw new Error(
            sponsoredStatus.reason ??
              `Sponsored UserOp did not succeed (${sponsoredStatus.status})`,
          );
        }

        const txHash =
          sponsoredStatus?.transactionHash ?? sponsoredResult.userOpHash;
        console.log(`  UserOp included. Receipt tx: ${txHash}`);
        return await decodeChannelOpened(txHash);
      } catch (sponsoredErr: any) {
        const sponsoredReason =
          sponsoredErr?.cause?.reason ??
          sponsoredErr?.cause?.shortMessage ??
          sponsoredErr?.shortMessage ??
          sponsoredErr?.message ??
          String(sponsoredErr);

        const shouldFallbackToTokenPayment =
          /timeout|timed out|sponsor|paymaster|aa21|aa31|rejected/i.test(
            sponsoredReason,
          );
        if (!shouldFallbackToTokenPayment) {
          lastError = new Error(sponsoredReason);
          continue;
        }

        const paymentToken =
          (process.env.SETTLEMENT_TOKEN_ADDRESS as `0x${string}` | undefined) ??
          (process.env.PAYMASTER_PAYMENT_TOKEN as `0x${string}` | undefined) ??
          ("0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63" as `0x${string}`);

        try {
          console.log(
            `  Sponsored UserOp failed (${sponsoredReason}). Retrying with token-payment fallback using ${paymentToken} (signer=${strategy.label})...`,
          );

          const baseUserOp = await (aaSdk as any).createUserOperation(
            this.eoaAddress as `0x${string}`,
            batchRequest,
          );
          const paymentResult = await aaSdk.sendUserOperationWithPayment(
            this.eoaAddress as `0x${string}`,
            batchRequest,
            baseUserOp,
            paymentToken,
            strategy.sign,
            undefined,
            { maxRetries: 60, interval: 5000 },
          );

          const paymentStatus = (paymentResult as any).status as
            | {
                status?: string;
                transactionHash?: `0x${string}`;
                reason?: string;
              }
            | undefined;
          if (paymentStatus?.status && paymentStatus.status !== "success") {
            throw new Error(
              paymentStatus.reason ??
                `Token-payment UserOp did not succeed (${paymentStatus.status})`,
            );
          }

          const txHash =
            paymentStatus?.transactionHash ?? paymentResult.userOpHash;
          console.log(`  Token-payment UserOp included. Receipt tx: ${txHash}`);
          return await decodeChannelOpened(txHash);
        } catch (paymentErr: any) {
          const paymentReason =
            paymentErr?.cause?.reason ??
            paymentErr?.cause?.shortMessage ??
            paymentErr?.shortMessage ??
            paymentErr?.message ??
            String(paymentErr);
          lastError = new Error(paymentReason);
          continue;
        }
      }
    }

    console.error(
      `[openChannelViaVaultBatch] UserOp failed for ${walletContract}:`,
      lastError?.message ?? "Unknown UserOp failure",
    );
    throw lastError ?? new Error("Unknown UserOp failure");
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

  /**
   * Initiate settlement through AA wallet via UserOp so session consumers do not pay native gas.
   * The wallet executes PaymentChannel.initiateSettlement(...) as msg.sender.
   */
  async initiateSettlementViaVaultAA(
    sessionKeyAddress: `0x${string}`,
    walletContract: `0x${string}`,
    channelId: `0x${string}`,
    sequenceNumber: number,
    cumulativeCost: bigint,
    timestamp: number,
    providerSignature: `0x${string}`,
    merkleRoot: `0x${string}` = "0x0000000000000000000000000000000000000000000000000000000000000000",
  ): Promise<string> {
    const { GokiteAASDK } = await import("gokite-aa-sdk");
    const aaSdk = new GokiteAASDK(
      this.config.networkName || "kite_testnet",
      this.config.rpcUrl,
      this.config.bundlerUrl || "",
    );

    const derivedAaWallet = aaSdk.getAccountAddress(
      this.eoaAddress as `0x${string}`,
    ) as `0x${string}`;
    if (derivedAaWallet.toLowerCase() !== walletContract.toLowerCase()) {
      throw new Error(
        `AA wallet mismatch: session resolves to ${walletContract}, but GokiteAASDK(owner=${this.eoaAddress}) derives ${derivedAaWallet}`,
      );
    }

    const batchRequest = {
      targets: [this.config.contracts.paymentChannel as `0x${string}`],
      values: [0n],
      callDatas: [
        encodeFunctionData({
          abi: paymentChannelAbi,
          functionName: "initiateSettlement",
          args: [
            channelId,
            sessionKeyAddress,
            BigInt(sequenceNumber),
            cumulativeCost,
            BigInt(timestamp),
            providerSignature,
            merkleRoot,
          ],
        }),
      ],
    };

    const keyPair = (this.wdkAccount as any)?.keyPair;
    if (!keyPair?.privateKey) {
      throw new Error(
        "Session key private key not available for UserOp signing",
      );
    }
    const pkHex =
      `0x${Buffer.from(keyPair.privateKey).toString("hex")}` as `0x${string}`;
    const sessionAccount = privateKeyToAccount(pkHex);

    const signerStrategies: Array<{
      label: string;
      sign: (userOpHash: string) => Promise<string>;
    }> = [
      {
        label: "session-key",
        sign: async (userOpHash: string) =>
          sessionAccount.signMessage({ message: { raw: userOpHash as Hex } }),
      },
    ];

    const ownerPkRaw =
      process.env.PRIVATE_KEY ??
      getCredential() ??
      process.env.EOA_PRIVATE_KEY;
    if (ownerPkRaw) {
      const ownerPk = (
        ownerPkRaw.startsWith("0x") ? ownerPkRaw : `0x${ownerPkRaw}`
      ) as `0x${string}`;
      const ownerAccount = privateKeyToAccount(ownerPk);
      if (
        ownerAccount.address.toLowerCase() === this.eoaAddress.toLowerCase()
      ) {
        signerStrategies.push({
          label: "owner-eoa",
          sign: async (userOpHash: string) =>
            ownerAccount.signMessage({
              message: { raw: userOpHash as Hex },
            }),
        });
      }
    }

    let lastError: Error | null = null;
    for (const strategy of signerStrategies) {
      try {
        console.log(
          `  Sending UserOp to bundler for gasless channel close via AA (signer=${strategy.label})...`,
        );

        const sponsoredResult = await aaSdk.sendUserOperationAndWait(
          this.eoaAddress as `0x${string}`,
          batchRequest,
          strategy.sign,
          undefined,
          undefined,
          { maxRetries: 60, interval: 5000 },
        );
        const sponsoredStatus = (sponsoredResult as any).status as
          | {
              status?: string;
              transactionHash?: `0x${string}`;
              reason?: string;
            }
          | undefined;
        if (sponsoredStatus?.status && sponsoredStatus.status !== "success") {
          throw new Error(
            sponsoredStatus.reason ??
              `Sponsored UserOp did not succeed (${sponsoredStatus.status})`,
          );
        }

        const txHash =
          sponsoredStatus?.transactionHash ?? sponsoredResult.userOpHash;
        console.log(`  UserOp included. Receipt tx: ${txHash}`);
        return txHash;
      } catch (sponsoredErr: any) {
        const sponsoredReason =
          sponsoredErr?.cause?.reason ??
          sponsoredErr?.cause?.shortMessage ??
          sponsoredErr?.shortMessage ??
          sponsoredErr?.message ??
          String(sponsoredErr);

        const shouldFallbackToTokenPayment =
          /timeout|timed out|sponsor|paymaster|aa21|aa31|rejected/i.test(
            sponsoredReason,
          );
        if (!shouldFallbackToTokenPayment) {
          lastError = new Error(sponsoredReason);
          continue;
        }

        const paymentToken =
          "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63" as `0x${string}`;
        console.log(
          `  Sponsored UserOp failed (${sponsoredReason}). Retrying with token-payment fallback using ${paymentToken} (signer=${strategy.label})...`,
        );

        try {
          const baseUserOp = await (aaSdk as any).createUserOperation(
            this.eoaAddress as `0x${string}`,
            batchRequest,
          );
          const tokenResult = await aaSdk.sendUserOperationWithPayment(
            this.eoaAddress as `0x${string}`,
            batchRequest,
            baseUserOp,
            paymentToken,
            strategy.sign,
            undefined,
            { maxRetries: 60, interval: 5000 },
          );
          const tokenStatus = (tokenResult as any).status as
            | {
                status?: string;
                transactionHash?: `0x${string}`;
                reason?: string;
              }
            | undefined;
          if (tokenStatus?.status && tokenStatus.status !== "success") {
            throw new Error(
              tokenStatus.reason ??
                `Token-payment UserOp did not succeed (${tokenStatus.status})`,
            );
          }

          const txHash = tokenStatus?.transactionHash ?? tokenResult.userOpHash;
          console.log(`  UserOp included. Receipt tx: ${txHash}`);
          return txHash;
        } catch (tokenErr: any) {
          const tokenReason =
            tokenErr?.cause?.reason ??
            tokenErr?.cause?.shortMessage ??
            tokenErr?.shortMessage ??
            tokenErr?.message ??
            String(tokenErr);
          lastError = new Error(
            `AA settle failed (signer=${strategy.label}) sponsored=[${sponsoredReason}] token=[${tokenReason}]`,
          );
        }
      }
    }

    throw (
      lastError ??
      new Error("Unknown UserOp failure while initiating settlement")
    );
  }

  async initiateSettlement(
    channelId: `0x${string}`,
    sequenceNumber: number,
    cumulativeCost: bigint,
    timestamp: number,
    providerSignature: `0x${string}`,
    merkleRoot: `0x${string}` = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
  ): Promise<string> {
    const signerAddress = this.wdkAccount.getAddress() as string;
    const data = encodeFunctionData({
      abi: paymentChannelAbi,
      functionName: "initiateSettlement",
      args: [
        channelId,
        signerAddress as `0x${string}`,
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
    const result = await this.client.readContract({
      address: this.config.contracts.paymentChannel as `0x${string}`,
      abi: paymentChannelAbi,
      functionName: "getChannel",
      args: [channelId],
    });

    return {
      consumer: result[0],
      user: result[1],
      provider: result[2],
      token: result[3],
      mode: Number(result[4]),
      deposit: result[5],
      maxSpend: result[6],
      maxDuration: Number(result[7]),
      openedAt: Number(result[8]),
      expiresAt: Number(result[9]),
      maxPerCall: result[10],
      settledAmount: result[11],
      status: Number(result[12]),
      settlementDeadline: Number(result[13]),
      highestClaimedCost: result[14],
      highestSequenceNumber: Number(result[15]),
      wallet: result[16],
      channelId,
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

  // -- ClientAgentVault sessions --

  async createVaultSession(params: {
    walletContract: string;
    sessionId: `0x${string}`;
    sessionKey: string;
    rules?: Array<{
      timeWindow: bigint;
      budget: bigint;
      initialWindowStartTime: bigint;
      targetProviders: `0x${string}`[];
    }>;
  }): Promise<string> {
    const data = encodeFunctionData({
      abi: clientAgentVaultAbi,
      functionName: "createSession",
      args: [
        params.sessionId,
        params.sessionKey as `0x${string}`,
        (params.rules ?? []).map((rule) => ({
          timeWindow: rule.timeWindow,
          budget: rule.budget,
          initialWindowStartTime: rule.initialWindowStartTime,
          targetProviders: rule.targetProviders,
        })),
      ],
    });

    const result = await this.sendTx(params.walletContract, data);
    return result.hash;
  }

  async addVaultSpendingRules(params: {
    walletContract: string;
    sessionId: `0x${string}`;
    rules: Array<{
      timeWindow: bigint;
      budget: bigint;
      initialWindowStartTime: bigint;
      targetProviders: `0x${string}`[];
    }>;
  }): Promise<string> {
    const data = encodeFunctionData({
      abi: clientAgentVaultAbi,
      functionName: "addSpendingRules",
      args: [
        params.sessionId,
        params.rules.map((rule) => ({
          timeWindow: rule.timeWindow,
          budget: rule.budget,
          initialWindowStartTime: rule.initialWindowStartTime,
          targetProviders: rule.targetProviders,
        })),
      ],
    });

    const result = await this.sendTx(params.walletContract, data);
    return result.hash;
  }

  /** Remove a session from the vault (revoke). */
  async removeVaultSession(
    walletContract: string,
    sessionId: `0x${string}`,
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: clientAgentVaultAbi,
      functionName: "removeSession",
      args: [sessionId],
    });
    const result = await this.sendTx(walletContract, data);
    return result.hash;
  }

  /** Check whether a token is enabled on the ClientAgentVault. */
  async isVaultTokenSupported(
    walletContract: `0x${string}`,
    token: `0x${string}`,
  ): Promise<boolean> {
    return (await this.client.readContract({
      address: walletContract,
      abi: clientAgentVaultAbi,
      functionName: "isTokenSupported",
      args: [token],
    })) as boolean;
  }

  /** Enable an ERC-20 token on the ClientAgentVault (owner-only). */
  async addVaultSupportedToken(
    walletContract: `0x${string}`,
    token: `0x${string}`,
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: clientAgentVaultAbi,
      functionName: "addSupportedToken",
      args: [token],
    });
    const result = await this.sendTx(walletContract, data);
    return result.hash;
  }

  /** Get spending rules for a session on the ClientAgentVault. */
  async getVaultSpendingRules(
    walletContract: `0x${string}`,
    sessionId: `0x${string}`,
  ): Promise<
    Array<{
      rule: {
        timeWindow: bigint;
        budget: bigint;
        initialWindowStartTime: bigint;
        targetProviders: `0x${string}`[];
      };
      usage: {
        amountUsed: bigint;
        currentTimeWindowStartTime: bigint;
      };
    }>
  > {
    return (await this.client.readContract({
      address: walletContract,
      abi: clientAgentVaultAbi,
      functionName: "getSpendingRules",
      args: [sessionId],
    })) as Array<{
      rule: {
        timeWindow: bigint;
        budget: bigint;
        initialWindowStartTime: bigint;
        targetProviders: `0x${string}`[];
      };
      usage: {
        amountUsed: bigint;
        currentTimeWindowStartTime: bigint;
      };
    }>;
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
