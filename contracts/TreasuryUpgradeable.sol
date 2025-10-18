// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;


import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract TreasuryUpgradeable is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    // --- UUPS Upgradeability ---
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
    event TreasuryWithdrawal(address indexed to, uint256 amount);

    function initialize(address initialOwner) public initializer {
        __Ownable_init();
        if (initialOwner != msg.sender) {
            transferOwnership(initialOwner);
        }
    }

    receive() external payable {}

    function withdrawTo(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Zero address");
        payable(to).transfer(amount);
        emit TreasuryWithdrawal(to, amount);
    }
}
