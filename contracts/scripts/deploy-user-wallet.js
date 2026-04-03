// Deploy a new KiteAAWallet for a user.
// Deploys with deployer as owner, links to AgentRegistry, then transfers ownership.
//
// Usage:
//   USER_ADDRESS="0x..." npx hardhat run scripts/deploy-user-wallet.js --network kiteTestnet

const hre = require("hardhat");

const AGENT_REGISTRY = "0x575dca87061898C3EbBC2a8F2a49C09120E88951";

async function main() {
  const userAddress = process.env.USER_ADDRESS;
  if (!userAddress) {
    console.error("Set USER_ADDRESS env var");
    process.exit(1);
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Deploying KiteAAWallet for user:", userAddress);

  // Deploy with deployer as temporary owner so we can set up the registry link
  const KiteAAWallet = await hre.ethers.getContractFactory("KiteAAWallet");
  const wallet = await KiteAAWallet.deploy(deployer.address);
  await wallet.waitForDeployment();
  const walletAddr = await wallet.getAddress();
  console.log("KiteAAWallet deployed to:", walletAddr);

  // Link to AgentRegistry (requires owner)
  const tx1 = await wallet.setAgentRegistry(AGENT_REGISTRY);
  await tx1.wait();
  console.log("Linked to AgentRegistry:", AGENT_REGISTRY);

  // Transfer ownership to the actual user
  const tx2 = await wallet.transferOwnership(userAddress);
  await tx2.wait();
  console.log("Ownership transferred to:", userAddress);

  console.log("\n--- Result ---");
  console.log("KiteAAWallet:", walletAddr);
  console.log("Owner:       ", userAddress);
  console.log("Registry:    ", AGENT_REGISTRY);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
