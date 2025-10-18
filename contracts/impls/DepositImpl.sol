// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "../interfaces/IUniswapV2Router02.sol";
import "../interfaces/IStrategyBase.sol";
import "../libraries/LibAggregatorCore.sol";

// Storage shim MUST match AggregatorUpgradeable state layout up to `pairs`
contract DepositStorageShim {
    using LibAggregatorCore for LibAggregatorCore.AggregatorState;
    LibAggregatorCore.AggregatorState internal aggState;

    // Keeper / timing
    uint256 public minRebalanceInterval;

    // Delegate impl addresses (present in AggregatorUpgradeable)
    address public rebalanceImpl;
    address public lpVaultImpl;
    address public depositImpl;

    // Keeper whitelist
    mapping(address => bool) public isKeeper;

    // Flash boost config/state
    bool public flashBoostEnabled;
    mapping(address => bool) public whitelistedFlashStrategies;
    uint256 public maxBoostPercent;
    address public flashBoostImpl;
    struct FlashBoost { address strategy; uint256 principal; uint256 startTime; bool active; }
    mapping(uint256 => FlashBoost) public flashBoosts;

    // Fees & totals
    uint256 public totalFeesCollected;

    // Router & fee config
    address public router;
    uint256 public performanceFeeBps;
    address public feeRecipient;
    uint256 public protocolFeeBps;
    address public treasury;

    // Pair struct and mappings (must align with AggregatorUpgradeable)
    struct Pair { IERC20 tokenA; IERC20 tokenB; IStrategyBase[] strategies; uint256 totalShares; }
    mapping(uint256 => Pair) public pairs;
    mapping(uint256 => mapping(address => uint256)) public userShares;
    mapping(uint256 => mapping(address => uint256)) public strategyPrincipal;
    uint256 public nextPairId;
    mapping(uint256 => address) public lpTokenOfPair;

    event XPUpdated(address indexed user, uint256 indexed pairId, uint256 xp, string action);
}

contract DepositImpl is OwnableUpgradeable, PausableUpgradeable, DepositStorageShim {
    function deposit(uint256 _pairId, uint256 _amountUSDC) external {
        require(_amountUSDC > 0, "Amount must be > 0");
        Pair storage pair = pairs[_pairId];
        require(address(pair.tokenA) != address(0), "Invalid pair");
        require(router != address(0), "Router not set");

        uint256 vaultValueBefore = pair.tokenA.balanceOf(address(this)) + pair.tokenB.balanceOf(address(this));
        require(pair.tokenA.transferFrom(msg.sender, address(this), _amountUSDC), "USDC transfer failed");
        pair.tokenA.approve(router, _amountUSDC / 2);
        address[] memory path = new address[](2);
        path[0] = address(pair.tokenA);
        path[1] = address(pair.tokenB);
        uint256 amountIn = _amountUSDC / 2;
        uint256 amountOutMin = 0;
        uint256 deadline = block.timestamp + 1200;
        IUniswapV2Router02(router).swapExactTokensForTokens(amountIn, amountOutMin, path, address(this), deadline);

        uint256 amountA = pair.tokenA.balanceOf(address(this));
        uint256 amountB = pair.tokenB.balanceOf(address(this));
        uint256 vaultValueAfter = amountA + amountB;
        uint256 depositValue = vaultValueAfter - vaultValueBefore;
        uint256 shares;
        if (pair.totalShares == 0 || vaultValueBefore == 0) {
            shares = depositValue;
        } else {
            shares = (depositValue * pair.totalShares) / vaultValueBefore;
        }
        require(shares > 0, "Zero shares");
        userShares[_pairId][msg.sender] += shares;
        pair.totalShares += shares;
        emit XPUpdated(msg.sender, _pairId, shares, "deposit");
    }

    function withdraw(uint256 _pairId, uint256 _shares) external {
        require(_shares > 0, "shares must be > 0");
        Pair storage pair = pairs[_pairId];
        require(pair.totalShares > 0, "No shares in vault");
        require(userShares[_pairId][msg.sender] >= _shares, "Not enough shares");
        uint256 vaultBalance = (address(pair.tokenA) == address(pair.tokenB)) ? pair.tokenA.balanceOf(address(this)) : pair.tokenA.balanceOf(address(this)) + pair.tokenB.balanceOf(address(this));
        uint256 amount = (vaultBalance * _shares) / pair.totalShares;
        userShares[_pairId][msg.sender] -= _shares;
        pair.totalShares -= _shares;
        uint256 fee = (amount * protocolFeeBps) / 10000;
        uint256 payout = amount - fee;
        require(pair.tokenA.balanceOf(address(this)) >= amount, "Insufficient liquidity");
        if (address(pair.tokenB) != address(pair.tokenA) && pair.tokenB.balanceOf(address(this)) > 0) {
            address[] memory path = new address[](2);
            path[0] = address(pair.tokenB);
            path[1] = address(pair.tokenA);
            uint256 amountIn = pair.tokenB.balanceOf(address(this));
            uint256 amountOutMin = 0;
            uint256 deadline = block.timestamp + 1200;
            pair.tokenB.approve(router, amountIn);
            IUniswapV2Router02(router).swapExactTokensForTokens(amountIn, amountOutMin, path, address(this), deadline);
        }
        if (fee > 0 && treasury != address(0)) {
            pair.tokenA.transfer(treasury, fee);
            totalFeesCollected += fee;
            emit XPUpdated(treasury, _pairId, fee, "fee");
        }
        pair.tokenA.transfer(msg.sender, payout);
        emit XPUpdated(msg.sender, _pairId, _shares, "withdraw");
    }
}
