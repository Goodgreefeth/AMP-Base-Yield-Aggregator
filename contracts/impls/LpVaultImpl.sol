// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IRouter.sol";
import "../interfaces/IStrategyBase.sol";

contract LpVaultStorageShim {
    struct Pair { IERC20 tokenA; IERC20 tokenB; IStrategyBase[] strategies; uint256 totalShares; }
    mapping(uint256 => Pair) public pairs;
    mapping(uint256 => address) public lpTokenOfPair;
    mapping(uint256 => mapping(address => uint256)) public strategyPrincipal;
    mapping(uint256 => uint256) public totalShares;
    mapping(uint256 => mapping(address => uint256)) public userSharesLP;
    IRouter public lpRouter;
    uint256 public defaultSlippageBps;
    uint256 public totalFeesCollected;
}

contract LpVaultImpl is LpVaultStorageShim {
    event SingleSidedDeposit(uint256 indexed pairId, address indexed user, uint256 amountIn, uint256 liquidityMinted);
    event SharesMinted(uint256 indexed pairId, address indexed user, uint256 liquidity, uint256 shares);
    event WithdrawnSingleSided(uint256 indexed pairId, address indexed user, uint256 sharesBurned, uint256 amountOut);

    function depositSingleSidedToPair(uint256 pairId, uint256 amount, uint256 slippageBps) external {
        require(amount > 0, "zero amount");
        Pair storage p = pairs[pairId];
        require(address(p.tokenA) != address(0) && address(p.tokenB) != address(0), "pair missing");
        require(lpTokenOfPair[pairId] != address(0), "lpTokenOfPair not set");
        require(p.strategies.length > 0, "no strategies for pair");
        if (slippageBps == 0) slippageBps = defaultSlippageBps;

        // pull tokenA
        p.tokenA.transferFrom(msg.sender, address(this), amount);
        uint256 half = amount / 2;
        uint256 otherHalf = amount - half;

        // swap half -> tokenB
        uint256 swappedAmount = _swapHalfToTokenB(address(p.tokenA), address(p.tokenB), half);

        // add liquidity
        uint256 liquidity = _addLiquidityAndReturnLP(address(p.tokenA), address(p.tokenB), otherHalf, swappedAmount, slippageBps);

        // deposit to best strategy
        uint256 bestAPY = 0;
        uint256 bestIndex = 0;
        for (uint i = 0; i < p.strategies.length; i++) {
            uint256 apy = p.strategies[i].getAPY();
            if (apy > bestAPY) { bestAPY = apy; bestIndex = i; }
        }
        address bestStrategy = address(p.strategies[bestIndex]);
        IERC20(lpTokenOfPair[pairId]).approve(bestStrategy, liquidity);
        p.strategies[bestIndex].deposit(liquidity);
        strategyPrincipal[pairId][bestStrategy] += liquidity;

        _mintSharesForDeposit(pairId, msg.sender, liquidity);
        emit SingleSidedDeposit(pairId, msg.sender, amount, liquidity);
    }

    function _swapHalfToTokenB(address tokenA, address tokenB, uint256 half) internal returns (uint256 swappedAmount) {
        if (tokenA == tokenB) return half;
        address[] memory path = new address[](2);
        path[0] = tokenA; path[1] = tokenB;
        uint256[] memory amounts = lpRouter.swapExactTokensForTokens(half, 0, path, address(this), block.timestamp + 120);
        swappedAmount = amounts[1];
    }

    function _addLiquidityAndReturnLP(address tokenA, address tokenB, uint256 otherHalf, uint256 swappedAmount, uint256 slippageBps) internal returns (uint256 lpMinted) {
        _approveIfNeeded(IERC20(tokenA), address(lpRouter), otherHalf);
        _approveIfNeeded(IERC20(tokenB), address(lpRouter), swappedAmount);
        (uint256 usedA, uint256 usedB, uint256 liquidity) = lpRouter.addLiquidity(tokenA, tokenB, otherHalf, swappedAmount, 0, 0, address(this), block.timestamp + 120);
        lpMinted = liquidity;
        // refund leftovers
        if (otherHalf > usedA) IERC20(tokenA).transfer(msg.sender, otherHalf - usedA);
        if (swappedAmount > usedB) IERC20(tokenB).transfer(msg.sender, swappedAmount - usedB);
    }

    function _approveIfNeeded(IERC20 token, address spender, uint256 amount) internal {
        if (token.allowance(address(this), spender) < amount) token.approve(spender, type(uint256).max);
    }

    function _mintSharesForDeposit(uint256 pairId, address user, uint256 liquidity) internal {
        require(liquidity > 0, "no liquidity");
        uint256 totalLP = _totalLPForPair(pairId);
        uint256 shares;
        if (totalShares[pairId] == 0 || totalLP == liquidity) {
            shares = liquidity;
        } else {
            uint256 priorLP = totalLP - liquidity;
            if (priorLP == 0) {
                shares = liquidity;
            } else {
                shares = (liquidity * totalShares[pairId]) / priorLP;
            }
        }
        userSharesLP[pairId][user] += shares;
        totalShares[pairId] += shares;
        emit SharesMinted(pairId, user, liquidity, shares);
    }

    function _totalLPForPair(uint256 pairId) internal view returns (uint256 totalLP) {
        address lpAddr = lpTokenOfPair[pairId];
        if (lpAddr == address(0)) return 0;
        IERC20 lp = IERC20(lpAddr);
        totalLP = lp.balanceOf(address(this));
        Pair storage p = pairs[pairId];
        for (uint i = 0; i < p.strategies.length; i++) {
            totalLP += p.strategies[i].balanceOf();
        }
    }

    function withdrawLP(uint256 pairId, uint256 shareAmount, bool singleSidedOut, address outToken, uint256 slippageBps) external {
        require(shareAmount > 0, "zero shares");
        uint256 ts = totalShares[pairId];
        require(ts > 0, "no shares");
        uint256 lpAmount = (shareAmount * _totalLPForPair(pairId)) / ts;
        userSharesLP[pairId][msg.sender] -= shareAmount;
        totalShares[pairId] -= shareAmount;
        IERC20 lp = IERC20(lpTokenOfPair[pairId]);
        uint256 aggLpBal = lp.balanceOf(address(this));
        if (aggLpBal < lpAmount) revert("insufficient aggregator LP - call replenish");
        if (!singleSidedOut) { lp.transfer(msg.sender, lpAmount); return; }
        _approveIfNeeded(lp, address(lpRouter), lpAmount);
        (uint256 amountA, uint256 amountB) = lpRouter.removeLiquidity(address(pairs[pairId].tokenA), address(pairs[pairId].tokenB), lpAmount, 0, 0, address(this), block.timestamp + 60);
        uint256 finalOut;
        if (outToken == address(pairs[pairId].tokenA)) {
            if (amountB > 0) {
                address[] memory path = new address[](2);
                path[0] = address(pairs[pairId].tokenB);
                path[1] = address(pairs[pairId].tokenA);
                uint256[] memory amounts = lpRouter.swapExactTokensForTokens(amountB, 0, path, address(this), block.timestamp + 60);
                amountA += amounts[1];
            }
            finalOut = amountA;
            pairs[pairId].tokenA.transfer(msg.sender, finalOut);
        } else {
            if (amountA > 0) {
                address[] memory path = new address[](2);
                path[0] = address(pairs[pairId].tokenA);
                path[1] = address(pairs[pairId].tokenB);
                uint256[] memory amounts = lpRouter.swapExactTokensForTokens(amountA, 0, path, address(this), block.timestamp + 60);
                amountB += amounts[1];
            }
            finalOut = amountB;
            pairs[pairId].tokenB.transfer(msg.sender, finalOut);
        }
        emit WithdrawnSingleSided(pairId, msg.sender, shareAmount, finalOut);
    }
}
