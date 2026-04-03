// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AnchorMerkle
 * @notice Anchors Merkle roots of aggregated agent usage logs on Kite Chain.
 *         The backend periodically computes a Merkle tree from payment/usage logs
 *         and submits the root here. Anyone can then verify individual log entries
 *         against the anchored root (off-chain proof, on-chain verification).
 *
 *         This enables:
 *         - Auditable batch payment verification
 *         - Provable service consumption without storing every log on-chain
 *         - Foundation for future ZK proof aggregation
 */
contract AnchorMerkle is Ownable {

    struct MerkleAnchor {
        bytes32 merkleRoot;
        uint256 timestamp;
        uint256 logCount;      // number of log entries in this batch
        string  metadata;      // optional: IPFS hash, batch description, etc.
    }

    MerkleAnchor[] public anchors;

    // agentId => list of anchor indices relevant to that agent
    mapping(bytes32 => uint256[]) public agentAnchors;

    // Authorized submitters (backend service accounts)
    mapping(address => bool) public authorizedSubmitters;

    event MerkleRootAnchored(
        uint256 indexed anchorIndex,
        bytes32 indexed merkleRoot,
        uint256 logCount,
        string metadata
    );
    event SubmitterAdded(address indexed submitter);
    event SubmitterRemoved(address indexed submitter);
    event LeafVerified(uint256 indexed anchorIndex, bytes32 indexed leafHash, bool valid);

    modifier onlySubmitter() {
        require(authorizedSubmitters[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    constructor() Ownable(msg.sender) {
        authorizedSubmitters[msg.sender] = true;
    }

    // ─── Admin ─────────────────────────────────────────────────────────

    function addSubmitter(address submitter) external onlyOwner {
        authorizedSubmitters[submitter] = true;
        emit SubmitterAdded(submitter);
    }

    function removeSubmitter(address submitter) external onlyOwner {
        authorizedSubmitters[submitter] = false;
        emit SubmitterRemoved(submitter);
    }

    // ─── Anchor Operations ─────────────────────────────────────────────

    /**
     * @notice Anchor a Merkle root computed from a batch of usage logs.
     * @param merkleRoot  The root hash of the Merkle tree
     * @param logCount    Number of log entries in this batch
     * @param metadata    Optional metadata (IPFS CID, batch label, etc.)
     * @param agentIds    Agent IDs included in this batch (for indexing)
     */
    function anchorRoot(
        bytes32 merkleRoot,
        uint256 logCount,
        string calldata metadata,
        bytes32[] calldata agentIds
    ) external onlySubmitter {
        require(merkleRoot != bytes32(0), "Invalid root");
        require(logCount > 0, "Must have logs");

        uint256 index = anchors.length;
        anchors.push(MerkleAnchor({
            merkleRoot: merkleRoot,
            timestamp: block.timestamp,
            logCount: logCount,
            metadata: metadata
        }));

        for (uint256 i = 0; i < agentIds.length; i++) {
            agentAnchors[agentIds[i]].push(index);
        }

        emit MerkleRootAnchored(index, merkleRoot, logCount, metadata);
    }

    /**
     * @notice Verify that a leaf belongs to an anchored Merkle root.
     * @param anchorIndex  Index of the anchor to verify against
     * @param leaf         The leaf hash (keccak256 of log entry)
     * @param proof        The Merkle proof (sibling hashes)
     * @return valid       Whether the proof is correct
     */
    function verifyLeaf(
        uint256 anchorIndex,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external returns (bool valid) {
        require(anchorIndex < anchors.length, "Invalid anchor index");

        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        valid = computedHash == anchors[anchorIndex].merkleRoot;
        emit LeafVerified(anchorIndex, leaf, valid);
    }

    // ─── View Functions ────────────────────────────────────────────────

    function getAnchor(uint256 index) external view returns (
        bytes32 merkleRoot,
        uint256 timestamp,
        uint256 logCount,
        string memory metadata
    ) {
        MerkleAnchor storage a = anchors[index];
        return (a.merkleRoot, a.timestamp, a.logCount, a.metadata);
    }

    function getAgentAnchorIndices(bytes32 agentId) external view returns (uint256[] memory) {
        return agentAnchors[agentId];
    }

    function totalAnchors() external view returns (uint256) {
        return anchors.length;
    }
}
