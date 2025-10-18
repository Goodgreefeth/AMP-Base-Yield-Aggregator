const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Aggregator: Flash Boost", function () {
  let usdc, owner, user, aggregator, pairId;
  let base, flash;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    // Deploy mock USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.parseUnits("1000000", 6));
    await usdc.waitForDeployment();
    // Deploy Aggregator
  const Aggregator = await ethers.getContractFactory("contracts/Aggregator.sol:Aggregator");
    aggregator = await Aggregator.deploy();
    await aggregator.waitForDeployment();
    // Deploy impls and wire where possible
  const LpVaultImpl = await ethers.getContractFactory("contracts/impls/LpVaultImpl.sol:LpVaultImpl");
  const DepositImpl = await ethers.getContractFactory("contracts/impls/DepositImpl.sol:DepositImpl");
  const RebalanceImpl = await ethers.getContractFactory("contracts/impls/RebalanceImpl.sol:RebalanceImpl");
  const FlashBoostImpl = await ethers.getContractFactory("contracts/impls/FlashBoostImpl.sol:FlashBoostImpl");
  const lpVaultImpl = await LpVaultImpl.deploy(); await lpVaultImpl.waitForDeployment();
  const depositImpl = await DepositImpl.deploy(); await depositImpl.waitForDeployment();
  const rebalanceImpl = await RebalanceImpl.deploy(); await rebalanceImpl.waitForDeployment();
  const flashBoostImpl = await FlashBoostImpl.deploy(); await flashBoostImpl.waitForDeployment();
  try { await aggregator.setLpVaultImpl(await lpVaultImpl.getAddress()); } catch (e) {}
  try { await aggregator.setDepositImpl(await depositImpl.getAddress()); } catch (e) {}
  try { await aggregator.setRebalanceImpl(await rebalanceImpl.getAddress()); } catch (e) {}
  try { await aggregator.setFlashBoostImpl(await flashBoostImpl.getAddress()); } catch (e) {}
    // Add USDC/USDC pair
    const tx = await aggregator.addPair(await usdc.getAddress(), await usdc.getAddress());
    const receipt = await tx.wait();
    pairId = receipt.logs[0].args.pairId || 0;
    // Mint USDC to user
    await usdc.transfer(user.address, ethers.parseUnits("10000", 6));
    // Deploy two strategies
    const StrategySushi = await ethers.getContractFactory("StrategySushi");
    base = await StrategySushi.deploy(await usdc.getAddress());
    await base.waitForDeployment();
    const StrategySushiSwap = await ethers.getContractFactory("StrategySushiSwap");
    flash = await StrategySushiSwap.deploy(await usdc.getAddress(), ethers.ZeroAddress);
    await flash.waitForDeployment();
    // Add both strategies
    await aggregator.addStrategy(pairId, await base.getAddress());
    await aggregator.addStrategy(pairId, await flash.getAddress());
    // Set router
  const MockLP = await ethers.getContractFactory("MockLP");
  const mockLP = await MockLP.deploy("USDC/USDC LP", "LP");
  await mockLP.waitForDeployment();
  const MockRouter = await ethers.getContractFactory("contracts/mocks/MockRouter.sol:MockRouter");
  const router = await MockRouter.deploy(mockLP.target);
  await router.waitForDeployment();
  await aggregator.setRouter(router.target);
    // Whitelist flash strategy
    await aggregator.setFlashStrategyWhitelist(await flash.getAddress(), true);
  // Make owner a keeper so keeper-only functions can be triggered in tests
  await aggregator.setKeeper(await owner.getAddress(), true);
    // Approve tokens
    await aggregator.approveToken(pairId, await usdc.getAddress(), await base.getAddress(), ethers.parseUnits("1000", 6));
    await aggregator.approveToken(pairId, await usdc.getAddress(), await flash.getAddress(), ethers.parseUnits("1000", 6));
    // Deposit to base
    await usdc.transfer(await aggregator.getAddress(), ethers.parseUnits("1000", 6));
    await aggregator.depositToStrategy(pairId, await base.getAddress(), ethers.parseUnits("1000", 6));
  });

  it("should trigger and end a flash boost, taking fee only on yield", async function () {
    // Simulate yield: flash strategy will get 100 USDC extra
    await usdc.transfer(await flash.getAddress(), ethers.parseUnits("100", 6));
    // Record treasury balance before
    const treasury = await aggregator.treasury();
    const treasuryBalBefore = await usdc.balanceOf(treasury);
    // Trigger flash boost (20%)
    await expect(aggregator.connect(owner).triggerFlashBoost(pairId, await flash.getAddress(), 20))
      .to.emit(aggregator, "FlashBoostStarted");
    // End flash boost
    await expect(aggregator.connect(owner).endFlashBoost(pairId))
      .to.emit(aggregator, "FlashBoostEnded");
    // Check fee was taken (3% of 100 USDC yield = 3 USDC)
    const treasuryBalAfter = await usdc.balanceOf(treasury);
    expect(treasuryBalAfter - treasuryBalBefore).to.equal(ethers.parseUnits("3", 6));
    // All funds (minus fee) should be back in base
    const baseBal = await usdc.balanceOf(await base.getAddress());
    expect(baseBal).to.equal(ethers.parseUnits("1097", 6));
    // Flash strategy should be empty
    const flashBal = await usdc.balanceOf(await flash.getAddress());
    expect(flashBal).to.equal(0n);
  });

  it("should revert if flash boost is disabled", async function () {
    await aggregator.setFlashBoostEnabled(false);
    await expect(
      aggregator.triggerFlashBoost(pairId, await flash.getAddress(), 20)
    ).to.be.revertedWith("Flash boost disabled");
  });

  it("should revert if strategy is not whitelisted", async function () {
    await aggregator.setFlashStrategyWhitelist(await flash.getAddress(), false);
    await expect(
      aggregator.triggerFlashBoost(pairId, await flash.getAddress(), 20)
    ).to.be.revertedWith("Not whitelisted");
  });

  it("should revert if percent is over cap", async function () {
    await expect(
      aggregator.triggerFlashBoost(pairId, await flash.getAddress(), 30)
    ).to.be.revertedWith("Over cap");
  });

  it("should return correct isFlashBoostAllowed()", async function () {
    expect(
      await aggregator.isFlashBoostAllowed(pairId, await flash.getAddress(), 20)
    ).to.equal(true);
    await aggregator.setFlashBoostEnabled(false);
    expect(
      await aggregator.isFlashBoostAllowed(pairId, await flash.getAddress(), 20)
    ).to.equal(false);
  });
});
