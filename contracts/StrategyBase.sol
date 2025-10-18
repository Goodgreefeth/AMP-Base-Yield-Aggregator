// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

abstract contract StrategyBase {
    IERC20 public immutable token;

    constructor(address _token) {
        token = IERC20(_token);
    }

    function deposit(uint256 amount) external virtual;
    function withdraw(uint256 amount) external virtual;
    function harvest() external virtual returns (uint256);
    function getAPY() public view virtual returns (uint256);
    function balanceOf() public view virtual returns (uint256);
}
