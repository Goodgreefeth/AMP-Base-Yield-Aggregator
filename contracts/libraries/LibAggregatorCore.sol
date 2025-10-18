// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library LibAggregatorCore {
    struct AggregatorState {
        mapping(uint256 => uint256) lastRebalance;
        uint256 totalTVL;
        uint256 feeRate;
    }

    event Rebalanced(uint256 indexed pairId, uint256 timestamp);
    event FeesCollected(address indexed collector, uint256 amount);

    function updateRebalance(
        AggregatorState storage state,
        uint256 pairId
    ) internal {
        state.lastRebalance[pairId] = block.timestamp;
        emit Rebalanced(pairId, block.timestamp);
    }

    function shouldRebalance(
        AggregatorState storage state,
        uint256 pairId,
        uint256 interval
    ) internal view returns (bool) {
        uint256 last = state.lastRebalance[pairId];
        return block.timestamp > last + interval;
    }

    function collectFee(
        AggregatorState storage state,
        address collector,
        uint256 amount
    ) internal {
        state.totalTVL -= amount;
        emit FeesCollected(collector, amount);
    }
}
