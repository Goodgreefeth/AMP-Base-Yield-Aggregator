const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Aggregator: Full Protocol Lifecycle", function () {
  let usdc, owner, user1, user2, treasury, aggregator, pairId, strategy1, strategy2;

  beforeEach(async function () {
    [owner, user1, user2, treasury] = await ethers.getSigners();
    // Deploy mock USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.parseUnits("1000000000", 6));
    await usdc.waitForDeployment();
    // Deploy mock router
  const MockLP = await ethers.getContractFactory("MockLP");
  const mockLP = await MockLP.deploy("USDC/USDC LP", "LP");
  await mockLP.waitForDeployment();
  const MockRouter = await ethers.getContractFactory("contracts/mocks/MockRouter.sol:MockRouter");
  const router = await MockRouter.deploy(await mockLP.getAddress());
  await router.waitForDeployment();
    // Fund router with a large supply of USDC for swaps
    await usdc.transfer(await router.getAddress(), ethers.parseUnits("100000000", 6));
  // Deploy AggregatorUpgradeable as UUPS proxy
  // Use the correct contract name for the upgradeable artifact
  const Aggregator = await ethers.getContractFactory("AggregatorUpgradeable");
  // initialize(address _treasury, uint256 _performanceFeeBps, uint256 _protocolFeeBps, address _feeRecipient)
  aggregator = await upgrades.deployProxy(
    Aggregator,
    [treasury.address, 500, 100, treasury.address],
    { kind: "uups", unsafeAllow: ['delegatecall'] }
  );
  await aggregator.waitForDeployment();
  // Deploy impls and wire them into the upgradeable facade so delegatecall paths work in tests
  const LpVaultImpl = await ethers.getContractFactory("contracts/impls/LpVaultImpl.sol:LpVaultImpl");
  const DepositImpl = await ethers.getContractFactory("contracts/impls/DepositImpl.sol:DepositImpl");
  const RebalanceImpl = await ethers.getContractFactory("contracts/impls/RebalanceImpl.sol:RebalanceImpl");
  const FlashBoostImpl = await ethers.getContractFactory("contracts/impls/FlashBoostImpl.sol:FlashBoostImpl");
  const lpVaultImpl = await LpVaultImpl.deploy(); await lpVaultImpl.waitForDeployment();
  const depositImpl = await DepositImpl.deploy(); await depositImpl.waitForDeployment();
  const rebalanceImpl = await RebalanceImpl.deploy(); await rebalanceImpl.waitForDeployment();
  const flashBoostImpl = await FlashBoostImpl.deploy(); await flashBoostImpl.waitForDeployment();
  // Set implementations as the owner
  await aggregator.connect(owner).setLpVaultImpl(await lpVaultImpl.getAddress());
  await aggregator.connect(owner).setDepositImpl(await depositImpl.getAddress());
  await aggregator.connect(owner).setRebalanceImpl(await rebalanceImpl.getAddress());
  await aggregator.connect(owner).setFlashBoostImpl(await flashBoostImpl.getAddress());
    await aggregator.setRouter(await router.getAddress());
  await aggregator.setProtocolFee(100); // 1%
    await aggregator.setTreasury(treasury.address);
    // Add USDC/USDC pair
  const tx = await aggregator.addPair(await usdc.getAddress(), await usdc.getAddress());
    const receipt = await tx.wait();
    pairId = receipt.logs[0].args.pairId || 0;
    // Deploy strategies
    const StrategyX = await ethers.getContractFactory("StrategyX");
  strategy1 = await StrategyX.deploy(await usdc.getAddress());
  await strategy1.waitForDeployment();
  const HighAPYStrategy = await ethers.getContractFactory("HighAPYStrategy");
  strategy2 = await HighAPYStrategy.deploy(await usdc.getAddress());
  await strategy2.waitForDeployment();
  await aggregator.addStrategy(pairId, await strategy1.getAddress());
  await aggregator.addStrategy(pairId, await strategy2.getAddress());
    // Mint USDC to users
    await usdc.transfer(user1.address, ethers.parseUnits("1000000", 6));
    await usdc.transfer(user2.address, ethers.parseUnits("1000000", 6));
  });

  it("should handle multiple users, strategies, and full lifecycle with correct fee and yield accounting", async function () {
    // ---
    // NOTE: User withdrawals require aggregator to hold sufficient liquidity. Automation/keeper must withdraw from strategies before user withdraws.
    // ---

    // Try withdrawal with no shares (should revert with 'No shares in vault')
    const shares1BeforeDeposit = await aggregator.userShares(pairId, user1.address);
    await expect(
      aggregator.connect(user1).withdraw.staticCall(pairId, shares1BeforeDeposit)
    ).to.be.revertedWith("shares must be > 0");

    // Refetch shares after revert check (should be unchanged)
    const shares1AfterRevert = await aggregator.userShares(pairId, user1.address);

    // Simulate keeper/automation: withdraw all funds from strategy2 to aggregator
    const strat2Bal = await usdc.balanceOf(strategy2.target);
    if (strat2Bal > 0n) {
      await strategy2.withdraw(strat2Bal);
    }
  const strat1BalBefore = await usdc.balanceOf(strategy1.target);
  const strat2BalBefore = await usdc.balanceOf(strategy2.target);
  const treasuryBalBeforeDebug = await usdc.balanceOf(treasury.address);
  console.log("Strategy1 USDC before withdrawal:", strat1BalBefore.toString());
  console.log("Strategy2 USDC before withdrawal:", strat2BalBefore.toString());
  console.log("Treasury USDC before withdrawal:", treasuryBalBeforeDebug.toString());
    // User1 deposits
    const deposit1 = ethers.parseUnits("1000", 6);
    await usdc.connect(user1).approve(aggregator.target, deposit1);
    await aggregator.connect(user1).deposit(pairId, deposit1);
    let aggBal = await usdc.balanceOf(aggregator.target);
    let strat1Bal = await usdc.balanceOf(strategy1.target);
    let strat2BalUser1 = await usdc.balanceOf(strategy2.target);
    console.log("After user1 deposit: aggregator:", aggBal.toString(), "strategy1:", strat1Bal.toString(), "strategy2:", strat2BalUser1.toString());

    // User2 deposits
    const deposit2 = ethers.parseUnits("2000", 6);
    await usdc.connect(user2).approve(aggregator.target, deposit2);
    await aggregator.connect(user2).deposit(pairId, deposit2);
    aggBal = await usdc.balanceOf(aggregator.target);
    strat1Bal = await usdc.balanceOf(strategy1.target);
    let strat2BalUser2 = await usdc.balanceOf(strategy2.target);
    console.log("After user2 deposit: aggregator:", aggBal.toString(), "strategy1:", strat1Bal.toString(), "strategy2:", strat2BalUser2.toString());

    // Move all funds to strategy1
    await aggregator.depositToStrategy(pairId, strategy1.target, deposit1 + deposit2);
    aggBal = await usdc.balanceOf(aggregator.target);
    strat1Bal = await usdc.balanceOf(strategy1.target);
    let strat2BalPostDeposit = await usdc.balanceOf(strategy2.target);
    console.log("After depositToStrategy: aggregator:", aggBal.toString(), "strategy1:", strat1Bal.toString(), "strategy2:", strat2BalPostDeposit.toString());

    // Simulate yield in strategy1
    const yield1 = ethers.parseUnits("300", 6);
  await usdc.transfer(await strategy1.getAddress(), yield1);
    strat1Bal = await usdc.balanceOf(strategy1.target);
    console.log("After yield: strategy1:", strat1Bal.toString());

    // Approve strategy2 for rebalance
  await aggregator.approveToken(pairId, await usdc.getAddress(), await strategy2.getAddress(), deposit1 + deposit2 + yield1);
  await usdc.connect(owner).approve(await strategy2.getAddress(), deposit1 + deposit2 + yield1);

    // Rebalance: move all from strategy1 to strategy2, fee on yield
    strat1Bal = await usdc.balanceOf(strategy1.target);
    const principal = deposit1 + deposit2;
    const yieldEarned = strat1Bal - principal;
    const expectedFee = (yieldEarned * 100n) / 10000n;
    let treasuryBalBefore = await usdc.balanceOf(treasury.address);
    await aggregator.rebalance(pairId);
    aggBal = await usdc.balanceOf(aggregator.target);
    strat1Bal = await usdc.balanceOf(strategy1.target);
    let strat2BalAfterRebalance = await usdc.balanceOf(strategy2.target);
    let treasuryBalAfter = await usdc.balanceOf(treasury.address);
    console.log("After rebalance: aggregator:", aggBal.toString(), "strategy1:", strat1Bal.toString(), "strategy2:", strat2BalAfterRebalance.toString(), "treasury:", treasuryBalAfter.toString());
    expect(treasuryBalAfter - treasuryBalBefore).to.equal(expectedFee);
  // Simulate keeper/automation: withdraw all funds from strategy2 to aggregator before user withdrawals
  const strat2BalFinal = await usdc.balanceOf(strategy2.target);
  if (strat2BalFinal > 0n) {
    await aggregator.connect(owner).withdrawFromStrategy(pairId, strategy2.target, strat2BalFinal);
  }
  // Debug output: check balances after withdrawal
  const aggregatorBalAfterStratWithdraw = await usdc.balanceOf(aggregator.target);
  const strat2BalAfterWithdraw = await usdc.balanceOf(strategy2.target);
  console.log("Aggregator USDC after strategy withdrawal:", aggregatorBalAfterStratWithdraw.toString());
  console.log("Strategy2 USDC after withdrawal:", strat2BalAfterWithdraw.toString());
  // User1 and User2 withdraw after aggregator holds funds
  const shares1ForWithdraw = await aggregator.userShares(pairId, user1.address);
  const shares2ForWithdraw = await aggregator.userShares(pairId, user2.address);
  const pair = await aggregator.pairs(pairId);
  const totalShares = pair.totalShares;
  const vaultValue = await usdc.balanceOf(aggregator.target);
  console.log("User1 shares:", shares1ForWithdraw.toString());
  console.log("User2 shares:", shares2ForWithdraw.toString());
  console.log("Total shares:", totalShares.toString());
  console.log("Vault value before withdrawal:", vaultValue.toString());
  const bal1Before = await usdc.balanceOf(user1.address);
  await aggregator.connect(user1).withdraw(pairId, shares1ForWithdraw);
  const bal1After = await usdc.balanceOf(user1.address);
  console.log("User1 balance before withdrawal:", bal1Before.toString());
  console.log("User1 balance after withdrawal:", bal1After.toString());
  console.log("User1 withdrawal amount:", (bal1After - bal1Before).toString());
  expect(bal1After).to.be.gt(bal1Before); // User1 receives payout
  const bal2Before = await usdc.balanceOf(user2.address);
  await aggregator.connect(user2).withdraw(pairId, shares2ForWithdraw);
  const bal2After = await usdc.balanceOf(user2.address);
  console.log("User2 balance before withdrawal:", bal2Before.toString());
  console.log("User2 balance after withdrawal:", bal2After.toString());
  console.log("User2 withdrawal amount:", (bal2After - bal2Before).toString());
  expect(bal2After).to.be.gt(bal2Before); // User2 receives payout
  // Calculate withdrawal fees for both users
  // User1
  const user1Shares = shares1ForWithdraw;
  const user2Shares = shares2ForWithdraw;
  const totalSharesForWithdraw = pair.totalShares;
  // vaultValue is aggregator's balance after strategy withdrawal
  const user1Amount = (vaultValue * user1Shares) / totalSharesForWithdraw;
  const user2Amount = (vaultValue * user2Shares) / totalSharesForWithdraw;
  const withdrawFee1 = (user1Amount * 100n) / 10000n;
  const withdrawFee2 = (user2Amount * 100n) / 10000n;
  const expectedTotal = expectedFee + withdrawFee1 + withdrawFee2;
  const totalFees = await aggregator.totalFeesCollected();
  console.log("expectedFee (rebalance only):", expectedFee.toString());
  console.log("withdrawFee1:", withdrawFee1.toString(), "withdrawFee2:", withdrawFee2.toString());
  console.log("expectedTotal (all fees):", expectedTotal.toString());
  console.log("totalFees (contract):", totalFees.toString());
  console.log("deposit1:", deposit1.toString(), "deposit2:", deposit2.toString(), "yield1:", yield1.toString());
  console.log("principal:", principal.toString(), "yieldEarned:", yieldEarned.toString());
  expect(totalFees).to.equal(expectedTotal);
    // Check FeeCollected events
    // (Optional: parse logs for FeeCollected and sum amounts)
  });

  it("should not lose yield or misallocate after multiple deposits/withdrawals and rebalances", async function () {
    // User1 deposits
    const deposit1 = ethers.parseUnits("1000", 6);
    await usdc.connect(user1).approve(aggregator.target, deposit1);
    await aggregator.connect(user1).deposit(pairId, deposit1);
    // Move to strategy1
    await aggregator.depositToStrategy(pairId, strategy1.target, deposit1);
    // Simulate yield
    await usdc.transfer(strategy1.target, ethers.parseUnits("100", 6));
    // User2 deposits
    const deposit2 = ethers.parseUnits("500", 6);
    await usdc.connect(user2).approve(aggregator.target, deposit2);
    await aggregator.connect(user2).deposit(pairId, deposit2);
    // Move to strategy1
    await aggregator.depositToStrategy(pairId, strategy1.target, deposit2);
    // More yield
    await usdc.transfer(strategy1.target, ethers.parseUnits("50", 6));
    // Rebalance
    await aggregator.approveToken(pairId, usdc.target, strategy2.target, ethers.parseUnits("2000", 6));
    await usdc.connect(owner).approve(strategy2.target, ethers.parseUnits("2000", 6));
    await aggregator.rebalance(pairId);
    // Withdraw all
    const shares1 = await aggregator.userShares(pairId, user1.address);
    const shares2 = await aggregator.userShares(pairId, user2.address);
    await aggregator.connect(user1).withdraw(pairId, shares1);
    await aggregator.connect(user2).withdraw(pairId, shares2);
    // Check all funds (minus fees) are returned
    const aggBal = await usdc.balanceOf(aggregator.target);
    expect(aggBal).to.be.lte(1); // Should be dust only
    // Check total fees
    const totalFees = await aggregator.totalFeesCollected();
    expect(totalFees).to.be.gt(0);
  });
});
