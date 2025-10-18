const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Aggregator", function () {
  it("Should deploy successfully", async function () {
    // Deploy a mock token first
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const name = "Mock Token";
    const symbol = "MOCK";
    const initialSupply = ethers.parseUnits("1000", 18);
    const mockERC20 = await MockERC20.deploy(name, symbol, initialSupply);
    await mockERC20.waitForDeployment();
  const tokenAddress = mockERC20.target;

  // Deploy Aggregator (no constructor args)
  const Aggregator = await ethers.getContractFactory("contracts/Aggregator.sol:Aggregator");
  const aggregator = await Aggregator.deploy();
  await aggregator.waitForDeployment();
  const address = aggregator.target;
  expect(address).to.be.a("string");
  expect(address.length).to.equal(42);
  });
});
