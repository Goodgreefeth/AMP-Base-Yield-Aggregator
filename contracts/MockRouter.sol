// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        // Simulate real router: pull input token from sender
        IERC20 inToken = IERC20(path[0]);
        IERC20 outToken = IERC20(path[1]);
        inToken.transferFrom(msg.sender, address(this), amountIn);
        outToken.transfer(to, amountIn); // 1:1 for test
        amounts = new uint[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn;
    }
}
