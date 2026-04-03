const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AnchorMerkle", function () {
  let merkle, owner, submitter, other;
  const agentId1 = ethers.id("agent-claude-v1");
  const agentId2 = ethers.id("agent-gpt-v1");

  // Helper: build a 2-leaf Merkle tree and return { root, leaves, proof }
  function buildMerkleTree(leaf1, leaf2) {
    const sorted = leaf1 <= leaf2
      ? ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [leaf1, leaf2])
      : ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [leaf2, leaf1]);
    return {
      root: sorted,
      leaves: [leaf1, leaf2],
      // proof for leaf1 is [leaf2], proof for leaf2 is [leaf1]
      proofForLeaf1: [leaf2],
      proofForLeaf2: [leaf1],
    };
  }

  beforeEach(async function () {
    [owner, submitter, other] = await ethers.getSigners();

    const AnchorMerkle = await ethers.getContractFactory("AnchorMerkle");
    merkle = await AnchorMerkle.deploy();
    await merkle.waitForDeployment();
  });

  describe("Submitter Management", function () {
    it("owner should be an authorized submitter by default", async function () {
      expect(await merkle.authorizedSubmitters(owner.address)).to.be.true;
    });

    it("should add a submitter", async function () {
      await merkle.addSubmitter(submitter.address);
      expect(await merkle.authorizedSubmitters(submitter.address)).to.be.true;
    });

    it("should remove a submitter", async function () {
      await merkle.addSubmitter(submitter.address);
      await merkle.removeSubmitter(submitter.address);
      expect(await merkle.authorizedSubmitters(submitter.address)).to.be.false;
    });

    it("should reject non-owner adding submitter", async function () {
      await expect(
        merkle.connect(other).addSubmitter(submitter.address)
      ).to.be.revertedWithCustomError(merkle, "OwnableUnauthorizedAccount");
    });
  });

  describe("Anchor Operations", function () {
    it("should anchor a Merkle root", async function () {
      const root = ethers.id("fake-root");
      await merkle.anchorRoot(root, 10, "ipfs://batch1", [agentId1]);

      const anchor = await merkle.getAnchor(0);
      expect(anchor.merkleRoot).to.equal(root);
      expect(anchor.logCount).to.equal(10);
      expect(anchor.metadata).to.equal("ipfs://batch1");
      expect(await merkle.totalAnchors()).to.equal(1);
    });

    it("should index anchor by agent IDs", async function () {
      const root = ethers.id("fake-root");
      await merkle.anchorRoot(root, 5, "", [agentId1, agentId2]);

      const indices1 = await merkle.getAgentAnchorIndices(agentId1);
      const indices2 = await merkle.getAgentAnchorIndices(agentId2);
      expect(indices1.length).to.equal(1);
      expect(indices2.length).to.equal(1);
      expect(indices1[0]).to.equal(0n);
    });

    it("should reject zero root", async function () {
      await expect(
        merkle.anchorRoot(ethers.ZeroHash, 1, "", [])
      ).to.be.revertedWith("Invalid root");
    });

    it("should reject zero logCount", async function () {
      await expect(
        merkle.anchorRoot(ethers.id("root"), 0, "", [])
      ).to.be.revertedWith("Must have logs");
    });

    it("should reject unauthorized submitter", async function () {
      await expect(
        merkle.connect(other).anchorRoot(ethers.id("root"), 1, "", [])
      ).to.be.revertedWith("Not authorized");
    });

    it("authorized submitter can anchor", async function () {
      await merkle.addSubmitter(submitter.address);
      await merkle.connect(submitter).anchorRoot(ethers.id("root"), 3, "test", []);
      expect(await merkle.totalAnchors()).to.equal(1);
    });
  });

  describe("Merkle Proof Verification", function () {
    it("should verify a valid leaf proof", async function () {
      const leaf1 = ethers.id("log-entry-1");
      const leaf2 = ethers.id("log-entry-2");
      const tree = buildMerkleTree(leaf1, leaf2);

      await merkle.anchorRoot(tree.root, 2, "batch", [agentId1]);

      // Verify leaf1 — use staticCall for the return value
      const valid = await merkle.verifyLeaf.staticCall(0, leaf1, tree.proofForLeaf1);
      expect(valid).to.be.true;
    });

    it("should reject an invalid proof", async function () {
      const leaf1 = ethers.id("log-entry-1");
      const leaf2 = ethers.id("log-entry-2");
      const tree = buildMerkleTree(leaf1, leaf2);

      await merkle.anchorRoot(tree.root, 2, "batch", [agentId1]);

      const fakeLeaf = ethers.id("fake-leaf");
      const valid = await merkle.verifyLeaf.staticCall(0, fakeLeaf, tree.proofForLeaf1);
      expect(valid).to.be.false;
    });

    it("should reject invalid anchor index", async function () {
      await expect(
        merkle.verifyLeaf(99, ethers.id("leaf"), [])
      ).to.be.revertedWith("Invalid anchor index");
    });
  });
});
