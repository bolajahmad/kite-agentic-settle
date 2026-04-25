// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IIdentityRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);

    function isApprovedForAll(
        address owner,
        address operator
    ) external view returns (bool);

    function getApproved(uint256 tokenId) external view returns (address);
}

/**
 * @title AttestationRegistry
 * @notice EIP-8004 compliant reputation and validation registry for Kite agents.
 *
 *         Three subsystems live in this contract:
 *
 *         1. Reputation Registry (EIP-8004 §4 — Reputation)
 *            Feedback between agents / clients. Any address can give feedback
 *            to any registered agent. Feedback can be revoked by the giver.
 *            Agents can append a response to each feedback entry.
 *
 *         2. Validation Registry (EIP-8004 §5 — Validation)
 *            Agent-to-agent validation on explicit request. The agent (NFT owner)
 *            requests validation from a specified validator. The validator
 *            responds with a numeric score (0–100).
 *
 *         3. Merkle Extension (Kite-specific)
 *            Anchors off-chain usage Merkle roots as evidence of API activity.
 *            Anchoring internally creates a validation request so off-chain
 *            systems can confirm / respond. Stateless Merkle proof verification
 *            is also exposed.
 */
contract AttestationRegistry is Ownable {
    IIdentityRegistry public identityRegistry;

    // ─── Authorized Submitters ─────────────────────────────────────────
    mapping(address => bool) public authorizedSubmitters;

    // ─── 1. Reputation Registry ────────────────────────────────────────
    struct Feedback {
        address giver;
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        string endpoint;
        string feedbackURI;
        bytes32 feedbackHash;
        string responseURI;
        bytes32 responseHash;
        bool hasResponse;
        bool isRevoked;
        uint64 feedbackIndex;
        uint256 createdAt;
    }

    // agentId => giver => list of feedback
    mapping(uint256 => mapping(address => Feedback[])) private _feedback;
    // agentId => list of givers (for enumeration)
    mapping(uint256 => address[]) private _agentGivers;
    // agentId => giver => already in givers list?
    mapping(uint256 => mapping(address => bool)) private _giverTracked;

    // ─── 2. Validation Registry ────────────────────────────────────────
    struct ValidationRecord {
        address validatorAddress;
        uint256 agentId;
        string requestURI;
        bytes32 requestHash;
        uint8 response; // 0 = failed, 100 = passed, or intermediate
        string responseURI;
        bytes32 responseHash;
        string tag;
        uint256 requestedAt;
        uint256 lastUpdate;
        bool responded;
    }

    // keccak256(requestHash) => record
    mapping(bytes32 => ValidationRecord) private _validations;
    // agentId => list of requestHashes
    mapping(uint256 => bytes32[]) private _agentValidations;
    // validator => list of requestHashes
    mapping(address => bytes32[]) private _validatorRequests;

    // ─── 3. Merkle Extension ───────────────────────────────────────────
    struct MerkleAnchor {
        uint256 agentId;
        bytes32 merkleRoot;
        uint256 logCount;
        string ipfsURI;
        address validator;
        uint256 anchoredAt;
        bytes32 validationKey; // key into _validations
    }

    // merkleRoot => anchor
    mapping(bytes32 => MerkleAnchor) private _anchors;
    // agentId => list of merkle roots
    mapping(uint256 => bytes32[]) private _agentRoots;

    // ─── Events ────────────────────────────────────────────────────────

    // Reputation
    event FeedbackGiven(
        uint256 indexed agentId,
        address indexed giver,
        uint64 indexed feedbackIndex,
        int128 value,
        uint8 valueDecimals,
        string tag1,
        string tag2
    );
    event FeedbackRevoked(
        uint256 indexed agentId,
        address indexed giver,
        uint64 indexed feedbackIndex
    );
    event ResponseAppended(
        uint256 indexed agentId,
        address indexed giver,
        uint64 indexed feedbackIndex
    );
    // Validation
    event ValidationRequested(
        bytes32 indexed requestKey,
        uint256 indexed agentId,
        address indexed validatorAddress,
        bytes32 requestHash
    );
    event ValidationResponded(
        bytes32 indexed requestKey,
        address indexed validatorAddress,
        uint8 response,
        string tag
    );
    // Merkle
    event MerkleRootAnchored(
        uint256 indexed agentId,
        bytes32 indexed merkleRoot,
        uint256 logCount,
        string ipfsURI,
        address validator
    );
    // Admin
    event SubmitterAdded(address indexed submitter);
    event SubmitterRemoved(address indexed submitter);
    event IdentityRegistryUpdated(address indexed registry);

    // ─── Constructor ───────────────────────────────────────────────────

    constructor(address _identityRegistry) Ownable(msg.sender) {
        require(_identityRegistry != address(0), "Invalid registry");
        identityRegistry = IIdentityRegistry(_identityRegistry);
    }

    // ─── Admin ─────────────────────────────────────────────────────────

    function setIdentityRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry");
        identityRegistry = IIdentityRegistry(_registry);
        emit IdentityRegistryUpdated(_registry);
    }

    function addSubmitter(address submitter) external onlyOwner {
        require(submitter != address(0), "Invalid submitter");
        authorizedSubmitters[submitter] = true;
        emit SubmitterAdded(submitter);
    }

    function removeSubmitter(address submitter) external onlyOwner {
        authorizedSubmitters[submitter] = false;
        emit SubmitterRemoved(submitter);
    }

    // ─── Internal Helpers ──────────────────────────────────────────────

    function _isAgentAuthorized(
        uint256 agentId,
        address caller
    ) internal view returns (bool) {
        address agentOwner = identityRegistry.ownerOf(agentId);
        return (caller == agentOwner ||
            identityRegistry.isApprovedForAll(agentOwner, caller) ||
            identityRegistry.getApproved(agentId) == caller);
    }

    // ─── 1. Reputation Registry ────────────────────────────────────────

    /**
     * @notice Give feedback to an agent.
     *         Any address can give feedback. Multiple entries per (agentId, giver) allowed.
     *
     * @param agentId       Target agent's NFT tokenId
     * @param value         Numeric feedback value (signed, scaled by valueDecimals)
     * @param valueDecimals Decimal places of value
     * @param tag1          Primary tag (e.g. "quality")
     * @param tag2          Secondary tag (e.g. "speed")
     * @param endpoint      Service endpoint the feedback is about
     * @param feedbackURI   Off-chain URI with extended feedback details
     * @param feedbackHash  keccak256 of the off-chain feedback document
     */
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        // Agent must exist
        identityRegistry.ownerOf(agentId); // reverts if not minted

        Feedback[] storage list = _feedback[agentId][msg.sender];
        uint64 idx = uint64(list.length);

        list.push(
            Feedback({
                giver: msg.sender,
                value: value,
                valueDecimals: valueDecimals,
                tag1: tag1,
                tag2: tag2,
                endpoint: endpoint,
                feedbackURI: feedbackURI,
                feedbackHash: feedbackHash,
                responseURI: "",
                responseHash: bytes32(0),
                hasResponse: false,
                isRevoked: false,
                feedbackIndex: idx,
                createdAt: block.timestamp
            })
        );

        if (!_giverTracked[agentId][msg.sender]) {
            _giverTracked[agentId][msg.sender] = true;
            _agentGivers[agentId].push(msg.sender);
        }

        emit FeedbackGiven(
            agentId,
            msg.sender,
            idx,
            value,
            valueDecimals,
            tag1,
            tag2
        );
    }

    /**
     * @notice Revoke a previously given feedback entry. Only the original giver.
     */
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        Feedback[] storage list = _feedback[agentId][msg.sender];
        require(feedbackIndex < list.length, "Invalid feedbackIndex");
        require(!list[feedbackIndex].isRevoked, "Already revoked");
        list[feedbackIndex].isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    /**
     * @notice Agent appends a response to a specific feedback entry.
     *         Only the agent NFT owner or operator can respond.
     */
    function appendResponse(
        uint256 agentId,
        address giver,
        uint64 feedbackIndex,
        string calldata responseURI,
        bytes32 responseHash
    ) external {
        require(_isAgentAuthorized(agentId, msg.sender), "Not authorized");
        Feedback[] storage list = _feedback[agentId][giver];
        require(feedbackIndex < list.length, "Invalid feedbackIndex");
        require(!list[feedbackIndex].isRevoked, "Feedback is revoked");
        require(!list[feedbackIndex].hasResponse, "Response already appended");
        list[feedbackIndex].responseURI = responseURI;
        list[feedbackIndex].responseHash = responseHash;
        list[feedbackIndex].hasResponse = true;
        emit ResponseAppended(agentId, giver, feedbackIndex);
    }

    /**
     * @notice Read a specific feedback entry.
     */
    function readFeedback(
        uint256 agentId,
        address giver,
        uint64 feedbackIndex
    )
        external
        view
        returns (
            int128 value,
            uint8 valueDecimals,
            string memory tag1,
            string memory tag2,
            bool isRevoked,
            bool hasResponse,
            string memory responseURI
        )
    {
        Feedback[] storage list = _feedback[agentId][giver];
        require(feedbackIndex < list.length, "Invalid feedbackIndex");
        Feedback storage f = list[feedbackIndex];
        return (
            f.value,
            f.valueDecimals,
            f.tag1,
            f.tag2,
            f.isRevoked,
            f.hasResponse,
            f.responseURI
        );
    }

    /**
     * @notice Aggregate feedback summary for an agent.
     *         Skips revoked entries. Optionally filter by tag1 and/or tag2.
     *
     * @param agentId          Target agent
     * @param giverAddresses   Addresses to aggregate from (empty = all givers)
     * @param tag1             Tag filter (empty = no filter)
     * @param tag2             Tag filter (empty = no filter)
     * @return count           Number of non-revoked matching entries
     * @return summaryValue    Sum of matching values (scaled)
     * @return summaryValueDecimals Decimal places of summaryValue
     */
    function getSummaryFeedback(
        uint256 agentId,
        address[] calldata giverAddresses,
        string calldata tag1,
        string calldata tag2
    )
        external
        view
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)
    {
        address[] storage givers = giverAddresses.length > 0
            ? _toStorageRef(giverAddresses)
            : _agentGivers[agentId];

        bool filterTag1 = bytes(tag1).length > 0;
        bool filterTag2 = bytes(tag2).length > 0;
        bytes32 t1h = filterTag1 ? keccak256(bytes(tag1)) : bytes32(0);
        bytes32 t2h = filterTag2 ? keccak256(bytes(tag2)) : bytes32(0);
        summaryValueDecimals = 0;

        uint256 len = giverAddresses.length > 0
            ? giverAddresses.length
            : givers.length;
        for (uint256 i = 0; i < len; i++) {
            address giver = giverAddresses.length > 0
                ? giverAddresses[i]
                : givers[i];
            Feedback[] storage list = _feedback[agentId][giver];
            for (uint256 j = 0; j < list.length; j++) {
                Feedback storage f = list[j];
                if (f.isRevoked) continue;
                if (filterTag1 && keccak256(bytes(f.tag1)) != t1h) continue;
                if (filterTag2 && keccak256(bytes(f.tag2)) != t2h) continue;
                count++;
                summaryValue += f.value;
            }
        }
    }

    // Solidity doesn't allow calldata → storage assignments; use a helper that
    // returns the storage ref for agentGivers when no filter addresses given.
    function _toStorageRef(
        address[] calldata
    ) internal pure returns (address[] storage) {
        // This branch is never reached (caller guards with giverAddresses.length > 0)
        // We return a dummy storage ref; Solidity requires matching return type.
        address[] storage dummy;
        assembly {
            dummy.slot := 0
        }
        return dummy;
    }

    function getAgentGivers(
        uint256 agentId
    ) external view returns (address[] memory) {
        return _agentGivers[agentId];
    }

    function getFeedbackCount(
        uint256 agentId,
        address giver
    ) external view returns (uint256) {
        return _feedback[agentId][giver].length;
    }

    // ─── 2. Validation Registry ────────────────────────────────────────

    /**
     * @notice Request validation for an agent from a specified validator.
     *         Called by the agent NFT owner or an authorized operator.
     *
     * @param validatorAddress  The address that will call validationResponse
     * @param agentId           The agent being validated
     * @param requestURI        Off-chain URI with validation request details
     * @param requestHash       keccak256 of the off-chain request document
     */
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external returns (bytes32 requestKey) {
        require(_isAgentAuthorized(agentId, msg.sender), "Not authorized");
        require(validatorAddress != address(0), "Invalid validator");

        requestKey = keccak256(
            abi.encodePacked(
                requestHash,
                agentId,
                validatorAddress,
                block.timestamp
            )
        );
        require(
            _validations[requestKey].requestedAt == 0,
            "Request already exists"
        );

        _validations[requestKey] = ValidationRecord({
            validatorAddress: validatorAddress,
            agentId: agentId,
            requestURI: requestURI,
            requestHash: requestHash,
            response: 0,
            responseURI: "",
            responseHash: bytes32(0),
            tag: "",
            requestedAt: block.timestamp,
            lastUpdate: block.timestamp,
            responded: false
        });

        _agentValidations[agentId].push(requestKey);
        _validatorRequests[validatorAddress].push(requestKey);

        emit ValidationRequested(
            requestKey,
            agentId,
            validatorAddress,
            requestHash
        );
    }

    /**
     * @notice Respond to a validation request. Only the specified validator can call this.
     *
     * @param requestKey   The key returned by validationRequest
     * @param response     Score 0–100 (0 = fail, 100 = pass)
     * @param responseURI  Off-chain URI with response details
     * @param responseHash keccak256 of the off-chain response document
     * @param tag          Category tag for the validation
     */
    function validationResponse(
        bytes32 requestKey,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external {
        ValidationRecord storage rec = _validations[requestKey];
        require(rec.requestedAt > 0, "Request does not exist");
        require(
            msg.sender == rec.validatorAddress,
            "Not the designated validator"
        );

        rec.response = response;
        rec.responseURI = responseURI;
        rec.responseHash = responseHash;
        rec.tag = tag;
        rec.lastUpdate = block.timestamp;
        rec.responded = true;

        emit ValidationResponded(requestKey, msg.sender, response, tag);
    }

    /**
     * @notice Get the full status of a validation request.
     */
    function getValidationStatus(
        bytes32 requestKey
    )
        external
        view
        returns (
            address validatorAddress,
            uint256 agentId,
            uint8 response,
            bytes32 responseHash,
            string memory tag,
            uint256 lastUpdate,
            bool responded
        )
    {
        ValidationRecord storage rec = _validations[requestKey];
        return (
            rec.validatorAddress,
            rec.agentId,
            rec.response,
            rec.responseHash,
            rec.tag,
            rec.lastUpdate,
            rec.responded
        );
    }

    /**
     * @notice Aggregate validation summary for an agent.
     *
     * @param agentId            Target agent
     * @param validatorAddresses Filter by validator (empty = all validators)
     * @param tag                Filter by tag (empty = all tags)
     * @return count             Number of responded validations matching filter
     * @return averageResponse   Integer average of response scores
     */
    function getValidationSummary(
        uint256 agentId,
        address[] calldata validatorAddresses,
        string calldata tag
    ) external view returns (uint64 count, uint8 averageResponse) {
        bytes32[] storage keys = _agentValidations[agentId];
        bool filterValidator = validatorAddresses.length > 0;
        bool filterTag = bytes(tag).length > 0;
        bytes32 tagHash = filterTag ? keccak256(bytes(tag)) : bytes32(0);

        uint256 total = 0;
        for (uint256 i = 0; i < keys.length; i++) {
            ValidationRecord storage rec = _validations[keys[i]];
            if (!rec.responded) continue;
            if (filterTag && keccak256(bytes(rec.tag)) != tagHash) continue;
            if (
                filterValidator &&
                !_addressInList(rec.validatorAddress, validatorAddresses)
            ) continue;
            count++;
            total += rec.response;
        }

        averageResponse = count > 0 ? uint8(total / count) : 0;
    }

    function _addressInList(
        address addr,
        address[] calldata list
    ) internal pure returns (bool) {
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == addr) return true;
        }
        return false;
    }

    function getAgentValidations(
        uint256 agentId
    ) external view returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    function getValidatorRequests(
        address validatorAddress
    ) external view returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }

    // ─── 3. Merkle Extension ───────────────────────────────────────────

    /**
     * @notice Anchor an off-chain usage Merkle root as evidence.
     *         Caller must be the agent owner, an authorized operator, OR an
     *         authorized submitter (backend relayer).
     *
     *         Internally creates a ValidationRecord so the specified validator
     *         (typically the Kite backend) can confirm the root via
     *         validationResponse.
     *
     * @param agentId    The agent whose usage is being anchored
     * @param merkleRoot The Merkle root of the usage log tree
     * @param logCount   Number of log entries in the tree
     * @param ipfsURI    IPFS URI of the full usage log
     * @param validator  Address that should call validationResponse to confirm
     */
    function anchorRoot(
        uint256 agentId,
        bytes32 merkleRoot,
        uint256 logCount,
        string calldata ipfsURI,
        address validator
    ) external returns (bytes32 requestKey) {
        require(
            _isAgentAuthorized(agentId, msg.sender) ||
                authorizedSubmitters[msg.sender],
            "Not authorized to anchor"
        );
        require(merkleRoot != bytes32(0), "Empty merkle root");
        require(_anchors[merkleRoot].anchoredAt == 0, "Root already anchored");
        require(validator != address(0), "Invalid validator");

        // Create a validation request using the merkleRoot as the requestHash
        requestKey = keccak256(
            abi.encodePacked(merkleRoot, agentId, validator, block.timestamp)
        );
        _validations[requestKey] = ValidationRecord({
            validatorAddress: validator,
            agentId: agentId,
            requestURI: ipfsURI,
            requestHash: merkleRoot,
            response: 0,
            responseURI: "",
            responseHash: bytes32(0),
            tag: "merkle",
            requestedAt: block.timestamp,
            lastUpdate: block.timestamp,
            responded: false
        });
        _agentValidations[agentId].push(requestKey);
        _validatorRequests[validator].push(requestKey);

        _anchors[merkleRoot] = MerkleAnchor({
            agentId: agentId,
            merkleRoot: merkleRoot,
            logCount: logCount,
            ipfsURI: ipfsURI,
            validator: validator,
            anchoredAt: block.timestamp,
            validationKey: requestKey
        });
        _agentRoots[agentId].push(merkleRoot);

        emit MerkleRootAnchored(
            agentId,
            merkleRoot,
            logCount,
            ipfsURI,
            validator
        );
        emit ValidationRequested(requestKey, agentId, validator, merkleRoot);
    }

    /**
     * @notice Stateless Merkle proof verification.
     * @param merkleRoot Expected root
     * @param leaf       keccak256 of the leaf data
     * @param proof      Sibling hashes from leaf to root
     * @return valid     True if the leaf is included in the tree
     */
    function verifyLeaf(
        bytes32 merkleRoot,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external pure returns (bool valid) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            // Canonical ordering: smaller hash goes left
            if (computed <= sibling) {
                computed = keccak256(abi.encodePacked(computed, sibling));
            } else {
                computed = keccak256(abi.encodePacked(sibling, computed));
            }
        }
        valid = computed == merkleRoot;
    }

    function getAnchor(
        bytes32 merkleRoot
    )
        external
        view
        returns (
            uint256 agentId,
            uint256 logCount,
            string memory ipfsURI,
            address validator,
            uint256 anchoredAt,
            bytes32 validationKey
        )
    {
        MerkleAnchor storage a = _anchors[merkleRoot];
        return (
            a.agentId,
            a.logCount,
            a.ipfsURI,
            a.validator,
            a.anchoredAt,
            a.validationKey
        );
    }

    function getAgentRoots(
        uint256 agentId
    ) external view returns (bytes32[] memory) {
        return _agentRoots[agentId];
    }
}
