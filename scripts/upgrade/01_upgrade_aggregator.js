const { ethers, upgrades } = require("hardhat");

async function main() {
  const proxyAddress = process.env.AGGREGATOR_PROXY || "<AGGREGATOR_PROXY_ADDRESS_HERE>";
  if (!proxyAddress || proxyAddress.includes("<")) {
    throw new Error("Set AGGREGATOR_PROXY env var or edit the script with the deployed proxy address.");
  }
  console.log("Upgrading Aggregator proxy at:", proxyAddress);

  const Aggregator = await ethers.getContractFactory("contracts/AggregatorUpgradeable.sol:Aggregator");
  const upgraded = await upgrades.upgradeProxy(proxyAddress, Aggregator);
  await upgraded.waitForDeployment();
  console.log("Aggregator upgraded. New implementation:", await upgrades.erc1967.getImplementationAddress(proxyAddress));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
