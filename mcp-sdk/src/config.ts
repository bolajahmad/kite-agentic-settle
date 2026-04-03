import type { KiteConfig } from "./types.js";

export const KITE_TESTNET: KiteConfig = {
  rpcUrl: "https://rpc-testnet.gokite.ai",
  chainId: 2368,
  contracts: {
    agentRegistry: "0x575dca87061898C3EbBC2a8F2a49C09120E88951",
    kiteAAWallet: "0xF474302a32ebaA69f230cdaF2c14Def1dEdd93FF",
    anchorMerkle: "0xf7Ba449B63C07c84604cC671e41a3e58AEd30d3f",
    paymentChannel: "0x1BFbeeE10F0d06A24a6c7493Eee5b13485d6418a",
  },
  token: "0x1f98772C698FEb08cCF2364B83599908c93BaDA9",
};
