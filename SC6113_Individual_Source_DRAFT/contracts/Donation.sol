// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Single-campaign classroom prototype; use Sepolia test ETH only.
contract Donation {
    address payable public immutable organizer;
    uint256 public totalDonated;
    uint256 public totalWithdrawn;
    mapping(address => uint256) public donatedBy;
    bool private locked;

    event Donated(address indexed donor, uint256 amount);
    event Withdrawn(address indexed organizer, uint256 amount);

    constructor() { organizer = payable(msg.sender); }

    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }

    function donate() external payable nonReentrant {
        require(msg.value > 0, "Amount must be positive");
        totalDonated += msg.value;
        donatedBy[msg.sender] += msg.value;
        emit Donated(msg.sender, msg.value);
    }

    /// @notice Only the deployer can withdraw, always to their own address.
    function withdraw(uint256 amount) external nonReentrant {
        require(msg.sender == organizer, "Organizer only");
        require(amount > 0 && amount <= address(this).balance, "Invalid amount");
        totalWithdrawn += amount;
        (bool success, ) = organizer.call{value: amount}("");
        require(success, "Transfer failed");
        emit Withdrawn(msg.sender, amount);
    }
}
