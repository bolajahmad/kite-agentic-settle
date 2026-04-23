const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("KiteAAWallet", function () {
  let wallet, token, registry, owner, sessionKey, recipient, other;
  let agentId;
  const ONE_DAY = 86400;
  const VALUE_LIMIT = ethers.parseEther("10");
  const MAX_VALUE_ALLOWED = ethers.parseEther("100"); // lifetime cap for the session
  const metadata = ethers.toUtf8Bytes(JSON.stringify({ name: "Test Agent" }));

  beforeEach(async function () {
    [owner, sessionKey, recipient, other] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    token = await MockToken.deploy("Mock USDC", "mUSDC", ethers.parseEther("1000000"));
    await token.waitForDeployment();

    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    registry = await AgentRegistry.deploy();
    await registry.waitForDeployment();

    const KiteAAWallet = await ethers.getContractFactory("KiteAAWallet");
    wallet = await KiteAAWallet.deploy();
    await wallet.waitForDeployment();

    await wallet.setAgentRegistry(await registry.getAddress());
    await wallet.connect(owner).register();

    const tx = await registry.connect(owner).registerAgent(
      sessionKey.address,
      await wallet.getAddress(),
      0,
      metadata
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => registry.interface.parseLog(log)?.name === "AgentRegistered");
    agentId = registry.interface.parseLog(event).args.agentId;

    await token.connect(owner).approve(await wallet.getAddress(), ethers.parseEther("10000"));
    await wallet.connect(owner).deposit(await token.getAddress(), ethers.parseEther("10000"));
  });

  describe("User Registration", function () {
    it("should register a user", async function () {
      expect(await wallet.isRegistered(owner.address)).to.be.true;
    });

    it("should reject duplicate registration", async function () {
      await expect(wallet.connect(owner).register()).to.be.revertedWith("Already registered");
    });

    it("should track user balance after deposit", async function () {
      const bal = await wallet.getUserBalance(owner.address, await token.getAddress());
      expect(bal).to.equal(ethers.parseEther("10000"));
    });

    it("should list user agent IDs", async function () {
      const ids = await wallet.getUserAgentIds(owner.address);
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(agentId);
    });
  });

  describe("Session Key Management", function () {
    it("should add a session key rule with maxValueAllowed and sync to registry", async function () {
      const expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      const newSessionKey = ethers.Wallet.createRandom();
      await wallet.connect(owner).addSessionKeyRule(
        newSessionKey.address, agentId, 0, VALUE_LIMIT, MAX_VALUE_ALLOWED, expiry, [], "0x"
      );

      const rule = await wallet.getSessionRule(newSessionKey.address);
      expect(rule.user).to.equal(owner.address);
      expect(rule.agentId).to.equal(agentId);
      expect(rule.valueLimit).to.equal(VALUE_LIMIT);
      expect(rule.maxValueAllowed).to.equal(MAX_VALUE_ALLOWED);
      expect(rule.active).to.be.true;

      const regInfo = await registry.getAgentBySession(newSessionKey.address);
      expect(regInfo.agentId).to.equal(agentId);
      expect(regInfo.sessionActive).to.be.true;
    });

    it("should reject maxValueAllowed < valueLimit", async function () {
      const expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      await expect(
        wallet.connect(owner).addSessionKeyRule(
          sessionKey.address, agentId, 0, VALUE_LIMIT, VALUE_LIMIT - 1n, expiry, [], "0x"
        )
      ).to.be.revertedWith("maxValueAllowed must be >= valueLimit");
    });

    it("should reject session key from unregistered user", async function () {
      const expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      await expect(
        wallet.connect(other).addSessionKeyRule(
          sessionKey.address, agentId, 0, VALUE_LIMIT, MAX_VALUE_ALLOWED, expiry, [], "0x"
        )
      ).to.be.revertedWith("Not registered");
    });

    it("should reject session key for agent not owned by caller", async function () {
      await wallet.connect(other).register();
      const expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      await expect(
        wallet.connect(other).addSessionKeyRule(
          sessionKey.address, agentId, 0, VALUE_LIMIT, MAX_VALUE_ALLOWED, expiry, [], "0x"
        )
      ).to.be.revertedWith("Agent not owned by caller");
    });

    it("should revoke a session key and sync to registry", async function () {
      const expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      const newSessionKey = ethers.Wallet.createRandom();
      await wallet.connect(owner).addSessionKeyRule(
        newSessionKey.address, agentId, 0, VALUE_LIMIT, MAX_VALUE_ALLOWED, expiry, [], "0x"
      );
      await wallet.connect(owner).revokeSessionKey(newSessionKey.address);

      const rule = await wallet.getSessionRule(newSessionKey.address);
      expect(rule.active).to.be.false;

      const regInfo = await registry.getAgentBySession(newSessionKey.address);
      expect(regInfo.sessionActive).to.be.false;
    });

    it("should reject revoke from non-session-owner", async function () {
      const expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      const newSessionKey = ethers.Wallet.createRandom();
      await wallet.connect(owner).addSessionKeyRule(
        newSessionKey.address, agentId, 0, VALUE_LIMIT, MAX_VALUE_ALLOWED, expiry, [], "0x"
      );
      await wallet.connect(other).register();
      await expect(
        wallet.connect(other).revokeSessionKey(newSessionKey.address)
      ).to.be.revertedWith("Not session owner");
    });

    it("should revoke all agent sessions and sync to registry", async function () {
      const expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      const sk1 = ethers.Wallet.createRandom();
      const sk2 = ethers.Wallet.createRandom();
      await wallet.connect(owner).addSessionKeyRule(
        sk1.address, agentId, 0, VALUE_LIMIT, MAX_VALUE_ALLOWED, expiry, [], "0x"
      );
      await wallet.connect(owner).addSessionKeyRule(
        sk2.address, agentId, 1, VALUE_LIMIT, MAX_VALUE_ALLOWED, expiry, [], "0x"
      );

      await wallet.connect(owner).revokeAllAgentSessions(agentId);

      expect(await wallet.isSessionValid(sk1.address)).to.be.false;
      expect(await wallet.isSessionValid(sk2.address)).to.be.false;

      const reg1 = await registry.getAgentBySession(sk1.address);
      const reg2 = await registry.getAgentBySession(sk2.address);
      expect(reg1.sessionActive).to.be.false;
      expect(reg2.sessionActive).to.be.false;
    });

    it("should reject zero address session key", async function () {
      const expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      await expect(
        wallet.connect(owner).addSessionKeyRule(
          ethers.ZeroAddress, agentId, 0, VALUE_LIMIT, MAX_VALUE_ALLOWED, expiry, [], "0x"
        )
      ).to.be.revertedWith("Invalid session key");
    });

    it("should reject expired session key rule", async function () {
      const pastExpiry = Math.floor(Date.now() / 1000) - 100;
      await expect(
        wallet.connect(owner).addSessionKeyRule(
          sessionKey.address, agentId, 0, VALUE_LIMIT, MAX_VALUE_ALLOWED, pastExpiry, [], "0x"
        )
      ).to.be.revertedWith("Expiry must be in future");
    });
  });

  describe("Payment Execution", function () {
    let expiry, paySessionKey;

    beforeEach(async function () {
      expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      paySessionKey = sessionKey;
      const agentAddr = ethers.Wallet.createRandom();
      const tx = await registry.connect(owner).registerAgent(
        agentAddr.address, await wallet.getAddress(), 1, metadata
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => registry.interface.parseLog(log)?.name === "AgentRegistered");
      const payAgentId = registry.interface.parseLog(event).args.agentId;

      await wallet.connect(owner).addSessionKeyRule(
        paySessionKey.address, payAgentId, 0, VALUE_LIMIT, MAX_VALUE_ALLOWED, expiry,
        [other.address], "0x"
      );
    });

    it("should execute payment via session key holder", async function () {
      const amount = ethers.parseEther("5");
      const recipientBalBefore = await token.balanceOf(recipient.address);
      await wallet.connect(paySessionKey).executePayment(
        paySessionKey.address, recipient.address, await token.getAddress(), amount
      );
      expect(await token.balanceOf(recipient.address) - recipientBalBefore).to.equal(amount);
    });

    it("should deduct from user balance on payment", async function () {
      const amount = ethers.parseEther("5");
      const balBefore = await wallet.getUserBalance(owner.address, await token.getAddress());
      await wallet.connect(paySessionKey).executePayment(
        paySessionKey.address, recipient.address, await token.getAddress(), amount
      );
      const balAfter = await wallet.getUserBalance(owner.address, await token.getAddress());
      expect(balBefore - balAfter).to.equal(amount);
    });

    it("should execute payment via user (EOA) on behalf of session key", async function () {
      const amount = ethers.parseEther("5");
      await wallet.connect(owner).executePayment(
        paySessionKey.address, recipient.address, await token.getAddress(), amount
      );
      expect(await token.balanceOf(recipient.address)).to.equal(amount);
    });

    it("should track cumulative session spend", async function () {
      const amount = ethers.parseEther("5");
      await wallet.connect(paySessionKey).executePayment(
        paySessionKey.address, recipient.address, await token.getAddress(), amount
      );
      expect(await wallet.getSessionSpent(paySessionKey.address)).to.equal(amount);

      await wallet.connect(paySessionKey).executePayment(
        paySessionKey.address, recipient.address, await token.getAddress(), amount
      );
      expect(await wallet.getSessionSpent(paySessionKey.address)).to.equal(amount * 2n);
    });

    it("should reject payment exceeding per-tx valueLimit", async function () {
      const amount = ethers.parseEther("15"); // > VALUE_LIMIT (10)
      await expect(
        wallet.connect(paySessionKey).executePayment(
          paySessionKey.address, recipient.address, await token.getAddress(), amount
        )
      ).to.be.revertedWith("Exceeds per-tx limit");
    });

    it("should enforce session lifetime limit (maxValueAllowed)", async function () {
      // 10 payments of VALUE_LIMIT (10 ETH each) = 100 ETH = MAX_VALUE_ALLOWED
      const amount = VALUE_LIMIT;
      for (let i = 0; i < 10; i++) {
        await wallet.connect(paySessionKey).executePayment(
          paySessionKey.address, recipient.address, await token.getAddress(), amount
        );
      }
      // 11th would exceed lifetime cap
      await expect(
        wallet.connect(paySessionKey).executePayment(
          paySessionKey.address, recipient.address, await token.getAddress(), amount
        )
      ).to.be.revertedWith("Exceeds session limit");
    });

    it("should reject payment to blocked provider", async function () {
      const amount = ethers.parseEther("5");
      await expect(
        wallet.connect(paySessionKey).executePayment(
          paySessionKey.address, other.address, await token.getAddress(), amount
        )
      ).to.be.revertedWith("Recipient is blocked");
    });

    it("should reject payment from unauthorized caller", async function () {
      const amount = ethers.parseEther("1");
      await expect(
        wallet.connect(other).executePayment(
          paySessionKey.address, recipient.address, await token.getAddress(), amount
        )
      ).to.be.revertedWith("Not authorized");
    });

    it("should reject payment with revoked session key", async function () {
      await wallet.connect(owner).revokeSessionKey(paySessionKey.address);
      const amount = ethers.parseEther("1");
      await expect(
        wallet.connect(paySessionKey).executePayment(
          paySessionKey.address, recipient.address, await token.getAddress(), amount
        )
      ).to.be.revertedWith("Session key not active");
    });
  });

  describe("Funds Management", function () {
    it("should allow deposits and track per-user balance", async function () {
      await wallet.connect(other).register();
      const depositAmount = ethers.parseEther("500");
      await token.transfer(other.address, depositAmount);
      await token.connect(other).approve(await wallet.getAddress(), depositAmount);
      await wallet.connect(other).deposit(await token.getAddress(), depositAmount);

      expect(await wallet.getUserBalance(other.address, await token.getAddress())).to.equal(depositAmount);
      expect(await wallet.getUserBalance(owner.address, await token.getAddress())).to.equal(ethers.parseEther("10000"));
    });

    it("should allow user to withdraw their own balance", async function () {
      const withdrawAmount = ethers.parseEther("100");
      const ownerBalBefore = await token.balanceOf(owner.address);
      await wallet.connect(owner).withdraw(await token.getAddress(), withdrawAmount);
      const ownerBalAfter = await token.balanceOf(owner.address);
      expect(ownerBalAfter - ownerBalBefore).to.equal(withdrawAmount);
      expect(await wallet.getUserBalance(owner.address, await token.getAddress())).to.equal(ethers.parseEther("9900"));
    });

    it("should reject withdrawal exceeding balance", async function () {
      await expect(
        wallet.connect(owner).withdraw(await token.getAddress(), ethers.parseEther("99999"))
      ).to.be.revertedWith("Insufficient balance");
    });

    it("should reject deposit from unregistered user", async function () {
      await expect(
        wallet.connect(other).deposit(await token.getAddress(), ethers.parseEther("1"))
      ).to.be.revertedWith("Not registered");
    });

    it("should reject withdrawal from unregistered user", async function () {
      await expect(
        wallet.connect(other).withdraw(await token.getAddress(), ethers.parseEther("1"))
      ).to.be.revertedWith("Not registered");
    });
  });
});
