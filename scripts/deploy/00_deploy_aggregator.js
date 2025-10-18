const { ethers, upgrades } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with", deployer.address);

  const Treasury = await ethers.getContractFactory("TreasuryUpgradeable");
  const treasury = await upgrades.deployProxy(Treasury, [deployer.address], { initializer: "initialize" });
  await treasury.waitForDeployment();
  console.log("Treasury proxy:", await treasury.getAddress());

  const Aggregator = await ethers.getContractFactory("contracts/AggregatorUpgradeable.sol:Aggregator");
  const aggr = await upgrades.deployProxy(Aggregator, [await treasury.getAddress(), 300], { initializer: "initialize" });
  await aggr.waitForDeployment();

  console.log("Aggregator proxy:", await aggr.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
