const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("KiteAAWallet", function () {
  let wallet, token, owner, sessionKey, recipient, other;
  const agentId = ethers.id("agent-claude-v1");
  const ONE_DAY = 86400;
  const VALUE_LIMIT = ethers.parseEther("10");
  const DAILY_LIMIT = ethers.parseEther("50");

  beforeEach(async function () {
    [owner, sessionKey, recipient, other] = await ethers.getSigners();

    // Deploy a mock ERC20 for payments
    const MockToken = await ethers.getContractFactory("MockERC20");
    token = await MockToken.deploy("Mock USDC", "mUSDC", ethers.parseEther("1000000"));
    await token.waitForDeployment();

    // Deploy wallet
    const KiteAAWallet = await ethers.getContractFactory("KiteAAWallet");
    wallet = await KiteAAWallet.deploy(owner.address);
    await wallet.waitForDeployment();

    // Fund the wallet with tokens
    await token.transfer(wallet.getAddress(), ethers.parseEther("10000"));
  });

  describe("Session Key Management", function () {
    it("should add a session key rule", async function () {
      const expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      await wallet.addSessionKeyRule(
        sessionKey.address, agentId, VALUE_LIMIT, DAILY_LIMIT, expiry, [recipient.address]
      );

      const rule = await wallet.getSessionRule(sessionKey.address);
      expect(rule.agentId).to.equal(agentId);
      expect(rule.valueLimit).to.equal(VALUE_LIMIT);
      expect(rule.dailyLimit).to.equal(DAILY_LIMIT);
      expect(rule.active).to.be.true;
    });

    it("should reject session key from non-owner", async function () {
      const expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      await expect(
        wallet.connect(other).addSessionKeyRule(
          sessionKey.address, agentId, VALUE_LIMIT, DAILY_LIMIT, expiry, []
        )
      ).to.be.revertedWithCustomError(wallet, "OwnableUnauthorizedAccount");
    });

    it("should revoke a session key", async function () {
      const expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      await wallet.addSessionKeyRule(
        sessionKey.address, agentId, VALUE_LIMIT, DAILY_LIMIT, expiry, []
      );
      await wallet.revokeSessionKey(sessionKey.address);

      const rule = await wallet.getSessionRule(sessionKey.address);
      expect(rule.active).to.be.false;
    });

    it("should revoke all agent sessions", async function () {
      const expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      await wallet.addSessionKeyRule(
        sessionKey.address, agentId, VALUE_LIMIT, DAILY_LIMIT, expiry, []
      );
      await wallet.addSessionKeyRule(
        other.address, agentId, VALUE_LIMIT, DAILY_LIMIT, expiry, []
      );

      await wallet.revokeAllAgentSessions(agentId);

      expect(await wallet.isSessionValid(sessionKey.address)).to.be.false;
      expect(await wallet.isSessionValid(other.address)).to.be.false;
    });

    it("should reject zero address session key", async function () {
      const expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      await expect(
        wallet.addSessionKeyRule(ethers.ZeroAddress, agentId, VALUE_LIMIT, DAILY_LIMIT, expiry, [])
      ).to.be.revertedWith("Invalid session key");
    });

    it("should reject expired session key rule", async function () {
      const pastExpiry = Math.floor(Date.now() / 1000) - 100;
      await expect(
        wallet.addSessionKeyRule(sessionKey.address, agentId, VALUE_LIMIT, DAILY_LIMIT, pastExpiry, [])
      ).to.be.revertedWith("Expiry must be in future");
    });
  });

  describe("Payment Execution", function () {
    let expiry;

    beforeEach(async function () {
      expiry = Math.floor(Date.now() / 1000) + ONE_DAY;
      await wallet.addSessionKeyRule(
        sessionKey.address, agentId, VALUE_LIMIT, DAILY_LIMIT, expiry, [recipient.address]
      );
    });

    it("should execute payment via session key", async function () {
      const amount = ethers.parseEther("5");
      const recipientBalBefore = await token.balanceOf(recipient.address);

      await wallet.connect(sessionKey).executePayment(
        sessionKey.address, recipient.address, await token.getAddress(), amount
      );

      const recipientBalAfter = await token.balanceOf(recipient.address);
      expect(recipientBalAfter - recipientBalBefore).to.equal(amount);
    });

    it("should execute payment via owner on behalf of session key", async function () {
      const amount = ethers.parseEther("5");
      await wallet.connect(owner).executePayment(
        sessionKey.address, recipient.address, await token.getAddress(), amount
      );

      expect(await token.balanceOf(recipient.address)).to.equal(amount);
    });

    it("should reject payment exceeding per-tx limit", async function () {
      const amount = ethers.parseEther("15"); // > 10 limit
      await expect(
        wallet.connect(sessionKey).executePayment(
          sessionKey.address, recipient.address, await token.getAddress(), amount
        )
      ).to.be.revertedWith("Exceeds per-tx limit");
    });

    it("should reject payment to non-allowed recipient", async function () {
      const amount = ethers.parseEther("5");
      await expect(
        wallet.connect(sessionKey).executePayment(
          sessionKey.address, other.address, await token.getAddress(), amount
        )
      ).to.be.revertedWith("Recipient not in allowlist");
    });

    it("should enforce daily limit across multiple payments", async function () {
      const amount = ethers.parseEther("10");
      // 5 payments of 10 = 50 (at daily limit)
      for (let i = 0; i < 5; i++) {
        await wallet.connect(sessionKey).executePayment(
          sessionKey.address, recipient.address, await token.getAddress(), amount
        );
      }
      // 6th should fail
      await expect(
        wallet.connect(sessionKey).executePayment(
          sessionKey.address, recipient.address, await token.getAddress(), amount
        )
      ).to.be.revertedWith("Exceeds daily limit");
    });

    it("should reject payment from unauthorized caller", async function () {
      const amount = ethers.parseEther("1");
      await expect(
        wallet.connect(other).executePayment(
          sessionKey.address, recipient.address, await token.getAddress(), amount
        )
      ).to.be.revertedWith("Not authorized");
    });

    it("should reject payment with revoked session key", async function () {
      await wallet.revokeSessionKey(sessionKey.address);
      const amount = ethers.parseEther("1");
      await expect(
        wallet.connect(sessionKey).executePayment(
          sessionKey.address, recipient.address, await token.getAddress(), amount
        )
      ).to.be.revertedWith("Session key not active");
    });

    it("should allow any recipient when allowlist is empty", async function () {
      // Create a session key with empty allowlist
      await wallet.addSessionKeyRule(
        other.address, agentId, VALUE_LIMIT, DAILY_LIMIT, expiry, []
      );
      const amount = ethers.parseEther("1");
      await wallet.connect(other).executePayment(
        other.address, recipient.address, await token.getAddress(), amount
      );
      expect(await token.balanceOf(recipient.address)).to.equal(amount);
    });
  });

  describe("Funds Management", function () {
    it("should allow deposits", async function () {
      const depositAmount = ethers.parseEther("500");
      await token.approve(wallet.getAddress(), depositAmount);
      await wallet.deposit(await token.getAddress(), depositAmount);

      expect(await token.balanceOf(wallet.getAddress())).to.equal(
        ethers.parseEther("10000") + depositAmount
      );
    });

    it("should allow owner to withdraw", async function () {
      const withdrawAmount = ethers.parseEther("100");
      const ownerBalBefore = await token.balanceOf(owner.address);
      await wallet.withdraw(await token.getAddress(), withdrawAmount);
      const ownerBalAfter = await token.balanceOf(owner.address);
      expect(ownerBalAfter - ownerBalBefore).to.equal(withdrawAmount);
    });

    it("should reject non-owner withdrawal", async function () {
      await expect(
        wallet.connect(other).withdraw(await token.getAddress(), ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(wallet, "OwnableUnauthorizedAccount");
    });
  });
});
