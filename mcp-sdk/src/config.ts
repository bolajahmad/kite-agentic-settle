import type { KiteConfig } from "./types.js";

// Contract addresses sourced from frontend/utils/contracts/index.ts (source of truth)
export const KITE_TESTNET: KiteConfig = {
  rpcUrl: "https://rpc-testnet.gokite.ai",
  chainId: 2368,
  contracts: {
    agentRegistry: "0x8E706f71473A80603a9e86AE9E5164E296996e7A",
    kiteAAWallet: "0x18A1e425C762A37fc4c78Dd327D9d7823193046D",
    anchorMerkle: "0xf7Ba449B63C07c84604cC671e41a3e58AEd30d3f",
    paymentChannel: "0x1BFbeeE10F0d06A24a6c7493Eee5b13485d6418a",
  },
  token: "0x1f98772C698FEb08cCF2364B83599908c93BaDA9",
};
