// Deploy a fresh MockERC20 token and update references.
// Mints 1,000,000 tokens to the deployer.
//
// Usage:
//   npx hardhat run scripts/deploy-token.js --network kiteTestnet

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const initialSupply = hre.ethers.parseEther("1000000"); // 1M tokens
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy("Kite Test Token", "KTT", initialSupply);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();

  const bal = await token.balanceOf(deployer.address);
  console.log("Token deployed to:", tokenAddr);
  console.log("Deployer balance: ", hre.ethers.formatEther(bal), "KTT");
  console.log("\nUpdate KITE_TESTNET.token and backend .env with this address.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
