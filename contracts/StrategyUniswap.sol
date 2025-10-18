// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StrategyBase.sol";

contract StrategyUniswap is StrategyBase {
    address public uniswapPool;
    uint256 public mockAPY;

    constructor(address _token, address _uniswapPool) StrategyBase(_token) {
        uniswapPool = _uniswapPool;
    }

    function deposit(uint256 amount) external override {
        // For testing: accept tokens from sender
        require(token.transferFrom(msg.sender, address(this), amount), "Transfer failed");
    }

    function withdraw(uint256 amount) external override {
        // For testing: send tokens to caller
        require(token.transfer(msg.sender, amount), "Transfer failed");
    }

    function harvest() external override returns (uint256) {
        // TODO: Collect trading fees
        return 0;
    }

    function setMockAPY(uint256 _apy) external {
        mockAPY = _apy;
    }

    function getAPY() public view override returns (uint256) {
        return mockAPY;
    }

    function balanceOf() public view override returns (uint256) {
        // For testing: return the token balance held by this contract
        return token.balanceOf(address(this));
    }
}
