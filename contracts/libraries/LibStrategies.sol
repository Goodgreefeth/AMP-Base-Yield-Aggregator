// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library LibStrategies {
    // Interact with strategy adapters
    function depositToStrategy(address strategy, uint256 amount) internal {
        (bool success, ) = strategy.call(abi.encodeWithSignature("deposit(uint256)", amount));
        require(success, "Strategy deposit failed");
    }

    function withdrawFromStrategy(address strategy, uint256 amount) internal {
        (bool success, ) = strategy.call(abi.encodeWithSignature("withdraw(uint256)", amount));
        require(success, "Strategy withdraw failed");
    }

    function harvest(address strategy) internal returns (uint256 yield) {
        (bool success, bytes memory data) = strategy.call(abi.encodeWithSignature("harvest()"));
        require(success, "Strategy harvest failed");
        yield = abi.decode(data, (uint256));
    }

    // Add more helpers for switching pools, APY checks, etc.
}
