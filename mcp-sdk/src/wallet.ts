import WDK from "@tetherto/wdk";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  keccak256,
  toBytes,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// ── Credential Detection ──────────────────────────────────────────

/** Check if a string is a hex private key (64 hex chars, optional 0x prefix). */
export function isPrivateKey(input: string): boolean {
  const cleaned = input.startsWith("0x") ? input.slice(2) : input;
  return /^[0-9a-fA-F]{64}$/.test(cleaned);
}

/** Check if a string looks like a BIP-39 mnemonic (12 or 24 words). */
export function isSeedPhrase(input: string): boolean {
  const words = input.trim().split(/\s+/);
  return words.length === 12 || words.length === 24;
}

/** Normalize a private key to 0x-prefixed hex. */
export function normalizePrivateKey(input: string): `0x${string}` {
  return (input.startsWith("0x") ? input : `0x${input}`) as `0x${string}`;
}

// ── Viem Account Adapter ──────────────────────────────────────────
// Wraps a raw private key into an account interface compatible with
// ContractService (same shape as a WDK account).

class ViemAccountAdapter {
  readonly keyPair: { privateKey: Uint8Array };
  private readonly walletClient: any;
  private readonly publicClient: PublicClient;
  private readonly _address: string;

  constructor(privateKeyHex: `0x${string}`, rpcUrl: string, chainId: number) {
    const account = privateKeyToAccount(privateKeyHex);
    this._address = account.address;

    const chain = defineChain({
      id: chainId,
      name: "Kite AI",
      nativeCurrency: { name: "KITE", symbol: "KITE", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });

    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    this.walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

    const pkBytes = Buffer.from(privateKeyHex.slice(2), "hex");
    this.keyPair = { privateKey: new Uint8Array(pkBytes) };
  }

  async sendTransaction(params: {
    to: string;
    value: bigint;
    data: `0x${string}`;
  }): Promise<{ hash: string; fee: bigint }> {
    let hash: `0x${string}`;
    try {
      hash = await this.walletClient.sendTransaction({
        to: params.to as `0x${string}`,
        value: params.value,
        data: params.data,
      });
    } catch (err: any) {
      const reason =
        err?.cause?.reason ??
        err?.cause?.shortMessage ??
        err?.shortMessage ??
        err?.message ??
        String(err);
      throw new Error(`Transaction submission failed: ${reason}`);
    }

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 120_000,
      pollingInterval: 3_000,
    });

    if (receipt.status === "reverted") {
      throw new Error(`Transaction reverted on-chain (hash: ${hash})`);
    }

    const fee = (receipt.gasUsed ?? 0n) * (receipt.effectiveGasPrice ?? 0n);
    return { hash, fee };
  }

  async getTransactionReceipt(hash: string): Promise<any> {
    return await this.publicClient.waitForTransactionReceipt({
      hash: hash as `0x${string}`,
    });
  }

  getAddress(): string {
    return this._address;
  }
}

// ── Wallet Creation ───────────────────────────────────────────────

/**
 * Create a Kite wallet from either a BIP-39 seed phrase or a raw private key.
 *
 * - Seed phrase (12/24 words): HD wallet via WDK at account index 0.
 * - Private key (64 hex chars, optional 0x): direct Viem account.
 */
export async function createKiteWallet(
  seedOrKey: string,
  rpcUrl: string,
  chainId: number = 2368,
): Promise<{ wdk: any; account: any; address: string }> {
  if (isPrivateKey(seedOrKey)) {
    const pkHex = normalizePrivateKey(seedOrKey);
    const adapter = new ViemAccountAdapter(pkHex, rpcUrl, chainId);
    return { wdk: null, account: adapter, address: adapter.getAddress() };
  }

  if (!isSeedPhrase(seedOrKey)) {
    throw new Error(
      "Invalid credential: expected a BIP-39 seed phrase (12 or 24 words) " +
        "or a hex private key (64 hex chars, optionally 0x-prefixed)",
    );
  }

  const wdk = new WDK(seedOrKey).registerWallet("kite", WalletManagerEvm, {
    provider: rpcUrl,
  });
  const account = await wdk.getAccount("kite", 0);
  const address = await account.getAddress();

  return { wdk, account, address };
}

/** Generate a new random seed phrase using WDK. */
export function generateSeedPhrase(): string {
  return WDK.getRandomSeedPhrase();
}

// ── Deterministic Agent / Session Key Derivation ──────────────────
//
// Replicates the frontend's useGenerateAgent / useGenerateSession hooks:
//   1. Sign a fixed message with the EOA's private key
//   2. keccak256(signature) → 16-byte entropy → BIP-39 mnemonic
//   3. Derive keys at specific BIP-32 paths
//
// Agent keys:   m/44'/60'/0'/{agentIndex}/0
// Session keys: m/44'/60'/0'/{agentIndex}/{sessionIndex}

async function deriveKeyFromSignedMessage(
  eoaPrivateKey: Uint8Array,
  message: string,
  derivationPath: string,
): Promise<{ address: string; privateKey: `0x${string}` }> {
  const pkHex = `0x${Buffer.from(eoaPrivateKey).toString("hex")}` as `0x${string}`;
  const eoaAccount = privateKeyToAccount(pkHex);

  const signature = await eoaAccount.signMessage({ message });
  const entropy = keccak256(signature);
  const mnemonic = entropyToMnemonic(toBytes(entropy).slice(0, 16), wordlist);

  const seed = mnemonicToSeedSync(mnemonic);
  const masterKey = HDKey.fromMasterSeed(seed);
  const derived = masterKey.derive(derivationPath);

  if (!derived.privateKey) {
    throw new Error(`Failed to derive key at path: ${derivationPath}`);
  }

  const derivedPkHex = `0x${Buffer.from(derived.privateKey).toString("hex")}` as `0x${string}`;
  const derivedAccount = privateKeyToAccount(derivedPkHex);

  return { address: derivedAccount.address, privateKey: derivedPkHex };
}

/**
 * Derive an agent account deterministically from the EOA's private key.
 * Uses the same derivation as the frontend (sign message → entropy → HD path).
 * Path: m/44'/60'/0'/{agentIndex}/0
 */
export async function deriveAgentAccount(
  eoaPrivateKey: Uint8Array,
  agentIndex: number,
): Promise<{ address: string; privateKey: `0x${string}` }> {
  return deriveKeyFromSignedMessage(
    eoaPrivateKey,
    "Sign this to unlock your AI Agents. This does not cost gas.",
    `m/44'/60'/0'/${agentIndex}/0`,
  );
}

/**
 * Derive a session key deterministically from the EOA's private key.
 * Uses the same derivation as the frontend (sign message → entropy → HD path).
 * Path: m/44'/60'/0'/{agentIndex}/{sessionIndex}
 */
export async function deriveSessionAccount(
  eoaPrivateKey: Uint8Array,
  agentIndex: number,
  sessionIndex: number,
): Promise<{ address: string; privateKey: `0x${string}` }> {
  return deriveKeyFromSignedMessage(
    eoaPrivateKey,
    "Sign this to generate a new Session. This does not cost gas.",
    `m/44'/60'/0'/${agentIndex}/${sessionIndex}`,
  );
}

/**
 * Derive a session key for a specific agent using the EOA private key + agentId.
 *
 * The agentId (on-chain NFT tokenId) is baked into the signed message so
 * each agent gets a different session key even for the same session index.
 *
 * Message: "Kite: create session for agent {agentId}, index {sessionIndex}"
 * Path:    m/44'/60'/0'/0/{sessionIndex}
 */
export async function deriveSessionForAgent(
  eoaPrivateKey: Uint8Array,
  agentId: bigint,
  sessionIndex: number,
): Promise<{ address: string; privateKey: `0x${string}` }> {
  return deriveKeyFromSignedMessage(
    eoaPrivateKey,
    `Kite: create session for agent ${agentId}, index ${sessionIndex}`,
    `m/44'/60'/0'/0/${sessionIndex}`,
  );
}

/**
 * Encrypt a session private key using AES-256-GCM keyed to the seed phrase.
 * Returns a JSON string containing salt, iv, authTag, and ciphertext (all hex).
 */
export function encryptSessionKey(privateKeyHex: string, seedPhrase: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(seedPhrase, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(privateKeyHex, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  });
}

/**
 * Decrypt an encrypted session key blob produced by `encryptSessionKey`.
 */
export function decryptSessionKey(encryptedJson: string, seedPhrase: string): string {
  const { salt, iv, tag, data } = JSON.parse(encryptedJson) as {
    salt: string; iv: string; tag: string; data: string;
  };
  const key = scryptSync(seedPhrase, Buffer.from(salt, "hex"), 32);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(data, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
