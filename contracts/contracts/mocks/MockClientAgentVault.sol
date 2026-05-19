// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IClientAgentVault.sol";

/**
 * @title MockClientAgentVault
 * @notice Test stub for IClientAgentVault.
 *
 *         sessionId = keccak256(abi.encodePacked(sessionKey, agentId, validUntil))
 *         serviceProvider = keccak256(abi.encodePacked(providerAddress))
 */
contract MockClientAgentVault is Ownable {
    // bytes32 sessionId => exists
    mapping(bytes32 => bool) private _sessions;

    // keccak256(abi.encodePacked(providerAddress)) => blocked
    mapping(bytes32 => bool) private _blockedProviders;

    uint256 public maxAllowedSpend;

    constructor() Ownable(msg.sender) {
        maxAllowedSpend = type(uint256).max;
    }

    // ─── Session management helpers (test-only) ────────────────────────

    function setSessionExists(bytes32 sessionId, bool value) external onlyOwner {
        _sessions[sessionId] = value;
    }

    // ─── IClientAgentVault: session queries ────────────────────────────

    function sessionExists(bytes32 sessionId) external view returns (bool) {
        return _sessions[sessionId];
    }

    function getSessionAgent(bytes32) external pure returns (address) {
        return address(0);
    }

    // ─── IClientAgentVault: spending rules ────────────────────────────

    function setMaxAllowedSpend(uint256 amount) external onlyOwner {
        maxAllowedSpend = amount;
    }

    /**
     * @param provider  Raw provider address; the mock hashes it internally to match
     *                  the bytes32 serviceProvider expected by checkSpendingRules.
     */
    function setProviderBlocked(address provider, bool blocked) external onlyOwner {
        _blockedProviders[keccak256(abi.encodePacked(provider))] = blocked;
    }

    function checkSpendingRules(
        bytes32, /* sessionId */
        uint256 amount,
        bytes32 serviceProvider
    ) external view returns (bool) {
        return !_blockedProviders[serviceProvider] && amount <= maxAllowedSpend;
    }

    // ─── Token helpers ─────────────────────────────────────────────────

    function approveSpender(
        address token,
        address spender,
        uint256 amount
    ) external onlyOwner {
        IERC20(token).approve(spender, amount);
    }
}