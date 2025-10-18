const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Aggregator: Pausable & Keeper", function () {
  let usdc, owner, user, keeper, aggregator, pairId, base, flash;

  beforeEach(async function () {
    [owner, user, keeper] = await ethers.getSigners();
    // Deploy mock USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.parseUnits("1000000", 6));
    await usdc.waitForDeployment();
    // Deploy Aggregator
  const Aggregator = await ethers.getContractFactory("contracts/Aggregator.sol:Aggregator");
    aggregator = await Aggregator.deploy();
    await aggregator.waitForDeployment();
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
    // Approve tokens
    await aggregator.approveToken(pairId, await usdc.getAddress(), await base.getAddress(), ethers.parseUnits("1000", 6));
    await aggregator.approveToken(pairId, await usdc.getAddress(), await flash.getAddress(), ethers.parseUnits("1000", 6));
    // Deposit to base
    await usdc.transfer(await aggregator.getAddress(), ethers.parseUnits("1000", 6));
    await aggregator.depositToStrategy(pairId, await base.getAddress(), ethers.parseUnits("1000", 6));
  });

  it("only keeper can trigger/end flash boost", async function () {
    // Set keeper
    await aggregator.setKeeper(keeper.address, true);
    // Simulate yield
    await usdc.transfer(await flash.getAddress(), ethers.parseUnits("100", 6));
    // Should succeed for keeper
    await aggregator.connect(keeper).triggerFlashBoost(pairId, await flash.getAddress(), 20);
    await aggregator.connect(keeper).endFlashBoost(pairId);
    // Should revert for non-keeper
    await expect(
      aggregator.connect(user).triggerFlashBoost(pairId, await flash.getAddress(), 20)
    ).to.be.revertedWith("Not keeper");
    await expect(
      aggregator.connect(user).endFlashBoost(pairId)
    ).to.be.revertedWith("Not keeper");
  });

  it("owner can set/unset keeper", async function () {
    await aggregator.setKeeper(keeper.address, true);
    expect(await aggregator.isKeeper(keeper.address)).to.equal(true);
    await aggregator.setKeeper(keeper.address, false);
    expect(await aggregator.isKeeper(keeper.address)).to.equal(false);
  });

  it("all entrypoints revert when paused", async function () {
    await aggregator.pause();
    await usdc.connect(user).approve(await aggregator.getAddress(), ethers.parseUnits("100", 6));
    await expect(
      aggregator.connect(user).deposit(pairId, ethers.parseUnits("100", 6))
    ).to.be.revertedWith("Paused");
    await expect(
      aggregator.connect(user).withdraw(pairId, 1)
    ).to.be.revertedWith("Paused");
    await expect(
      aggregator.depositToStrategy(pairId, await base.getAddress(), 1)
    ).to.be.revertedWith("Paused");
    await aggregator.setKeeper(keeper.address, true);
    await expect(
      aggregator.connect(keeper).triggerFlashBoost(pairId, await flash.getAddress(), 20)
    ).to.be.revertedWith("Paused");
    await expect(
      aggregator.connect(keeper).endFlashBoost(pairId)
    ).to.be.revertedWith("Paused");
    await expect(
      aggregator.rebalance(pairId)
    ).to.be.revertedWith("Paused");
    await aggregator.unpause();
    // Should succeed after unpause
    await aggregator.connect(keeper).triggerFlashBoost(pairId, await flash.getAddress(), 20);
  });
});
