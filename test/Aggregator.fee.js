const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Aggregator: Protocol Fee & Treasury", function () {
  let usdc, owner, user, treasury, aggregator, pairId;

  beforeEach(async function () {
    [owner, user, treasury] = await ethers.getSigners();
  // Deploy mock USDC with a huge initial supply
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.parseUnits("1000000000", 6)); // 1 billion USDC
  await usdc.waitForDeployment();
    // Deploy mock router and set in Aggregator
  const MockLP = await ethers.getContractFactory("MockLP");
  const mockLP = await MockLP.deploy("USDC/USDC LP", "LP");
  await mockLP.waitForDeployment();
  const MockRouter = await ethers.getContractFactory("contracts/mocks/MockRouter.sol:MockRouter");
  const router = await MockRouter.deploy(await mockLP.getAddress());
  await router.waitForDeployment();
    // Deploy Aggregator
  const Aggregator = await ethers.getContractFactory("contracts/Aggregator.sol:Aggregator");
    aggregator = await Aggregator.deploy();
    await aggregator.waitForDeployment();
  await aggregator.setRouter(await router.getAddress());
    // Set protocol fee and treasury
    await aggregator.setProtocolFee(200); // 2%
    await aggregator.setTreasury(treasury.address);
    // Add USDC/USDC pair (for simplicity)
  const tx = await aggregator.addPair(await usdc.getAddress(), await usdc.getAddress());
    const receipt = await tx.wait();
    pairId = receipt.logs[0].args.pairId || 0;
  // Mint a large amount of USDC to user
  await usdc.transfer(user.address, ethers.parseUnits("1000000", 6));
  });

  it("should send protocol fee to treasury on withdrawal", async function () {
    const depositAmount = ethers.parseUnits("1000", 6);
  await usdc.connect(user).approve(await aggregator.getAddress(), depositAmount);
    await aggregator.connect(user).deposit(pairId, depositAmount);
    const shares = await aggregator.userShares(pairId, user.address);
    const treasuryBalBefore = await usdc.balanceOf(treasury.address);
    const tx = await aggregator.connect(user).withdraw(pairId, shares);
    const receipt = await tx.wait();
    const treasuryBalAfter = await usdc.balanceOf(treasury.address);
    // 2% of 1000 USDC = 20 USDC (for same-token pair, not double)
    expect(treasuryBalAfter - treasuryBalBefore).to.equal(depositAmount / 50n); // 2% of deposit
    // Check FeeCollected event
    const feeEvent = receipt.logs.map(log => {
      try { return aggregator.interface.parseLog(log); } catch { return null; }
    }).find(e => e && e.name === "FeeCollected");
    expect(feeEvent).to.exist;
    expect(feeEvent.args.amount).to.equal(depositAmount / 50n);
    // Check totalFeesCollected
    const totalFees = await aggregator.totalFeesCollected();
    expect(totalFees).to.equal(depositAmount / 50n);
  });

  it("should send protocol fee to treasury on rebalance", async function () {
  const aggregatorBal = await usdc.balanceOf(aggregator.target);
    console.log("Aggregator USDC balance before rebalance:", aggregatorBal.toString());
    // Deploy mock strategies
    const StrategyX = await ethers.getContractFactory("StrategyX");
  const strategy1 = await StrategyX.deploy(await usdc.getAddress());
    await strategy1.waitForDeployment();
    const HighAPYStrategy = await ethers.getContractFactory("HighAPYStrategy");
  const strategy2 = await HighAPYStrategy.deploy(await usdc.getAddress());
    await strategy2.waitForDeployment();
  await aggregator.addStrategy(pairId, await strategy1.getAddress());
  await aggregator.addStrategy(pairId, await strategy2.getAddress());
    // Simulate user deposit into Aggregator
    const depositAmount = ethers.parseUnits("1000", 6);
  await usdc.connect(user).approve(await aggregator.getAddress(), depositAmount);
    await aggregator.connect(user).deposit(pairId, depositAmount);
    // Aggregator moves funds into strategy1 (real protocol flow)
  await aggregator.depositToStrategy(pairId, await strategy1.getAddress(), depositAmount);
    // Simulate strategy1 earning yield (Aggregator will withdraw more than deposited)
    const yieldAmount = ethers.parseUnits("100", 6);
  await usdc.transfer(await strategy1.getAddress(), yieldAmount);
    // Approve strategy2 to spend USDC from Aggregator before rebalance
  await aggregator.approveToken(pairId, await usdc.getAddress(), await strategy2.getAddress(), depositAmount);
  await usdc.connect(owner).approve(await strategy2.getAddress(), depositAmount);
    // Now, after all deposits and yield, get strategy1's balance for expected fee calculation
  const strategy1Bal = await usdc.balanceOf(strategy1.target);
    const stratBalView = await strategy1.balanceOf();
    console.log("strategy1.balanceOf() before rebalance:", stratBalView.toString());
    // Now rebalance: strategy1 -> strategy2, Aggregator should receive funds from strategy1, skim fee, and deposit remainder into strategy2
    const treasuryBalBefore = await usdc.balanceOf(treasury.address);
    console.log("Treasury balance before rebalance:", treasuryBalBefore.toString());
  // Calculate yield and fee as in contract
  const principal = depositAmount;
  const yieldForFee = strategy1Bal > principal ? strategy1Bal - principal : 0n;
  const expectedFee = (yieldForFee * 200n) / 10000n; // 2% of yield only
    console.log("Treasury address:", treasury.address);
    console.log("Calculated expected fee: ", expectedFee.toString());
    const tx = await aggregator.rebalance(pairId);
    const receipt = await tx.wait();
    console.log("Raw logs from rebalance receipt:", receipt.logs);
    const treasuryBalAfter = await usdc.balanceOf(treasury.address);
    console.log("Treasury balance after rebalance:", treasuryBalAfter.toString());
  expect(treasuryBalAfter - treasuryBalBefore).to.equal(expectedFee); // 2% of yield only
    // Check FeeCollected event
    const feeEvent = receipt.logs.map(log => {
      try { return aggregator.interface.parseLog(log); } catch { return null; }
    }).find(e => e && e.name === "FeeCollected");
    expect(feeEvent).to.exist;
  expect(feeEvent.args.amount).to.equal(expectedFee);
  // Check totalFeesCollected (should be sum of withdrawal and rebalance fees)
  const totalFees = await aggregator.totalFeesCollected();
  // withdrawal fee is 2% of yield (if any), rebalance fee is 2% of yield
  // For this test, withdrawal fee is likely 0, so just check expectedFee
  expect(totalFees).to.equal(expectedFee);
  });

  it("should accumulate totalFeesCollected across withdrawal and rebalance", async function () {
    // Setup: deploy strategies and deposit
    const StrategyX = await ethers.getContractFactory("StrategyX");
  const strategy1 = await StrategyX.deploy(usdc.target);
    await strategy1.waitForDeployment();
    const HighAPYStrategy = await ethers.getContractFactory("HighAPYStrategy");
  const strategy2 = await HighAPYStrategy.deploy(usdc.target);
    await strategy2.waitForDeployment();
  await aggregator.addStrategy(pairId, strategy1.target);
  await aggregator.addStrategy(pairId, strategy2.target);
    const depositAmount = ethers.parseUnits("1000", 6);
  await usdc.connect(user).approve(aggregator.target, depositAmount);
    await aggregator.connect(user).deposit(pairId, depositAmount);
    // User withdraws half their shares while aggregator still has liquidity
    // (withdraw first so a withdrawal fee is actually collected on-chain)
    const shares = await aggregator.userShares(pairId, user.address);
    const halfShares = shares / 2n;
    // Calculate vault value and withdrawal amount
  const tx1 = await aggregator.connect(user).withdraw(pairId, halfShares);
  await tx1.wait();
  // Capture fees collected by withdrawal
  const feesAfterWithdraw = await aggregator.totalFeesCollected();

  // Now move the remaining funds into strategy and simulate yield
  await aggregator.depositToStrategy(pairId, strategy1.target, depositAmount / 2n);
    const yieldAmount = ethers.parseUnits("100", 6);
  await usdc.transfer(strategy1.target, yieldAmount);
    // Approve for rebalance
  await aggregator.approveToken(pairId, usdc.target, strategy2.target, depositAmount);
  await usdc.connect(owner).approve(strategy2.target, depositAmount);
    // Get strategy1 balance and compute rebalance fee based on yield (bal - principal)
  const strategy1Bal = await usdc.balanceOf(strategy1.target);
    const principal = depositAmount / 2n; // we moved half the deposit into strategy
    const yieldForFee = strategy1Bal > principal ? strategy1Bal - principal : 0n;
    const rebalanceFee = (yieldForFee * 200n) / 10000n;
    // Rebalance
    const tx2 = await aggregator.rebalance(pairId);
    await tx2.wait();
  // Check totalFeesCollected is sum of previous withdrawal fees + rebalance fee
  const totalFees = await aggregator.totalFeesCollected();
  expect(totalFees).to.equal(feesAfterWithdraw + rebalanceFee);
  });
});
