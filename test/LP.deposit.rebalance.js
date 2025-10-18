const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Aggregator LP deposit and rebalance", function () {
  let TokenA, TokenB, TokenC, tokenA, tokenB, tokenC, MockLP, mockLP1, mockLP2, MockRouter, router1, router2;
  let Aggregator, aggregator, owner, user, StrategyMock, strat1, strat2;

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();

    // Deploy tokens
  TokenA = await ethers.getContractFactory("MockERC20");
  tokenA = await TokenA.deploy("USDC", "USDC", ethers.parseUnits("1000000", 6));
  await tokenA.waitForDeployment();
  tokenB = await TokenA.deploy("USDT", "USDT", ethers.parseUnits("1000000", 6));
  await tokenB.waitForDeployment();
  tokenC = await TokenA.deploy("WETH", "WETH", ethers.parseUnits("1000000", 18));
  await tokenC.waitForDeployment();

    // Deploy LP tokens
    MockLP = await ethers.getContractFactory("MockLP");
  mockLP1 = await MockLP.deploy("USDC/USDT LP", "LP1");
  await mockLP1.waitForDeployment();
  mockLP2 = await MockLP.deploy("USDC/WETH LP", "LP2");
  await mockLP2.waitForDeployment();

    // Deploy routers
  MockRouter = await ethers.getContractFactory("contracts/mocks/MockRouter.sol:MockRouter");
  router1 = await MockRouter.deploy(await mockLP1.getAddress());
  await router1.waitForDeployment();
  router2 = await MockRouter.deploy(await mockLP2.getAddress());
  await router2.waitForDeployment();

    // Deploy aggregator as an upgradeable proxy (initialize with owner as treasury/fee recipient for test)
  Aggregator = await ethers.getContractFactory("AggregatorUpgradeable");
  aggregator = await upgrades.deployProxy(Aggregator, [await owner.getAddress(), 300, 100, await owner.getAddress()], { initializer: "initialize", unsafeAllow: ['delegatecall'] });

    // Deploy impls and wire them to the aggregator (upgradeable facade delegates heavy logic)
  const LpVaultImpl = await ethers.getContractFactory("contracts/impls/LpVaultImpl.sol:LpVaultImpl");
  const DepositImpl = await ethers.getContractFactory("contracts/impls/DepositImpl.sol:DepositImpl");
  const RebalanceImpl = await ethers.getContractFactory("contracts/impls/RebalanceImpl.sol:RebalanceImpl");
  const FlashBoostImpl = await ethers.getContractFactory("contracts/impls/FlashBoostImpl.sol:FlashBoostImpl");
  const lpVaultImpl = await LpVaultImpl.deploy(); await lpVaultImpl.waitForDeployment();
  const depositImpl = await DepositImpl.deploy(); await depositImpl.waitForDeployment();
  const rebalanceImpl = await RebalanceImpl.deploy(); await rebalanceImpl.waitForDeployment();
  const flashBoostImpl = await FlashBoostImpl.deploy(); await flashBoostImpl.waitForDeployment();
  // Wire impls using owner signer
  const ownerAddr = await owner.getAddress();
  await aggregator.connect(owner).setLpVaultImpl(await lpVaultImpl.getAddress());
  await aggregator.connect(owner).setDepositImpl(await depositImpl.getAddress());
  await aggregator.connect(owner).setRebalanceImpl(await rebalanceImpl.getAddress());
  await aggregator.connect(owner).setFlashBoostImpl(await flashBoostImpl.getAddress());

    // Set router and register pairs (call as owner)
  await aggregator.connect(owner).setRouter(await router1.getAddress()); // For simplicity, use router1 for both pairs in this test
    await aggregator.addPair(await tokenA.getAddress(), await tokenB.getAddress()); // pairId 0
    await aggregator.addPair(await tokenA.getAddress(), await tokenC.getAddress()); // pairId 1
  await aggregator.setLpTokenForPair(0, await mockLP1.getAddress());
  await aggregator.setLpTokenForPair(1, await mockLP2.getAddress());

    // Deploy two mock strategies for pair 0
    StrategyMock = await ethers.getContractFactory("StrategyMockLP");
  strat1 = await StrategyMock.deploy(await mockLP1.getAddress(), 200); // 2% APY
  await strat1.waitForDeployment();
  strat2 = await StrategyMock.deploy(await mockLP1.getAddress(), 400); // 4% APY
  await strat2.waitForDeployment();
    await aggregator.addStrategy(0, await strat1.getAddress());
    await aggregator.addStrategy(0, await strat2.getAddress());

    // Mint and approve USDC for user
  await tokenA.mint(await user.getAddress(), ethers.parseUnits("1000", 6));
  await tokenA.connect(user).approve(await aggregator.getAddress(), ethers.parseUnits("1000", 6));
  });

  it("deposits into highest APY strategy, rebalances on APY change", async () => {
    // User deposits to pair 0 (USDC/USDT)
    // debug: show balances/allowances before deposit
    console.log("User USDC balance:", (await tokenA.balanceOf(await user.getAddress())).toString());
    console.log("Aggregator USDC balance:", (await tokenA.balanceOf(await aggregator.getAddress())).toString());
    console.log("User allowance to aggregator:", (await tokenA.allowance(await user.getAddress(), await aggregator.getAddress())).toString());
    console.log("Aggregator allowance to router:", (await tokenA.allowance(await aggregator.getAddress(), await router1.getAddress())).toString());
  console.log("mockLP1 address:", await mockLP1.getAddress());
  console.log("strat1 address:", await strat1.getAddress());
  console.log("strat2 address:", await strat2.getAddress());
  const amt = ethers.parseUnits("100", 6);
  console.log("amt type:", typeof amt, "amt:", amt.toString());
  console.log("aggregator address:", await aggregator.getAddress());
  const aggWithUser = aggregator.connect(user);
  console.log("aggWithUser address:", await aggWithUser.getAddress());
  // Workaround: encode the call data using the contract factory's interface and send a raw transaction from the user signer
  const data = Aggregator.interface.encodeFunctionData("depositSingleSidedToPair", [0, amt, 30]);
  await user.sendTransaction({ to: await aggregator.getAddress(), data });
    // All LP should be in strat2 (4% APY)
  expect(await mockLP1.balanceOf(await strat2.getAddress())).to.be.gt(0);
  expect(await mockLP1.balanceOf(await strat1.getAddress())).to.equal(0);
    // Simulate APY change: strat1 now has 5%
    await strat1.setAPY(500); // 5%
    await strat2.setAPY(200); // 2%
    // Trigger rebalance (simulate keeper)
    await aggregator.rebalance(0);
    // All LP should now be in strat1
  expect(await mockLP1.balanceOf(await strat1.getAddress())).to.be.gt(0);
  expect(await mockLP1.balanceOf(await strat2.getAddress())).to.equal(0);
  });
});
