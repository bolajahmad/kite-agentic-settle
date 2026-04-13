// Deploy a fresh MockERC20 token and update references.
// Mints 1,000,000 tokens to the deployer.
//
// Usage:
//   npx hardhat run scripts/deploy-token.js --network kiteTestnet

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const initialSupply = hre.ethers.parseEther("1000000"); // 1M tokens
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy("USDT (Custom)", "USDT", initialSupply);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();

  const bal = await token.balanceOf(deployer.address);
  console.log("Token deployed to:", tokenAddr);
  console.log("Deployer balance: ", hre.ethers.formatEther(bal), "USDT");
  console.log(
    "\nUpdate KITE_TESTNET.token and backend .env with this address.",
  );

  // Save deployed address to deployments.json
  const deploymentsPath = path.resolve(__dirname, "../deployments.json");

  let deployments = {};
  if (fs.existsSync(deploymentsPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  }

  if (!deployments.usdt) {
    deployments.usdt = {};
  }

  deployments.usdt.address = tokenAddr;

  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("USDT address saved to deployments.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
