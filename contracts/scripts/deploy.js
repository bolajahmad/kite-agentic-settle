const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);
  console.log(
    "Balance:",
    hre.ethers.formatEther(
      await hre.ethers.provider.getBalance(deployer.address),
    ),
  );

  // 1. Deploy IdentityRegistry (ERC-721 agent NFTs + session management)
  const IdentityRegistry = await hre.ethers.getContractFactory("IdentityRegistry");
  const registry = await IdentityRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("IdentityRegistry deployed to:", registryAddr);

  // 2. Deploy KiteAAWallet (EIP-4337 AA wallet, sessions live on IdentityRegistry)
  const KiteAAWallet = await hre.ethers.getContractFactory("KiteAAWallet");
  const wallet = await KiteAAWallet.deploy();
  await wallet.waitForDeployment();
  const walletAddr = await wallet.getAddress();
  console.log("KiteAAWallet deployed to:", walletAddr);

  // Link wallet → registry
  await wallet.setIdentityRegistry(registryAddr);
  console.log("KiteAAWallet linked to IdentityRegistry");

  // 3. Deploy PaymentChannel (reads sessions from IdentityRegistry via wallet)
  const PaymentChannel = await hre.ethers.getContractFactory("PaymentChannel");
  const payChannel = await PaymentChannel.deploy();
  await payChannel.waitForDeployment();
  const payChannelAddr = await payChannel.getAddress();
  console.log("PaymentChannel deployed to:", payChannelAddr);

  // Link wallet → channel (so wallet can authorize channel withdrawals)
  await wallet.setPaymentChannel(payChannelAddr);
  console.log("KiteAAWallet linked to PaymentChannel");

  // 4. Deploy AttestationRegistry (EIP-8004 Reputation + Validation + Merkle)
  const AttestationRegistry = await hre.ethers.getContractFactory("AttestationRegistry");
  const attestation = await AttestationRegistry.deploy(registryAddr);
  await attestation.waitForDeployment();
  const attestationAddr = await attestation.getAddress();
  console.log("AttestationRegistry deployed to:", attestationAddr);

  console.log("\n--- Deployment Summary ---");
  console.log("IdentityRegistry   :", registryAddr);
  console.log("KiteAAWallet       :", walletAddr);
  console.log("PaymentChannel     :", payChannelAddr);
  console.log("AttestationRegistry:", attestationAddr);
  console.log("Network            :", hre.network.name);

  const deploymentsPath = path.resolve(__dirname, "../deployments.json");
  let deployments = {};

  if (fs.existsSync(deploymentsPath)) {
    try {
      deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
    } catch (e) {
      console.warn(
        "Could not parse existing deployments.json, starting fresh.",
      );
      deployments = {};
    }
  }

  const networkName = hre.network.name;

  deployments[networkName] = {
    IdentityRegistry: registryAddr,
    KiteAAWallet: walletAddr,
    PaymentChannel: payChannelAddr,
    AttestationRegistry: attestationAddr,
  };

  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`\nDeployments written to ${deploymentsPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
