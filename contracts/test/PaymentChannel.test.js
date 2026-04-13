const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PaymentChannel", function () {
  let channel, token, consumer, provider, other;
  const RATE_PER_CALL = ethers.parseEther("0.001"); // 0.001 USDT per call
  const DEPOSIT = ethers.parseEther("1");            // 1 USDT deposit
  const MAX_SPEND = ethers.parseEther("5");           // 5 USDT max spend
  const MAX_DURATION = 600;                          // 10 minutes
  const CHALLENGE_WINDOW = 3600;                     // 1 hour

  beforeEach(async function () {
    [consumer, provider, other] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    token = await MockToken.deploy("Mock USDT", "mUSDT", ethers.parseEther("1000000"));
    await token.waitForDeployment();

    const PaymentChannel = await ethers.getContractFactory("PaymentChannel");
    channel = await PaymentChannel.deploy();
    await channel.waitForDeployment();

    // Fund consumer with tokens and approve channel contract
    await token.transfer(consumer.address, ethers.parseEther("1000"));
    await token.connect(consumer).approve(
      await channel.getAddress(), ethers.parseEther("1000")
    );
  });

  // Helper: sign a receipt as provider
  async function signReceipt(channelId, sequenceNumber, cumulativeCost, timestamp) {
    const receiptHash = await channel.getReceiptHash(
      channelId, sequenceNumber, cumulativeCost, timestamp
    );
    return provider.signMessage(ethers.getBytes(receiptHash));
  }

  // Helper: open + activate a prepaid channel
  async function openAndActivatePrepaid() {
    const tokenAddr = await token.getAddress();
    const tx = await channel.connect(consumer).openChannel(
      provider.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, MAX_DURATION, RATE_PER_CALL
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(
      l => l.fragment && l.fragment.name === "ChannelOpened"
    );
    const channelId = event.args.channelId;
    await channel.connect(provider).activateChannel(channelId);
    return channelId;
  }

  describe("Opening Channels", function () {
    it("should open a prepaid channel with deposit and maxSpend", async function () {
      const tokenAddr = await token.getAddress();
      const balanceBefore = await token.balanceOf(consumer.address);

      const tx = await channel.connect(consumer).openChannel(
        provider.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, MAX_DURATION, RATE_PER_CALL
      );
      await tx.wait();

      const balanceAfter = await token.balanceOf(consumer.address);
      expect(balanceBefore - balanceAfter).to.equal(DEPOSIT);

      const locked = await channel.getLockedFunds(consumer.address, tokenAddr);
      expect(locked).to.equal(DEPOSIT);
      expect(await channel.totalChannels()).to.equal(1);
    });

    it("should open a postpaid channel with zero deposit", async function () {
      const tokenAddr = await token.getAddress();
      await channel.connect(consumer).openChannel(
        provider.address, tokenAddr, 1, 0, MAX_SPEND, MAX_DURATION, RATE_PER_CALL
      );
      expect(await channel.totalChannels()).to.equal(1);
    });

    it("should reject prepaid with zero deposit", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        channel.connect(consumer).openChannel(
          provider.address, tokenAddr, 0, 0, MAX_SPEND, MAX_DURATION, RATE_PER_CALL
        )
      ).to.be.revertedWith("Prepaid requires deposit");
    });

    it("should reject postpaid with non-zero deposit", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        channel.connect(consumer).openChannel(
          provider.address, tokenAddr, 1, DEPOSIT, MAX_SPEND, MAX_DURATION, RATE_PER_CALL
        )
      ).to.be.revertedWith("Postpaid must have 0 deposit");
    });

    it("should reject opening with self as provider", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        channel.connect(consumer).openChannel(
          consumer.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, MAX_DURATION, RATE_PER_CALL
        )
      ).to.be.revertedWith("Invalid provider");
    });

    it("should reject zero rate per call", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        channel.connect(consumer).openChannel(
          provider.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, MAX_DURATION, 0
        )
      ).to.be.revertedWith("Rate must be > 0");
    });

    it("should reject zero duration", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        channel.connect(consumer).openChannel(
          provider.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, 0, RATE_PER_CALL
        )
      ).to.be.revertedWith("Invalid duration");
    });

    it("should reject zero max spend", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        channel.connect(consumer).openChannel(
          provider.address, tokenAddr, 0, DEPOSIT, 0, MAX_DURATION, RATE_PER_CALL
        )
      ).to.be.revertedWith("Max spend must be > 0");
    });
  });

  describe("Activating Channels", function () {
    let channelId;

    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const tx = await channel.connect(consumer).openChannel(
        provider.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, MAX_DURATION, RATE_PER_CALL
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        l => l.fragment && l.fragment.name === "ChannelOpened"
      );
      channelId = event.args.channelId;
    });

    it("should activate by provider", async function () {
      await channel.connect(provider).activateChannel(channelId);
      const ch = await channel.getChannel(channelId);
      expect(ch.status).to.equal(1); // Active
    });

    it("should reject activation by consumer", async function () {
      await expect(
        channel.connect(consumer).activateChannel(channelId)
      ).to.be.revertedWith("Only provider can activate");
    });

    it("should reject activation by third party", async function () {
      await expect(
        channel.connect(other).activateChannel(channelId)
      ).to.be.revertedWith("Only provider can activate");
    });
  });

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
      await channel.connect(consumer).initiateSettlement(
        channelId, numCalls, cost, ts, sig, merkleRoot
      );

      const ch = await channel.getChannel(channelId);
      expect(ch.status).to.equal(2); // SettlementPending
      expect(ch.highestClaimedCost).to.equal(cost);
      expect(ch.highestSequenceNumber).to.equal(numCalls);
    });

    it("should initiate settlement with zero claim (no calls)", async function () {
      await channel.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );

      const ch = await channel.getChannel(channelId);
      expect(ch.status).to.equal(2); // SettlementPending
      expect(ch.highestClaimedCost).to.equal(0);
    });

    it("should reject settlement from non-party", async function () {
      await expect(
        channel.connect(other).initiateSettlement(
          channelId, 0, 0, 0, "0x", ethers.ZeroHash
        )
      ).to.be.revertedWith("Not a channel party");
    });

    it("should reject settlement with invalid signature", async function () {
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const receiptHash = await channel.getReceiptHash(channelId, 10, RATE_PER_CALL * 10n, ts);
      const badSig = await consumer.signMessage(ethers.getBytes(receiptHash));

      await expect(
        channel.connect(consumer).initiateSettlement(
          channelId, 10, RATE_PER_CALL * 10n, ts, badSig, ethers.ZeroHash
        )
      ).to.be.revertedWith("Invalid provider signature");
    });

    it("should reject cost exceeding max spend", async function () {
      const numCalls = 10000;
      const inflatedCost = MAX_SPEND + 1n;
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, inflatedCost, ts);

      await expect(
        channel.connect(consumer).initiateSettlement(
          channelId, numCalls, inflatedCost, ts, sig, ethers.ZeroHash
        )
      ).to.be.revertedWith("Exceeds max spend");
    });

    it("should reject cost exceeding rate * calls", async function () {
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const inflatedCost = RATE_PER_CALL * 20n;
      const sig = await signReceipt(channelId, 10, inflatedCost, ts);

      await expect(
        channel.connect(consumer).initiateSettlement(
          channelId, 10, inflatedCost, ts, sig, ethers.ZeroHash
        )
      ).to.be.revertedWith("Cost exceeds rate * calls");
    });
  });

  describe("Settlement Phase — Submit Receipt (Challenge)", function () {
    let channelId;

    beforeEach(async function () {
      channelId = await openAndActivatePrepaid();
      // Consumer initiates with zero claim
      await channel.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );
    });

    it("should accept a higher receipt from provider", async function () {
      const numCalls = 50;
      const cost = RATE_PER_CALL * BigInt(numCalls);
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cost, ts);

      await channel.connect(provider).submitReceipt(channelId, numCalls, cost, ts, sig);

      const ch = await channel.getChannel(channelId);
      expect(ch.highestClaimedCost).to.equal(cost);
      expect(ch.highestSequenceNumber).to.equal(numCalls);
    });

    it("should accept a higher receipt from third party (permissionless)", async function () {
      const numCalls = 50;
      const cost = RATE_PER_CALL * BigInt(numCalls);
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cost, ts);

      // Third party submits — permissionless
      await channel.connect(other).submitReceipt(channelId, numCalls, cost, ts, sig);

      const ch = await channel.getChannel(channelId);
      expect(ch.highestClaimedCost).to.equal(cost);
    });

    it("should accept an even higher receipt replacing a previous one", async function () {
      const ts = (await ethers.provider.getBlock("latest")).timestamp;

      // First receipt: 50 calls
      const sig1 = await signReceipt(channelId, 50, RATE_PER_CALL * 50n, ts);
      await channel.connect(provider).submitReceipt(channelId, 50, RATE_PER_CALL * 50n, ts, sig1);

      // Higher receipt: 100 calls
      const sig2 = await signReceipt(channelId, 100, RATE_PER_CALL * 100n, ts);
      await channel.connect(provider).submitReceipt(channelId, 100, RATE_PER_CALL * 100n, ts, sig2);

      const ch = await channel.getChannel(channelId);
      expect(ch.highestClaimedCost).to.equal(RATE_PER_CALL * 100n);
    });

    it("should reject a receipt not higher than current claim", async function () {
      const ts = (await ethers.provider.getBlock("latest")).timestamp;

      // Submit 50 calls
      const sig1 = await signReceipt(channelId, 50, RATE_PER_CALL * 50n, ts);
      await channel.connect(provider).submitReceipt(channelId, 50, RATE_PER_CALL * 50n, ts, sig1);

      // Try 30 calls (lower)
      const sig2 = await signReceipt(channelId, 30, RATE_PER_CALL * 30n, ts);
      await expect(
        channel.connect(provider).submitReceipt(channelId, 30, RATE_PER_CALL * 30n, ts, sig2)
      ).to.be.revertedWith("Not higher than current claim");
    });

    it("should reject receipt after challenge window closes", async function () {
      await time.increase(CHALLENGE_WINDOW + 1);

      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, 10, RATE_PER_CALL * 10n, ts);

      await expect(
        channel.connect(provider).submitReceipt(channelId, 10, RATE_PER_CALL * 10n, ts, sig)
      ).to.be.revertedWith("Challenge window closed");
    });
  });

  describe("Settlement Phase — Finalize", function () {
    let channelId;

    beforeEach(async function () {
      channelId = await openAndActivatePrepaid();
    });

    it("should finalize with receipt — pay provider, refund consumer", async function () {
      const numCalls = 100;
      const cost = RATE_PER_CALL * BigInt(numCalls); // 0.1 USDT
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cost, ts);

      // Initiate with receipt
      await channel.connect(consumer).initiateSettlement(
        channelId, numCalls, cost, ts, sig, ethers.ZeroHash
      );

      // Wait for challenge window to close
      await time.increase(CHALLENGE_WINDOW + 1);

      const providerBefore = await token.balanceOf(provider.address);
      const consumerBefore = await token.balanceOf(consumer.address);

      await channel.connect(consumer).finalize(channelId, ethers.ZeroHash);

      const providerAfter = await token.balanceOf(provider.address);
      const consumerAfter = await token.balanceOf(consumer.address);

      expect(providerAfter - providerBefore).to.equal(cost);
      expect(consumerAfter - consumerBefore).to.equal(DEPOSIT - cost);

      const ch = await channel.getChannel(channelId);
      expect(ch.status).to.equal(3); // Closed
      expect(ch.settledAmount).to.equal(cost);
    });

    it("should finalize with zero claim — full refund", async function () {
      await channel.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );

      await time.increase(CHALLENGE_WINDOW + 1);

      const consumerBefore = await token.balanceOf(consumer.address);
      await channel.connect(consumer).finalize(channelId, ethers.ZeroHash);
      const consumerAfter = await token.balanceOf(consumer.address);

      expect(consumerAfter - consumerBefore).to.equal(DEPOSIT);
    });

    it("should cap payment at deposit for prepaid", async function () {
      // maxSpend > deposit, so claim up to maxSpend
      const numCalls = 2000;
      const cost = RATE_PER_CALL * BigInt(numCalls); // 2 USDT > 1 USDT deposit
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cost, ts);

      await channel.connect(consumer).initiateSettlement(
        channelId, numCalls, cost, ts, sig, ethers.ZeroHash
      );
      await time.increase(CHALLENGE_WINDOW + 1);

      const providerBefore = await token.balanceOf(provider.address);
      await channel.connect(consumer).finalize(channelId, ethers.ZeroHash);
      const providerAfter = await token.balanceOf(provider.address);

      // Capped at deposit
      expect(providerAfter - providerBefore).to.equal(DEPOSIT);
    });

    it("should allow anyone to finalize (permissionless)", async function () {
      await channel.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );
      await time.increase(CHALLENGE_WINDOW + 1);

      // Third party finalizes
      await channel.connect(other).finalize(channelId, ethers.ZeroHash);

      const ch = await channel.getChannel(channelId);
      expect(ch.status).to.equal(3); // Closed
    });

    it("should reject finalize before challenge window closes", async function () {
      await channel.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );

      await expect(
        channel.connect(consumer).finalize(channelId, ethers.ZeroHash)
      ).to.be.revertedWith("Challenge window still open");
    });

    it("should finalize with challenge-updated amount", async function () {
      // Consumer initiates with zero
      await channel.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );

      // Provider challenges with actual receipt
      const numCalls = 200;
      const cost = RATE_PER_CALL * BigInt(numCalls);
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cost, ts);
      await channel.connect(provider).submitReceipt(channelId, numCalls, cost, ts, sig);

      // Finalize after window
      await time.increase(CHALLENGE_WINDOW + 1);

      const providerBefore = await token.balanceOf(provider.address);
      await channel.connect(other).finalize(channelId, ethers.ZeroHash);
      const providerAfter = await token.balanceOf(provider.address);

      expect(providerAfter - providerBefore).to.equal(cost);
    });
  });

  describe("Postpaid Channel", function () {
    let channelId;

    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const tx = await channel.connect(consumer).openChannel(
        provider.address, tokenAddr, 1, 0, MAX_SPEND, MAX_DURATION, RATE_PER_CALL
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        l => l.fragment && l.fragment.name === "ChannelOpened"
      );
      channelId = event.args.channelId;
      await channel.connect(provider).activateChannel(channelId);
    });

    it("should pull payment from consumer on finalize", async function () {
      const numCalls = 50;
      const cost = RATE_PER_CALL * BigInt(numCalls);
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cost, ts);

      await channel.connect(consumer).initiateSettlement(
        channelId, numCalls, cost, ts, sig, ethers.ZeroHash
      );
      await time.increase(CHALLENGE_WINDOW + 1);

      const providerBefore = await token.balanceOf(provider.address);
      const consumerBefore = await token.balanceOf(consumer.address);

      await channel.connect(consumer).finalize(channelId, ethers.ZeroHash);

      expect(await token.balanceOf(provider.address) - providerBefore).to.equal(cost);
      expect(consumerBefore - await token.balanceOf(consumer.address)).to.equal(cost);
    });
  });

  describe("Force Close Expired", function () {
    let channelId;

    beforeEach(async function () {
      channelId = await openAndActivatePrepaid();
    });

    it("should force-close (initiate settlement) after expiry + grace", async function () {
      await time.increase(MAX_DURATION + 300 + 1);

      await channel.connect(other).forceCloseExpired(channelId);

      const ch = await channel.getChannel(channelId);
      expect(ch.status).to.equal(2); // SettlementPending — challenge window open
    });

    it("should allow provider to submit receipt during force-close challenge", async function () {
      await time.increase(MAX_DURATION + 300 + 1);
      await channel.connect(other).forceCloseExpired(channelId);

      const numCalls = 200;
      const cost = RATE_PER_CALL * BigInt(numCalls);
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cost, ts);

      await channel.connect(provider).submitReceipt(channelId, numCalls, cost, ts, sig);

      // Finalize after window
      await time.increase(CHALLENGE_WINDOW + 1);

      const providerBefore = await token.balanceOf(provider.address);
      await channel.connect(other).finalize(channelId, ethers.ZeroHash);
      const providerAfter = await token.balanceOf(provider.address);

      expect(providerAfter - providerBefore).to.equal(cost);
    });

    it("should refund consumer if no receipt submitted after force-close", async function () {
      await time.increase(MAX_DURATION + 300 + 1);
      await channel.connect(other).forceCloseExpired(channelId);

      await time.increase(CHALLENGE_WINDOW + 1);

      const consumerBefore = await token.balanceOf(consumer.address);
      await channel.connect(other).finalize(channelId, ethers.ZeroHash);
      const consumerAfter = await token.balanceOf(consumer.address);

      expect(consumerAfter - consumerBefore).to.equal(DEPOSIT);
    });

    it("should reject force-close before expiry", async function () {
      await expect(
        channel.connect(other).forceCloseExpired(channelId)
      ).to.be.revertedWith("Not yet expired + grace");
    });
  });

  describe("Settlement State View", function () {
    let channelId;

    beforeEach(async function () {
      channelId = await openAndActivatePrepaid();
    });

    it("should return settlement state", async function () {
      await channel.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );

      const state = await channel.getSettlementState(channelId);
      expect(state.deadline).to.be.greaterThan(0);
      expect(state.highestCost).to.equal(0);
      expect(state.highestSeq).to.equal(0);
      expect(state.initiator).to.equal(consumer.address);
      expect(state.challengeOpen).to.be.true;
    });

    it("should report challenge closed after window", async function () {
      await channel.connect(consumer).initiateSettlement(
        channelId, 0, 0, 0, "0x", ethers.ZeroHash
      );

      await time.increase(CHALLENGE_WINDOW + 1);

      const state = await channel.getSettlementState(channelId);
      expect(state.challengeOpen).to.be.false;
    });
  });

  describe("View Functions", function () {
    let channelId;

    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const tx = await channel.connect(consumer).openChannel(
        provider.address, tokenAddr, 0, DEPOSIT, MAX_SPEND, MAX_DURATION, RATE_PER_CALL
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        l => l.fragment && l.fragment.name === "ChannelOpened"
      );
      channelId = event.args.channelId;
    });

    it("should return channel details with new fields", async function () {
      const ch = await channel.getChannel(channelId);
      expect(ch.consumer).to.equal(consumer.address);
      expect(ch.provider).to.equal(provider.address);
      expect(ch.deposit).to.equal(DEPOSIT);
      expect(ch.maxSpend).to.equal(MAX_SPEND);
      expect(ch.ratePerCall).to.equal(RATE_PER_CALL);
      expect(ch.status).to.equal(0); // Open
    });

    it("should report not expired for fresh channel", async function () {
      expect(await channel.isChannelExpired(channelId)).to.be.false;
    });

    it("should report expired after duration", async function () {
      await time.increase(MAX_DURATION + 1);
      expect(await channel.isChannelExpired(channelId)).to.be.true;
    });

    it("should return time remaining", async function () {
      const remaining = await channel.getChannelTimeRemaining(channelId);
      expect(remaining).to.be.greaterThan(0);
      expect(remaining).to.be.lte(MAX_DURATION);
    });

    it("should return 0 time remaining after expiry", async function () {
      await time.increase(MAX_DURATION + 1);
      expect(await channel.getChannelTimeRemaining(channelId)).to.equal(0);
    });
  });
});
