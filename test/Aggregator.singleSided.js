const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Aggregator: Single-Sided Deposit", function () {
  let usdc, usdt, owner, user, aggregator, pairId;

  beforeEach(async function () {
    [owner, user, feeRecipient] = await ethers.getSigners();
    // Deploy mock USDC and USDT
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.parseUnits("1000000", 6));
    await usdc.waitForDeployment();
    usdt = await MockERC20.deploy("Tether", "USDT", ethers.parseUnits("1000000", 6));
    await usdt.waitForDeployment();

    // Deploy mock LP and router
    const MockLP = await ethers.getContractFactory("MockLP");
    const mockLP = await MockLP.deploy("USDC/USDT LP", "LP");
    await mockLP.waitForDeployment();
  const MockRouter = await ethers.getContractFactory("contracts/mocks/MockRouter.sol:MockRouter");
  const router = await MockRouter.deploy(await mockLP.getAddress());
  await router.waitForDeployment();
    // Mint USDC to user
    await usdc.transfer(user.address, ethers.parseUnits("10000", 6));
  // Fund router with token balances so swaps can succeed (smaller amounts so owner keeps balance)
  await usdt.transfer(await router.getAddress(), ethers.parseUnits("100000", 6));
  await usdc.transfer(await router.getAddress(), ethers.parseUnits("100000", 6));
    // Deploy Aggregator
    const Aggregator = await ethers.getContractFactory("contracts/Aggregator.sol:Aggregator");
    aggregator = await Aggregator.deploy();
    await aggregator.waitForDeployment();
  await aggregator.setRouter(await router.getAddress());
    // Add USDC/USDT pair
  const tx = await aggregator.addPair(await usdc.getAddress(), await usdt.getAddress());
    const receipt = await tx.wait();
    pairId = receipt.logs[0].args.pairId || 0;
  // (user pre-funded above)
  });

  it("should revert on zero deposit", async function () {
  await usdc.connect(user).approve(await aggregator.getAddress(), 0);
    await expect(
      aggregator.connect(user).deposit(pairId, 0)
    ).to.be.revertedWith("Amount must be > 0");
  });

  it("should accept single-sided USDC deposit and split", async function () {
    const depositAmount = ethers.parseUnits("1000", 6);
  await usdc.connect(user).approve(await aggregator.getAddress(), depositAmount);
    await expect(
      aggregator.connect(user).deposit(pairId, depositAmount)
    ).to.emit(aggregator, "XPUpdated");
    // Check shares and balances
    const shares = await aggregator.userShares(pairId, user.address);
    expect(shares).to.be.gt(0);
    const totalShares = await aggregator.pairs(pairId).then(p => p.totalShares);
    expect(totalShares).to.equal(shares);
    // Check USDC/USDT balances in aggregator
  const usdcBal = await usdc.balanceOf(await aggregator.getAddress());
  const usdtBal = await usdt.balanceOf(await aggregator.getAddress());
    expect(usdcBal + usdtBal).to.equal(depositAmount);
  });

  it("should handle multiple users sequentially", async function () {
    const deposit1 = ethers.parseUnits("1000", 6);
    const deposit2 = ethers.parseUnits("2000", 6);
  await usdc.connect(user).approve(await aggregator.getAddress(), deposit1);
    await aggregator.connect(user).deposit(pairId, deposit1);
    await usdc.transfer(owner.address, deposit2);
  await usdc.connect(owner).approve(aggregator.target, deposit2);
    await aggregator.connect(owner).deposit(pairId, deposit2);
    const shares1 = await aggregator.userShares(pairId, user.address);
    const shares2 = await aggregator.userShares(pairId, owner.address);
    expect(shares1).to.be.gt(0);
    expect(shares2).to.be.gt(0);
    expect(await aggregator.pairs(pairId).then(p => p.totalShares)).to.equal(shares1 + shares2);
  });

  it("should allow rebalance after deposit", async function () {
    const depositAmount = ethers.parseUnits("1000", 6);
  await usdc.connect(user).approve(aggregator.target, depositAmount);
    await aggregator.connect(user).deposit(pairId, depositAmount);
    // Add two mock strategies
    const StrategyX = await ethers.getContractFactory("StrategyX");
  const strategy1 = await StrategyX.deploy(await usdc.getAddress());
    await strategy1.waitForDeployment();
  const strategy2 = await StrategyX.deploy(await usdc.getAddress());
    await strategy2.waitForDeployment();
  await aggregator.addStrategy(pairId, await strategy1.getAddress());
  await aggregator.addStrategy(pairId, await strategy2.getAddress());
    // Transfer some USDC to strategy1 to simulate a balance
  await usdc.transfer(await strategy1.getAddress(), ethers.parseUnits("100", 6));
    // Transfer some USDC to strategy2 to simulate a balance
  await usdc.transfer(await strategy2.getAddress(), ethers.parseUnits("50", 6));
    // Aggregator approves both strategies to spend USDC
  await aggregator.approveToken(pairId, await usdc.getAddress(), await strategy1.getAddress(), ethers.parseUnits("1000", 6));
  await aggregator.approveToken(pairId, await usdc.getAddress(), await strategy2.getAddress(), ethers.parseUnits("1000", 6));
    // Rebalance
    await expect(aggregator.rebalance(pairId)).to.emit(aggregator, "StrategyRebalanced");
  });
});
