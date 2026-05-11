// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IClientAgentVault
 * @notice Interface for the Kite AI AA wallet (GokiteAccount / ClientAgentVault).
 *
 *         Sessions are identified by a bytes32 sessionId derived deterministically:
 *           sessionId = keccak256(abi.encodePacked(sessionKey, agentId, validUntil))
 *
 *         Provider addresses used in spending rules are stored as their keccak256 hash:
 *           hashedProvider = keccak256(abi.encodePacked(providerAddress))
 */
interface IClientAgentVault {
    // ─── Session management ────────────────────────────────────────────

    struct Rule {
        uint256 timeWindow;
        uint160 budget;
        uint96 initialWindowStartTime;
        bytes32[] targetProviders; // keccak256(abi.encodePacked(address)) for each provider
    }

    function createSession(
        bytes32 sessionId,
        address agent,
        Rule[] calldata rules
    ) external;

    function addSpendingRules(
        bytes32 sessionId,
        Rule[] calldata rules
    ) external;

    function removeSession(bytes32 sessionId) external;

    function setSessionAgent(bytes32 sessionId, address agent) external;

    // ─── Session queries ───────────────────────────────────────────────

    /**
     * @notice Returns true when a session with the given id exists on the vault.
     * @param sessionId keccak256(abi.encodePacked(sessionKey, agentId, validUntil))
     */
    function sessionExists(bytes32 sessionId) external view returns (bool);

    /**
     * @notice Returns the agent (session key) address for a given sessionId.
     */
    function getSessionAgent(bytes32 sessionId) external view returns (address);

    /**
     * @notice Check whether a transfer is permitted by the session's spending rules.
     * @param sessionId          keccak256(abi.encodePacked(sessionKey, agentId, validUntil))
     * @param normalizedAmount   Amount normalised to STANDARD_DECIMALS (6)
     * @param serviceProvider    keccak256(abi.encodePacked(providerAddress))
     */
    function checkSpendingRules(
        bytes32 sessionId,
        uint256 normalizedAmount,
        bytes32 serviceProvider
    ) external view returns (bool);

    // ─── Token / balance queries ───────────────────────────────────────

    function getAvailableBalance(address token) external view returns (uint256);

    function isTokenSupported(address token) external view returns (bool);

    function getTokenDecimals(address token) external view returns (uint8);

    // ─── ERC-4337 ─────────────────────────────────────────────────────

    function addDeposit() external payable;

    function getDeposit() external view returns (uint256);

    function owner() external view returns (address);
}
