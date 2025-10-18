const { ethers, upgrades } = require("hardhat");

async function main() {
  const proxyAddress = process.env.TREASURY_PROXY || "<TREASURY_PROXY_ADDRESS_HERE>";
  if (!proxyAddress || proxyAddress.includes("<")) {
    throw new Error("Set TREASURY_PROXY env var or edit the script with the deployed proxy address.");
  }
  console.log("Upgrading Treasury proxy at:", proxyAddress);

  const Treasury = await ethers.getContractFactory("TreasuryUpgradeable");
  const upgraded = await upgrades.upgradeProxy(proxyAddress, Treasury);
  await upgraded.waitForDeployment();
  console.log("Treasury upgraded. New implementation:", await upgrades.erc1967.getImplementationAddress(proxyAddress));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
