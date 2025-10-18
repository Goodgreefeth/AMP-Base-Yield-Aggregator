// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "../interfaces/IStrategyBase.sol";
import "../interfaces/IRouter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract RebalanceImpl is OwnableUpgradeable, PausableUpgradeable {
    // Storage layout MUST match AggregatorUpgradeable for delegatecall to operate correctly.
    // We copy only the state variables used by rebalance in the same order as in AggregatorUpgradeable.

    // from AggregatorUpgradeable top
    // Note: the inherited OwnableUpgradeable/PausableUpgradeable storage slots match by inheritance order

    // Protocol & treasury
    uint256 public protocolFeeBps;
    address public treasury;

    // Pair struct and storage
    struct Pair {
        IERC20 tokenA;
        IERC20 tokenB;
        IStrategyBase[] strategies;
        uint256 totalShares;
    }

    mapping(uint256 => Pair) public pairs;
    mapping(uint256 => mapping(address => uint256)) public strategyPrincipal;

    uint256 public totalFeesCollected;

    // Events (must match aggregator events)
    event FeeCollected(address indexed treasury, address indexed token, uint256 amount, string context);
    event StrategyRebalanced(uint256 indexed pairId, address fromStrategy, address toStrategy, uint256 amount);
    event XPUpdated(address indexed user, uint256 indexed pairId, uint256 xp, string action);

    // Rebalance function: executes in caller (Aggregator) storage via delegatecall
    function rebalance(uint256 _pairId) external {
        require(!paused(), "Paused");
        Pair storage pair = pairs[_pairId];
        require(pair.strategies.length > 0, "No strategies for pair");

        uint256 bestAPY = 0;
        uint256 bestIndex = 0;
        for (uint i = 0; i < pair.strategies.length; i++) {
            uint256 apy = pair.strategies[i].getAPY();
            if (apy > bestAPY) {
                bestAPY = apy;
                bestIndex = i;
            }
        }

        address bestStrategy = address(pair.strategies[bestIndex]);
        uint256 totalToMove = 0;
        for (uint i = 0; i < pair.strategies.length; i++) {
            if (i != bestIndex) {
                address fromStrategy = address(pair.strategies[i]);
                uint256 bal = pair.strategies[i].balanceOf();
                uint256 principal = strategyPrincipal[_pairId][fromStrategy];
                if (bal > 0) {
                    uint256 yield = bal > principal ? bal - principal : 0;
                    uint256 fee = (yield * protocolFeeBps) / 10000;
                    uint256 toMove = bal - fee;
                    pair.strategies[i].withdraw(bal);
                    if (fee > 0 && treasury != address(0)) {
                        uint256 aggBal = pair.tokenA.balanceOf(address(this));
                        require(aggBal >= fee, "Aggregator: insufficient balance for fee");
                        pair.tokenA.transfer(treasury, fee);
                        totalFeesCollected += fee;
                        emit FeeCollected(treasury, address(pair.tokenA), fee, "rebalance");
                    }
                    strategyPrincipal[_pairId][fromStrategy] = 0;
                    totalToMove += toMove;
                    emit StrategyRebalanced(_pairId, fromStrategy, bestStrategy, toMove);
                    emit XPUpdated(owner(), _pairId, toMove, "rebalance");
                }
            }
        }

        if (totalToMove > 0) {
            require(pair.tokenA.balanceOf(address(this)) >= totalToMove, "Aggregator: insufficient balance for deposit");
            pair.tokenA.approve(bestStrategy, totalToMove);
            pair.strategies[bestIndex].deposit(totalToMove);
        }

        for (uint i = 0; i < pair.strategies.length; i++) {
            address strat = address(pair.strategies[i]);
            if (i == bestIndex) {
                strategyPrincipal[_pairId][strat] = totalToMove;
            } else {
                strategyPrincipal[_pairId][strat] = 0;
            }
        }
    }

    // Returns whether APY conditions indicate a rebalance is desirable for the pair.
    // This is a view helper that can be delegatecalled from the Aggregator to do
    // the APY comparison without duplicating the loop-heavy logic in the aggregator implementation.
    function checkUpkeepApy(uint256 pairId) external view returns (bool upkeepNeeded, bytes memory performData) {
        Pair storage pair = pairs[pairId];
        if (pair.strategies.length == 0) {
            return (false, bytes(""));
        }
        // Find current strategy (the one with all/most LP)
        uint256 currentIndex = 0;
        uint256 maxBal = 0;
        for (uint i = 0; i < pair.strategies.length; i++) {
            uint256 bal = pair.strategies[i].balanceOf();
            if (bal > maxBal) {
                maxBal = bal;
                currentIndex = i;
            }
        }
        uint256 currentAPY = pair.strategies[currentIndex].getAPY();
        uint256 bestAPY = currentAPY;
        uint256 bestIndex = currentIndex;
        for (uint i = 0; i < pair.strategies.length; i++) {
            uint256 apy = pair.strategies[i].getAPY();
            if (apy > bestAPY) {
                bestAPY = apy;
                bestIndex = i;
            }
        }
        upkeepNeeded = false;
        if (bestIndex != currentIndex && bestAPY >= currentAPY + 300) {
            upkeepNeeded = true;
        }
        performData = abi.encode(pairId);
    }
}
