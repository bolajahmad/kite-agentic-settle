const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AttestationRegistry", function () {
  let registry, attestation;
  let deployer, alice, bob, carol, validator;
  let agentId;

  beforeEach(async function () {
    [deployer, alice, bob, carol, validator] = await ethers.getSigners();

    const RegistryF     = await ethers.getContractFactory("IdentityRegistry");
    const AttestationF  = await ethers.getContractFactory("AttestationRegistry");

    registry    = await RegistryF.deploy();
    attestation = await AttestationF.deploy(await registry.getAddress());

    await registry.connect(alice)["register(string)"]("ipfs://alice-agent");
    agentId = 1n;
  });

  // ─── Admin ────────────────────────────────────────────────────────

  describe("addSubmitter / removeSubmitter", function () {
    it("owner can add submitter", async function () {
      await expect(attestation.addSubmitter(bob.address))
        .to.emit(attestation, "SubmitterAdded").withArgs(bob.address);
      expect(await attestation.authorizedSubmitters(bob.address)).to.be.true;
    });
    it("non-owner cannot add submitter", async function () {
      await expect(attestation.connect(alice).addSubmitter(bob.address))
        .to.be.reverted;
    });
  });

  // ─── Reputation: Feedback ─────────────────────────────────────────

  describe("giveFeedback / revokeFeedback / appendResponse", function () {
    it("any address can give feedback", async function () {
      await expect(attestation.connect(bob).giveFeedback(
        agentId, 80n, 0, "quality", "speed", "/api/chat", "ipfs://f", ethers.ZeroHash
      )).to.emit(attestation, "FeedbackGiven");
      expect(await attestation.getFeedbackCount(agentId, bob.address)).to.equal(1n);
    });

    it("giver can revoke their own feedback", async function () {
      await attestation.connect(bob).giveFeedback(
        agentId, 80n, 0, "quality", "", "", "", ethers.ZeroHash
      );
      await expect(attestation.connect(bob).revokeFeedback(agentId, 0n))
        .to.emit(attestation, "FeedbackRevoked");
      const [,,,, isRevoked] = await attestation.readFeedback(agentId, bob.address, 0n);
      expect(isRevoked).to.be.true;
    });

    it("agent owner can append response", async function () {
      await attestation.connect(bob).giveFeedback(
        agentId, 90n, 0, "accuracy", "", "", "", ethers.ZeroHash
      );
      await expect(attestation.connect(alice).appendResponse(
        agentId, bob.address, 0n, "ipfs://response", ethers.ZeroHash
      )).to.emit(attestation, "ResponseAppended");
      const [,,,,, hasResponse] = await attestation.readFeedback(agentId, bob.address, 0n);
      expect(hasResponse).to.be.true;
    });

    it("cannot give feedback to non-existent agent", async function () {
      await expect(attestation.connect(bob).giveFeedback(
        999n, 50n, 0, "", "", "", "", ethers.ZeroHash
      )).to.be.reverted;
    });
  });

  describe("getSummaryFeedback", function () {
    it("aggregates non-revoked feedback values", async function () {
      await attestation.connect(bob).giveFeedback(agentId, 80n, 0, "quality", "", "", "", ethers.ZeroHash);
      await attestation.connect(carol).giveFeedback(agentId, 60n, 0, "quality", "", "", "", ethers.ZeroHash);
      // Revoke bob's
      await attestation.connect(bob).revokeFeedback(agentId, 0n);

      const [count, summaryValue] = await attestation.getSummaryFeedback(
        agentId, [bob.address, carol.address], "quality", ""
      );
      expect(count).to.equal(1n);
      expect(summaryValue).to.equal(60n);
    });
  });

  // ─── Validation ───────────────────────────────────────────────────

  describe("validationRequest / validationResponse / getValidationStatus", function () {
    let requestKey;

    beforeEach(async function () {
      const tx = await attestation.connect(alice).validationRequest(
        validator.address, agentId, "ipfs://req", ethers.ZeroHash
      );
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment?.name === "ValidationRequested");
      requestKey = ev.args.requestKey;
    });

    it("emits ValidationRequested", async function () {
      expect(requestKey).to.not.equal(ethers.ZeroHash);
    });

    it("validator can respond", async function () {
      await expect(attestation.connect(validator).validationResponse(
        requestKey, 95, "ipfs://resp", ethers.ZeroHash, "security"
      )).to.emit(attestation, "ValidationResponded");

      const [va, id, response, , tag, , responded] = await attestation.getValidationStatus(requestKey);
      expect(va).to.equal(validator.address);
      expect(id).to.equal(agentId);
      expect(response).to.equal(95);
      expect(tag).to.equal("security");
      expect(responded).to.be.true;
    });

    it("non-validator cannot respond", async function () {
      await expect(attestation.connect(bob).validationResponse(
        requestKey, 50, "", ethers.ZeroHash, ""
      )).to.be.revertedWith("Not the designated validator");
    });

    it("non-agent-owner cannot request validation", async function () {
      await expect(attestation.connect(bob).validationRequest(
        validator.address, agentId, "ipfs://x", ethers.ZeroHash
      )).to.be.revertedWith("Not authorized");
    });
  });

  describe("getValidationSummary", function () {
    it("computes average response across validators", async function () {
      const tx1 = await attestation.connect(alice).validationRequest(
        validator.address, agentId, "ipfs://r1", ethers.id("req1")
      );
      const r1 = (await tx1.wait()).logs.find(l => l.fragment?.name === "ValidationRequested").args.requestKey;
      await attestation.connect(validator).validationResponse(r1, 80, "", ethers.ZeroHash, "perf");

      const tx2 = await attestation.connect(alice).validationRequest(
        validator.address, agentId, "ipfs://r2", ethers.id("req2")
      );
      const r2 = (await tx2.wait()).logs.find(l => l.fragment?.name === "ValidationRequested").args.requestKey;
      await attestation.connect(validator).validationResponse(r2, 60, "", ethers.ZeroHash, "perf");

      const [count, avg] = await attestation.getValidationSummary(agentId, [], "perf");
      expect(count).to.equal(2n);
      expect(avg).to.equal(70); // (80+60)/2
    });
  });

  // ─── Merkle Extension ─────────────────────────────────────────────

  describe("anchorRoot / verifyLeaf / getAnchor", function () {
    const merkleRoot = ethers.id("test-root");
    const leaf       = ethers.id("leaf-0");
    const sibling    = ethers.id("leaf-1");

    it("agent owner can anchor a root", async function () {
      await expect(attestation.connect(alice).anchorRoot(
        agentId, merkleRoot, 10n, "ipfs://tree", validator.address
      )).to.emit(attestation, "MerkleRootAnchored");

      const [id, logCount, , v] = await attestation.getAnchor(merkleRoot);
      expect(id).to.equal(agentId);
      expect(logCount).to.equal(10n);
      expect(v).to.equal(validator.address);
    });

    it("authorized submitter can anchor", async function () {
      await attestation.addSubmitter(bob.address);
      await expect(attestation.connect(bob).anchorRoot(
        agentId, merkleRoot, 5n, "ipfs://t2", validator.address
      )).to.not.be.reverted;
    });

    it("unauthorized address cannot anchor", async function () {
      await expect(attestation.connect(carol).anchorRoot(
        agentId, merkleRoot, 5n, "ipfs://t3", validator.address
      )).to.be.revertedWith("Not authorized to anchor");
    });

    it("cannot anchor same root twice", async function () {
      await attestation.connect(alice).anchorRoot(agentId, merkleRoot, 10n, "ipfs://x", validator.address);
      await expect(attestation.connect(alice).anchorRoot(agentId, merkleRoot, 10n, "ipfs://y", validator.address))
        .to.be.revertedWith("Root already anchored");
    });

    it("anchor creates a validation request internally", async function () {
      const tx = await attestation.connect(alice).anchorRoot(
        agentId, merkleRoot, 10n, "ipfs://t", validator.address
      );
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment?.name === "ValidationRequested");
      expect(ev).to.not.be.undefined;
      expect(ev.args.agentId).to.equal(agentId);
    });

    it("verifyLeaf returns true for valid proof", async function () {
      // Build a 2-leaf Merkle tree manually
      let combined;
      if (leaf <= sibling) {
        combined = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [leaf, sibling]);
      } else {
        combined = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [sibling, leaf]);
      }
      expect(await attestation.verifyLeaf(combined, leaf, [sibling])).to.be.true;
    });

    it("verifyLeaf returns false for invalid proof", async function () {
      const fakeRoot = ethers.id("wrong-root");
      expect(await attestation.verifyLeaf(fakeRoot, leaf, [sibling])).to.be.false;
    });
  });
});
