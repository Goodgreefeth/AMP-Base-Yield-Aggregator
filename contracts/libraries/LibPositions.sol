// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library LibPositions {
    struct Position {
        uint256 shares;
        uint256 lastUpdated;
        uint256 principal;
        int256 pnl;
    }
    struct PairState {
        uint256 totalShares;
        uint256 lastRebalance;
        mapping(address => Position) positions;
        // Add more as needed
    }

    // Deposit logic
    function deposit(PairState storage pair, address user, uint256 amount, uint256 shares) internal {
        Position storage pos = pair.positions[user];
        pos.shares += shares;
        pos.lastUpdated = block.timestamp;
        pos.principal += amount;
        pair.totalShares += shares;
    }

    // Withdraw logic
    function withdraw(PairState storage pair, address user, uint256 shares) internal returns (uint256 amount) {
        Position storage pos = pair.positions[user];
        require(pos.shares >= shares, "Insufficient shares");
        pos.shares -= shares;
        pos.lastUpdated = block.timestamp;
        // PnL and principal logic can be added here
        pair.totalShares -= shares;
        // For now, 1:1 mapping
        amount = shares;
    }

    // Rebalance logic
    function rebalance(PairState storage pair) internal {
        pair.lastRebalance = block.timestamp;
        // Add allocation, PnL, etc. logic here
    }

    // Add more helpers as needed
}
