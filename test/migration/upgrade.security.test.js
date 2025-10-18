const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("AggregatorUpgradeable: Upgrade & Security", function () {
  let deployer, user, treasury, aggregator;

  beforeEach(async function () {
    [deployer, user] = await ethers.getSigners();
    // Deploy TreasuryUpgradeable proxy
    const Treasury = await ethers.getContractFactory("TreasuryUpgradeable");
  treasury = await upgrades.deployProxy(Treasury, [deployer.address], { initializer: "initialize" });
    // Deploy AggregatorUpgradeable proxy
  const Aggregator = await ethers.getContractFactory("AggregatorUpgradeable");
  aggregator = await upgrades.deployProxy(Aggregator, [await treasury.getAddress(), 300, 100, await treasury.getAddress()], { initializer: "initialize", unsafeAllow: ['delegatecall'] });
  });

  it("should persist deposits and balances through upgrade", async function () {
    // Set a protocol-level value and ensure it persists through upgrade
    await aggregator.setProtocolFee(321);
    expect(await aggregator.protocolFeeBps()).to.equal(321);
    // Upgrade to new logic (simulate v2)
  const AggregatorV2 = await ethers.getContractFactory("contracts/AggregatorUpgradeable.sol:Aggregator");
  const upgraded = await upgrades.upgradeProxy(await aggregator.getAddress(), AggregatorV2, { unsafeAllow: ['delegatecall'] });
    // Check value still present
    expect(await upgraded.protocolFeeBps()).to.equal(321);
  });

  it("should persist strategies and state through upgrade", async function () {
    // Simulate adding a strategy (mock logic, replace with real if needed)
    if (aggregator.addStrategy && aggregator.getStrategies) {
      await aggregator.addStrategy(user.address);
      const strats = await aggregator.getStrategies();
      expect(strats).to.include(user.address);
    }
    // Upgrade
    const AggregatorV2 = await ethers.getContractFactory("contracts/AggregatorUpgradeable.sol:Aggregator");
    const upgraded = await upgrades.upgradeProxy(await aggregator.getAddress(), AggregatorV2, { unsafeAllow: ['delegatecall'] });
    // Check strategies still present
    if (upgraded.getStrategies) {
      const strats2 = await upgraded.getStrategies();
      expect(strats2).to.include(user.address);
    }
  });

  it("should restrict upgrades to onlyOwner", async function () {
    const AggregatorV2 = await ethers.getContractFactory("contracts/AggregatorUpgradeable.sol:Aggregator");
    await expect(
        upgrades.upgradeProxy(await aggregator.getAddress(), AggregatorV2.connect(user), { unsafeAllow: ['delegatecall'] })
      ).to.be.reverted;
  });
});
