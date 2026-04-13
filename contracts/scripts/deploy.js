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

  // 1. Deploy AgentRegistry
  const AgentRegistry = await hre.ethers.getContractFactory("AgentRegistry");
  const registry = await AgentRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("AgentRegistry deployed to:", registryAddr);

  // 2. Deploy KiteAAWallet (multi-tenant, no owner arg)
  const KiteAAWallet = await hre.ethers.getContractFactory("KiteAAWallet");
  const wallet = await KiteAAWallet.deploy();
  await wallet.waitForDeployment();
  const walletAddr = await wallet.getAddress();
  console.log("KiteAAWallet deployed to:", walletAddr);

  // Link wallet to registry
  await wallet.setAgentRegistry(registryAddr);
  console.log("KiteAAWallet linked to AgentRegistry");

  // 3. Deploy AnchorMerkle
  const AnchorMerkle = await hre.ethers.getContractFactory("AnchorMerkle");
  const merkle = await AnchorMerkle.deploy();
  await merkle.waitForDeployment();
  const merkleAddr = await merkle.getAddress();
  console.log("AnchorMerkle deployed to:", merkleAddr);

  // 4. Deploy PaymentChannel
  const PaymentChannel = await hre.ethers.getContractFactory("PaymentChannel");
  const payChannel = await PaymentChannel.deploy();
  await payChannel.waitForDeployment();
  const payChannelAddr = await payChannel.getAddress();
  console.log("PaymentChannel deployed to:", payChannelAddr);

  console.log("\n--- Deployment Summary ---");
  console.log("AgentRegistry  :", registryAddr);
  console.log("KiteAAWallet   :", walletAddr);
  console.log("AnchorMerkle   :", merkleAddr);
  console.log("PaymentChannel :", payChannelAddr);
  console.log("Network        :", hre.network.name);

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
    AgentRegistry: registryAddr,
    KiteAAWallet: walletAddr,
    AnchorMerkle: merkleAddr,
    PaymentChannel: payChannelAddr,
  };

  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`\nDeployments written to ${deploymentsPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
