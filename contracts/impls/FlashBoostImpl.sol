// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IStrategyBase.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract RebalanceStorageShim {
    // minimal subset of storage layout used by flashboost logic
    uint256 public minRebalanceInterval;
    uint256 public totalFeesCollected;
    uint256 public performanceFeeBps;
    uint256 public protocolFeeBps;
    address public treasury;
    address public router;
    // pairs mapping simplified: each Pair uses tokenA, tokenB and strategies
    struct Pair { IERC20 tokenA; IERC20 tokenB; IStrategyBase[] strategies; uint256 totalShares; }
    mapping(uint256 => Pair) public pairs;
    mapping(uint256 => mapping(address => uint256)) public strategyPrincipal;
    // flash boost state
    struct FlashBoost { address strategy; uint256 principal; uint256 startTime; bool active; }
    mapping(uint256 => FlashBoost) public flashBoosts;
}

contract FlashBoostImpl is RebalanceStorageShim {
    event FlashBoostStarted(uint256 indexed pairId, address indexed strategy, uint256 principal, uint256 startTime);
    event FlashBoostEnded(uint256 indexed pairId, address indexed strategy, uint256 principal, uint256 yield, uint256 fee, uint256 endTime);
    event FeeCollected(address indexed treasury, address indexed token, uint256 amount, string context);

    // trigger flash boost (to be called via delegatecall from Aggregator)
    function triggerFlashBoost(uint256 pairId, address targetStrategy, uint256 percent) external {
        // Ensure this function is delegatecalled (so code.length of this impl contract is non-zero when called directly).
        require(address(this).code.length == 0, "should be delegatecalled");
        require(percent <= 50, "Over cap");
        FlashBoost storage fb = flashBoosts[pairId];
        require(!fb.active, "Boost already active");
        Pair storage pair = pairs[pairId];
        require(pair.strategies.length > 0, "No strategies");
        uint256 totalValue = 0;
        for (uint i = 0; i < pair.strategies.length; i++) {
            totalValue += pair.strategies[i].balanceOf();
        }
        require(totalValue > 0, "No funds to boost");
        uint256 boostAmount = (totalValue * percent) / 100;
        require(boostAmount > 0, "Boost too small");
        // withdraw from base (first strategy)
        uint256 baseBal = pair.strategies[0].balanceOf();
        require(baseBal >= boostAmount, "Not enough in base");
        pair.strategies[0].withdraw(boostAmount);
        // approve and deposit to target
        pair.tokenA.approve(targetStrategy, boostAmount);
        IStrategyBase(targetStrategy).deposit(boostAmount);
        flashBoosts[pairId] = FlashBoost({ strategy: targetStrategy, principal: boostAmount, startTime: block.timestamp, active: true });
        emit FlashBoostStarted(pairId, targetStrategy, boostAmount, block.timestamp);
    }

    function endFlashBoost(uint256 pairId) external {
        FlashBoost storage fb = flashBoosts[pairId];
        require(fb.active, "No active boost");
        Pair storage pair = pairs[pairId];
        uint256 bal = IStrategyBase(fb.strategy).balanceOf();
        require(bal > 0, "Nothing to withdraw");
        IStrategyBase(fb.strategy).withdraw(bal);
        uint256 yield = bal > fb.principal ? bal - fb.principal : 0;
        uint256 fee = (yield * protocolFeeBps) / 10000;
        uint256 toReturn = bal;
        if (fee > 0 && treasury != address(0)) {
            require(pair.tokenA.balanceOf(address(this)) >= fee, "Insufficient balance for fee");
            pair.tokenA.transfer(treasury, fee);
            totalFeesCollected += fee;
            emit FeeCollected(treasury, address(pair.tokenA), fee, "flashBoost");
            toReturn = bal - fee;
        }
        pair.tokenA.approve(address(pair.strategies[0]), toReturn);
        pair.strategies[0].deposit(toReturn);
        emit FlashBoostEnded(pairId, fb.strategy, fb.principal, yield, fee, block.timestamp);
        fb.active = false;
    }
}
