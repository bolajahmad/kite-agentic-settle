// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @dev Minimal interface so IdentityRegistry can verify that a wallet contract
 *      has the given user registered, enabling the proxy pattern for session
 *      registration via wallet.addSessionKeyRule().
 */
interface IRegisteredWallet {
    function isRegistered(address user) external view returns (bool);
}

/**
 * @title IdentityRegistry
 * @notice ERC-8004 compliant identity registry for Kite agents.
 *
 *         Each agent is an ERC-721 NFT:
 *           - agentId  = tokenId  (auto-incrementing)
 *           - agentURI = tokenURI (IPFS / HTTPS / data URI pointing to
 *                                  ERC-8004 registration file)
 *
 *         Sessions are stored here — NOT in the wallet. Both KiteAAWallet and
 *         PaymentChannel read session rules from this registry before
 *         authorising any payment.
 *
 *         The reserved `agentWallet` metadata key maps an agent to a
 *         (walletContract, userAddress) pair representing the user's balance
 *         inside a KiteAAWallet. This is where payment flows, not an EOA.
 */
contract IdentityRegistry is ERC721URIStorage, EIP712 {
    using ECDSA for bytes32;

    // ─── Storage ───────────────────────────────────────────────────────
    uint256 private _nextTokenId;

    // agentId => arbitrary on-chain KV metadata
    mapping(uint256 => mapping(string => bytes)) private _metadata;

    // agentId => (walletContract, userAddress) — the payment destination
    struct AgentWallet {
        address walletContract;
        address user; // user's balance inside walletContract
    }
    mapping(uint256 => AgentWallet) private _agentWallets;

    // ── Sessions ───────────────────────────────────────────────────────

    struct SessionRule {
        uint256 agentId;
        address user; // EOA that owns this session
        address walletContract; // KiteAAWallet where user's funds live
        uint256 valueLimit; // max per-tx spend (token units)
        uint256 maxValueAllowed; // lifetime spend cap for this session key
        uint256 validUntil; // expiry timestamp
        uint256[] blockedAgents; // agentIds that cannot use this session key
        bool active;
    }

    // session key address => rule
    mapping(address => SessionRule) private _sessions;

    // agentId => list of session key addresses
    mapping(uint256 => address[]) private _agentSessions;

    // ── EIP-712 type hash for agentWallet proof ─────────────────────
    bytes32 private constant SET_WALLET_TYPEHASH =
        keccak256(
            "SetAgentWallet(uint256 agentId,address walletContract,address user,uint256 deadline)"
        );

    // ─── Events ────────────────────────────────────────────────────────

    event Registered(
        uint256 indexed agentId,
        string agentURI,
        address indexed owner
    );
    event URIUpdated(
        uint256 indexed agentId,
        string newURI,
        address indexed updatedBy
    );
    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );
    event AgentWalletSet(
        uint256 indexed agentId,
        address indexed walletContract,
        address indexed user
    );
    event AgentWalletCleared(uint256 indexed agentId);
    event SessionRegistered(
        uint256 indexed agentId,
        address indexed sessionKey,
        address indexed user,
        address walletContract,
        uint256 valueLimit,
        uint256 maxValueAllowed,
        uint256 validUntil
    );
    event SessionRevoked(uint256 indexed agentId, address indexed sessionKey);

    // ─── Constructor ───────────────────────────────────────────────────

    constructor() ERC721("Kite Agent", "KITE") EIP712("IdentityRegistry", "1") {
        _nextTokenId = 1;
    }

    // ─── ERC-8004 Registration ─────────────────────────────────────────

    /**
     * @notice Mint a new agent NFT. agentId is assigned automatically.
     * @param agentURI  URI resolving to the ERC-8004 registration JSON file.
     * @return agentId  The newly minted tokenId.
     */
    function register(
        string calldata agentURI
    ) external returns (uint256 agentId) {
        agentId = _nextTokenId++;
        _safeMint(msg.sender, agentId);
        _setTokenURI(agentId, agentURI);
        emit Registered(agentId, agentURI, msg.sender);
    }

    /**
     * @notice Mint without URI (set later via setAgentURI).
     */
    function register() external returns (uint256 agentId) {
        agentId = _nextTokenId++;
        _safeMint(msg.sender, agentId);
        emit Registered(agentId, "", msg.sender);
    }

    /**
     * @notice Update the agentURI. Only the owner or an approved operator.
     */
    function setAgentURI(uint256 agentId, string calldata newURI) external {
        require(
            _isAuthorized(ownerOf(agentId), msg.sender, agentId),
            "Not authorized"
        );
        _setTokenURI(agentId, newURI);
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    // ─── On-chain Metadata (ERC-8004) ──────────────────────────────────
    function getMetadata(
        uint256 agentId,
        string memory metadataKey
    ) external view returns (bytes memory) {
        require(_ownerOf(agentId) != address(0), "Agent does not exist");
        return _metadata[agentId][metadataKey];
    }

    function setMetadata(
        uint256 agentId,
        string calldata metadataKey,
        bytes calldata metadataValue
    ) external {
        require(
            _isAuthorized(ownerOf(agentId), msg.sender, agentId),
            "Not authorized"
        );
        require(
            keccak256(bytes(metadataKey)) != keccak256(bytes("agentWallet")),
            "Use setAgentWallet for agentWallet key"
        );
        _metadata[agentId][metadataKey] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    // ─── Agent Wallet (reserved metadata) ──────────────────────────────
    /**
     * @notice Link an agent to a (walletContract, user) payment destination.
     *         The caller must prove control of `newWallet` via an EIP-712 signature
     *         from the `user` address, tying agent identity to a specific user
     *         balance within a KiteAAWallet contract.
     *
     * @param agentId         The agent NFT
     * @param walletContract  The KiteAAWallet contract address
     * @param user            The EOA whose balance inside walletContract receives payments
     * @param deadline        Signature expiry
     * @param signature       EIP-712 sig from `user` over (agentId, walletContract, user, deadline)
     */
    function setAgentWallet(
        uint256 agentId,
        address walletContract,
        address user,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(
            _isAuthorized(ownerOf(agentId), msg.sender, agentId),
            "Not authorized"
        );
        require(block.timestamp <= deadline, "Signature expired");
        require(
            walletContract != address(0) && user != address(0),
            "Invalid wallet"
        );

        bytes32 structHash = keccak256(
            abi.encode(
                SET_WALLET_TYPEHASH,
                agentId,
                walletContract,
                user,
                deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(signature);
        require(signer == user, "Invalid user signature");

        _agentWallets[agentId] = AgentWallet({
            walletContract: walletContract,
            user: user
        });
        emit AgentWalletSet(agentId, walletContract, user);
    }

    function getAgentWallet(
        uint256 agentId
    ) external view returns (address walletContract, address user) {
        AgentWallet storage w = _agentWallets[agentId];
        return (w.walletContract, w.user);
    }

    function unsetAgentWallet(uint256 agentId) external {
        require(
            _isAuthorized(ownerOf(agentId), msg.sender, agentId),
            "Not authorized"
        );
        delete _agentWallets[agentId];
        emit AgentWalletCleared(agentId);
    }

    // Clear agentWallet on transfer (ERC-8004 requirement)
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0) && from != to) {
            // Transfer: clear agent wallet
            delete _agentWallets[tokenId];
            emit AgentWalletCleared(tokenId);
        }
        return from;
    }

    // ─── Sessions ──────────────────────────────────────────────────────

    /**
     * @notice Register or update a session key for an agent.
     *
     *         Called by either:
     *           (a) The agent's NFT owner (EOA) directly, OR
     *           (b) A KiteAAWallet that the owner has delegated session management to.
     *
     *         The session rule lives here — KiteAAWallet and PaymentChannel
     *         read it from this contract.
     *
     * @param agentId           The agent NFT this session belongs to
     * @param sessionKey        The ephemeral key address
     * @param user              EOA whose balance is debited
     * @param walletContract    KiteAAWallet where user's funds live
     * @param valueLimit        Max spend per transaction
     * @param maxValueAllowed   Lifetime spend cap for this session key
     * @param validUntil        Expiry timestamp
     * @param blockedAgents     agentIds that may NOT use this session key
     */
    function registerSession(
        uint256 agentId,
        address sessionKey,
        address user,
        address walletContract,
        uint256 valueLimit,
        uint256 maxValueAllowed,
        uint256 validUntil,
        uint256[] calldata blockedAgents
    ) external {
        require(_ownerOf(agentId) != address(0), "Agent does not exist");
        // Caller must be the NFT owner, an approved operator, the linked walletContract,
        // or any wallet where the session user IS the agent owner (proxy pattern).
        address agentOwner = ownerOf(agentId);
        require(
            msg.sender == agentOwner ||
                isApprovedForAll(agentOwner, msg.sender) ||
                getApproved(agentId) == msg.sender ||
                (_agentWallets[agentId].walletContract == msg.sender &&
                    _agentWallets[agentId].user == user) ||
                _isWalletProxyForOwner(walletContract, user, agentOwner),
            "Not authorized to register session"
        );
        require(sessionKey != address(0), "Invalid session key");
        require(validUntil > block.timestamp, "Expiry must be in future");
        require(valueLimit > 0, "valueLimit must be > 0");
        require(
            maxValueAllowed >= valueLimit,
            "maxValueAllowed must be >= valueLimit"
        );

        _sessions[sessionKey] = SessionRule({
            agentId: agentId,
            user: user,
            walletContract: walletContract,
            valueLimit: valueLimit,
            maxValueAllowed: maxValueAllowed,
            validUntil: validUntil,
            blockedAgents: blockedAgents,
            active: true
        });

        _agentSessions[agentId].push(sessionKey);

        emit SessionRegistered(
            agentId,
            sessionKey,
            user,
            walletContract,
            valueLimit,
            maxValueAllowed,
            validUntil
        );
    }

    /**
     * @notice Revoke a session key. Only the NFT owner or the session's user.
     */
    function revokeSession(address sessionKey) external {
        SessionRule storage s = _sessions[sessionKey];
        require(s.active, "Session not active");
        address agentOwner = ownerOf(s.agentId);
        require(
            msg.sender == agentOwner ||
                isApprovedForAll(agentOwner, msg.sender) ||
                getApproved(s.agentId) == msg.sender ||
                msg.sender == s.user ||
                msg.sender == s.walletContract,
            "Not authorized to revoke"
        );
        uint256 agentId = s.agentId;
        s.active = false;
        emit SessionRevoked(agentId, sessionKey);
    }

    // ─── Session View Functions ─────────────────────────────────────────

    /**
     * @notice Validate a session key. Returns all fields needed by callers.
     *         Used by KiteAAWallet (validateUserOp) and PaymentChannel (openChannel).
     */
    function validateSession(
        address sessionKey
    )
        external
        view
        returns (
            bool active,
            uint256 agentId,
            address user,
            address walletContract,
            uint256 valueLimit,
            uint256 maxValueAllowed,
            uint256 validUntil
        )
    {
        SessionRule storage s = _sessions[sessionKey];
        active = s.active && block.timestamp <= s.validUntil;
        agentId = s.agentId;
        user = s.user;
        walletContract = s.walletContract;
        valueLimit = s.valueLimit;
        maxValueAllowed = s.maxValueAllowed;
        validUntil = s.validUntil;
    }

    /**
     * @notice Raw session data (without timestamp-based active check).
     */
    function getSession(
        address sessionKey
    ) external view returns (SessionRule memory) {
        return _sessions[sessionKey];
    }

    /**
     * @notice Returns true when the given agentId is in the session's blocked list.
     */
    function isAgentBlocked(
        address sessionKey,
        uint256 agentId
    ) external view returns (bool) {
        uint256[] storage blocked = _sessions[sessionKey].blockedAgents;
        for (uint256 i = 0; i < blocked.length; i++) {
            if (blocked[i] == agentId) return true;
        }
        return false;
    }

    /**
     * @notice All session keys ever registered for an agent (may include revoked).
     */
    function getAgentSessions(
        uint256 agentId
    ) external view returns (address[] memory) {
        return _agentSessions[agentId];
    }

    // ─── Convenience ───────────────────────────────────────────────────

    function totalAgents() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function agentURI(uint256 agentId) external view returns (string memory) {
        return tokenURI(agentId);
    }

    // ─── Internal helpers ──────────────────────────────────────────────

    /**
     * @dev Returns true when a wallet CONTRACT (identified by walletContract being
     *      the actual caller via msg.sender) proxies a session registration on
     *      behalf of `user`, and `user` is both the agent owner AND registered in
     *      that wallet.  EOAs are rejected because they have no code.
     */
    function _isWalletProxyForOwner(
        address walletContract,
        address user,
        address agentOwner
    ) internal view returns (bool) {
        if (walletContract != msg.sender) return false; // caller must be the wallet
        if (walletContract.code.length == 0) return false; // must be a contract, not EOA
        if (user != agentOwner) return false; // user must own the agent NFT
        try IRegisteredWallet(walletContract).isRegistered(user) returns (
            bool ok
        ) {
            return ok;
        } catch {
            return false;
        }
    }
}
