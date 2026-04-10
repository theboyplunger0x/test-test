import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Base Sepolia USDC (Circle testnet faucet)
  const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  // Deployer is both operator and treasury for testnet
  const operator = deployer.address;
  const treasury = deployer.address;

  console.log("\nDeploying FUDVault...");
  console.log("  USDC:", USDC_BASE_SEPOLIA);
  console.log("  Operator:", operator);
  console.log("  Treasury:", treasury);

  const FUDVault = await ethers.getContractFactory("FUDVault");
  const vault = await FUDVault.deploy(USDC_BASE_SEPOLIA, operator, treasury);
  await vault.waitForDeployment();

  const address = await vault.getAddress();
  console.log("\n✅ FUDVault deployed to:", address);
  console.log("   Chain: Base Sepolia (84532)");
  console.log("   Verify: https://sepolia.basescan.org/address/" + address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
