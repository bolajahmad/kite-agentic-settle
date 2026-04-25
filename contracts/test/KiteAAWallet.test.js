const { expect }  = require("chai");
const { ethers }  = require("hardhat");

describe("KiteAAWallet", function () {
  let wallet, registry, token;
  let deployer, alice, bob, carol, sessionKey, provider;

  const TEN   = ethers.parseEther("10");
  const FIFTY = ethers.parseEther("50");
  const ONE   = ethers.parseEther("1");

  async function futureTs(offsetSec = 3600) {
    const blk = await ethers.provider.getBlock("latest");
    return BigInt(blk.timestamp) + BigInt(offsetSec);
  }

  /** Sign an EIP-712 Payment authorisation with the given ethers signer. */
  async function signPayment(signer, { agentId: aid, sessionKey: sk, recipient, token: tok, amount, nonce, deadline }) {
    const domain = {
      name: "KiteAAWallet",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await wallet.getAddress(),
    };
    const types = {
      Payment: [
        { name: "agentId",   type: "uint256" },
        { name: "sessionKey", type: "address" },
        { name: "recipient",  type: "address" },
        { name: "token",      type: "address" },
        { name: "amount",     type: "uint256" },
        { name: "nonce",      type: "uint256" },
        { name: "deadline",   type: "uint256" },
      ],
    };
    return signer.signTypedData(domain, types, { agentId: aid, sessionKey: sk, recipient, token: tok, amount, nonce, deadline });
  }

  beforeEach(async function () {
    [deployer, alice, bob, carol, sessionKey, provider] = await ethers.getSigners();
    const MockERC20F = await ethers.getContractFactory("MockERC20");
    const RegistryF  = await ethers.getContractFactory("IdentityRegistry");
    const WalletF    = await ethers.getContractFactory("KiteAAWallet");
    token    = await MockERC20F.deploy("USDC", "USDC", ethers.parseEther("1000000"));
    registry = await RegistryF.deploy();
    wallet   = await WalletF.deploy();
    await wallet.setIdentityRegistry(await registry.getAddress());
    await token.transfer(alice.address, FIFTY);
    await wallet.connect(alice).register();
  });

  describe("register / deposit / withdraw", function () {
    it("registers a user", async function () {
      expect(await wallet.isRegistered(alice.address)).to.be.true;
      expect(await wallet.isRegistered(bob.address)).to.be.false;
    });
    it("cannot register twice", async function () {
      await expect(wallet.connect(alice).register()).to.be.revertedWith("Already registered");
    });
    it("deposits and tracks balance", async function () {
      await token.connect(alice).approve(await wallet.getAddress(), TEN);
      await expect(wallet.connect(alice).deposit(await token.getAddress(), TEN))
        .to.emit(wallet, "FundsDeposited")
        .withArgs(alice.address, await token.getAddress(), TEN);
      expect(await wallet.getUserBalance(alice.address, await token.getAddress())).to.equal(TEN);
    });
    it("withdraws tokens", async function () {
      await token.connect(alice).approve(await wallet.getAddress(), TEN);
      await wallet.connect(alice).deposit(await token.getAddress(), TEN);
      await expect(wallet.connect(alice).withdraw(await token.getAddress(), TEN))
        .to.emit(wallet, "FundsWithdrawn");
      expect(await wallet.getUserBalance(alice.address, await token.getAddress())).to.equal(0n);
    });
    it("reverts withdrawal when balance insufficient", async function () {
      await expect(wallet.connect(alice).withdraw(await token.getAddress(), ONE))
        .to.be.revertedWith("Insufficient balance");
    });
  });

  describe("addSessionKeyRule / revokeSessionKey", function () {
    let agentId;
    beforeEach(async function () {
      await registry.connect(alice)["register(string)"]("ipfs://alice-agent");
      agentId = 1n;
    });
    it("proxies registerSession to IdentityRegistry", async function () {
      const validUntil = await futureTs();
      await expect(wallet.connect(alice).addSessionKeyRule(agentId, sessionKey.address, ONE, TEN, validUntil, []))
        .to.emit(registry, "SessionRegistered");
      const [active, , user, wc] = await registry.validateSession(sessionKey.address);
      expect(active).to.be.true;
      expect(user).to.equal(alice.address);
      expect(wc).to.equal(await wallet.getAddress());
    });
    it("proxies revokeSession to IdentityRegistry", async function () {
      const validUntil = await futureTs();
      await wallet.connect(alice).addSessionKeyRule(agentId, sessionKey.address, ONE, TEN, validUntil, []);
      await wallet.connect(alice).revokeSessionKey(sessionKey.address);
      const [active] = await registry.validateSession(sessionKey.address);
      expect(active).to.be.false;
    });
    it("unregistered user cannot add session key rule", async function () {
      const validUntil = await futureTs();
      await expect(wallet.connect(bob).addSessionKeyRule(agentId, sessionKey.address, ONE, TEN, validUntil, []))
        .to.be.revertedWith("Not registered");
    });
  });

  describe("executePayment (sig-based, x402)", function () {
    let agentId, tokenAddr, deadline;

    beforeEach(async function () {
      await token.connect(alice).approve(await wallet.getAddress(), FIFTY);
      await wallet.connect(alice).deposit(await token.getAddress(), FIFTY);
      await registry.connect(alice)["register(string)"]("ipfs://a");
      agentId = 1n;
      const validUntil = await futureTs(7200); // 2 h
      await wallet.connect(alice).addSessionKeyRule(agentId, sessionKey.address, TEN, FIFTY, validUntil, []);
      tokenAddr = await token.getAddress();
      deadline  = await futureTs(3600); // 1 h
    });

    it("facilitator submits a session-key-signed payment", async function () {
      const nonce = 1n;
      const sig = await signPayment(sessionKey, {
        agentId, sessionKey: sessionKey.address, recipient: provider.address,
        token: tokenAddr, amount: ONE, nonce, deadline,
      });
      const before = await token.balanceOf(provider.address);
      // deployer = facilitator/server — anyone can submit the signed payload
      await wallet.connect(deployer).executePayment(
        agentId, sessionKey.address, provider.address, tokenAddr, ONE, nonce, deadline, sig
      );
      expect(await token.balanceOf(provider.address)).to.equal(before + ONE);
      expect(await wallet.getUserBalance(alice.address, tokenAddr)).to.equal(FIFTY - ONE);
    });

    it("tracks sessionSpent across payments", async function () {
      for (let i = 1n; i <= 2n; i++) {
        const sig = await signPayment(sessionKey, {
          agentId, sessionKey: sessionKey.address, recipient: provider.address,
          token: tokenAddr, amount: ONE, nonce: i, deadline,
        });
        await wallet.executePayment(agentId, sessionKey.address, provider.address, tokenAddr, ONE, i, deadline, sig);
      }
      expect(await wallet.getSessionSpent(sessionKey.address)).to.equal(ONE * 2n);
    });

    it("rejects a replayed nonce", async function () {
      const nonce = 42n;
      const sig = await signPayment(sessionKey, {
        agentId, sessionKey: sessionKey.address, recipient: provider.address,
        token: tokenAddr, amount: ONE, nonce, deadline,
      });
      await wallet.executePayment(agentId, sessionKey.address, provider.address, tokenAddr, ONE, nonce, deadline, sig);
      await expect(
        wallet.executePayment(agentId, sessionKey.address, provider.address, tokenAddr, ONE, nonce, deadline, sig)
      ).to.be.revertedWith("Nonce already used");
    });

    it("rejects an expired deadline", async function () {
      const past = BigInt(Math.floor(Date.now() / 1000) - 1);
      const sig = await signPayment(sessionKey, {
        agentId, sessionKey: sessionKey.address, recipient: provider.address,
        token: tokenAddr, amount: ONE, nonce: 1n, deadline: past,
      });
      await expect(
        wallet.executePayment(agentId, sessionKey.address, provider.address, tokenAddr, ONE, 1n, past, sig)
      ).to.be.revertedWith("Signature expired");
    });

    it("rejects a signature from the wrong signer", async function () {
      const nonce = 1n;
      const sig = await signPayment(bob, { // bob signs, not the session key
        agentId, sessionKey: sessionKey.address, recipient: provider.address,
        token: tokenAddr, amount: ONE, nonce, deadline,
      });
      await expect(
        wallet.executePayment(agentId, sessionKey.address, provider.address, tokenAddr, ONE, nonce, deadline, sig)
      ).to.be.revertedWith("Invalid signature");
    });

    it("reverts when per-tx limit exceeded", async function () {
      const nonce = 1n;
      const sig = await signPayment(sessionKey, {
        agentId, sessionKey: sessionKey.address, recipient: provider.address,
        token: tokenAddr, amount: TEN + 1n, nonce, deadline,
      });
      await expect(
        wallet.executePayment(agentId, sessionKey.address, provider.address, tokenAddr, TEN + 1n, nonce, deadline, sig)
      ).to.be.revertedWith("Exceeds per-tx limit");
    });

    it("reverts when lifetime limit exceeded", async function () {
      for (let i = 1n; i <= 5n; i++) {
        const sig = await signPayment(sessionKey, {
          agentId, sessionKey: sessionKey.address, recipient: provider.address,
          token: tokenAddr, amount: TEN, nonce: i, deadline,
        });
        await wallet.executePayment(agentId, sessionKey.address, provider.address, tokenAddr, TEN, i, deadline, sig);
      }
      const sig = await signPayment(sessionKey, {
        agentId, sessionKey: sessionKey.address, recipient: provider.address,
        token: tokenAddr, amount: ONE, nonce: 99n, deadline,
      });
      await expect(
        wallet.executePayment(agentId, sessionKey.address, provider.address, tokenAddr, ONE, 99n, deadline, sig)
      ).to.be.revertedWith("Exceeds session limit");
    });

    it("reverts when agent is blocked at session level", async function () {
      // Revoke current session, re-create with agentId blocked
      await registry.connect(alice).revokeSession(sessionKey.address);
      const validUntil = await futureTs(7200);
      await wallet.connect(alice).addSessionKeyRule(agentId, sessionKey.address, TEN, FIFTY, validUntil, [agentId]);
      const nonce = 1n;
      const sig = await signPayment(sessionKey, {
        agentId, sessionKey: sessionKey.address, recipient: provider.address,
        token: tokenAddr, amount: ONE, nonce, deadline,
      });
      await expect(
        wallet.executePayment(agentId, sessionKey.address, provider.address, tokenAddr, ONE, nonce, deadline, sig)
      ).to.be.revertedWith("Agent is blocked for this session");
    });

    it("reverts when recipient is blocked at user level", async function () {
      // Alice blocks the provider at user level
      await wallet.connect(alice).setBlockedProvider(provider.address, true);
      const nonce = 1n;
      const sig = await signPayment(sessionKey, {
        agentId, sessionKey: sessionKey.address, recipient: provider.address,
        token: tokenAddr, amount: ONE, nonce, deadline,
      });
      await expect(
        wallet.executePayment(agentId, sessionKey.address, provider.address, tokenAddr, ONE, nonce, deadline, sig)
      ).to.be.revertedWith("Recipient is blocked by user");
    });

    it("user can unblock a provider", async function () {
      await wallet.connect(alice).setBlockedProvider(provider.address, true);
      await wallet.connect(alice).setBlockedProvider(provider.address, false);
      const nonce = 1n;
      const sig = await signPayment(sessionKey, {
        agentId, sessionKey: sessionKey.address, recipient: provider.address,
        token: tokenAddr, amount: ONE, nonce, deadline,
      });
      await wallet.executePayment(agentId, sessionKey.address, provider.address, tokenAddr, ONE, nonce, deadline, sig);
      expect(await wallet.getUserBalance(alice.address, tokenAddr)).to.equal(FIFTY - ONE);
    });

    it("reverts when session is revoked", async function () {
      await wallet.connect(alice).revokeSessionKey(sessionKey.address);
      const nonce = 1n;
      const sig = await signPayment(sessionKey, {
        agentId, sessionKey: sessionKey.address, recipient: provider.address,
        token: tokenAddr, amount: ONE, nonce, deadline,
      });
      await expect(
        wallet.executePayment(agentId, sessionKey.address, provider.address, tokenAddr, ONE, nonce, deadline, sig)
      ).to.be.revertedWith("Session key not active");
    });

    it("isNonceUsed reflects consumed nonces", async function () {
      const nonce = 77n;
      const sig = await signPayment(sessionKey, {
        agentId, sessionKey: sessionKey.address, recipient: provider.address,
        token: tokenAddr, amount: ONE, nonce, deadline,
      });
      expect(await wallet.isNonceUsed(sessionKey.address, nonce)).to.be.false;
      await wallet.executePayment(agentId, sessionKey.address, provider.address, tokenAddr, ONE, nonce, deadline, sig);
      expect(await wallet.isNonceUsed(sessionKey.address, nonce)).to.be.true;
    });
  });

  describe("withdrawForChannel / refundFromChannel", function () {
    let fakeChannel;
    beforeEach(async function () {
      fakeChannel = bob;
      await wallet.setPaymentChannel(fakeChannel.address);
      await token.connect(alice).approve(await wallet.getAddress(), TEN);
      await wallet.connect(alice).deposit(await token.getAddress(), TEN);
    });
    it("PaymentChannel can pull user funds", async function () {
      await expect(wallet.connect(fakeChannel).withdrawForChannel(alice.address, await token.getAddress(), TEN))
        .to.emit(wallet, "ChannelFundsWithdrawn");
      expect(await wallet.getUserBalance(alice.address, await token.getAddress())).to.equal(0n);
    });
    it("reverts if not paymentChannel", async function () {
      await expect(wallet.connect(carol).withdrawForChannel(alice.address, await token.getAddress(), ONE))
        .to.be.revertedWith("Only PaymentChannel");
    });
    it("PaymentChannel can refund user funds", async function () {
      await wallet.connect(fakeChannel).withdrawForChannel(alice.address, await token.getAddress(), TEN);
      await token.connect(fakeChannel).approve(await wallet.getAddress(), TEN);
      await expect(wallet.connect(fakeChannel).refundFromChannel(alice.address, await token.getAddress(), TEN))
        .to.emit(wallet, "ChannelFundsRefunded");
      expect(await wallet.getUserBalance(alice.address, await token.getAddress())).to.equal(TEN);
    });
  });
});
