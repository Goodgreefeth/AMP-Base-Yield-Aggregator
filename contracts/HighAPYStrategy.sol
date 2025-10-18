// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StrategyBase.sol";

contract HighAPYStrategy is StrategyBase {
    constructor(address _token) StrategyBase(_token) {}

    function deposit(uint256 amount) external override {
        token.transferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) external override {
        token.transfer(msg.sender, amount);
    }

    function harvest() external override returns (uint256) {
        return 0;
    }

    function getAPY() public view override returns (uint256) {
        return 999999;
    }

    function balanceOf() public view override returns (uint256) {
        return token.balanceOf(address(this));
    }
}
