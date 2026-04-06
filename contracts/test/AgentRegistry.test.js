const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentRegistry", function () {
  let registry, wallet, owner, agentAddr, other;
  const metadata = ethers.toUtf8Bytes(
    JSON.stringify({
      name: "Claude Portfolio Agent",
      description: "AI agent for portfolio management",
      category: "Finance",
      tags: ["AI", "Finance"],
    }),
  );

  beforeEach(async function () {
    [owner, agentAddr, other] = await ethers.getSigners();

    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    registry = await AgentRegistry.deploy();
    await registry.waitForDeployment();

    // Deploy wallet so we have a real walletContract address
    const KiteAAWallet = await ethers.getContractFactory("KiteAAWallet");
    wallet = await KiteAAWallet.deploy();
    await wallet.waitForDeployment();
  });

  describe("Agent Registration", function () {
    it("should register an agent and generate agentId on-chain", async function () {
      const tx = await registry.registerAgent(
        agentAddr.address,
        await wallet.getAddress(),
        metadata,
      );
      const receipt = await tx.wait();

      // Find the AgentRegistered event
      const event = receipt.logs.find(
        (log) => registry.interface.parseLog(log)?.name === "AgentRegistered",
      );
      const parsed = registry.interface.parseLog(event);
      const agentId = parsed.args.agentId;

      expect(agentId).to.not.equal(ethers.ZeroHash);

      const info = await registry.getAgent(agentId);
      expect(info.metadataHash).to.equal(ethers.keccak256(metadata));
      expect(info.agentAddress).to.equal(agentAddr.address);
      expect(info.walletContract).to.equal(await wallet.getAddress());
      expect(info.active).to.be.true;
    });

    it("should reject duplicate agent address registration", async function () {
      await registry.registerAgent(
        agentAddr.address,
        await wallet.getAddress(),
        metadata,
      );
      await expect(
        registry.registerAgent(
          agentAddr.address,
          await wallet.getAddress(),
          metadata,
        ),
      ).to.be.revertedWith("Agent address already registered");
    });

    it("should reject zero-address agent", async function () {
      await expect(
        registry.registerAgent(
          ethers.ZeroAddress,
          await wallet.getAddress(),
          metadata,
        ),
      ).to.be.revertedWith("Invalid agent address");
    });

    it("should reject zero-address wallet", async function () {
      await expect(
        registry.registerAgent(agentAddr.address, ethers.ZeroAddress, metadata),
      ).to.be.revertedWith("Invalid wallet contract");
    });

    it("should increment nonce after each registration", async function () {
      expect(await registry.nonce()).to.equal(1);
      await registry.registerAgent(
        agentAddr.address,
        await wallet.getAddress(),
        metadata,
      );
      expect(await registry.nonce()).to.equal(2);
      await registry.registerAgent(
        other.address,
        await wallet.getAddress(),
        metadata,
      );
      expect(await registry.nonce()).to.equal(3);
    });

    it("should deactivate an agent", async function () {
      const tx = await registry.registerAgent(
        agentAddr.address,
        await wallet.getAddress(),
        metadata,
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log) => registry.interface.parseLog(log)?.name === "AgentRegistered",
      );
      const agentId = registry.interface.parseLog(event).args.agentId;

      await registry.deactivateAgent(agentId);

      const info = await registry.getAgent(agentId);
      expect(info.active).to.be.false;
    });

    it("should reject deactivation from non-owner", async function () {
      const tx = await registry.registerAgent(
        agentAddr.address,
        await wallet.getAddress(),
        metadata,
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log) => registry.interface.parseLog(log)?.name === "AgentRegistered",
      );
      const agentId = registry.interface.parseLog(event).args.agentId;

      await expect(
        registry.connect(other).deactivateAgent(agentId),
      ).to.be.revertedWith("Not agent owner");
    });

    it("should track agents per owner", async function () {
      await registry.registerAgent(
        agentAddr.address,
        await wallet.getAddress(),
        metadata,
      );
      await registry.registerAgent(
        other.address,
        await wallet.getAddress(),
        metadata,
      );

      const agents = await registry.getOwnerAgents(owner.address);
      expect(agents.length).to.equal(2);
    });

    it("should return total agent count", async function () {
      expect(await registry.totalAgents()).to.equal(0);
      await registry.registerAgent(
        agentAddr.address,
        await wallet.getAddress(),
        metadata,
      );
      expect(await registry.totalAgents()).to.equal(1);
    });

    it("should emit metadata in the event", async function () {
      await expect(
        registry.registerAgent(
          agentAddr.address,
          await wallet.getAddress(),
          metadata,
        ),
      ).to.emit(registry, "AgentRegistered");
    });
  });

  describe("Resolution Functions", function () {
    let agentId;

    beforeEach(async function () {
      const tx = await registry.registerAgent(
        agentAddr.address,
        await wallet.getAddress(),
        metadata,
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log) => registry.interface.parseLog(log)?.name === "AgentRegistered",
      );
      agentId = registry.interface.parseLog(event).args.agentId;
    });

    it("should resolve agent by address", async function () {
      const result = await registry.resolveAgentByAddress(agentAddr.address);
      expect(result.agentId).to.equal(agentId);
      expect(result.metadataHash).to.equal(ethers.keccak256(metadata));
      expect(result.active).to.be.true;
    });
  });

  describe("Session Registration", function () {
    const validUntil = Math.floor(Date.now() / 1000) + 86400;
    let sessionAddr, agentId;

    beforeEach(async function () {
      [, , , , sessionAddr] = await ethers.getSigners();

      // Link wallet to registry
      await wallet.setAgentRegistry(await registry.getAddress());

      // Register EOA on wallet
      await wallet.connect(owner).register();

      // Register agent on registry with walletContract = wallet address
      const tx = await registry.registerAgent(
        agentAddr.address,
        await wallet.getAddress(),
        metadata,
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log) => registry.interface.parseLog(log)?.name === "AgentRegistered",
      );
      agentId = registry.interface.parseLog(event).args.agentId;

      // Track agentId in wallet
      await wallet.connect(owner).addAgentId(agentId);
    });

    it("should register a session via wallet's addSessionKeyRule", async function () {
      // Adding a session key rule on the wallet auto-registers on the registry
      const VALUE_LIMIT = ethers.parseEther("10");
      const DAILY_LIMIT = ethers.parseEther("50");
      await wallet.connect(owner).addSessionKeyRule(
        sessionAddr.address, agentId, VALUE_LIMIT, DAILY_LIMIT, validUntil, []
      );

      const info = await registry.getAgentBySession(sessionAddr.address);
      expect(info.agentId).to.equal(agentId);
      expect(info.metadataHash).to.equal(ethers.keccak256(metadata));
      expect(info.sessionActive).to.be.true;
    });

    it("should reject direct session registration from EOA", async function () {
      await expect(
        registry.connect(owner).registerSession(agentId, sessionAddr.address, validUntil),
      ).to.be.revertedWith("Only wallet contract");
    });

    it("should reject session for inactive agent", async function () {
      await registry.deactivateAgent(agentId);
      const VALUE_LIMIT = ethers.parseEther("10");
      const DAILY_LIMIT = ethers.parseEther("50");
      await expect(
        wallet.connect(owner).addSessionKeyRule(
          sessionAddr.address, agentId, VALUE_LIMIT, DAILY_LIMIT, validUntil, []
        ),
      ).to.be.reverted;
    });

    it("should deactivate a session via wallet revoke", async function () {
      const VALUE_LIMIT = ethers.parseEther("10");
      const DAILY_LIMIT = ethers.parseEther("50");
      await wallet.connect(owner).addSessionKeyRule(
        sessionAddr.address, agentId, VALUE_LIMIT, DAILY_LIMIT, validUntil, []
      );

      await wallet.connect(owner).revokeSessionKey(sessionAddr.address);

      const info = await registry.getAgentBySession(sessionAddr.address);
      expect(info.sessionActive).to.be.false;
    });

    it("should update session when addSessionKeyRule is called again", async function () {
      const VALUE_LIMIT = ethers.parseEther("10");
      const DAILY_LIMIT = ethers.parseEther("50");
      await wallet.connect(owner).addSessionKeyRule(
        sessionAddr.address, agentId, VALUE_LIMIT, DAILY_LIMIT, validUntil, []
      );

      // Update with a new expiry
      const newValidUntil = validUntil + 86400;
      await wallet.connect(owner).addSessionKeyRule(
        sessionAddr.address, agentId, VALUE_LIMIT, DAILY_LIMIT, newValidUntil, []
      );

      const info = await registry.getAgentBySession(sessionAddr.address);
      expect(info.sessionValidUntil).to.equal(newValidUntil);
      expect(info.sessionActive).to.be.true;
    });

    it("should reject direct deactivateSession from EOA", async function () {
      const VALUE_LIMIT = ethers.parseEther("10");
      const DAILY_LIMIT = ethers.parseEther("50");
      await wallet.connect(owner).addSessionKeyRule(
        sessionAddr.address, agentId, VALUE_LIMIT, DAILY_LIMIT, validUntil, []
      );

      await expect(
        registry.connect(owner).deactivateSession(sessionAddr.address),
      ).to.be.revertedWith("Only wallet contract");
    });
  });
});
