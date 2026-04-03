const { vars } = require("hardhat/config");
require("@nomicfoundation/hardhat-toolbox");

const PRIVATE_KEY = vars.get("PRIVATE_KEY");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
    },
  },
  sourcify: {
    enabled: false
  },
  networks: {
    kiteTestnet: {
      type: "http",
      url: process.env.KITE_TESTNET_RPC || "https://rpc-testnet.gokite.ai",
      chainId: Number(process.env.KITE_TESTNET_CHAIN_ID) || 2368,
      accounts: [PRIVATE_KEY],
    },
  },
  etherscan: {
    apiKey: {
      kiteTestnet: vars.get("KITE_SCAN_KEY"),
    },
    customChains: [
      {
        network: 'kiteTestnet',
        chainId: 2368,
        urls: {
          apiURL: 'https://kitescan.ai',
          browserURL: 'https://testnet.kitescan.ai',
        },
      },
    ],
  }
};
