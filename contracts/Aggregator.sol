// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

import "./StrategyBase.sol";
import "./interfaces/IUniswapV2Router02.sol";

contract Aggregator is Ownable, Pausable {
    // --- Keeper Whitelist ---
    mapping(address => bool) public isKeeper;
    event KeeperSet(address indexed keeper, bool allowed);
    modifier onlyKeeper() {
        require(isKeeper[msg.sender], "Not keeper");
        _;
    }
    function setKeeper(address keeper, bool allowed) external onlyOwner {
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    // --- Pausable ---
    function pause() external onlyOwner {
        _pause();
    }
    function unpause() external onlyOwner {
        _unpause();
    }
    // --- Flash Boost Config ---
    bool public flashBoostEnabled = true;
    mapping(address => bool) public whitelistedFlashStrategies;
    uint256 public maxBoostPercent = 25; // 25% of total balance

    event FlashBoostToggled(bool enabled);
    event FlashStrategyWhitelisted(address strategy, bool allowed);
    event MaxBoostPercentSet(uint256 newCap);

    function setFlashBoostEnabled(bool enabled) external onlyOwner {
        flashBoostEnabled = enabled;
        emit FlashBoostToggled(enabled);
    }

    function setFlashStrategyWhitelist(address strategy, bool allowed) external onlyOwner {
        whitelistedFlashStrategies[strategy] = allowed;
        emit FlashStrategyWhitelisted(strategy, allowed);
    }

    function setMaxBoostPercent(uint256 newCap) external onlyOwner {
        require(newCap <= 50, "Cap too high");
        maxBoostPercent = newCap;
        emit MaxBoostPercentSet(newCap);
    }

    modifier flashBoostActive() {
        require(flashBoostEnabled, "Flash boost disabled");
        _;
    }

    modifier onlyWhitelistedStrategy(address strategy) {
        require(whitelistedFlashStrategies[strategy], "Not whitelisted");
        _;
    }

    function isFlashBoostAllowed(uint256 pairId, address targetStrategy, uint256 percent)
        external
        view
        returns (bool)
    {
        return (
            flashBoostEnabled &&
            whitelistedFlashStrategies[targetStrategy] &&
            percent <= maxBoostPercent
        );
    }
    // --- Flash Boost State ---
    struct FlashBoost {
        address strategy;
        uint256 principal;
        uint256 startTime;
        bool active;
    }
    mapping(uint256 => FlashBoost) public flashBoosts; // pairId => FlashBoost

    // --- Flash Boost Events ---
    event FlashBoostStarted(uint256 indexed pairId, address indexed strategy, uint256 principal, uint256 startTime);
    event FlashBoostEnded(uint256 indexed pairId, address indexed strategy, uint256 principal, uint256 yield, uint256 fee, uint256 endTime);

    // --- Flash Boost Function Signatures ---

    function triggerFlashBoost(
        uint256 pairId,
        address targetStrategy,
        uint256 percent
    )
        external
        flashBoostActive
        onlyWhitelistedStrategy(targetStrategy)
        onlyKeeper
    {
        require(!paused(), "Paused");
        require(percent <= maxBoostPercent, "Over cap");
        require(!flashBoosts[pairId].active, "Boost already active");
        Pair storage pair = pairs[pairId];
        require(pair.strategies.length > 0, "No strategies");
        // Calculate total pool value (sum of all strategy balances)
        uint256 totalValue = 0;
        for (uint i = 0; i < pair.strategies.length; i++) {
            totalValue += pair.strategies[i].balanceOf();
        }
        require(totalValue > 0, "No funds to boost");
        uint256 boostAmount = (totalValue * percent) / 100;
        require(boostAmount > 0, "Boost too small");
        // Withdraw boostAmount from all strategies proportionally (or from a base strategy, here: first strategy)
        address baseStrategy = address(pair.strategies[0]);
        uint256 baseBal = pair.strategies[0].balanceOf();
        require(baseBal >= boostAmount, "Not enough in base");
        pair.strategies[0].withdraw(boostAmount);
        // Approve and deposit to target
        pair.tokenA.approve(targetStrategy, boostAmount);
        StrategyBase(targetStrategy).deposit(boostAmount);
        // Record boost
        flashBoosts[pairId] = FlashBoost({
            strategy: targetStrategy,
            principal: boostAmount,
            startTime: block.timestamp,
            active: true
        });
        emit FlashBoostStarted(pairId, targetStrategy, boostAmount, block.timestamp);
    }

    function endFlashBoost(uint256 pairId)
        external
        flashBoostActive
        onlyKeeper
    {
        require(!paused(), "Paused");
        FlashBoost storage fb = flashBoosts[pairId];
        require(fb.active, "No active boost");
        Pair storage pair = pairs[pairId];
        // Withdraw all from boosted strategy
        uint256 bal = StrategyBase(fb.strategy).balanceOf();
        require(bal > 0, "Nothing to withdraw");
        StrategyBase(fb.strategy).withdraw(bal);
        // Calculate yield and fee
        uint256 yield = bal > fb.principal ? bal - fb.principal : 0;
        uint256 fee = (yield * protocolFeeBps) / 10000;
        uint256 toReturn = bal;
        if (fee > 0 && treasury != address(0)) {
            // Only transfer the fee portion from the contract to treasury
            require(pair.tokenA.balanceOf(address(this)) >= fee, "Insufficient balance for fee");
            pair.tokenA.transfer(treasury, fee);
            totalFeesCollected += fee;
            emit FeeCollected(treasury, address(pair.tokenA), fee, "flashBoost");
            toReturn = bal - fee;
        }
        // Return to base strategy (first strategy)
        pair.tokenA.approve(address(pair.strategies[0]), toReturn);
        pair.strategies[0].deposit(toReturn);
        emit FlashBoostEnded(pairId, fb.strategy, fb.principal, yield, fee, block.timestamp);
        // Reset boost
        fb.active = false;
    }

    function getFlashBoost(uint256 pairId) external view returns (address strategy, uint256 principal, uint256 startTime, bool active) {
        FlashBoost storage fb = flashBoosts[pairId];
        return (fb.strategy, fb.principal, fb.startTime, fb.active);
    }
    uint256 public totalFeesCollected;
    event FeeCollected(address indexed treasury, address indexed token, uint256 amount, string context);
    // Allows owner to move funds from Aggregator into a strategy for a given pair
    function depositToStrategy(uint256 _pairId, address strategy, uint256 amount) external onlyOwner {
    require(!paused(), "Paused");
    Pair storage pair = pairs[_pairId];
        require(amount > 0, "Amount must be > 0");
        require(pair.tokenA.balanceOf(address(this)) >= amount, "Insufficient balance");
        bool found = false;
        for (uint i = 0; i < pair.strategies.length; i++) {
            if (address(pair.strategies[i]) == strategy) {
                found = true;
                break;
            }
        }
        require(found, "Strategy not found for pair");
        pair.tokenA.approve(strategy, amount);
        StrategyBase(strategy).deposit(amount);

        // Track principal
        strategyPrincipal[_pairId][strategy] += amount;
    }

    event DebugLog(string label, uint256 fee, address treasury, address token);

    // Returns the true vault value, handling same-token pairs correctly
    function getVaultValue(uint256 _pairId) public view returns (uint256) {
        Pair storage pair = pairs[_pairId];
        if (address(pair.tokenA) == address(pair.tokenB)) {
            return pair.tokenA.balanceOf(address(this));
        }
        return pair.tokenA.balanceOf(address(this)) + pair.tokenB.balanceOf(address(this));
    }

    address public router;
    event RouterSet(address indexed newRouter);

    // Performance fee (in basis points, e.g. 500 = 5%)
    uint256 public performanceFeeBps = 500;
    address public feeRecipient;

    // Protocol fee (in basis points, e.g. 300 = 3%). Configurable, max 5% (500 bps).
    uint256 public protocolFeeBps = 300;
    address public treasury;

    event ProtocolFeeSet(uint256 newFeeBps);
    event TreasurySet(address newTreasury);

    event PerformanceFeeSet(uint256 newFeeBps);
    event FeeRecipientSet(address newRecipient);

    struct Pair {
        IERC20 tokenA;
        IERC20 tokenB;
        StrategyBase[] strategies;
        uint256 totalShares;
    }

    mapping(uint256 => Pair) public pairs;
    mapping(uint256 => mapping(address => uint256)) public userShares; // pairId => user => shares
    mapping(uint256 => mapping(address => uint256)) public strategyPrincipal; // pairId => strategy => principal
    uint256 public nextPairId;

    event PairAdded(uint256 indexed pairId, address tokenA, address tokenB);
    event StrategyAdded(uint256 indexed pairId, address strategy);
    event StrategyRebalanced(uint256 indexed pairId, address fromStrategy, address toStrategy, uint256 amount);
    event XPUpdated(address indexed user, uint256 indexed pairId, uint256 xp, string action);


    constructor() Ownable() {
        feeRecipient = msg.sender;
        treasury = msg.sender;
    }

    function setProtocolFee(uint256 _feeBps) external onlyOwner {
    require(_feeBps <= 500, "Fee too high (max 5%)"); // Max 5%
    protocolFeeBps = _feeBps;
    emit ProtocolFeeSet(_feeBps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Zero address");
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    function setRouter(address _router) external onlyOwner {
        require(_router != address(0), "Zero address");
        router = _router;
        emit RouterSet(_router);
    }

    mapping(uint256 => address) public lpTokenOfPair; // pairId => lp token address

    function setLpTokenForPair(uint256 pairId, address lpToken) external onlyOwner {
        require(lpToken != address(0), "Zero lp token");
        lpTokenOfPair[pairId] = lpToken;
    }

    // Allow owner to approve tokens from Aggregator to a strategy (for testing/mock purposes)
    function approveToken(uint256 _pairId, address _token, address _spender, uint256 _amount) external onlyOwner {
        require(_spender != address(0), "Zero spender");
        require(_token == address(pairs[_pairId].tokenA) || _token == address(pairs[_pairId].tokenB), "Token not in pair");
        IERC20(_token).approve(_spender, _amount);
    }

    function setPerformanceFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 2000, "Fee too high"); // Max 20%
        performanceFeeBps = _feeBps;
        emit PerformanceFeeSet(_feeBps);
    }

    function setFeeRecipient(address _recipient) external onlyOwner {
        require(_recipient != address(0), "Zero address");
        feeRecipient = _recipient;
        emit FeeRecipientSet(_recipient);
    }

    function addPair(address _tokenA, address _tokenB) external onlyOwner returns (uint256) {
        pairs[nextPairId].tokenA = IERC20(_tokenA);
        pairs[nextPairId].tokenB = IERC20(_tokenB);
        emit PairAdded(nextPairId, _tokenA, _tokenB);
        return nextPairId++;
    }

    function addStrategy(uint256 _pairId, address _strategy) external onlyOwner {
        pairs[_pairId].strategies.push(StrategyBase(_strategy));
        emit StrategyAdded(_pairId, _strategy);
    }

    // Single-sided deposit: only USDC (tokenA), protocol splits into LP (mock swap for demo)
    function deposit(uint256 _pairId, uint256 _amountUSDC) external {
    require(!paused(), "Paused");
    Pair storage pair = pairs[_pairId];
    require(address(pair.tokenA) != address(0), "Invalid pair");
    require(_amountUSDC > 0, "Amount must be > 0");
    require(router != address(0), "Router not set");

    // Calculate vault value before deposit
    uint256 vaultValueBefore = pair.tokenA.balanceOf(address(this)) + pair.tokenB.balanceOf(address(this));

    // Transfer USDC from user
    require(pair.tokenA.transferFrom(msg.sender, address(this), _amountUSDC), "USDC transfer failed");

    // Approve router to spend USDC
    pair.tokenA.approve(router, _amountUSDC / 2);

    // Swap half USDC for tokenB (e.g., USDT)
    address[] memory path = new address[](2);
    path[0] = address(pair.tokenA);
    path[1] = address(pair.tokenB);
    uint256 amountIn = _amountUSDC / 2;
    uint256 amountOutMin = 0; // For demo, accept any amount
    uint256 deadline = block.timestamp + 1200;
    IUniswapV2Router02(router).swapExactTokensForTokens(
        amountIn,
        amountOutMin,
        path,
        address(this),
        deadline
    );

    // After swap, Aggregator holds both tokens
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

    /// @notice Returns the available liquidity in the aggregator for a given pair (tokenA balance)
    function availableLiquidity(uint256 _pairId) public view returns (uint256) {
        Pair storage pair = pairs[_pairId];
        return pair.tokenA.balanceOf(address(this));
    }

    /**
     * @dev User withdrawals require aggregator to hold sufficient liquidity. Automation/keeper must withdraw from strategies before user withdraws.
     */
    function withdraw(uint256 _pairId, uint256 _shares) external {
        require(!paused(), "Paused");
        Pair storage pair = pairs[_pairId];
        require(pair.totalShares > 0, "No shares in vault");
        require(userShares[_pairId][msg.sender] >= _shares, "Not enough shares");
        // Calculate before updating shares to avoid division by zero
        uint256 vaultBalance = getVaultValue(_pairId);
        uint256 amount = (vaultBalance * _shares) / pair.totalShares;
        // Update shares after calculation
        userShares[_pairId][msg.sender] -= _shares;
        pair.totalShares -= _shares;
        // Calculate protocol fee and payout
        uint256 fee = (amount * protocolFeeBps) / 10000;
        uint256 payout = amount - fee;
        require(availableLiquidity(_pairId) >= amount, "Insufficient liquidity");
        // Swap all tokenB to tokenA (USDC) if needed
        if (address(pair.tokenB) != address(pair.tokenA) && pair.tokenB.balanceOf(address(this)) > 0) {
            address[] memory path = new address[](2);
            path[0] = address(pair.tokenB);
            path[1] = address(pair.tokenA);
            uint256 amountIn = pair.tokenB.balanceOf(address(this));
            uint256 amountOutMin = 0; // Accept any amount for demo
            uint256 deadline = block.timestamp + 1200;
            pair.tokenB.approve(router, amountIn);
            IUniswapV2Router02(router).swapExactTokensForTokens(
                amountIn,
                amountOutMin,
                path,
                address(this),
                deadline
            );
        }
        // After swap, pay out everything in tokenA (USDC)
        if (fee > 0 && treasury != address(0)) {
            pair.tokenA.transfer(treasury, fee); // Transfer fee to treasury
            totalFeesCollected += fee;
            emit FeeCollected(treasury, address(pair.tokenA), fee, "withdraw");
        }
        pair.tokenA.transfer(msg.sender, payout); // Transfer payout to user
        emit XPUpdated(msg.sender, _pairId, _shares, "withdraw");
    }

    function rebalance(uint256 _pairId) external onlyOwner {
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

        // Debug: emit principal, yield, fee, toMove for each rebalance
        address bestStrategy = address(pair.strategies[bestIndex]);
        uint256 totalToMove = 0;
        for (uint i = 0; i < pair.strategies.length; i++) {
            if (i != bestIndex) {
                address fromStrategy = address(pair.strategies[i]);
                uint256 bal = pair.strategies[i].balanceOf();
                uint256 principal = strategyPrincipal[_pairId][fromStrategy];
                if (bal > 0) {
                    emit DebugLog("rebalance: before withdraw", bal, fromStrategy, address(pair.tokenA));
                    uint256 yield = bal > principal ? bal - principal : 0;
                    uint256 fee = (yield * protocolFeeBps) / 10000;
                    uint256 toMove = bal - fee;
                    emit DebugLog("rebalance: principal", principal, fromStrategy, address(pair.tokenA));
                    emit DebugLog("rebalance: yield", yield, fromStrategy, address(pair.tokenA));
                    emit DebugLog("rebalance: fee", fee, fromStrategy, address(pair.tokenA));
                    emit DebugLog("rebalance: toMove", toMove, fromStrategy, address(pair.tokenA));
                    pair.strategies[i].withdraw(bal);
                    if (fee > 0 && treasury != address(0)) {
                        require(fee > 0, "Fee is zero in rebalance");
                        uint256 aggBal = pair.tokenA.balanceOf(address(this));
                        require(aggBal >= fee, "Aggregator: insufficient balance for fee");
                        emit DebugLog("rebalance: after fee transfer", fee, treasury, address(pair.tokenA));
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
        // Set principal for all strategies except the best to 0, and for the best to the new total
        for (uint i = 0; i < pair.strategies.length; i++) {
            address strat = address(pair.strategies[i]);
            if (i == bestIndex) {
                strategyPrincipal[_pairId][strat] = totalToMove;
            } else {
                strategyPrincipal[_pairId][strat] = 0;
            }
        }
    }

    function harvest(uint256 _pairId) external onlyOwner {
        Pair storage pair = pairs[_pairId];
        for (uint i = 0; i < pair.strategies.length; i++) {
            uint256 yieldAmount = pair.strategies[i].harvest();
            if (yieldAmount > 0 && performanceFeeBps > 0 && feeRecipient != address(0)) {
                uint256 fee = (yieldAmount * performanceFeeBps) / 10000;
                // For demo, assume yield is paid in tokenA
                if (fee > 0) {
                    pair.tokenA.transfer(feeRecipient, fee);
                }
            }
        }
    }
}

