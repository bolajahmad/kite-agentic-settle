const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)));

  // 1. Deploy AgentRegistry
  const AgentRegistry = await hre.ethers.getContractFactory("AgentRegistry");
  const registry = await AgentRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("AgentRegistry deployed to:", registryAddr);

  // 2. Deploy KiteAAWallet (owner = deployer for PoC)
  const KiteAAWallet = await hre.ethers.getContractFactory("KiteAAWallet");
  const wallet = await KiteAAWallet.deploy(deployer.address);
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
