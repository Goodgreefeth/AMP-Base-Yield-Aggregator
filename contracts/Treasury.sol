// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract Treasury is Ownable {
    event TreasuryWithdrawal(address indexed to, uint256 amount);

    receive() external payable {}

    function withdrawTo(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Zero address");
        payable(to).transfer(amount);
        emit TreasuryWithdrawal(to, amount);
    }
}
