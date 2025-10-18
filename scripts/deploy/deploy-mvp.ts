
import hre from "hardhat";
const { ethers } = hre;

async function main() {
  // Deploy MockERC20 for local testing
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mockToken = await MockERC20.deploy("Test Token", "TST", ethers.parseEther("1000000"));
  await mockToken.waitForDeployment();
  console.log("MockERC20 deployed to:", await mockToken.getAddress());

  // Deploy Aggregator
  const Aggregator = await ethers.getContractFactory("Aggregator");
  const deployer = (await ethers.getSigners())[0];
  // Aggregator is an alias contract with no constructor args (upgradeable pattern)
  const aggregator = await Aggregator.connect(deployer).deploy();
  await aggregator.waitForDeployment();
  console.log("Aggregator deployed to:", await aggregator.getAddress());

  // Deploy StrategyX
  const StrategyX = await ethers.getContractFactory("StrategyX");
  const strategyX = await StrategyX.connect(deployer).deploy(await mockToken.getAddress());
  await strategyX.waitForDeployment();
  console.log("StrategyX deployed to:", await strategyX.getAddress());

  // Create a basic pair (pairId 0) then add StrategyX to that pair
  const txPair = await aggregator.addPair(await mockToken.getAddress(), await mockToken.getAddress());
  await txPair.wait();
  const tx = await aggregator.addStrategy(0, await strategyX.getAddress());
  await tx.wait();
  console.log("StrategyX added to Aggregator (pair 0)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
