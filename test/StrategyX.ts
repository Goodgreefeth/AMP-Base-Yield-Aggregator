
import { expect } from "chai";
import { ethers } from "hardhat";

describe("StrategyX", function () {
  it("Should deploy successfully", async function () {
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mock = await MockERC20.deploy("Mock", "MCK", ethers.parseUnits("1000", 18));
  await mock.waitForDeployment();
  const tokenAddr = await mock.getAddress();
  const StrategyX = await ethers.getContractFactory("StrategyX");
  const strategyX = await StrategyX.deploy(tokenAddr);
  await strategyX.waitForDeployment();
  const address = await strategyX.getAddress();
  expect(address).to.be.a("string");
  expect(address.length).to.equal(42);
  });
});
