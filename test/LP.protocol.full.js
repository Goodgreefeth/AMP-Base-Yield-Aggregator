const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Aggregator Full Protocol: Single-Sided Deposit, APY-Driven Rebalance, Automation", function () {
  let TokenA, TokenB, TokenC, tokenA, tokenB, tokenC, MockLP, mockLP1, mockLP2, MockRouter, router1, router2;
  let Aggregator, aggregator, owner, user, keeper, treasury, StrategyMock, strat1, strat2, strat3;
  let pairId0, pairId1;
  let mockLP1Addr, mockLP2Addr, router1Addr, router2Addr, aggAddress;

  beforeEach(async () => {
  [owner, user, keeper, treasury] = await ethers.getSigners();

    // Deploy tokens
    TokenA = await ethers.getContractFactory("MockERC20");

  tokenA = await TokenA.deploy("USDC", "USDC", 6);
  await tokenA.waitForDeployment();
  const tokenAAddr = await tokenA.getAddress();
  tokenB = await TokenA.deploy("USDT", "USDT", 6);
  await tokenB.waitForDeployment();
  const tokenBAddr = await tokenB.getAddress();
  tokenC = await TokenA.deploy("WETH", "WETH", 18);
  await tokenC.waitForDeployment();
  const tokenCAddr = await tokenC.getAddress();

  // Deploy LP tokens
  MockLP = await ethers.getContractFactory("MockLP");
  mockLP1 = await MockLP.deploy("USDC/USDT LP", "LP1");
  await mockLP1.waitForDeployment();
  mockLP1Addr = await mockLP1.getAddress();
  if (!mockLP1Addr) throw new Error('mockLP1.address is undefined');
  mockLP2 = await MockLP.deploy("USDC/WETH LP", "LP2");
  await mockLP2.waitForDeployment();
  mockLP2Addr = await mockLP2.getAddress();
  if (!mockLP2Addr) throw new Error('mockLP2.address is undefined');

  // Deploy routers
  MockRouter = await ethers.getContractFactory("contracts/mocks/MockRouter.sol:MockRouter");
  router1 = await MockRouter.deploy(mockLP1Addr);
  await router1.waitForDeployment();
  router1Addr = await router1.getAddress();
  if (!router1Addr) throw new Error('router1.address is undefined');
  // Provide router with tokenB balance so MockRouter can transfer outToken during swap
  await tokenB.mint(router1Addr, ethers.parseUnits("1000000", 6));
  router2 = await MockRouter.deploy(mockLP2Addr);
  await router2.waitForDeployment();
  router2Addr = await router2.getAddress();
  if (!router2Addr) throw new Error('router2.address is undefined');
  // Provide router2 with tokenC balance for swaps involving tokenC (WETH)
  await tokenC.mint(router2Addr, ethers.parseUnits("100000", 18));

  // Deploy upgradeable Aggregator proxy so we can set impls and use delegatecall paths
  const upgrades = require('hardhat').upgrades;
  const Aggregator = await ethers.getContractFactory("AggregatorUpgradeable");
  aggregator = await upgrades.deployProxy(Aggregator, [await owner.getAddress(), 100, 100, await owner.getAddress()], { kind: "uups", unsafeAllow: ['delegatecall'] });
  await aggregator.waitForDeployment();
  aggAddress = await aggregator.getAddress();
  if (!aggAddress) throw new Error('aggregator.address is undefined');

    // Set router and register pairs (owner-only)
    await aggregator.connect(owner).setRouter(router1Addr); // For simplicity, use router1 for both pairs in this test
  await aggregator.connect(owner).addPair(tokenAAddr, tokenBAddr);
  let nextPairIdAfter0 = await aggregator.nextPairId();
  pairId0 = Number(nextPairIdAfter0) - 1;
  console.log('After addPair 0: pairId0', pairId0, 'nextPairId', nextPairIdAfter0.toString());
  await aggregator.connect(owner).addPair(tokenAAddr, tokenCAddr);
  let nextPairIdAfter1 = await aggregator.nextPairId();
  pairId1 = Number(nextPairIdAfter1) - 1;
  console.log('After addPair 1: pairId1', pairId1, 'nextPairId', nextPairIdAfter1.toString());
  // Debug: log pair IDs and LP token mapping
  console.log('pairId0:', pairId0, 'pairId1:', pairId1);
  const lp0 = await aggregator.lpTokenOfPair(pairId0);
  const lp1 = await aggregator.lpTokenOfPair(pairId1);
  console.log('lpTokenOfPair[0]:', lp0, 'lpTokenOfPair[1]:', lp1);
  await aggregator.connect(owner).setLpTokenForPair(0, mockLP1Addr);
  await aggregator.connect(owner).setLpTokenForPair(1, mockLP2Addr);

  // Deploy impls and wire them (for the upgradeable path we'd set via setters; keep parity for non-upgradeable aggregator)
  // For non-upgradeable Aggregator we still deploy the impls to allow using their logic directly in tests where needed.
  const LpVaultImpl = await ethers.getContractFactory("contracts/impls/LpVaultImpl.sol:LpVaultImpl");
  const DepositImpl = await ethers.getContractFactory("contracts/impls/DepositImpl.sol:DepositImpl");
  const RebalanceImpl = await ethers.getContractFactory("contracts/impls/RebalanceImpl.sol:RebalanceImpl");
  const FlashBoostImpl = await ethers.getContractFactory("contracts/impls/FlashBoostImpl.sol:FlashBoostImpl");
  const lpVaultImpl = await LpVaultImpl.deploy(); await lpVaultImpl.waitForDeployment();
  const depositImpl = await DepositImpl.deploy(); await depositImpl.waitForDeployment();
  const rebalanceImpl = await RebalanceImpl.deploy(); await rebalanceImpl.waitForDeployment();
  const flashBoostImpl = await FlashBoostImpl.deploy(); await flashBoostImpl.waitForDeployment();
  // If aggregator has setter functions (upgradeable facade), set them. Wrap in try/catch to support both Aggregator and AggregatorUpgradeable artifacts.
  // Set implementations on the proxy
  await aggregator.connect(owner).setLpVaultImpl(await lpVaultImpl.getAddress());
  await aggregator.connect(owner).setDepositImpl(await depositImpl.getAddress());
  await aggregator.connect(owner).setRebalanceImpl(await rebalanceImpl.getAddress());
  await aggregator.connect(owner).setFlashBoostImpl(await flashBoostImpl.getAddress());
  // Debug: log lpTokenOfPair after setting and check pairId0
  const lp0After = await aggregator.lpTokenOfPair(pairId0);
  const lp1After = await aggregator.lpTokenOfPair(pairId1);
  const nextPairId = await aggregator.nextPairId();
  console.log('pairId0:', pairId0, 'pairId1:', pairId1, 'nextPairId:', nextPairId.toString(), 'lpTokenOfPair[pairId0]:', lp0After, 'lpTokenOfPair[pairId1]:', lp1After);
  if (!lp0After || lp0After === ethers.ZeroAddress) {
    throw new Error('lpTokenOfPair[pairId0] is not set or is zero address after setLpTokenForPair!');
  }

    // Deploy strategies for pair 0
    StrategyMock = await ethers.getContractFactory("StrategyMockLP");
  strat1 = await StrategyMock.deploy(mockLP1Addr, 200); // 2% APY
  await strat1.waitForDeployment();
  const strat1Addr = await strat1.getAddress();
  if (!strat1Addr) throw new Error('strat1.address is undefined');
  strat2 = await StrategyMock.deploy(mockLP1Addr, 400); // 4% APY
  await strat2.waitForDeployment();
  const strat2Addr = await strat2.getAddress();
  if (!strat2Addr) throw new Error('strat2.address is undefined');
  await aggregator.connect(owner).addStrategy(0, strat1Addr);
  await aggregator.connect(owner).addStrategy(0, strat2Addr);

    // Deploy a third strategy for pair 0 (simulate future higher APY)
  strat3 = await StrategyMock.deploy(mockLP1Addr, 100); // 1% APY
  await strat3.waitForDeployment();
  const strat3Addr = await strat3.getAddress();
  if (!strat3Addr) throw new Error('strat3.address is undefined');
  await aggregator.connect(owner).addStrategy(0, strat3Addr);

    // Mint and approve USDC for user
    await tokenA.mint(user.address, ethers.parseUnits("1000", 6));
    await tokenA.connect(user).approve(aggAddress, ethers.parseUnits("1000", 6));

  // Set minRebalanceInterval to 12 hours (if available on this aggregator artifact)
  try { await aggregator.setMinRebalanceInterval(12 * 60 * 60); } catch (e) {}
  });

  it("deposits, only rebalances if APY improvement >3% and 12h passed", async () => {
  // Debug: log router, treasury, lpTokenOfPair, and known strategy addresses before deposit
  const routerAddr = await aggregator.router();
  const treasuryAddr = await aggregator.treasury();
  const lp0BeforeDeposit = await aggregator.lpTokenOfPair(0);
  const strat1Addr = await strat1.getAddress();
  const strat2Addr = await strat2.getAddress();
  const strat3Addr = await strat3.getAddress();
  console.log('router:', routerAddr, 'treasury:', treasuryAddr, 'lpTokenOfPair:', lp0BeforeDeposit, 'strategies:', strat1Addr, strat2Addr, strat3Addr);
  // Debug: call getDebugPairState if available (upgradeable vs non-upgradeable artifacts may differ)
  let debugState = null;
  try {
    if (typeof aggregator.getDebugPairState === 'function') {
      debugState = await aggregator.getDebugPairState(0);
      console.log('DEBUG getDebugPairState(0):', debugState);
    }
  } catch (e) {
    // ignore - some artifacts may not expose this helper
  }
  console.log('Addresses before deposit:', {
    strat1: strat1Addr,
    strat2: strat2Addr,
    strat3: strat3Addr,
    mockLP1: mockLP1Addr,
    mockLP2: mockLP2Addr,
    router1: router1Addr,
    router2: router2Addr,
    aggregator: aggAddress,
    user: user?.address,
    owner: owner?.address,
    treasury: treasury?.address,
    pairId0,
    lpTokenOfPair: lp0BeforeDeposit
  });
  if (!lp0BeforeDeposit || lp0BeforeDeposit === ethers.ZeroAddress) {
    throw new Error('lpTokenOfPair[pairId0] is not set or is zero address!');
  }
  // Create a contract instance using the LpVaultImpl ABI but pointing at the proxy address so delegatecall targets execute
  const AggregatorAsLpVault = await ethers.getContractAt("contracts/impls/LpVaultImpl.sol:LpVaultImpl", aggAddress);
  // User deposits to pair 0 (USDC/USDT) using the LP vault single-sided flow
  // Use ethers v6 parseUnits
  const tx = await AggregatorAsLpVault.connect(user).depositSingleSidedToPair(0, ethers.parseUnits("100", 6), 30);
  const receipt = await tx.wait();
  console.log('Deposit tx logs count:', receipt.logs.length);
  // Check aggregator bookkeeping: userShares and totalShares should reflect the deposit
  const userShares = await aggregator.userShares(0, await user.getAddress());
  const totalShares = await aggregator.pairTotalShares(0);
  expect(userShares).to.be.gt(0);
  expect(totalShares).to.be.gt(0);
  // Debug: print strategy internal balances and strategyPrincipal
  const s1bal = await strat1.balanceOf();
  const s2bal = await strat2.balanceOf();
  const s3bal = await strat3.balanceOf();
  console.log('Strategy balances after deposit:', s1bal.toString(), s2bal.toString(), s3bal.toString());
  const sp1 = await aggregator.strategyPrincipal(0, strat1Addr);
  const sp2 = await aggregator.strategyPrincipal(0, strat2Addr);
  const sp3 = await aggregator.strategyPrincipal(0, strat3Addr);
  console.log('Strategy principal mapping:', sp1.toString(), sp2.toString(), sp3.toString());

    // Simulate APY change: strat1 now has 6.1% (610 bps), strat2 has 4%
  await strat1.setAPY(610); // 6.1%
  await strat2.setAPY(400); // 4%
    console.log('APYs after change:', await strat1.getAPY(), await strat2.getAPY(), await strat3.getAPY());
    // Not enough time passed, should not rebalance
    await aggregator.rebalance(0);
    expect(await strat2.balanceOf()).to.be.gt(0);
    expect(await strat1.balanceOf()).to.equal(0);

    // Fast-forward 12 hours
    await ethers.provider.send("evm_increaseTime", [12 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    // Now rebalance should move LP to strat1
  await aggregator.rebalance(0);
  expect(await strat2.balanceOf()).to.equal(0);
  expect(await strat1.balanceOf()).to.be.gt(0);
  });
});
