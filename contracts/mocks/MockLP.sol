// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockLP is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    // mint/burn helpers for router to call
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
