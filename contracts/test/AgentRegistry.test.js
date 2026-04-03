const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentRegistry", function () {
  let registry, owner, agentAddr, walletAddr, other;
  const agentId = ethers.id("agent-claude-v1");
  const agentDomain = "alice.eth/claude/portfolio-v1";

  beforeEach(async function () {
    [owner, agentAddr, walletAddr, other] = await ethers.getSigners();

    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    registry = await AgentRegistry.deploy();
    await registry.waitForDeployment();
  });

  describe("Agent Registration", function () {
    it("should register an agent", async function () {
      await registry.registerAgent(agentId, agentDomain, agentAddr.address, walletAddr.address);

      const info = await registry.getAgent(agentId);
      expect(info.agentDomain).to.equal(agentDomain);
      expect(info.agentAddress).to.equal(agentAddr.address);
      expect(info.walletContract).to.equal(walletAddr.address);
      expect(info.active).to.be.true;
    });

    it("should reject duplicate agent registration", async function () {
      await registry.registerAgent(agentId, agentDomain, agentAddr.address, walletAddr.address);
      await expect(
        registry.registerAgent(agentId, agentDomain, agentAddr.address, walletAddr.address)
      ).to.be.revertedWith("Agent already registered");
    });

    it("should reject zero-address agent", async function () {
      await expect(
        registry.registerAgent(agentId, agentDomain, ethers.ZeroAddress, walletAddr.address)
      ).to.be.revertedWith("Invalid agent address");
    });

    it("should deactivate an agent", async function () {
      await registry.registerAgent(agentId, agentDomain, agentAddr.address, walletAddr.address);
      await registry.deactivateAgent(agentId);

      const info = await registry.getAgent(agentId);
      expect(info.active).to.be.false;
    });

    it("should reject deactivation from non-owner", async function () {
      await registry.registerAgent(agentId, agentDomain, agentAddr.address, walletAddr.address);
      await expect(
        registry.connect(other).deactivateAgent(agentId)
      ).to.be.revertedWith("Not agent owner");
    });

    it("should track agents per owner", async function () {
      const agentId2 = ethers.id("agent-gpt-v1");
      await registry.registerAgent(agentId, agentDomain, agentAddr.address, walletAddr.address);
      await registry.registerAgent(agentId2, "alice.eth/gpt/v1", other.address, walletAddr.address);

      const agents = await registry.getOwnerAgents(owner.address);
      expect(agents.length).to.equal(2);
    });
  });

  describe("Resolution Functions", function () {
    beforeEach(async function () {
      await registry.registerAgent(agentId, agentDomain, agentAddr.address, walletAddr.address);
    });

    it("should resolve agent by domain", async function () {
      const result = await registry.resolveAgentByDomain(agentDomain);
      expect(result.agentId).to.equal(agentId);
      expect(result.agentAddress).to.equal(agentAddr.address);
      expect(result.active).to.be.true;
    });

    it("should resolve agent by address", async function () {
      const result = await registry.resolveAgentByAddress(agentAddr.address);
      expect(result.agentId).to.equal(agentId);
      expect(result.agentDomain).to.equal(agentDomain);
      expect(result.active).to.be.true;
    });

    it("should return total agent count", async function () {
      expect(await registry.totalAgents()).to.equal(1);
    });
  });

  describe("Session Registration", function () {
    const validUntil = Math.floor(Date.now() / 1000) + 86400;
    let sessionAddr;

    beforeEach(async function () {
      [, , , , sessionAddr] = await ethers.getSigners();
      await registry.registerAgent(agentId, agentDomain, agentAddr.address, walletAddr.address);
    });

    it("should register a session for an agent", async function () {
      await registry.registerSession(agentId, sessionAddr.address, validUntil);

      const info = await registry.getAgentBySession(sessionAddr.address);
      expect(info.agentId).to.equal(agentId);
      expect(info.agentDomain).to.equal(agentDomain);
      expect(info.sessionActive).to.be.true;
    });

    it("should reject session registration from unauthorized caller", async function () {
      await expect(
        registry.connect(other).registerSession(agentId, sessionAddr.address, validUntil)
      ).to.be.revertedWith("Not authorized");
    });

    it("should reject session for inactive agent", async function () {
      await registry.deactivateAgent(agentId);
      await expect(
        registry.registerSession(agentId, sessionAddr.address, validUntil)
      ).to.be.revertedWith("Agent not active");
    });

    it("should deactivate a session", async function () {
      await registry.registerSession(agentId, sessionAddr.address, validUntil);
      await registry.deactivateSession(sessionAddr.address);

      const info = await registry.getAgentBySession(sessionAddr.address);
      expect(info.sessionActive).to.be.false;
    });
  });
});
