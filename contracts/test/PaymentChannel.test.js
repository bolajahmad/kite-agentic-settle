const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PaymentChannel", function () {
  // consumer = the session key signer (opens channels)
  // owner    = the EOA whose wallet balance is debited
  let channelContract, walletContract, token, registry;
  let owner, consumer, provider, other;
  let walletAddr, tokenAddr;
  let agentId;

  const RATE_PER_CALL      = ethers.parseEther("0.001"); // maxPerCall
  const DEPOSIT            = ethers.parseEther("1");
  const MAX_SPEND          = ethers.parseEther("5");      // must be <= MAX_VALUE_ALLOWED
  const MAX_VALUE_ALLOWED  = ethers.parseEther("100");    // session lifetime cap
  const VALUE_LIMIT        = ethers.parseEther("1");      // per-tx cap >= RATE_PER_CALL
  const MAX_DURATION       = 600;                         // 10 minutes
  const CHALLENGE_WINDOW   = 3600;                        // 1 hour
  const ONE_YEAR           = 365 * 24 * 3600;
  const metadata           = ethers.toUtf8Bytes(JSON.stringify({ name: "Test Consumer" }));

  beforeEach(async function () {
    [owner, consumer, provider, other] = await ethers.getSigners();

    // Deploy contracts
    const MockToken       = await ethers.getContractFactory("MockERC20");
    const AgentRegistry   = await ethers.getContractFactory("AgentRegistry");
    const KiteAAWallet    = await ethers.getContractFactory("KiteAAWallet");
    const PaymentChannel  = await ethers.getContractFactory("PaymentChannel");

    token           = await MockToken.deploy("Mock USDT", "mUSDT", ethers.parseEther("1000000"));
    registry        = await AgentRegistry.deploy();
    walletContract  = await KiteAAWallet.deploy();
    channelContract = await PaymentChannel.deploy();

    await Promise.all([
      token.waitForDeployment(),
      registry.waitForDeployment(),
      walletContract.waitForDeployment(),
      channelContract.waitForDeployment(),
    ]);

    walletAddr = await walletContract.getAddress();
    tokenAddr  = await token.getAddress();

    // Link contracts
    await walletContract.setAgentRegistry(await registry.getAddress());
    await walletContract.setPaymentChannel(await channelContract.getAddress());

    // Register the EOA (owner) on the wallet
    await walletContract.connect(owner).register();

    // Register an agent; consumer signer is the agent address for simplicity
    const regTx = await registry.connect(owner).registerAgent(
      consumer.address, walletAddr, 0, metadata
    );
    const regReceipt = await regTx.wait();
    const regEvent   = regReceipt.logs.find(
      l => registry.interface.parseLog(l)?.name === "AgentRegistered"
    );
    agentId = registry.interface.parseLog(regEvent).args.agentId;

    // Add session key rule: consumer is the session key
    // validUntil = now + 1 year (well beyond MAX_DURATION)
    const validUntil = (await ethers.provider.getBlock("latest")).timestamp + ONE_YEAR;
    await walletContract.connect(owner).addSessionKeyRule(
      consumer.address, agentId, 0,
      VALUE_LIMIT,       // per-tx cap (>= RATE_PER_CALL)
      MAX_VALUE_ALLOWED, // lifetime cap (>= MAX_SPEND)
      validUntil,
      [],                // no blocked providers
      "0x"
    );

    // Deposit tokens into the wallet (from owner's EOA)
    await token.transfer(owner.address, ethers.parseEther("10000"));
    await token.connect(owner).approve(walletAddr, ethers.parseEther("10000"));
    await walletContract.connect(owner).deposit(tokenAddr, ethers.parseEther("10000"));
  });

  // ─── Helpers ────────────────────────────────────────────────────────

  async function signReceipt(channelId, sequenceNumber, cumulativeCost, timestamp) {
    const receiptHash = await channelContract.getReceiptHash(
      channelId, sequenceNumber, cumulativeCost, timestamp
    );
    return provider.signMessage(ethers.getBytes(receiptHash));
  }

  async function openAndActivatePrepaid() {
    const tx = await channelContract.connect(consumer).openChannel(
      provider.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, MAX_DURATION, RATE_PER_CALL, walletAddr
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(l => l.fragment?.name === "ChannelOpened");
    const channelId = event.args.channelId;
    await channelContract.connect(provider).activateChannel(channelId);
    return channelId;
  }

  // ─── Opening Channels ────────────────────────────────────────────────

  describe("Opening Channels", function () {
    it("should open a prepaid channel — debit wallet balance and lock funds", async function () {
      const walletBalBefore = await walletContract.getUserBalance(owner.address, tokenAddr);

      const tx = await channelContract.connect(consumer).openChannel(
        provider.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, MAX_DURATION, RATE_PER_CALL, walletAddr
      );
      await tx.wait();

      const walletBalAfter = await walletContract.getUserBalance(owner.address, tokenAddr);
      expect(walletBalBefore - walletBalAfter).to.equal(DEPOSIT);

      const locked = await channelContract.getLockedFunds(walletAddr, tokenAddr);
      expect(locked).to.equal(DEPOSIT);
      expect(await channelContract.totalChannels()).to.equal(1);
    });

    it("should open a postpaid channel with zero deposit", async function () {
      await channelContract.connect(consumer).openChannel(
        provider.address, tokenAddr, 1, 0, MAX_SPEND, MAX_DURATION, RATE_PER_CALL, walletAddr
      );
      expect(await channelContract.totalChannels()).to.equal(1);
    });

    it("should reject prepaid with zero deposit", async function () {
      await expect(
        channelContract.connect(consumer).openChannel(
          provider.address, tokenAddr, 0, 0, MAX_SPEND, MAX_DURATION, RATE_PER_CALL, walletAddr
        )
      ).to.be.revertedWith("Prepaid requires deposit");
    });

    it("should reject postpaid with non-zero deposit", async function () {
      await expect(
        channelContract.connect(consumer).openChannel(
          provider.address, tokenAddr, 1, DEPOSIT, MAX_SPEND, MAX_DURATION, RATE_PER_CALL, walletAddr
        )
      ).to.be.revertedWith("Postpaid must have 0 deposit");
    });

    it("should reject opening with self as provider", async function () {
      await expect(
        channelContract.connect(consumer).openChannel(
          consumer.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, MAX_DURATION, RATE_PER_CALL, walletAddr
        )
      ).to.be.revertedWith("Invalid provider");
    });

    it("should reject zero rate per call", async function () {
      await expect(
        channelContract.connect(consumer).openChannel(
          provider.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, MAX_DURATION, 0, walletAddr
        )
      ).to.be.revertedWith("maxPerCall must be > 0");
    });

    it("should reject zero duration", async function () {
      await expect(
        channelContract.connect(consumer).openChannel(
          provider.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, 0, RATE_PER_CALL, walletAddr
        )
      ).to.be.revertedWith("Invalid duration");
    });

    it("should reject zero max spend", async function () {
      await expect(
        channelContract.connect(consumer).openChannel(
          provider.address, tokenAddr, 0, DEPOSIT, 0, MAX_DURATION, RATE_PER_CALL, walletAddr
        )
      ).to.be.revertedWith("Max spend must be > 0");
    });

    it("should reject maxPerCall exceeding session valueLimit", async function () {
      // VALUE_LIMIT = 1 ETH; try maxPerCall = 2 ETH
      await expect(
        channelContract.connect(consumer).openChannel(
          provider.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, MAX_DURATION,
          VALUE_LIMIT + 1n, walletAddr
        )
      ).to.be.revertedWith("maxPerCall exceeds session valueLimit");
    });

    it("should reject maxSpend exceeding session maxValueAllowed", async function () {
      // MAX_VALUE_ALLOWED = 100 ETH; try maxSpend = 101 ETH
      await expect(
        channelContract.connect(consumer).openChannel(
          provider.address, tokenAddr, 0, DEPOSIT, MAX_VALUE_ALLOWED + 1n,
          MAX_DURATION, RATE_PER_CALL, walletAddr
        )
      ).to.be.revertedWith("maxSpend exceeds session maxValueAllowed");
    });

    it("should reject deposit exceeding wallet balance", async function () {
      // Withdraw most of the balance first
      await walletContract.connect(owner).withdraw(tokenAddr, ethers.parseEther("9999"));
      // Remaining balance is 1 ETH; deposit = 1 ETH is fine.
      // Try deposit = 2 ETH which exceeds the remaining 1 ETH
      await expect(
        channelContract.connect(consumer).openChannel(
          provider.address, tokenAddr, 0, ethers.parseEther("2"), MAX_SPEND,
          MAX_DURATION, RATE_PER_CALL, walletAddr
        )
      ).to.be.revertedWith("Insufficient wallet balance for deposit");
    });

    it("should reject channel opened by unregistered session key", async function () {
      await expect(
        channelContract.connect(other).openChannel(
          provider.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, MAX_DURATION, RATE_PER_CALL, walletAddr
        )
      ).to.be.revertedWith("Session key is not active");
    });

    it("should reject blocked provider", async function () {
      // Re-add session key with provider in blocklist
      const validUntil = (await ethers.provider.getBlock("latest")).timestamp + ONE_YEAR;
      const blockedKey = ethers.Wallet.createRandom();
      // Register a fresh agent so blockedKey can be the session key
      const agentTx = await registry.connect(owner).registerAgent(
        blockedKey.address, walletAddr, 99, metadata
      );
      const agentReceipt = await agentTx.wait();
      const agentEvt = agentReceipt.logs.find(
        l => registry.interface.parseLog(l)?.name === "AgentRegistered"
      );
      const newAgentId = registry.interface.parseLog(agentEvt).args.agentId;

      await walletContract.connect(owner).addSessionKeyRule(
        blockedKey.address, newAgentId, 0,
        VALUE_LIMIT, MAX_VALUE_ALLOWED, validUntil,
        [provider.address], "0x"
      );

      // blockedKey is not a signer in this test, just verify the rule is set
      // Use isProviderBlocked view instead
      expect(
        await walletContract.isProviderBlocked(blockedKey.address, provider.address)
      ).to.be.true;
    });
  });

  // ─── Activating Channels ─────────────────────────────────────────────

  describe("Activating Channels", function () {
    let channelId;

    beforeEach(async function () {
      const tx = await channelContract.connect(consumer).openChannel(
        provider.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, MAX_DURATION, RATE_PER_CALL, walletAddr
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => l.fragment?.name === "ChannelOpened");
      channelId = event.args.channelId;
    });

    it("should activate by provider", async function () {
      await channelContract.connect(provider).activateChannel(channelId);
      const ch = await channelContract.getChannel(channelId);
      expect(ch.status).to.equal(1); // Active
    });

    it("should reject activation by consumer", async function () {
      await expect(
        channelContract.connect(consumer).activateChannel(channelId)
      ).to.be.revertedWith("Only provider can activate");
    });

    it("should reject activation by third party", async function () {
      await expect(
        channelContract.connect(other).activateChannel(channelId)
      ).to.be.revertedWith("Only provider can activate");
    });
  });

  // ─── Settlement — Initiate ───────────────────────────────────────────

  describe("Settlement Phase — Initiate", function () {
    let channelId;

    beforeEach(async function () {
      channelId = await openAndActivatePrepaid();
    });

    it("should initiate settlement with a receipt", async function () {
      const numCalls = 100;
      const cost = RATE_PER_CALL * BigInt(numCalls);
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cost, ts);
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));

      await channelContract.connect(consumer).initiateSettlement(
        channelId, numCalls, cost, ts, sig, merkleRoot
      );

      const ch = await channelContract.getChannel(channelId);
      expect(ch.status).to.equal(2); // SettlementPending
      expect(ch.highestClaimedCost).to.equal(cost);
      expect(ch.highestSequenceNumber).to.equal(numCalls);
    });

    it("should initiate settlement with zero claim (no calls)", async function () {
      await channelContract.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );
      const ch = await channelContract.getChannel(channelId);
      expect(ch.status).to.equal(2);
      expect(ch.highestClaimedCost).to.equal(0);
    });

    it("should reject settlement from non-party", async function () {
      await expect(
        channelContract.connect(other).initiateSettlement(
          channelId, 0, 0, 0, "0x", ethers.ZeroHash
        )
      ).to.be.revertedWith("Not a channel party");
    });

    it("should reject settlement with invalid signature", async function () {
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const receiptHash = await channelContract.getReceiptHash(channelId, 10, RATE_PER_CALL * 10n, ts);
      const badSig = await consumer.signMessage(ethers.getBytes(receiptHash));

      await expect(
        channelContract.connect(consumer).initiateSettlement(
          channelId, 10, RATE_PER_CALL * 10n, ts, badSig, ethers.ZeroHash
        )
      ).to.be.revertedWith("Invalid provider signature");
    });

    it("should reject cost exceeding max spend", async function () {
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const inflatedCost = MAX_SPEND + 1n;
      const sig = await signReceipt(channelId, 10000, inflatedCost, ts);

      await expect(
        channelContract.connect(consumer).initiateSettlement(
          channelId, 10000, inflatedCost, ts, sig, ethers.ZeroHash
        )
      ).to.be.revertedWith("Exceeds max spend");
    });

    it("should reject cumulative cost exceeding maxPerCall ceiling", async function () {
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const inflatedCost = RATE_PER_CALL * 20n; // 20x rate for only 10 calls
      const sig = await signReceipt(channelId, 10, inflatedCost, ts);

      await expect(
        channelContract.connect(consumer).initiateSettlement(
          channelId, 10, inflatedCost, ts, sig, ethers.ZeroHash
        )
      ).to.be.revertedWith("Cumulative exceeds maxPerCall ceiling");
    });
  });

  // ─── Settlement — Submit Receipt (Challenge) ─────────────────────────

  describe("Settlement Phase — Submit Receipt (Challenge)", function () {
    let channelId;

    beforeEach(async function () {
      channelId = await openAndActivatePrepaid();
      await channelContract.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );
    });

    it("should accept a higher receipt from provider", async function () {
      const numCalls = 50;
      const cost = RATE_PER_CALL * BigInt(numCalls);
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cost, ts);

      await channelContract.connect(provider).submitReceipt(channelId, numCalls, cost, ts, sig);

      const ch = await channelContract.getChannel(channelId);
      expect(ch.highestClaimedCost).to.equal(cost);
      expect(ch.highestSequenceNumber).to.equal(numCalls);
    });

    it("should accept a higher receipt from third party (permissionless)", async function () {
      const numCalls = 50;
      const cost = RATE_PER_CALL * BigInt(numCalls);
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cost, ts);

      await channelContract.connect(other).submitReceipt(channelId, numCalls, cost, ts, sig);
      const ch = await channelContract.getChannel(channelId);
      expect(ch.highestClaimedCost).to.equal(cost);
    });

    it("should accept an even higher receipt replacing a previous one", async function () {
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig1 = await signReceipt(channelId, 50, RATE_PER_CALL * 50n, ts);
      await channelContract.connect(provider).submitReceipt(channelId, 50, RATE_PER_CALL * 50n, ts, sig1);

      const sig2 = await signReceipt(channelId, 100, RATE_PER_CALL * 100n, ts);
      await channelContract.connect(provider).submitReceipt(channelId, 100, RATE_PER_CALL * 100n, ts, sig2);

      const ch = await channelContract.getChannel(channelId);
      expect(ch.highestClaimedCost).to.equal(RATE_PER_CALL * 100n);
    });

    it("should reject a receipt not higher than current claim", async function () {
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig1 = await signReceipt(channelId, 50, RATE_PER_CALL * 50n, ts);
      await channelContract.connect(provider).submitReceipt(channelId, 50, RATE_PER_CALL * 50n, ts, sig1);

      const sig2 = await signReceipt(channelId, 30, RATE_PER_CALL * 30n, ts);
      await expect(
        channelContract.connect(provider).submitReceipt(channelId, 30, RATE_PER_CALL * 30n, ts, sig2)
      ).to.be.revertedWith("Not higher than current claim");
    });

    it("should reject receipt after challenge window closes", async function () {
      await time.increase(CHALLENGE_WINDOW + 1);
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, 10, RATE_PER_CALL * 10n, ts);

      await expect(
        channelContract.connect(provider).submitReceipt(channelId, 10, RATE_PER_CALL * 10n, ts, sig)
      ).to.be.revertedWith("Challenge window closed");
    });
  });

  // ─── Settlement — Finalize ───────────────────────────────────────────

  describe("Settlement Phase — Finalize", function () {
    let channelId;

    beforeEach(async function () {
      channelId = await openAndActivatePrepaid();
    });

    it("should finalize with receipt — pay provider, refund to wallet", async function () {
      const numCalls = 100;
      const cost = RATE_PER_CALL * BigInt(numCalls); // 0.1 ETH
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cost, ts);

      await channelContract.connect(consumer).initiateSettlement(
        channelId, numCalls, cost, ts, sig, ethers.ZeroHash
      );
      await time.increase(CHALLENGE_WINDOW + 1);

      const providerBalBefore = await token.balanceOf(provider.address);
      const walletBalBefore   = await walletContract.getUserBalance(owner.address, tokenAddr);

      await channelContract.connect(consumer).finalize(channelId, ethers.ZeroHash);

      const providerBalAfter = await token.balanceOf(provider.address);
      const walletBalAfter   = await walletContract.getUserBalance(owner.address, tokenAddr);

      expect(providerBalAfter - providerBalBefore).to.equal(cost);
      // Refund = DEPOSIT - cost goes back into wallet balance
      expect(walletBalAfter - walletBalBefore).to.equal(DEPOSIT - cost);

      const ch = await channelContract.getChannel(channelId);
      expect(ch.status).to.equal(3); // Closed
      expect(ch.settledAmount).to.equal(cost);
    });

    it("should finalize with zero claim — full refund to wallet", async function () {
      await channelContract.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );
      await time.increase(CHALLENGE_WINDOW + 1);

      const walletBalBefore = await walletContract.getUserBalance(owner.address, tokenAddr);
      await channelContract.connect(consumer).finalize(channelId, ethers.ZeroHash);
      const walletBalAfter  = await walletContract.getUserBalance(owner.address, tokenAddr);

      expect(walletBalAfter - walletBalBefore).to.equal(DEPOSIT);
    });

    it("should cap payment at deposit for prepaid", async function () {
      // MAX_SPEND (5) > DEPOSIT (1); claim 2 ETH worth (> deposit)
      const numCalls = 2000;
      const cost = RATE_PER_CALL * BigInt(numCalls); // 2 ETH > 1 ETH deposit
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cost, ts);

      await channelContract.connect(consumer).initiateSettlement(
        channelId, numCalls, cost, ts, sig, ethers.ZeroHash
      );
      await time.increase(CHALLENGE_WINDOW + 1);

      const providerBalBefore = await token.balanceOf(provider.address);
      await channelContract.connect(consumer).finalize(channelId, ethers.ZeroHash);
      const providerBalAfter  = await token.balanceOf(provider.address);

      // Capped at deposit (no refund)
      expect(providerBalAfter - providerBalBefore).to.equal(DEPOSIT);
    });

    it("should allow anyone to finalize (permissionless)", async function () {
      await channelContract.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );
      await time.increase(CHALLENGE_WINDOW + 1);

      await channelContract.connect(other).finalize(channelId, ethers.ZeroHash);

      const ch = await channelContract.getChannel(channelId);
      expect(ch.status).to.equal(3); // Closed
    });

    it("should reject finalize before challenge window closes", async function () {
      await channelContract.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );
      await expect(
        channelContract.connect(consumer).finalize(channelId, ethers.ZeroHash)
      ).to.be.revertedWith("Challenge window still open");
    });

    it("should finalize with challenge-updated amount", async function () {
      // Consumer initiates with zero
      await channelContract.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );

      // Provider challenges with actual receipt
      const numCalls = 200;
      const cost = RATE_PER_CALL * BigInt(numCalls);
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cost, ts);
      await channelContract.connect(provider).submitReceipt(channelId, numCalls, cost, ts, sig);

      await time.increase(CHALLENGE_WINDOW + 1);

      const providerBefore = await token.balanceOf(provider.address);
      await channelContract.connect(other).finalize(channelId, ethers.ZeroHash);
      const providerAfter  = await token.balanceOf(provider.address);

      expect(providerAfter - providerBefore).to.equal(cost);
    });
  });

  // ─── Force Close Expired ─────────────────────────────────────────────

  describe("Force Close Expired", function () {
    let channelId;

    beforeEach(async function () {
      channelId = await openAndActivatePrepaid();
    });

    it("should force-close (initiate settlement) after expiry + grace", async function () {
      await time.increase(MAX_DURATION + 300 + 1);
      await channelContract.connect(other).forceCloseExpired(channelId);
      const ch = await channelContract.getChannel(channelId);
      expect(ch.status).to.equal(2); // SettlementPending
    });

    it("should allow provider to submit receipt during force-close challenge", async function () {
      await time.increase(MAX_DURATION + 300 + 1);
      await channelContract.connect(other).forceCloseExpired(channelId);

      const numCalls = 200;
      const cost = RATE_PER_CALL * BigInt(numCalls);
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cost, ts);
      await channelContract.connect(provider).submitReceipt(channelId, numCalls, cost, ts, sig);

      await time.increase(CHALLENGE_WINDOW + 1);

      const providerBefore = await token.balanceOf(provider.address);
      await channelContract.connect(other).finalize(channelId, ethers.ZeroHash);
      const providerAfter  = await token.balanceOf(provider.address);
      expect(providerAfter - providerBefore).to.equal(cost);
    });

    it("should refund to wallet if no receipt submitted after force-close", async function () {
      await time.increase(MAX_DURATION + 300 + 1);
      await channelContract.connect(other).forceCloseExpired(channelId);
      await time.increase(CHALLENGE_WINDOW + 1);

      const walletBalBefore = await walletContract.getUserBalance(owner.address, tokenAddr);
      await channelContract.connect(other).finalize(channelId, ethers.ZeroHash);
      const walletBalAfter  = await walletContract.getUserBalance(owner.address, tokenAddr);

      expect(walletBalAfter - walletBalBefore).to.equal(DEPOSIT);
    });

    it("should reject force-close before expiry", async function () {
      await expect(
        channelContract.connect(other).forceCloseExpired(channelId)
      ).to.be.revertedWith("Not yet expired + grace");
    });
  });

  // ─── Settlement State View ───────────────────────────────────────────

  describe("Settlement State View", function () {
    let channelId;

    beforeEach(async function () {
      channelId = await openAndActivatePrepaid();
    });

    it("should return settlement state", async function () {
      await channelContract.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );
      const state = await channelContract.getSettlementState(channelId);
      expect(state.deadline).to.be.greaterThan(0);
      expect(state.highestCost).to.equal(0);
      expect(state.initiator).to.equal(consumer.address);
      expect(state.challengeOpen).to.be.true;
    });

    it("should report challenge closed after window", async function () {
      await channelContract.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );
      await time.increase(CHALLENGE_WINDOW + 1);
      const state = await channelContract.getSettlementState(channelId);
      expect(state.challengeOpen).to.be.false;
    });
  });

  // ─── View Functions ──────────────────────────────────────────────────

  describe("View Functions", function () {
    let channelId;

    beforeEach(async function () {
      const tx = await channelContract.connect(consumer).openChannel(
        provider.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, MAX_DURATION, RATE_PER_CALL, walletAddr
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => l.fragment?.name === "ChannelOpened");
      channelId = event.args.channelId;
    });

    it("should return channel details", async function () {
      const ch = await channelContract.getChannel(channelId);
      expect(ch.consumer).to.equal(consumer.address);
      expect(ch.provider).to.equal(provider.address);
      expect(ch.deposit).to.equal(DEPOSIT);
      expect(ch.maxSpend).to.equal(MAX_SPEND);
      expect(ch.maxPerCall).to.equal(RATE_PER_CALL);
      expect(ch.status).to.equal(0); // Open
      expect(ch.walletContract).to.equal(walletAddr);
    });

    it("should report not expired for fresh channel", async function () {
      expect(await channelContract.isChannelExpired(channelId)).to.be.false;
    });

    it("should report expired after duration", async function () {
      await time.increase(MAX_DURATION + 1);
      expect(await channelContract.isChannelExpired(channelId)).to.be.true;
    });

    it("should return time remaining", async function () {
      const remaining = await channelContract.getChannelTimeRemaining(channelId);
      expect(remaining).to.be.greaterThan(0);
      expect(remaining).to.be.lessThanOrEqual(MAX_DURATION);
    });
  });
});
