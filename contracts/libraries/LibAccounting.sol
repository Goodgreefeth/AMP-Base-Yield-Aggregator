// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library LibAccounting {
    // Fee calculation
    function calculateFee(uint256 amount, uint256 feeBps) internal pure returns (uint256) {
        return (amount * feeBps) / 10000;
    }

    // Share accounting
    function sharesForAmount(uint256 totalShares, uint256 totalAssets, uint256 amount) internal pure returns (uint256) {
        if (totalAssets == 0 || totalShares == 0) return amount;
        return (amount * totalShares) / totalAssets;
    }

    function amountForShares(uint256 totalShares, uint256 totalAssets, uint256 shares) internal pure returns (uint256) {
        if (totalShares == 0) return 0;
        return (shares * totalAssets) / totalShares;
    }

    // Rewards distribution (stub)
    function distributeRewards(uint256 totalRewards, uint256 totalShares, uint256 userShares) internal pure returns (uint256) {
        if (totalShares == 0) return 0;
        return (totalRewards * userShares) / totalShares;
    }
}
