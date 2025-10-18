const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Aggregator: Multi-Strategy Rebalancing", function () {
  let usdc, owner, user, aggregator, pairId;
  let beefy, aero, sushi, uni, aave, uniswap, sushiswap;

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
    // Add USDC/USDC pair (for simplicity)
  const tx = await aggregator.addPair(usdc.target, usdc.target);
    const receipt = await tx.wait();
    pairId = receipt.logs[0].args.pairId || 0;
    // Mint USDC to user
    await usdc.transfer(user.address, ethers.parseUnits("10000", 6));
    // Deploy all strategies
    const Beefy = await ethers.getContractFactory("StrategyBeefy");
  beefy = await Beefy.deploy(usdc.target);
    await beefy.waitForDeployment();
    const Aero = await ethers.getContractFactory("StrategyAero");
  aero = await Aero.deploy(usdc.target);
    await aero.waitForDeployment();
    const Sushi = await ethers.getContractFactory("StrategySushi");
  sushi = await Sushi.deploy(usdc.target);
    await sushi.waitForDeployment();
    const Uni = await ethers.getContractFactory("StrategyUniV3");
  uni = await Uni.deploy(usdc.target);
    await uni.waitForDeployment();
    // New strategies
    const Aave = await ethers.getContractFactory("StrategyAave");
  aave = await Aave.deploy(usdc.target, ethers.ZeroAddress);
    await aave.waitForDeployment();
    const Uniswap = await ethers.getContractFactory("StrategyUniswap");
  uniswap = await Uniswap.deploy(usdc.target, ethers.ZeroAddress);
    await uniswap.waitForDeployment();
    const SushiSwap = await ethers.getContractFactory("StrategySushiSwap");
  sushiswap = await SushiSwap.deploy(usdc.target, ethers.ZeroAddress);
    await sushiswap.waitForDeployment();
    // Add all strategies to Aggregator
  await aggregator.addStrategy(pairId, beefy.target);
  await aggregator.addStrategy(pairId, aero.target);
  await aggregator.addStrategy(pairId, sushi.target);
  await aggregator.addStrategy(pairId, uni.target);
  await aggregator.addStrategy(pairId, aave.target);
  await aggregator.addStrategy(pairId, uniswap.target);
  await aggregator.addStrategy(pairId, sushiswap.target);
    // Deploy mock router and set in Aggregator
  const MockLP = await ethers.getContractFactory("MockLP");
  const mockLP = await MockLP.deploy("USDC/USDC LP", "LP");
  await mockLP.waitForDeployment();
  const MockRouter = await ethers.getContractFactory("contracts/mocks/MockRouter.sol:MockRouter");
  const router = await MockRouter.deploy(mockLP.target);
  await router.waitForDeployment();
  await aggregator.setRouter(router.target);
  });

  it("should rebalance to the highest APY strategy", async function () {
    // User deposits USDC
    const depositAmount = ethers.parseUnits("1000", 6);
  await usdc.connect(user).approve(aggregator.target, depositAmount);
    await aggregator.connect(user).deposit(pairId, depositAmount);
    // Fund Aggregator and simulate balances in all strategies using depositToStrategy for principal tracking
    for (const [amount, strat] of [
      ["100", beefy],
      ["200", aero],
      ["300", sushi],
      ["400", uni],
      ["500", aave],
      ["600", uniswap],
      ["700", sushiswap],
    ]) {
  await usdc.transfer(aggregator.target, ethers.parseUnits(amount, 6));
  await aggregator.depositToStrategy(pairId, strat.target, ethers.parseUnits(amount, 6));
    }
    // Approve all strategies to spend from Aggregator
  await aggregator.approveToken(pairId, usdc.target, beefy.target, ethers.parseUnits("1000", 6));
  await aggregator.approveToken(pairId, usdc.target, aero.target, ethers.parseUnits("1000", 6));
  await aggregator.approveToken(pairId, usdc.target, sushi.target, ethers.parseUnits("1000", 6));
  await aggregator.approveToken(pairId, usdc.target, uni.target, ethers.parseUnits("1000", 6));
  await aggregator.approveToken(pairId, usdc.target, aave.target, ethers.parseUnits("1000", 6));
  await aggregator.approveToken(pairId, usdc.target, uniswap.target, ethers.parseUnits("1000", 6));
  await aggregator.approveToken(pairId, usdc.target, sushiswap.target, ethers.parseUnits("1000", 6));
    // Rebalance
    await expect(aggregator.rebalance(pairId)).to.emit(aggregator, "StrategyRebalanced");
    // Beefy has the highest APY (6000), so all funds should end up there
  const beefyBal = await usdc.balanceOf(beefy.target);
  const aeroBal = await usdc.balanceOf(aero.target);
  const sushiBal = await usdc.balanceOf(sushi.target);
  const uniBal = await usdc.balanceOf(uni.target);
  const aaveBal = await usdc.balanceOf(aave.target);
  const uniswapBal = await usdc.balanceOf(uniswap.target);
  const sushiswapBal = await usdc.balanceOf(sushiswap.target);
    expect(beefyBal).to.be.gt(aeroBal);
    expect(beefyBal).to.be.gt(sushiBal);
    expect(beefyBal).to.be.gt(uniBal);
    expect(beefyBal).to.be.gt(aaveBal);
    expect(beefyBal).to.be.gt(uniswapBal);
    expect(beefyBal).to.be.gt(sushiswapBal);
  });

  it("should support Aave, Uniswap, and SushiSwap strategies", async function () {
    // User deposits USDC
    const depositAmount = ethers.parseUnits("1000", 6);
    await usdc.connect(user).approve(await aggregator.getAddress(), depositAmount);
    await aggregator.connect(user).deposit(pairId, depositAmount);
  // Set mock APY values for all strategies
  await beefy.setMockAPY(100);      // 1%
  await aero.setMockAPY(100);       // 1%
  await sushi.setMockAPY(100);      // 1%
  await uni.setMockAPY(100);        // 1%
  await aave.setMockAPY(1000);      // 10%
  await uniswap.setMockAPY(2000);   // 20%
  await sushiswap.setMockAPY(3000); // 30%
    // Only Aave has a balance before rebalance (set principal correctly)
    await usdc.transfer(await aggregator.getAddress(), depositAmount);
    await aggregator.depositToStrategy(pairId, await aave.getAddress(), depositAmount);
    // Approve all new strategies to spend from Aggregator
    await aggregator.approveToken(pairId, await usdc.getAddress(), await aave.getAddress(), depositAmount);
    await aggregator.approveToken(pairId, await usdc.getAddress(), await uniswap.getAddress(), depositAmount);
    await aggregator.approveToken(pairId, await usdc.getAddress(), await sushiswap.getAddress(), depositAmount);

    // Print balances before rebalance
    const strategyAddresses = [
      await beefy.getAddress(),
      await aero.getAddress(),
      await sushi.getAddress(),
      await uni.getAddress(),
      await aave.getAddress(),
      await uniswap.getAddress(),
      await sushiswap.getAddress(),
    ];
    let balances = await Promise.all(strategyAddresses.map(addr => usdc.balanceOf(addr)));
    console.log("Balances before rebalance:");
    for (let i = 0; i < balances.length; i++) {
      console.log(`  ${i}: ${strategyAddresses[i]}: ${balances[i].toString()}`);
    }

    // Rebalance: should move funds from Aave to SushiSwap
    await expect(aggregator.rebalance(pairId)).to.emit(aggregator, "StrategyRebalanced");

    // Print balances after rebalance
    balances = await Promise.all(strategyAddresses.map(addr => usdc.balanceOf(addr)));
    console.log("Balances after rebalance:");
    for (let i = 0; i < balances.length; i++) {
      console.log(`  ${i}: ${strategyAddresses[i]}: ${balances[i].toString()}`);
    }

    // After rebalance, only SushiSwap should have funds
    const sushiSwapIndex = strategyAddresses.indexOf(await sushiswap.getAddress());
    for (let i = 0; i < balances.length; i++) {
      if (i === sushiSwapIndex) {
        expect(balances[i]).to.equal(depositAmount);
      } else {
        expect(balances[i]).to.equal(0n);
      }
    }
  });

  it("should NOT take a fee if there is no yield on rebalance", async function () {
  // Set mock APY values for all strategies
  await beefy.setMockAPY(100);
  await aero.setMockAPY(100);
  await sushi.setMockAPY(100);
  await uni.setMockAPY(100);
  await aave.setMockAPY(1000);
  await uniswap.setMockAPY(2000);
  await sushiswap.setMockAPY(3000);
    // User deposits USDC
    const depositAmount = ethers.parseUnits("1000", 6);
    await usdc.connect(user).approve(await aggregator.getAddress(), depositAmount);
    await aggregator.connect(user).deposit(pairId, depositAmount);
  // Only Aave has a balance before rebalance (no yield, set principal correctly)
  await usdc.transfer(await aggregator.getAddress(), ethers.parseUnits("1000", 6));
  await aggregator.depositToStrategy(pairId, await aave.getAddress(), ethers.parseUnits("1000", 6));
    await aggregator.approveToken(pairId, await usdc.getAddress(), await aave.getAddress(), ethers.parseUnits("1000", 6));
    await aggregator.approveToken(pairId, await usdc.getAddress(), await sushiswap.getAddress(), ethers.parseUnits("1000", 6));
    // Rebalance: should move all principal, no fee
    const treasuryBalBefore = await usdc.balanceOf(await (await aggregator.treasury()));
    await expect(aggregator.rebalance(pairId)).to.emit(aggregator, "StrategyRebalanced");
    const treasuryBalAfter = await usdc.balanceOf(await (await aggregator.treasury()));
    expect(treasuryBalAfter - treasuryBalBefore).to.equal(0n);
    // After rebalance, only SushiSwap should have funds
    const strategyAddresses = [
      await beefy.getAddress(),
      await aero.getAddress(),
      await sushi.getAddress(),
      await uni.getAddress(),
      await aave.getAddress(),
      await uniswap.getAddress(),
      await sushiswap.getAddress(),
    ];
    const balances = await Promise.all(strategyAddresses.map(addr => usdc.balanceOf(addr)));
    const sushiSwapIndex = strategyAddresses.indexOf(await sushiswap.getAddress());
    for (let i = 0; i < balances.length; i++) {
      if (i === sushiSwapIndex) {
        expect(balances[i]).to.equal(depositAmount);
      } else {
        expect(balances[i]).to.equal(0n);
      }
    }
  });

  it("should take a 3% fee only on yield on rebalance", async function () {
  // Set mock APY values for all strategies
  await beefy.setMockAPY(100);
  await aero.setMockAPY(100);
  await sushi.setMockAPY(100);
  await uni.setMockAPY(100);
  await aave.setMockAPY(1000);
  await uniswap.setMockAPY(2000);
  await sushiswap.setMockAPY(3000);
    // User deposits USDC
    const depositAmount = ethers.parseUnits("1000", 6);
    await usdc.connect(user).approve(await aggregator.getAddress(), depositAmount);
    await aggregator.connect(user).deposit(pairId, depositAmount);
  // Simulate yield: Aave has principal + yield
  await usdc.transfer(await aggregator.getAddress(), ethers.parseUnits("1000", 6));
  await aggregator.depositToStrategy(pairId, await aave.getAddress(), ethers.parseUnits("1000", 6)); // principal
  await usdc.transfer(await aave.getAddress(), ethers.parseUnits("100", 6)); // yield (direct transfer, not tracked as principal)
    await aggregator.approveToken(pairId, await usdc.getAddress(), await aave.getAddress(), ethers.parseUnits("1100", 6));
    await aggregator.approveToken(pairId, await usdc.getAddress(), await sushiswap.getAddress(), ethers.parseUnits("1100", 6));
    // Rebalance: should take 3% fee on 100 USDC yield
    const treasuryBalBefore = await usdc.balanceOf(await (await aggregator.treasury()));
    await expect(aggregator.rebalance(pairId)).to.emit(aggregator, "StrategyRebalanced");
    const treasuryBalAfter = await usdc.balanceOf(await (await aggregator.treasury()));
    const feeExpected = ethers.parseUnits("3", 6); // 3% of 100 USDC yield
    expect(treasuryBalAfter - treasuryBalBefore).to.equal(feeExpected);
    // After rebalance, only SushiSwap should have funds
    const strategyAddresses = [
      await beefy.getAddress(),
      await aero.getAddress(),
      await sushi.getAddress(),
      await uni.getAddress(),
      await aave.getAddress(),
      await uniswap.getAddress(),
      await sushiswap.getAddress(),
    ];
    const balances = await Promise.all(strategyAddresses.map(addr => usdc.balanceOf(addr)));
    const sushiSwapIndex = strategyAddresses.indexOf(await sushiswap.getAddress());
    for (let i = 0; i < balances.length; i++) {
      if (i === sushiSwapIndex) {
        expect(balances[i]).to.equal(ethers.parseUnits("1097", 6));
      } else {
        expect(balances[i]).to.equal(0n);
      }
    }
  });
});
