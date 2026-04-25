const { expect }       = require("chai");
const { ethers }       = require("hardhat");

/**
 * IdentityRegistry.test.js
 * Covers: register, setAgentURI, setMetadata, setAgentWallet, sessions,
 *         isAgentBlocked, validateSession, token transfer clears agentWallet.
 */
describe("IdentityRegistry", function () {
  let registry;
  let owner, alice, bob, carol, operator;

  beforeEach(async function () {
    [owner, alice, bob, carol, operator] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("IdentityRegistry");
    registry = await Factory.deploy();
  });

  // ─── Registration ─────────────────────────────────────────────────

  describe("register(string)", function () {
    it("mints agent NFT with URI and emits Registered", async function () {
      const tx = await registry.connect(alice)["register(string)"]("ipfs://abc");
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => l.fragment?.name === "Registered");
      expect(event).to.not.be.undefined;
      expect(event.args.agentId).to.equal(1n);
      expect(event.args.agentURI).to.equal("ipfs://abc");
      expect(event.args.owner).to.equal(alice.address);
      expect(await registry.ownerOf(1)).to.equal(alice.address);
      expect(await registry.tokenURI(1)).to.equal("ipfs://abc");
    });

    it("auto-increments agentId starting at 1", async function () {
      await registry.connect(alice)["register(string)"]("ipfs://a");
      await registry.connect(bob)["register(string)"]("ipfs://b");
      const tx = await registry.connect(carol)["register(string)"]("ipfs://c");
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => l.fragment?.name === "Registered");
      expect(event.args.agentId).to.equal(3n);
    });
  });

  describe("register()", function () {
    it("mints agent without URI", async function () {
      await registry.connect(alice)["register()"]();
      expect(await registry.ownerOf(1)).to.equal(alice.address);
      expect(await registry.totalAgents()).to.equal(1n);
    });
  });

  describe("setAgentURI", function () {
    it("owner can update URI", async function () {
      await registry.connect(alice)["register(string)"]("ipfs://old");
      await expect(registry.connect(alice).setAgentURI(1, "ipfs://new"))
        .to.emit(registry, "URIUpdated")
        .withArgs(1n, "ipfs://new", alice.address);
      expect(await registry.tokenURI(1)).to.equal("ipfs://new");
    });

    it("non-owner cannot update URI", async function () {
      await registry.connect(alice)["register(string)"]("ipfs://old");
      await expect(registry.connect(bob).setAgentURI(1, "ipfs://new"))
        .to.be.revertedWith("Not authorized");
    });
  });

  // ─── Metadata ──────────────────────────────────────────────────────

  describe("setMetadata / getMetadata", function () {
    beforeEach(async function () {
      await registry.connect(alice)["register(string)"]("ipfs://a");
    });

    it("owner can set and read metadata", async function () {
      const val = ethers.toUtf8Bytes("hello world");
      await expect(registry.connect(alice).setMetadata(1, "description", val))
        .to.emit(registry, "MetadataSet");
      const stored = await registry.getMetadata(1, "description");
      expect(stored).to.equal(ethers.hexlify(val));
    });

    it("non-owner cannot set metadata", async function () {
      await expect(
        registry.connect(bob).setMetadata(1, "foo", ethers.toUtf8Bytes("bar"))
      ).to.be.revertedWith("Not authorized");
    });

    it("cannot use reserved key 'agentWallet'", async function () {
      await expect(
        registry.connect(alice).setMetadata(1, "agentWallet", ethers.toUtf8Bytes("x"))
      ).to.be.revertedWith("Use setAgentWallet for agentWallet key");
    });
  });

  // ─── Agent Wallet ──────────────────────────────────────────────────

  describe("setAgentWallet", function () {
    let agentId;
    const domain = {
      name:    "IdentityRegistry",
      version: "1",
      chainId: 31337, // Hardhat default
    };
    let domainWithContract;

    beforeEach(async function () {
      await registry.connect(alice)["register(string)"]("ipfs://a");
      agentId = 1n;
      domainWithContract = { ...domain, verifyingContract: await registry.getAddress() };
    });

    it("links wallet after valid EIP-712 user signature", async function () {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const walletAddr = bob.address; // pretend it's a wallet contract

      const types = {
        SetAgentWallet: [
          { name: "agentId",        type: "uint256" },
          { name: "walletContract", type: "address" },
          { name: "user",           type: "address" },
          { name: "deadline",       type: "uint256" },
        ],
      };
      const value = { agentId, walletContract: walletAddr, user: carol.address, deadline };
      const sig = await carol.signTypedData(domainWithContract, types, value);

      await expect(
        registry.connect(alice).setAgentWallet(agentId, walletAddr, carol.address, deadline, sig)
      ).to.emit(registry, "AgentWalletSet");

      const [wc, u] = await registry.getAgentWallet(agentId);
      expect(wc).to.equal(walletAddr);
      expect(u).to.equal(carol.address);
    });

    it("rejects expired signature", async function () {
      const deadline = 1n; // already expired
      const walletAddr = bob.address;
      const types = {
        SetAgentWallet: [
          { name: "agentId",        type: "uint256" },
          { name: "walletContract", type: "address" },
          { name: "user",           type: "address" },
          { name: "deadline",       type: "uint256" },
        ],
      };
      const value = { agentId, walletContract: walletAddr, user: carol.address, deadline };
      const sig = await carol.signTypedData(domainWithContract, types, value);

      await expect(
        registry.connect(alice).setAgentWallet(agentId, walletAddr, carol.address, deadline, sig)
      ).to.be.revertedWith("Signature expired");
    });

    it("clears agentWallet on token transfer", async function () {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const types = {
        SetAgentWallet: [
          { name: "agentId",        type: "uint256" },
          { name: "walletContract", type: "address" },
          { name: "user",           type: "address" },
          { name: "deadline",       type: "uint256" },
        ],
      };
      const value = { agentId, walletContract: bob.address, user: carol.address, deadline };
      const sig = await carol.signTypedData(domainWithContract, types, value);
      await registry.connect(alice).setAgentWallet(agentId, bob.address, carol.address, deadline, sig);

      // Transfer the NFT
      await registry.connect(alice).transferFrom(alice.address, operator.address, agentId);
      const [wc,] = await registry.getAgentWallet(agentId);
      expect(wc).to.equal(ethers.ZeroAddress);
    });
  });

  // ─── Sessions ──────────────────────────────────────────────────────

  describe("registerSession / validateSession / revokeSession", function () {
    let agentId;
    let sessionKey;

    beforeEach(async function () {
      await registry.connect(alice)["register(string)"]("ipfs://a");
      agentId    = 1n;
      sessionKey = carol; // use carol's address as session key
    });

    async function doRegisterSession(opts = {}) {
      const validUntil       = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const valueLimit       = opts.valueLimit       ?? ethers.parseEther("10");
      const maxValueAllowed  = opts.maxValueAllowed  ?? ethers.parseEther("100");
      const blockedProviders = opts.blockedProviders ?? [];
      return registry.connect(alice).registerSession(
        agentId, sessionKey.address, alice.address, bob.address,
        valueLimit, maxValueAllowed, validUntil, blockedProviders
      );
    }

    it("registers a session and emits SessionRegistered", async function () {
      await expect(doRegisterSession())
        .to.emit(registry, "SessionRegistered");
    });

    it("validateSession returns active=true for valid session", async function () {
      await doRegisterSession();
      const [active, id, user, wc] = await registry.validateSession(sessionKey.address);
      expect(active).to.be.true;
      expect(id).to.equal(agentId);
      expect(user).to.equal(alice.address);
      expect(wc).to.equal(bob.address); // wallet contract
    });

    it("validateSession returns active=false for revoked session", async function () {
      await doRegisterSession();
      await registry.connect(alice).revokeSession(sessionKey.address);
      const [active] = await registry.validateSession(sessionKey.address);
      expect(active).to.be.false;
    });

    it("isAgentBlocked returns true for blocked agent", async function () {
      // Register session with agentId in the blocked list
      await registry.connect(alice).registerSession(
        agentId, sessionKey.address, alice.address, bob.address,
        ethers.parseEther("10"), ethers.parseEther("100"),
        BigInt(Math.floor(Date.now() / 1000) + 3600),
        [agentId]
      );
      expect(await registry.isAgentBlocked(sessionKey.address, agentId)).to.be.true;
      expect(await registry.isAgentBlocked(sessionKey.address, agentId + 1n)).to.be.false;
    });

    it("getAgentSessions returns registered session keys", async function () {
      await doRegisterSession();
      const sessions = await registry.getAgentSessions(agentId);
      expect(sessions).to.include(sessionKey.address);
    });

    it("non-owner cannot register session", async function () {
      await expect(
        registry.connect(bob).registerSession(
          agentId, sessionKey.address, alice.address, bob.address,
          ethers.parseEther("10"), ethers.parseEther("100"),
          BigInt(Math.floor(Date.now() / 1000) + 3600),
          []
        )
      ).to.be.revertedWith("Not authorized to register session");
    });

    it("cannot register session with past expiry", async function () {
      await expect(
        registry.connect(alice).registerSession(
          agentId, sessionKey.address, alice.address, bob.address,
          ethers.parseEther("10"), ethers.parseEther("100"),
          1n, // in the past
          []
        )
      ).to.be.revertedWith("Expiry must be in future");
    });
  });
});
