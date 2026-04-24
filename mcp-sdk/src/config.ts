import { zeroAddress } from "viem";
import type { KiteConfig } from "./types.js";

// Contract addresses sourced from frontend/utils/contracts/index.ts (source of truth)
export const KITE_TESTNET: KiteConfig = {
  rpcUrl: "https://rpc-testnet.gokite.ai",
  chainId: 2368,
  contracts: {
    attestationRegistry: "0xc967d18A2BcC682c52A424b879EcA94215faE81b",
    identityRegistry: "0xc2a94C26987A0c480d0da82f2cB6675AE0fc50fb",
    kiteAAWallet: "0x0DB3Ad9b0182BdBB8fa8B32C609946D0C05079d8",
    paymentChannel: "0x312e805C810D6e5dD6234f796d8575B62c43c810",
  },
  token: "0xd4a87d5531A586C247BD13F3Bb0Dd68C6253B489",
};

export const TOKENS = [
  {
    symbol: "DmUSDT",
    name: "Kite Demo USDT",
    address: "0xd4a87d5531A586C247BD13F3Bb0Dd68C6253B489",
    decimals: 18,
  },
  {
    symbol: "X.USDT",
    name: "Kite x402 USD",
    address: "0x1b7425d288ea676FCBc65c29711fccF0B6D5c293",
    decimals: 18,
  },
  {
    symbol: "USDC.e",
    name: "USDC Bridge",
    address: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
    decimals: 6,
  },
  {
    symbol: "USDT",
    name: "USDT Bridged",
    address: "0x3Fdd283C4c43A60398bf93CA01a8a8BD773a755b",
    decimals: 6,
  },
  {
    symbol: "KITE",
    name: "Kite Token",
    address: zeroAddress,
    decimals: 18,
  },
];
