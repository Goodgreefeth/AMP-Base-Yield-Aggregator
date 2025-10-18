const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StrategyX", function () {
  it("Should deploy successfully", async function () {
    // Deploy a mock token for constructor
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const name = "Mock Token";
    const symbol = "MOCK";
    const initialSupply = ethers.parseUnits("1000", 18);
    const mockERC20 = await MockERC20.deploy(name, symbol, initialSupply);
    await mockERC20.waitForDeployment();
  const tokenAddress = mockERC20.target;

    // Deploy StrategyX with the token address (update if more args are needed)
    const StrategyX = await ethers.getContractFactory("StrategyX");
    const strategyX = await StrategyX.deploy(tokenAddress);
    await strategyX.waitForDeployment();
  const address = strategyX.target;
    expect(address).to.be.a("string");
    expect(address.length).to.equal(42);
  });
});
