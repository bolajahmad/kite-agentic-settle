const { expect }       = require("chai");
const { ethers }       = require("hardhat");

/**
 * IdentityRegistry.test.js
 * Covers: register, setAgentURI, setAgentWallet, sessions,
 *         isAgentBlocked, validateSession, token transfer clears agentWallet.
 */
describe("IdentityRegistry", function () {
  let registry;
  let vault;
  let alice, bob, carol, operator;

  beforeEach(async function () {
    [, alice, bob, carol, operator] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("IdentityRegistry");
    const VaultFactory = await ethers.getContractFactory("MockClientAgentVault");
    registry = await Factory.deploy();
    vault = await VaultFactory.deploy();
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
      expect(await registry.ownerOf(agentId)).to.equal(carol.address);
    });

    it("does not transfer NFT when user is already the owner", async function () {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const walletAddr = bob.address;

      const types = {
        SetAgentWallet: [
          { name: "agentId",        type: "uint256" },
          { name: "walletContract", type: "address" },
          { name: "user",           type: "address" },
          { name: "deadline",       type: "uint256" },
        ],
      };
      const value = { agentId, walletContract: walletAddr, user: alice.address, deadline };
      const sig = await alice.signTypedData(domainWithContract, types, value);

      await registry.connect(alice).setAgentWallet(agentId, walletAddr, alice.address, deadline, sig);
      expect(await registry.ownerOf(agentId)).to.equal(alice.address);
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
      await registry.connect(carol).transferFrom(carol.address, operator.address, agentId);
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

    /** Compute the deterministic sessionId used by the vault and IdentityRegistry. */
    function computeSessionId(sessionKeyAddr, aid, validUntil) {
      return ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256"],
        [sessionKeyAddr, aid, validUntil]
      );
    }

    async function doRegisterSession(opts = {}) {
      const validUntil       = opts.validUntil ?? BigInt(Math.floor(Date.now() / 1000) + 3600);
      const blockedProviders = opts.blockedProviders ?? [];

      if (opts.skipVaultSetup !== true) {
        const sessionId = computeSessionId(sessionKey.address, agentId, validUntil);
        await vault.setSessionExists(sessionId, true);
      }

      return registry.connect(alice).registerSession(
        agentId,
        sessionKey.address,
        alice.address,
        await vault.getAddress(),
        validUntil,
        blockedProviders
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
      expect(wc).to.equal(await vault.getAddress());
    });

    it("validateSession returns active=false for revoked session", async function () {
      await doRegisterSession();
      await registry.connect(alice).revokeSession(sessionKey.address);
      const [active] = await registry.validateSession(sessionKey.address);
      expect(active).to.be.false;
    });

    it("isAgentBlocked returns true for blocked agent", async function () {
      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const sessionId = computeSessionId(sessionKey.address, agentId, validUntil);
      await vault.setSessionExists(sessionId, true);
      // Register session with agentId in the blocked list
      await registry.connect(alice).registerSession(
        agentId,
        sessionKey.address,
        alice.address,
        await vault.getAddress(),
        validUntil,
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
          agentId,
          sessionKey.address,
          alice.address,
          await vault.getAddress(),
          BigInt(Math.floor(Date.now() / 1000) + 3600),
          []
        )
      ).to.be.revertedWith("Not authorized to register session");
    });

    it("cannot register session with past expiry", async function () {
      await expect(
        registry.connect(alice).registerSession(
          agentId,
          sessionKey.address,
          alice.address,
          await vault.getAddress(),
          1n, // in the past
          []
        )
      ).to.be.revertedWith("Expiry must be in future");
    });

    it("requires the session to exist on the vault", async function () {
      await expect(doRegisterSession({ skipVaultSetup: true })).to.be.revertedWith("Vault session not set");
    });
  });
});
