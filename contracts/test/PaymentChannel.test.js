const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-network-helpers");

describe("PaymentChannel", function () {
  let channel, wallet, registry, token;
  let deployer, alice, bob, carol, sessionKey, providerSigner;

  const DEPOSIT  = ethers.parseEther("100");
  const MAX_SPEND = ethers.parseEther("100");
  const PER_CALL  = ethers.parseEther("10");
  const ONE_ETH   = ethers.parseEther("1");
  const HOUR      = 3600;
  const DAY       = 86400;

  async function futureTs(offsetSec) {
    const blk = await ethers.provider.getBlock("latest");
    return BigInt(blk.timestamp) + BigInt(offsetSec);
  }

  async function setupSession(opts = {}) {
    const validUntil = await futureTs(opts.sessionDur ?? DAY * 2);
    const valueLimit = opts.valueLimit ?? PER_CALL;
    const maxValue   = opts.maxValue   ?? MAX_SPEND;
    const blocked    = opts.blocked    ?? [];
    await wallet.connect(alice).addSessionKeyRule(1n, sessionKey.address, valueLimit, maxValue, validUntil, blocked);
  }

  async function openChannel(opts = {}) {
    const mode     = opts.mode    ?? 0; // Prepaid
    const deposit  = opts.deposit ?? DEPOSIT;
    const maxSpend = opts.maxSpend ?? MAX_SPEND;
    const maxDur   = opts.maxDur  ?? HOUR;
    const perCall  = opts.perCall ?? PER_CALL;
    return channel.connect(sessionKey).openChannel(
      providerSigner.address,
      await token.getAddress(),
      mode,
      deposit,
      maxSpend,
      maxDur,
      perCall,
      await wallet.getAddress()
    );
  }

  function signReceipt(channelId, seq, cost, ts, signer) {
    const hash = ethers.solidityPackedKeccak256(
      ["bytes32", "uint256", "uint256", "uint256"],
      [channelId, seq, cost, ts]
    );
    return signer.signMessage(ethers.getBytes(hash));
  }

  beforeEach(async function () {
    [deployer, alice, bob, carol, sessionKey, providerSigner] = await ethers.getSigners();

    const MockERC20F = await ethers.getContractFactory("MockERC20");
    const RegistryF  = await ethers.getContractFactory("IdentityRegistry");
    const WalletF    = await ethers.getContractFactory("KiteAAWallet");
    const ChannelF   = await ethers.getContractFactory("PaymentChannel");

    token    = await MockERC20F.deploy("USDC", "USDC", ethers.parseEther("10000000"));
    registry = await RegistryF.deploy();
    wallet   = await WalletF.deploy();
    channel  = await ChannelF.deploy();

    // Wire up
    await wallet.setIdentityRegistry(await registry.getAddress());
    await wallet.setPaymentChannel(await channel.getAddress());

    // Fund alice
    await token.transfer(alice.address, ethers.parseEther("1000"));
    await wallet.connect(alice).register();
    await token.connect(alice).approve(await wallet.getAddress(), ethers.parseEther("1000"));
    await wallet.connect(alice).deposit(await token.getAddress(), ethers.parseEther("1000"));

    // Register agent
    await registry.connect(alice)["register(string)"]("ipfs://alice-agent");
  });

  // ─── openChannel ──────────────────────────────────────────────────

  describe("openChannel (prepaid)", function () {
    beforeEach(async function () { await setupSession(); });

    it("opens a channel and emits ChannelOpened", async function () {
      const tx = await openChannel();
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment?.name === "ChannelOpened");
      expect(ev).to.not.be.undefined;
      expect(ev.args.consumer).to.equal(sessionKey.address);
      expect(ev.args.provider).to.equal(providerSigner.address);
    });

    it("locks deposit in channel contract", async function () {
      const tx = await openChannel();
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment?.name === "ChannelOpened");
      const channelId = ev.args.channelId;
      expect(await channel.getLockedFunds(await wallet.getAddress(), await token.getAddress()))
        .to.equal(DEPOSIT);
    });

    it("stores the user (EOA) derived from session", async function () {
      const tx = await openChannel();
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment?.name === "ChannelOpened");
      const channelId = ev.args.channelId;
      const [consumer, user] = await channel.getChannel(channelId);
      expect(consumer).to.equal(sessionKey.address);
      expect(user).to.equal(alice.address);
    });

    it("rejects when session maxPerCall < channel maxPerCall", async function () {
      await expect(openChannel({ perCall: PER_CALL + 1n }))
        .to.be.revertedWith("maxPerCall exceeds session valueLimit");
    });

    it("rejects when session maxValueAllowed < maxSpend", async function () {
      await expect(openChannel({ maxSpend: MAX_SPEND + 1n }))
        .to.be.revertedWith("maxSpend exceeds session maxValueAllowed");
    });

    it("rejects when channel duration exceeds session validity", async function () {
      // Session valid for 2 days; channel duration 3 days — would exceed session
      await expect(openChannel({ maxDur: DAY * 3 }))
        .to.be.revertedWith("Channel duration exceeds session validity");
    });

    it("rejects when provider is blocked", async function () {
      // User-level provider blocklist lives on KiteAAWallet now
      await wallet.connect(alice).setBlockedProvider(providerSigner.address, true);
      await expect(openChannel()).to.be.revertedWith("Provider is blocked by this user");
      // Cleanup
      await wallet.connect(alice).setBlockedProvider(providerSigner.address, false);
    });

    it("rejects when session is inactive", async function () {
      await registry.connect(alice).revokeSession(sessionKey.address);
      await expect(openChannel()).to.be.revertedWith("Session key is not active");
    });
  });

  describe("openChannel (postpaid)", function () {
    beforeEach(async function () { await setupSession(); });

    it("opens postpaid channel with 0 deposit", async function () {
      await expect(openChannel({ mode: 1, deposit: 0n })).to.not.be.reverted;
    });

    it("rejects postpaid with non-zero deposit", async function () {
      await expect(openChannel({ mode: 1, deposit: ONE_ETH }))
        .to.be.revertedWith("Postpaid must have 0 deposit");
    });
  });

  // ─── activateChannel ──────────────────────────────────────────────

  describe("activateChannel", function () {
    let channelId;
    beforeEach(async function () {
      await setupSession();
      const tx = await openChannel();
      const receipt = await tx.wait();
      channelId = receipt.logs.find(l => l.fragment?.name === "ChannelOpened").args.channelId;
    });

    it("provider can activate", async function () {
      await expect(channel.connect(providerSigner).activateChannel(channelId))
        .to.emit(channel, "ChannelActivated").withArgs(channelId);
    });

    it("non-provider cannot activate", async function () {
      await expect(channel.connect(alice).activateChannel(channelId))
        .to.be.revertedWith("Only provider can activate");
    });
  });

  // ─── Settlement ───────────────────────────────────────────────────

  async function openAndActivate(opts = {}) {
    await setupSession(opts.session ?? {});
    const tx = await openChannel(opts.channel ?? {});
    const receipt = await tx.wait();
    const channelId = receipt.logs.find(l => l.fragment?.name === "ChannelOpened").args.channelId;
    await channel.connect(providerSigner).activateChannel(channelId);
    return channelId;
  }

  describe("initiateSettlement / submitReceipt / finalize", function () {
    let channelId;

    beforeEach(async function () { channelId = await openAndActivate(); });

    it("consumer can initiate settlement with zero claim", async function () {
      await expect(channel.connect(sessionKey).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      )).to.emit(channel, "SettlementInitiated");
    });

    it("full prepaid settlement: payment to provider, refund to wallet", async function () {
      const seq  = 3n;
      const cost = ethers.parseEther("30");
      const ts   = BigInt(Math.floor(Date.now() / 1000));
      const sig  = await signReceipt(channelId, seq, cost, ts, providerSigner);

      await channel.connect(sessionKey).initiateSettlement(
        channelId, seq, cost, ts, sig, ethers.ZeroHash
      );

      const blk = await ethers.provider.getBlock("latest");
      await time.increase(3601); // past challenge window

      const providerBalBefore = await token.balanceOf(providerSigner.address);
      const userBalBefore     = await wallet.getUserBalance(alice.address, await token.getAddress());

      await channel.finalize(channelId, ethers.ZeroHash);

      const providerBalAfter = await token.balanceOf(providerSigner.address);
      const userBalAfter     = await wallet.getUserBalance(alice.address, await token.getAddress());

      expect(providerBalAfter - providerBalBefore).to.equal(cost);
      // Refund = deposit - cost
      expect(userBalAfter - userBalBefore).to.equal(DEPOSIT - cost);
    });

    it("submitReceipt upgrades highest claim", async function () {
      // Start with zero claim
      await channel.connect(sessionKey).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );

      const seq  = 2n;
      const cost = ethers.parseEther("20");
      const ts   = BigInt(Math.floor(Date.now() / 1000));
      const sig  = await signReceipt(channelId, seq, cost, ts, providerSigner);

      await expect(channel.connect(providerSigner).submitReceipt(
        channelId, seq, cost, ts, sig
      )).to.emit(channel, "ReceiptSubmitted");

      const [, highestCost] = await channel.getSettlementState(channelId);
      expect(highestCost).to.equal(cost);
    });

    it("reverts finalize before challenge window closes", async function () {
      await channel.connect(sessionKey).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );
      await expect(channel.finalize(channelId, ethers.ZeroHash))
        .to.be.revertedWith("Challenge window still open");
    });
  });

  describe("forceCloseExpired", function () {
    it("force-closes after expiry + grace period", async function () {
      const channelId = await openAndActivate({ channel: { maxDur: HOUR } });
      await time.increase(HOUR + 301); // 5 min grace + 1s
      await expect(channel.forceCloseExpired(channelId))
        .to.emit(channel, "SettlementInitiated");
    });

    it("rejects before grace period elapsed", async function () {
      const channelId = await openAndActivate({ channel: { maxDur: HOUR } });
      await time.increase(HOUR); // not yet past grace
      await expect(channel.forceCloseExpired(channelId))
        .to.be.revertedWith("Not yet expired + grace");
    });
  });

  // ─── Receipt Hash ─────────────────────────────────────────────────

  describe("getReceiptHash", function () {
    it("is deterministic", async function () {
      const h1 = await channel.getReceiptHash(ethers.ZeroHash, 1n, 100n, 999n);
      const h2 = await channel.getReceiptHash(ethers.ZeroHash, 1n, 100n, 999n);
      expect(h1).to.equal(h2);
    });
  });
});
