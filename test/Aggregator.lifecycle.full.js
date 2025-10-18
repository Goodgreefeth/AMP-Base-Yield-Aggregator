
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");


describe("Aggregator: Full Local Lifecycle Simulator", () => {
  let aggregator, tokens, strategies, users, treasury;
  const NUM_PAIRS = 2;
  const NUM_STRATEGIES = 2;
  const NUM_USERS = 2;
  let INITIAL_BALANCE;

  beforeEach(async () => {
    // Deploy tokens (one per pair)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tokens = [];
    for (let i = 0; i < NUM_PAIRS; i++) {
      const token = await MockERC20.deploy(`USDC${i+1}`, `USDC${i+1}`, 6);
      await token.waitForDeployment();
      tokens.push(token);
    }
  users = (await ethers.getSigners()).slice(0, NUM_USERS);
  INITIAL_BALANCE = ethers.parseUnits("1000", 6); // USDC 6 decimals

    // Deploy treasury as UUPS proxy
    const Treasury = await ethers.getContractFactory("TreasuryUpgradeable");
    const treasuryOwner = await users[0].getAddress();
    treasury = await upgrades.deployProxy(
      Treasury,
      [treasuryOwner],
      { kind: "uups" }
    );
    await treasury.waitForDeployment();
    const treasuryAddress = await treasury.getAddress();

    // Deploy AggregatorUpgradeable as UUPS proxy (we need delegatecall paths for impls)
    const Aggregator = await ethers.getContractFactory("AggregatorUpgradeable");
    const feeRecipient = await users[0].getAddress();
      aggregator = await upgrades.deployProxy(
        Aggregator,
        [
          treasuryAddress,
          100, // performanceFeeBps
          100, // protocolFeeBps
          feeRecipient
        ],
        { kind: "uups", unsafeAllow: ['delegatecall'] }
      );
    await aggregator.waitForDeployment();
    const aggregatorAddress = await aggregator.getAddress();

    // Deploy and set mock router
  const MockLP = await ethers.getContractFactory("MockLP");
  const mockLP = await MockLP.deploy("USDC/USDC LP", "LP");
  await mockLP.waitForDeployment();
  const MockRouter = await ethers.getContractFactory("contracts/mocks/MockRouter.sol:MockRouter");
  const mockRouter = await MockRouter.deploy(mockLP.target);
  await mockRouter.waitForDeployment();
  // Use the first signer as owner to perform setup calls
  const signers = await ethers.getSigners();
  const ownerSigner = signers[0];
  await aggregator.connect(ownerSigner).setRouter(mockRouter.target);

  // Deploy impls and wire them into the proxy so delegatecall paths work
  const LpVaultImpl = await ethers.getContractFactory("contracts/impls/LpVaultImpl.sol:LpVaultImpl");
  const DepositImpl = await ethers.getContractFactory("contracts/impls/DepositImpl.sol:DepositImpl");
  const RebalanceImpl = await ethers.getContractFactory("contracts/impls/RebalanceImpl.sol:RebalanceImpl");
  const FlashBoostImpl = await ethers.getContractFactory("contracts/impls/FlashBoostImpl.sol:FlashBoostImpl");
  const lpVaultImpl = await LpVaultImpl.deploy(); await lpVaultImpl.waitForDeployment();
  const depositImpl = await DepositImpl.deploy(); await depositImpl.waitForDeployment();
  const rebalanceImpl = await RebalanceImpl.deploy(); await rebalanceImpl.waitForDeployment();
  const flashBoostImpl = await FlashBoostImpl.deploy(); await flashBoostImpl.waitForDeployment();
  // Set impls as the proxy owner
  await aggregator.connect(ownerSigner).setLpVaultImpl(await lpVaultImpl.getAddress());
  await aggregator.connect(ownerSigner).setDepositImpl(await depositImpl.getAddress());
  await aggregator.connect(ownerSigner).setRebalanceImpl(await rebalanceImpl.getAddress());
  await aggregator.connect(ownerSigner).setFlashBoostImpl(await flashBoostImpl.getAddress());

    // Add pairs and deploy strategies for each
    strategies = [];
    for (let pairId = 0; pairId < NUM_PAIRS; pairId++) {
      const token = tokens[pairId];
      const tokenAddress = await token.getAddress();
      await aggregator.addPair(tokenAddress, tokenAddress);
      strategies[pairId] = [];
      const Strategy = await ethers.getContractFactory("HighAPYStrategy");
      for (let s = 0; s < NUM_STRATEGIES; s++) {
        const strat = await Strategy.deploy(tokenAddress);
        await strat.waitForDeployment();
        const stratAddress = await strat.getAddress();
        strategies[pairId].push(strat);
        await aggregator.addStrategy(pairId, stratAddress);
      }
    }

    // Mint initial balances to users for all tokens
    for (let u of users) {
      const userAddress = await u.getAddress();
      for (let token of tokens) {
        await token.mint(userAddress, INITIAL_BALANCE);
        await token.connect(u).approve(aggregatorAddress, INITIAL_BALANCE);
      }
    }
  });

  it("should simulate multiple deposits, yields, rebalances, and withdrawals", async () => {
    // Set minRebalanceInterval to 1 hour (3600s) for test
    await aggregator.setMinRebalanceInterval(3600);

    // Step 1: Users deposit into all pairs
    for (let pairId = 0; pairId < NUM_PAIRS; pairId++) {
      for (let u = 0; u < NUM_USERS; u++) {
        await aggregator.connect(users[u]).deposit(pairId, ethers.parseUnits(((u+1)*100).toString(), 6));
      }
    }

    // Step 2: Deposit to all strategies for all pairs
    for (let pairId = 0; pairId < NUM_PAIRS; pairId++) {
      for (let s = 0; s < NUM_STRATEGIES; s++) {
        const stratAddress = await strategies[pairId][s].getAddress();
        // Deposit half of total vault balance to each strategy
        await aggregator.depositToStrategy(pairId, stratAddress, ethers.parseUnits("100", 6));
      }
    }

    // Step 3: Simulate yield in all strategies (direct transfer to strategy contract)
    for (let pairId = 0; pairId < NUM_PAIRS; pairId++) {
      const token = tokens[pairId];
      for (let s = 0; s < NUM_STRATEGIES; s++) {
        const stratAddress = await strategies[pairId][s].getAddress();
        await token.transfer(stratAddress, ethers.parseUnits("10", 6)); // Simulate 10% yield
      }
    }

    // Step 4: Simulate time passing for Chainlink upkeep
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine");

    // Step 5: Simulate Chainlink Keeper calling checkUpkeep and performUpkeep for all pairs
    for (let pairId = 0; pairId < NUM_PAIRS; pairId++) {
  const checkData = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [pairId]);
  const upkeepResult = await aggregator.checkUpkeep.staticCall(checkData);
  const [upkeepNeeded, performData] = upkeepResult;
  const lastRebalance = await aggregator.lastRebalance(pairId);
  const minRebalanceInterval = await aggregator.minRebalanceInterval();
  console.log(`PairId: ${pairId}, upkeepNeeded:`, upkeepNeeded, 'lastRebalance:', lastRebalance.toString(), 'minRebalanceInterval:', minRebalanceInterval.toString());
  expect(upkeepNeeded).to.be.true;
  await aggregator.performUpkeep(performData);
    }

    // Step 6: Users withdraw from all pairs
    for (let pairId = 0; pairId < NUM_PAIRS; pairId++) {
      const token = tokens[pairId];
      for (let u = 0; u < NUM_USERS; u++) {
        const userAddress = await users[u].getAddress();
        const userBalanceBefore = await token.balanceOf(userAddress);
        const shares = await aggregator.userShares(pairId, userAddress);
        await aggregator.connect(users[u]).withdraw(pairId, shares);
        const userBalanceAfter = await token.balanceOf(userAddress);
        expect(userBalanceAfter).to.be.gt(userBalanceBefore);
      }
    }
  });

});
