import { Router } from "express";
import {
  openChannel,
  activateChannel,
  closeChannel,
  closeChannelEmpty,
  disputeChannel,
  resolveDispute,
  forceCloseExpired,
  getChannel,
  getChannelStatus,
  getReceiptHash,
  getLockedFunds,
} from "../controllers/channel.js";

const router = Router();

router.post("/open", openChannel);
router.post("/activate", activateChannel);
router.post("/close", closeChannel);
router.post("/close-empty", closeChannelEmpty);
router.post("/dispute", disputeChannel);
router.post("/resolve-dispute", resolveDispute);
router.post("/force-close", forceCloseExpired);
router.post("/receipt-hash", getReceiptHash);
router.get("/locked-funds", getLockedFunds);
router.get("/:channelId", getChannel);
router.get("/:channelId/status", getChannelStatus);

export default router;
