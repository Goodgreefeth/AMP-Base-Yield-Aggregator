const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MockERC20", function () {
  it("Should deploy successfully", async function () {
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const name = "Mock Token";
    const symbol = "MOCK";
    const initialSupply = ethers.parseUnits("1000", 18);
    const mockERC20 = await MockERC20.deploy(name, symbol, initialSupply);
    await mockERC20.waitForDeployment();
  const address = mockERC20.target;
    expect(address).to.be.a("string");
    expect(address.length).to.equal(42);
  });
});
