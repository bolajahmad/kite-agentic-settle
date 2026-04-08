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
    const hash = await this.walletClient.sendTransaction({
      to: params.to as `0x${string}`,
      value: params.value,
      data: params.data,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
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
