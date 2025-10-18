const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Aggregator: DEX Swap Integration", function () {
  let usdc, usdt, owner, user, aggregator, pairId, router;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    // Deploy mock USDC and USDT
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.parseUnits("1000000", 6));
    await usdc.waitForDeployment();
    usdt = await MockERC20.deploy("Tether", "USDT", ethers.parseUnits("1000000", 6));
    await usdt.waitForDeployment();
    // Deploy mock router
  const MockLP = await ethers.getContractFactory("MockLP");
  const mockLP = await MockLP.deploy("USDC/USDT LP", "LP");
  await mockLP.waitForDeployment();
  const MockRouter = await ethers.getContractFactory("contracts/mocks/MockRouter.sol:MockRouter");
  router = await MockRouter.deploy(mockLP.target);
  await router.waitForDeployment();
    // Fund router with USDT for swap simulation
    await usdt.transfer(await router.getAddress(), ethers.parseUnits("100000", 6));
    // Deploy Aggregator
  const Aggregator = await ethers.getContractFactory("contracts/Aggregator.sol:Aggregator");
    aggregator = await Aggregator.deploy();
    await aggregator.waitForDeployment();
    // Set router
    await aggregator.setRouter(await router.getAddress());
    // Add USDC/USDT pair
    const tx = await aggregator.addPair(await usdc.getAddress(), await usdt.getAddress());
    const receipt = await tx.wait();
    pairId = receipt.logs[0].args.pairId || 0;
    // Mint USDC to user
    await usdc.transfer(user.address, ethers.parseUnits("10000", 6));
  });

  it("should swap half USDC for USDT on deposit", async function () {
    const depositAmount = ethers.parseUnits("1000", 6);
    await usdc.connect(user).approve(await aggregator.getAddress(), depositAmount);
    await expect(aggregator.connect(user).deposit(pairId, depositAmount)).to.emit(aggregator, "XPUpdated");
    // After deposit, Aggregator should hold both USDC and USDT
    const usdcBal = await usdc.balanceOf(await aggregator.getAddress());
    const usdtBal = await usdt.balanceOf(await aggregator.getAddress());
    expect(usdcBal).to.be.lt(depositAmount); // Some USDC swapped
    expect(usdtBal).to.be.gt(0); // Received USDT from swap
  });
});

// MockRouter for local testing
// Place this in contracts/MockRouter.sol:
// SPDX-License-Identifier: MIT
// pragma solidity ^0.8.20;
// contract MockRouter {
//     function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts) {
//         // For test: just mint the output token to 'to'
//         IERC20 outToken = IERC20(path[1]);
//         outToken.transfer(to, amountIn); // 1:1 for test
//         amounts = new uint[](2);
//         amounts[0] = amountIn;
//         amounts[1] = amountIn;
//     }
// }
