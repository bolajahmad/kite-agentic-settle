const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PaymentChannel", function () {
  let channel, token, consumer, provider, other;
  const RATE_PER_CALL = ethers.parseEther("0.001"); // 0.001 USDT per call
  const DEPOSIT = ethers.parseEther("1");            // 1 USDT deposit
  const MAX_DURATION = 600;                          // 10 minutes

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

  describe("Opening Channels", function () {
    it("should open a prepaid channel with deposit", async function () {
      const tokenAddr = await token.getAddress();
      const balanceBefore = await token.balanceOf(consumer.address);

      const tx = await channel.connect(consumer).openChannel(
        provider.address, tokenAddr, 0, DEPOSIT, MAX_DURATION, RATE_PER_CALL
      );
      const receipt = await tx.wait();

      const balanceAfter = await token.balanceOf(consumer.address);
      expect(balanceBefore - balanceAfter).to.equal(DEPOSIT);

      // Verify locked funds
      const locked = await channel.getLockedFunds(consumer.address, tokenAddr);
      expect(locked).to.equal(DEPOSIT);

      expect(await channel.totalChannels()).to.equal(1);
    });

    it("should open a postpaid channel with zero deposit", async function () {
      const tokenAddr = await token.getAddress();
      await channel.connect(consumer).openChannel(
        provider.address, tokenAddr, 1, 0, MAX_DURATION, RATE_PER_CALL
      );
      expect(await channel.totalChannels()).to.equal(1);
    });

    it("should reject prepaid with zero deposit", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        channel.connect(consumer).openChannel(
          provider.address, tokenAddr, 0, 0, MAX_DURATION, RATE_PER_CALL
        )
      ).to.be.revertedWith("Prepaid requires deposit");
    });

    it("should reject postpaid with non-zero deposit", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        channel.connect(consumer).openChannel(
          provider.address, tokenAddr, 1, DEPOSIT, MAX_DURATION, RATE_PER_CALL
        )
      ).to.be.revertedWith("Postpaid must have 0 deposit");
    });

    it("should reject opening with self as provider", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        channel.connect(consumer).openChannel(
          consumer.address, tokenAddr, 0, DEPOSIT, MAX_DURATION, RATE_PER_CALL
        )
      ).to.be.revertedWith("Invalid provider");
    });

    it("should reject zero rate per call", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        channel.connect(consumer).openChannel(
          provider.address, tokenAddr, 0, DEPOSIT, MAX_DURATION, 0
        )
      ).to.be.revertedWith("Rate must be > 0");
    });

    it("should reject zero duration", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        channel.connect(consumer).openChannel(
          provider.address, tokenAddr, 0, DEPOSIT, 0, RATE_PER_CALL
        )
      ).to.be.revertedWith("Invalid duration");
    });
  });

  describe("Activating Channels", function () {
    let channelId;

    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const tx = await channel.connect(consumer).openChannel(
        provider.address, tokenAddr, 0, DEPOSIT, MAX_DURATION, RATE_PER_CALL
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

  describe("Closing with Signed Receipt (Prepaid)", function () {
    let channelId;

    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const tx = await channel.connect(consumer).openChannel(
        provider.address, tokenAddr, 0, DEPOSIT, MAX_DURATION, RATE_PER_CALL
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        l => l.fragment && l.fragment.name === "ChannelOpened"
      );
      channelId = event.args.channelId;
      await channel.connect(provider).activateChannel(channelId);
    });

    it("should settle and refund remainder on close", async function () {
      const numCalls = 100;
      const cumulativeCost = RATE_PER_CALL * BigInt(numCalls); // 0.1 USDT
      const ts = (await ethers.provider.getBlock("latest")).timestamp;

      const sig = await signReceipt(channelId, numCalls, cumulativeCost, ts);

      const providerBefore = await token.balanceOf(provider.address);
      const consumerBefore = await token.balanceOf(consumer.address);

      await channel.connect(consumer).closeChannel(
        channelId, numCalls, cumulativeCost, ts, sig
      );

      const providerAfter = await token.balanceOf(provider.address);
      const consumerAfter = await token.balanceOf(consumer.address);

      // Provider gets 0.1 USDT
      expect(providerAfter - providerBefore).to.equal(cumulativeCost);
      // Consumer gets 0.9 USDT refund
      expect(consumerAfter - consumerBefore).to.equal(DEPOSIT - cumulativeCost);

      const ch = await channel.getChannel(channelId);
      expect(ch.status).to.equal(3); // Closed
      expect(ch.settledAmount).to.equal(cumulativeCost);
    });

    it("should cap payment at deposit for prepaid", async function () {
      // Try to claim more than deposit
      const numCalls = 2000;
      const cumulativeCost = RATE_PER_CALL * BigInt(numCalls); // 2 USDT > 1 USDT deposit
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cumulativeCost, ts);

      const providerBefore = await token.balanceOf(provider.address);

      await channel.connect(consumer).closeChannel(
        channelId, numCalls, cumulativeCost, ts, sig
      );

      const providerAfter = await token.balanceOf(provider.address);
      // Provider gets at most the deposit
      expect(providerAfter - providerBefore).to.equal(DEPOSIT);

      const ch = await channel.getChannel(channelId);
      expect(ch.settledAmount).to.equal(DEPOSIT);
    });

    it("should reject invalid provider signature", async function () {
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      // Consumer signs instead of provider
      const receiptHash = await channel.getReceiptHash(channelId, 10, RATE_PER_CALL * 10n, ts);
      const badSig = await consumer.signMessage(ethers.getBytes(receiptHash));

      await expect(
        channel.connect(consumer).closeChannel(
          channelId, 10, RATE_PER_CALL * 10n, ts, badSig
        )
      ).to.be.revertedWith("Invalid provider signature");
    });

    it("should reject inflated cumulative cost", async function () {
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      // 10 calls but claims 20 calls worth
      const inflatedCost = RATE_PER_CALL * 20n;
      const sig = await signReceipt(channelId, 10, inflatedCost, ts);

      await expect(
        channel.connect(consumer).closeChannel(
          channelId, 10, inflatedCost, ts, sig
        )
      ).to.be.revertedWith("Cumulative cost exceeds expected total");
    });

    it("should reject close from non-party", async function () {
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, 1, RATE_PER_CALL, ts);

      await expect(
        channel.connect(other).closeChannel(
          channelId, 1, RATE_PER_CALL, ts, sig
        )
      ).to.be.revertedWith("Not a channel party");
    });
  });

  describe("Empty Close", function () {
    let channelId;

    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const tx = await channel.connect(consumer).openChannel(
        provider.address, tokenAddr, 0, DEPOSIT, MAX_DURATION, RATE_PER_CALL
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        l => l.fragment && l.fragment.name === "ChannelOpened"
      );
      channelId = event.args.channelId;
      await channel.connect(provider).activateChannel(channelId);
    });

    it("should return full deposit on empty close", async function () {
      const consumerBefore = await token.balanceOf(consumer.address);
      await channel.connect(consumer).closeChannelEmpty(channelId);
      const consumerAfter = await token.balanceOf(consumer.address);

      expect(consumerAfter - consumerBefore).to.equal(DEPOSIT);

      const ch = await channel.getChannel(channelId);
      expect(ch.status).to.equal(3); // Closed
      expect(ch.settledAmount).to.equal(0);
    });

    it("should reject empty close from provider", async function () {
      await expect(
        channel.connect(provider).closeChannelEmpty(channelId)
      ).to.be.revertedWith("Only consumer");
    });
  });

  describe("Postpaid Channel", function () {
    let channelId;

    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const tx = await channel.connect(consumer).openChannel(
        provider.address, tokenAddr, 1, 0, MAX_DURATION, RATE_PER_CALL
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        l => l.fragment && l.fragment.name === "ChannelOpened"
      );
      channelId = event.args.channelId;
      await channel.connect(provider).activateChannel(channelId);
    });

    it("should pull payment from consumer on close", async function () {
      const numCalls = 50;
      const cumulativeCost = RATE_PER_CALL * BigInt(numCalls);
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cumulativeCost, ts);

      const providerBefore = await token.balanceOf(provider.address);
      const consumerBefore = await token.balanceOf(consumer.address);

      await channel.connect(consumer).closeChannel(
        channelId, numCalls, cumulativeCost, ts, sig
      );

      expect(await token.balanceOf(provider.address) - providerBefore).to.equal(cumulativeCost);
      expect(consumerBefore - await token.balanceOf(consumer.address)).to.equal(cumulativeCost);
    });
  });

  describe("Force Close Expired", function () {
    let channelId;

    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const tx = await channel.connect(consumer).openChannel(
        provider.address, tokenAddr, 0, DEPOSIT, MAX_DURATION, RATE_PER_CALL
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        l => l.fragment && l.fragment.name === "ChannelOpened"
      );
      channelId = event.args.channelId;
      await channel.connect(provider).activateChannel(channelId);
    });

    it("should force-close after expiry + grace, refunding consumer", async function () {
      // Fast forward past expiry + grace
      await time.increase(MAX_DURATION + 300 + 1);

      const consumerBefore = await token.balanceOf(consumer.address);
      await channel.connect(other).forceCloseExpired(channelId);
      const consumerAfter = await token.balanceOf(consumer.address);

      expect(consumerAfter - consumerBefore).to.equal(DEPOSIT);
    });

    it("should reject force-close before expiry", async function () {
      await expect(
        channel.connect(other).forceCloseExpired(channelId)
      ).to.be.revertedWith("Not yet expired + grace");
    });

    it("should allow provider to force-close with receipt after expiry", async function () {
      const numCalls = 200;
      const cumulativeCost = RATE_PER_CALL * BigInt(numCalls);
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cumulativeCost, ts);

      await time.increase(MAX_DURATION + 1);

      const providerBefore = await token.balanceOf(provider.address);
      await channel.connect(provider).forceCloseWithReceipt(
        channelId, numCalls, cumulativeCost, ts, sig
      );
      const providerAfter = await token.balanceOf(provider.address);

      expect(providerAfter - providerBefore).to.equal(cumulativeCost);
    });
  });

  describe("Disputes", function () {
    let channelId;

    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const tx = await channel.connect(consumer).openChannel(
        provider.address, tokenAddr, 0, DEPOSIT, MAX_DURATION, RATE_PER_CALL
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        l => l.fragment && l.fragment.name === "ChannelOpened"
      );
      channelId = event.args.channelId;
      await channel.connect(provider).activateChannel(channelId);
    });

    it("should allow a party to dispute", async function () {
      await channel.connect(consumer).disputeChannel(channelId);
      const ch = await channel.getChannel(channelId);
      expect(ch.status).to.equal(4); // Disputed
    });

    it("should reject dispute from non-party", async function () {
      await expect(
        channel.connect(other).disputeChannel(channelId)
      ).to.be.revertedWith("Not a channel party");
    });

    it("should resolve dispute with valid receipt", async function () {
      await channel.connect(consumer).disputeChannel(channelId);

      const numCalls = 50;
      const cumulativeCost = RATE_PER_CALL * BigInt(numCalls);
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, numCalls, cumulativeCost, ts);

      const providerBefore = await token.balanceOf(provider.address);
      await channel.connect(provider).resolveDispute(
        channelId, numCalls, cumulativeCost, ts, sig
      );
      const providerAfter = await token.balanceOf(provider.address);

      expect(providerAfter - providerBefore).to.equal(cumulativeCost);
      const ch = await channel.getChannel(channelId);
      expect(ch.status).to.equal(3); // Closed
    });

    it("should allow finalize if dispute deadline passes", async function () {
      await channel.connect(consumer).disputeChannel(channelId);

      // Fast forward past dispute timeout
      await time.increase(3601);

      const consumerBefore = await token.balanceOf(consumer.address);
      await channel.connect(consumer).finalizeExpiredDispute(channelId);
      const consumerAfter = await token.balanceOf(consumer.address);

      // Full refund since no receipt was submitted
      expect(consumerAfter - consumerBefore).to.equal(DEPOSIT);
    });

    it("should reject resolve after deadline", async function () {
      await channel.connect(consumer).disputeChannel(channelId);
      await time.increase(3601);

      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      const sig = await signReceipt(channelId, 1, RATE_PER_CALL, ts);

      await expect(
        channel.connect(provider).resolveDispute(
          channelId, 1, RATE_PER_CALL, ts, sig
        )
      ).to.be.revertedWith("Dispute deadline passed");
    });

    it("should reject finalize before deadline", async function () {
      await channel.connect(consumer).disputeChannel(channelId);

      await expect(
        channel.connect(consumer).finalizeExpiredDispute(channelId)
      ).to.be.revertedWith("Dispute still active");
    });
  });

  describe("View Functions", function () {
    let channelId;

    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      const tx = await channel.connect(consumer).openChannel(
        provider.address, tokenAddr, 0, DEPOSIT, MAX_DURATION, RATE_PER_CALL
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        l => l.fragment && l.fragment.name === "ChannelOpened"
      );
      channelId = event.args.channelId;
    });

    it("should return channel details", async function () {
      const ch = await channel.getChannel(channelId);
      expect(ch.consumer).to.equal(consumer.address);
      expect(ch.provider).to.equal(provider.address);
      expect(ch.deposit).to.equal(DEPOSIT);
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
