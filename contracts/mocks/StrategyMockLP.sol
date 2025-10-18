// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../StrategyBase.sol";

contract StrategyMockLP is StrategyBase {
    IERC20 public immutable lpToken;
    uint256 public apyBps; // e.g. 400 = 4.00%
    uint256 public _balance;

    constructor(address _lpToken, uint256 _apyBps) StrategyBase(_lpToken) {
        lpToken = IERC20(_lpToken);
        apyBps = _apyBps;
    }

    function getAPY() public view override returns (uint256) {
        return apyBps;
    }

    function setAPY(uint256 _apyBps) external {
        apyBps = _apyBps;
    }

    function deposit(uint256 amount) external override {
        lpToken.transferFrom(msg.sender, address(this), amount);
        _balance += amount;
    }

    function withdraw(uint256 amount) external override {
        require(_balance >= amount, "not enough");
        _balance -= amount;
        lpToken.transfer(msg.sender, amount);
    }

    function balanceOf() public view override returns (uint256) {
        return _balance;
    }

    function harvest() external override returns (uint256) {
        return 0;
    }
}
