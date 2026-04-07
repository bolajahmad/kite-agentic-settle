// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentRegistry
 * @notice On-chain registry for Kite agent identities. Maps agent IDs to
 *         wallet addresses and session keys. Provides permissionless identity
 *         resolution matching Kite's architecture:
 *
 *         - GetAgent(agentId)
 *         - ResolveAgentByAddress(agentAddress)
 *         - GetAgentBySession(sessionKey)
 *         - GetOwnerAgents(ownerAddress)
 *
 *         Agent IDs are deterministically derived on-chain from
 *         (agentAddress, walletContract, msg.sender, nonce).
 *         Metadata is emitted in events; only its keccak256 hash is stored.
 */
contract AgentRegistry is Ownable {

    struct AgentInfo {
        bytes32 agentId;
        bytes32 metadataHash;      // keccak256 of the metadata bytes
        address agentAddress;      // BIP-32 derived agent address
        address walletContract;    // KiteAAWallet that funds this agent
        address ownerAddress;      // user EOA that controls this agent
        uint256 agentIndex;        // derivation index for deterministic key regeneration
        bool    active;
    }

    struct SessionInfo {
        bytes32 agentId;
        address sessionKey;
        uint256 sessionIndex;      // derivation index for deterministic key regeneration
        uint256 validUntil;
        bool    active;
    }

    // agentId => AgentInfo
    mapping(bytes32 => AgentInfo) public agents;
    // agent address => agentId
    mapping(address => bytes32) public addressToAgent;
    // session key => SessionInfo
    mapping(address => SessionInfo) public sessionToAgent;
    // owner address => list of agentIds
    mapping(address => bytes32[]) public ownerAgents;

    uint256 public nonce;

    event AgentRegistered(
        bytes32 indexed agentId,
        address indexed agentAddress,
        address indexed walletContract,
        address ownerAddress,
        uint256 agentIndex,
        bytes   metadata
    );
    event AgentDeactivated(bytes32 indexed agentId);
    event SessionRegistered(bytes32 indexed agentId, address indexed sessionKey, uint256 sessionIndex, uint256 validUntil);
    event SessionDeactivated(address indexed sessionKey);

    constructor() Ownable(msg.sender) {
        nonce = 1;
    }

    // ─── Registration ──────────────────────────────────────────────────

    /**
     * @notice Register an agent. Called by the EOA that owns the agent.
     *         The agentId is derived on-chain from (agentAddress, walletContract, msg.sender, nonce).
     *         Metadata is emitted in the event; only its hash is stored.
     * @param agentAddress The agent's address (e.g. BIP-32 derived)
     * @param walletContract The KiteAAWallet that funds this agent
     * @param metadata Arbitrary bytes encoding agent metadata (name, description, etc.)
     * @return agentId The deterministically generated agent identifier
     */
    function registerAgent(
        address agentAddress,
        address walletContract,
        uint256 agentIndex,
        bytes calldata metadata
    ) external returns (bytes32) {
        require(agentAddress != address(0), "Invalid agent address");
        require(walletContract != address(0), "Invalid wallet contract");
        require(addressToAgent[agentAddress] == bytes32(0), "Agent address already registered");

        bytes32 agentId = keccak256(abi.encodePacked(agentAddress, walletContract, msg.sender, nonce));
        require(agents[agentId].agentAddress == address(0), "Agent ID collision");

        agents[agentId] = AgentInfo({
            agentId: agentId,
            metadataHash: keccak256(metadata),
            agentAddress: agentAddress,
            walletContract: walletContract,
            ownerAddress: msg.sender,
            agentIndex: agentIndex,
            active: true
        });

        addressToAgent[agentAddress] = agentId;
        ownerAgents[msg.sender].push(agentId);
        nonce++;

        emit AgentRegistered(agentId, agentAddress, walletContract, msg.sender, agentIndex, metadata);

        return agentId;
    }

    function deactivateAgent(bytes32 agentId) external {
        AgentInfo storage agent = agents[agentId];
        require(agent.ownerAddress == msg.sender, "Not agent owner");
        agent.active = false;
        emit AgentDeactivated(agentId);
    }

    // ─── Session Registration ──────────────────────────────────────────

    /**
     * @notice Register or update a session key for an agent. Only callable by
     *         the agent's walletContract (KiteAAWallet) to keep session state
     *         in sync between wallet rules and registry records.
     *         If the session already exists, it updates validUntil and reactivates it.
     */
    function registerSession(
        bytes32 agentId,
        address sessionKey,
        uint256 sessionIndex,
        uint256 validUntil
    ) external {
        AgentInfo storage agent = agents[agentId];
        require(agent.active, "Agent not active");
        require(agent.walletContract == msg.sender, "Only wallet contract");

        sessionToAgent[sessionKey] = SessionInfo({
            agentId: agentId,
            sessionKey: sessionKey,
            sessionIndex: sessionIndex,
            validUntil: validUntil,
            active: true
        });

        emit SessionRegistered(agentId, sessionKey, sessionIndex, validUntil);
    }

    function deactivateSession(address sessionKey) external {
        SessionInfo storage session = sessionToAgent[sessionKey];
        AgentInfo storage agent = agents[session.agentId];
        require(agent.walletContract == msg.sender, "Only wallet contract");
        session.active = false;
        emit SessionDeactivated(sessionKey);
    }

    // ─── Resolution Functions (Permissionless) ─────────────────────────

    function getAgent(bytes32 agentId) external view returns (
        bytes32 metadataHash,
        address agentAddress,
        address walletContract,
        address ownerAddr,
        uint256 agentIndex,
        bool active
    ) {
        AgentInfo storage a = agents[agentId];
        return (a.metadataHash, a.agentAddress, a.walletContract, a.ownerAddress, a.agentIndex, a.active);
    }

    function resolveAgentByAddress(address agentAddr) external view returns (
        bytes32 agentId,
        bytes32 metadataHash,
        address walletContract,
        address ownerAddr,
        uint256 agentIndex,
        bool active
    ) {
        bytes32 id = addressToAgent[agentAddr];
        AgentInfo storage a = agents[id];
        return (id, a.metadataHash, a.walletContract, a.ownerAddress, a.agentIndex, a.active);
    }

    function getAgentBySession(address sessionKey) external view returns (
        bytes32 agentId,
        bytes32 metadataHash,
        address agentAddress,
        uint256 agentIndex,
        uint256 sessionIndex,
        bool agentActive,
        bool sessionActive,
        uint256 sessionValidUntil
    ) {
        SessionInfo storage s = sessionToAgent[sessionKey];
        AgentInfo storage a = agents[s.agentId];
        return (
            s.agentId,
            a.metadataHash,
            a.agentAddress,
            a.agentIndex,
            s.sessionIndex,
            a.active,
            s.active && block.timestamp <= s.validUntil,
            s.validUntil
        );
    }

    function getOwnerAgents(address ownerAddr) external view returns (bytes32[] memory) {
        return ownerAgents[ownerAddr];
    }

    function totalAgents() external view returns (uint256) {
        return nonce - 1;
    }
}
