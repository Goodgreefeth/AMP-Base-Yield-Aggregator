const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("AggregatorUpgradeable: Proxy Upgradeability", function () {
  let deployer, user, treasury, aggregator;

  beforeEach(async function () {
    [deployer, user] = await ethers.getSigners();
    // Deploy TreasuryUpgradeable proxy
  const Treasury = await ethers.getContractFactory("TreasuryUpgradeable");
  treasury = await upgrades.deployProxy(Treasury, [deployer.address], { initializer: "initialize" });
    // Deploy AggregatorUpgradeable proxy
  const Aggregator = await ethers.getContractFactory("AggregatorUpgradeable");
  // Provide all initializer args: (treasury, performanceFeeBps, protocolFeeBps, feeRecipient)
  aggregator = await upgrades.deployProxy(Aggregator, [await treasury.getAddress(), 300, 100, await treasury.getAddress()], { initializer: "initialize", unsafeAllow: ['delegatecall'] });
  });

  it("should persist state across upgrades", async function () {
    // Set a value
    await aggregator.setProtocolFee(333);
    expect(await aggregator.protocolFeeBps()).to.equal(333);

    // Deploy a new implementation (AggregatorV2Upgradeable)
    // For this test, AggregatorUpgradeable is used as a stand-in; in real use, create a V2 with new logic
  const AggregatorV2 = await ethers.getContractFactory("contracts/AggregatorUpgradeable.sol:Aggregator");
  const upgraded = await upgrades.upgradeProxy(await aggregator.getAddress(), AggregatorV2, { unsafeAllow: ['delegatecall'] });
    expect(await upgraded.protocolFeeBps()).to.equal(333);
  });

  it("should restrict upgrades to onlyOwner", async function () {
    // Try to upgrade from a non-owner account
  const AggregatorV2 = await ethers.getContractFactory("contracts/AggregatorUpgradeable.sol:Aggregator");
    await expect(
      upgrades.upgradeProxy(await aggregator.getAddress(), AggregatorV2.connect(user), { unsafeAllow: ['delegatecall'] })
    ).to.be.reverted;
  });
});
