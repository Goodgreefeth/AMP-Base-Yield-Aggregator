// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStrategyBase {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function balanceOf() external view returns (uint256);
    function getAPY() external view returns (uint256);
    function harvest() external returns (uint256);
}
