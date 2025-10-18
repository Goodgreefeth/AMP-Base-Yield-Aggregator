// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MockLP.sol";
import "../interfaces/IRouter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../MockERC20.sol";

contract MockRouter is IRouter {
    MockLP public lpToken;
    uint256 public priceNumerator = 1;
    uint256 public priceDenominator = 1;

    constructor(address lpAddr) {
        lpToken = MockLP(lpAddr);
    }

    function setPriceRatio(uint256 num, uint256 den) external {
        priceNumerator = num;
        priceDenominator = den;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 /*amountOutMin*/,
        address[] calldata path,
        address to,
        uint256 /*deadline*/
    ) external override returns (uint256[] memory amounts) {
        require(path.length >= 2, "path");
        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        uint256 amountOut = amountIn * priceNumerator / priceDenominator;
        // Ensure router has tokenOut to send - if tokenOut is a MockERC20, mint to router first
        try MockERC20(tokenOut).mint(address(this), amountOut) {
            // minted
        } catch {
            // ignore - if tokenOut doesn't support mint, transfer will likely revert in tests
        }
        IERC20(tokenOut).transfer(to, amountOut);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 /*amountAMin*/,
        uint256 /*amountBMin*/,
        address to,
        uint256 /*deadline*/
    ) external override returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        IERC20(tokenA).transferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountBDesired);
        amountA = amountADesired;
        amountB = amountBDesired;
        liquidity = (amountA + amountB) / 2;
        lpToken.mint(to, liquidity);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 /*amountAMin*/,
        uint256 /*amountBMin*/,
        address to,
        uint256 /*deadline*/
    ) external override returns (uint256 amountA, uint256 amountB) {
        lpToken.burn(msg.sender, liquidity);
        amountA = liquidity;
        amountB = liquidity;
        IERC20(tokenA).transfer(to, amountA);
        IERC20(tokenB).transfer(to, amountB);
    }
}
