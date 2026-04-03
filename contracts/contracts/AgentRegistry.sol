// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentRegistry
 * @notice On-chain registry for Kite agent identities. Maps agent DIDs to
 *         wallet addresses and session keys. Provides permissionless identity
 *         resolution matching Kite's architecture:
 *
 *         - GetAgent(agentId)
 *         - ResolveAgentByDomain(domain)
 *         - ResolveAgentByAddress(agentAddress)
 *         - GetAgentBySession(sessionKey)
 *
 *         Sets a standard for the Kite ecosystem where the official SDK
 *         does not yet expose these resolution functions.
 */
contract AgentRegistry is Ownable {

    struct AgentInfo {
        bytes32 agentId;
        string  agentDomain;       // e.g. "alice.eth/chatgpt/portfolio-v1"
        address agentAddress;      // BIP-32 derived agent address
        address walletContract;    // KiteAgentWallet that funds this agent
        address ownerAddress;      // user EOA that controls this agent
        bool    active;
    }

    struct SessionInfo {
        bytes32 agentId;
        address sessionKey;
        uint256 validUntil;
        bool    active;
    }

    // agentId => AgentInfo
    mapping(bytes32 => AgentInfo) public agents;
    // domain string hash => agentId
    mapping(bytes32 => bytes32) public domainToAgent;
    // agent address => agentId
    mapping(address => bytes32) public addressToAgent;
    // session key => SessionInfo
    mapping(address => SessionInfo) public sessionToAgent;
    // owner address => list of agentIds
    mapping(address => bytes32[]) public ownerAgents;

    bytes32[] public allAgentIds;

    event AgentRegistered(
        bytes32 indexed agentId,
        string agentDomain,
        address indexed agentAddress,
        address indexed walletContract,
        address ownerAddress
    );
    event AgentDeactivated(bytes32 indexed agentId);
    event SessionRegistered(bytes32 indexed agentId, address indexed sessionKey, uint256 validUntil);
    event SessionDeactivated(address indexed sessionKey);

    constructor() Ownable(msg.sender) {}

    // ─── Registration ──────────────────────────────────────────────────

    /**
     * @notice Register an agent. Can be called by the user (owner of the agent)
     *         or by a KiteAgentWallet on behalf of the user.
     */
    function registerAgent(
        bytes32 agentId,
        string calldata agentDomain,
        address agentAddress,
        address walletContract
    ) external {
        require(agents[agentId].agentAddress == address(0), "Agent already registered");
        require(agentAddress != address(0), "Invalid agent address");

        bytes32 domainHash = keccak256(abi.encodePacked(agentDomain));

        agents[agentId] = AgentInfo({
            agentId: agentId,
            agentDomain: agentDomain,
            agentAddress: agentAddress,
            walletContract: walletContract,
            ownerAddress: msg.sender,
            active: true
        });

        domainToAgent[domainHash] = agentId;
        addressToAgent[agentAddress] = agentId;
        ownerAgents[msg.sender].push(agentId);
        allAgentIds.push(agentId);

        emit AgentRegistered(agentId, agentDomain, agentAddress, walletContract, msg.sender);
    }

    function deactivateAgent(bytes32 agentId) external {
        AgentInfo storage agent = agents[agentId];
        require(agent.ownerAddress == msg.sender, "Not agent owner");
        agent.active = false;
        emit AgentDeactivated(agentId);
    }

    // ─── Session Registration ──────────────────────────────────────────

    /**
     * @notice Register a session key for an agent. Typically called after
     *         addSessionKeyRule on KiteAgentWallet so the registry knows
     *         which sessions map to which agents.
     */
    function registerSession(
        bytes32 agentId,
        address sessionKey,
        uint256 validUntil
    ) external {
        AgentInfo storage agent = agents[agentId];
        require(agent.active, "Agent not active");
        require(
            agent.ownerAddress == msg.sender || agent.walletContract == msg.sender,
            "Not authorized"
        );

        sessionToAgent[sessionKey] = SessionInfo({
            agentId: agentId,
            sessionKey: sessionKey,
            validUntil: validUntil,
            active: true
        });

        emit SessionRegistered(agentId, sessionKey, validUntil);
    }

    function deactivateSession(address sessionKey) external {
        SessionInfo storage session = sessionToAgent[sessionKey];
        AgentInfo storage agent = agents[session.agentId];
        require(
            agent.ownerAddress == msg.sender || agent.walletContract == msg.sender,
            "Not authorized"
        );
        session.active = false;
        emit SessionDeactivated(sessionKey);
    }

    // ─── Resolution Functions (Permissionless) ─────────────────────────

    function getAgent(bytes32 agentId) external view returns (
        string memory agentDomain,
        address agentAddress,
        address walletContract,
        address ownerAddr,
        bool active
    ) {
        AgentInfo storage a = agents[agentId];
        return (a.agentDomain, a.agentAddress, a.walletContract, a.ownerAddress, a.active);
    }

    function resolveAgentByDomain(string calldata domain) external view returns (
        bytes32 agentId,
        address agentAddress,
        address walletContract,
        bool active
    ) {
        bytes32 domainHash = keccak256(abi.encodePacked(domain));
        bytes32 id = domainToAgent[domainHash];
        AgentInfo storage a = agents[id];
        return (id, a.agentAddress, a.walletContract, a.active);
    }

    function resolveAgentByAddress(address agentAddr) external view returns (
        bytes32 agentId,
        string memory agentDomain,
        address walletContract,
        bool active
    ) {
        bytes32 id = addressToAgent[agentAddr];
        AgentInfo storage a = agents[id];
        return (id, a.agentDomain, a.walletContract, a.active);
    }

    function getAgentBySession(address sessionKey) external view returns (
        bytes32 agentId,
        string memory agentDomain,
        address agentAddress,
        bool agentActive,
        bool sessionActive,
        uint256 sessionValidUntil
    ) {
        SessionInfo storage s = sessionToAgent[sessionKey];
        AgentInfo storage a = agents[s.agentId];
        return (
            s.agentId,
            a.agentDomain,
            a.agentAddress,
            a.active,
            s.active && block.timestamp <= s.validUntil,
            s.validUntil
        );
    }

    function getOwnerAgents(address ownerAddr) external view returns (bytes32[] memory) {
        return ownerAgents[ownerAddr];
    }

    function totalAgents() external view returns (uint256) {
        return allAgentIds.length;
    }
}
