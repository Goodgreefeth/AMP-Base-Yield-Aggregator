// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IRouter.sol";

library LibLP {
    /// @notice Swap half of tokenA to tokenB using lpRouter. Executed via DELEGATECALL so address(this) is caller contract.
    function swapHalfToTokenB(address lpRouter, address tokenA, address tokenB, uint256 half) external returns (uint256 swappedAmount) {
        if (tokenA == tokenB) return half;
        IERC20(tokenA).approve(lpRouter, half);
        address[] memory path = new address[](2);
        path[0] = tokenA;
        path[1] = tokenB;
        uint256 amountOutMin = 0;
        uint256 deadline = block.timestamp + 60;
        uint256[] memory amounts = IRouter(lpRouter).swapExactTokensForTokens(half, amountOutMin, path, address(this), deadline);
        swappedAmount = amounts[1];
    }

    /// @notice Add liquidity and return amounts used + LP minted. Executed via DELEGATECALL so approvals/transfers are from caller.
    function addLiquidityAndReturnLP(address lpRouter, address tokenA, address tokenB, uint256 otherHalf, uint256 swappedAmount, uint256 slippageBps) external returns (uint256 usedA, uint256 usedB, uint256 lpMinted) {
        IERC20(tokenA).approve(lpRouter, otherHalf);
        IERC20(tokenB).approve(lpRouter, swappedAmount);
        uint256 minA = (otherHalf * (10000 - slippageBps)) / 10000;
        uint256 minB = (swappedAmount * (10000 - slippageBps)) / 10000;
        (usedA, usedB, lpMinted) = IRouter(lpRouter).addLiquidity(
            tokenA,
            tokenB,
            otherHalf,
            swappedAmount,
            minA,
            minB,
            address(this),
            block.timestamp + 60
        );
        // left-overs (if any) are returned by caller after this function returns
    }
}
