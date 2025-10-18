// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StrategyBase.sol";

contract StrategyX is StrategyBase {
    constructor(address _token) StrategyBase(_token) {}

    function deposit(uint256 amount) external override {
        token.transferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) external override {
        // Always transfer to msg.sender (Aggregator), which will then distribute as needed
        token.transfer(msg.sender, amount);
    }

    function harvest() external override returns (uint256) {
        return 0;
    }

    function getAPY() public view override returns (uint256) {
        // Mock APY: use block.timestamp for demo
        return (block.timestamp % 1000) + 3000;
    }

    function balanceOf() public view override returns (uint256) {
        return token.balanceOf(address(this));
    }
}
