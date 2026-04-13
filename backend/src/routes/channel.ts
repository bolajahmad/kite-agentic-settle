import { Router } from "express";
import {
  openChannel,
  activateChannel,
  initiateSettlement,
  submitReceipt,
  finalizeChannel,
  forceCloseExpired,
  getChannel,
  getChannelStatus,
  getSettlementState,
  getReceiptHash,
  getLockedFunds,
} from "../controllers/channel.js";

const router = Router();

router.post("/open", openChannel);
router.post("/activate", activateChannel);
router.post("/initiate-settlement", initiateSettlement);
router.post("/submit-receipt", submitReceipt);
router.post("/finalize", finalizeChannel);
router.post("/force-close", forceCloseExpired);
router.post("/receipt-hash", getReceiptHash);
router.get("/locked-funds", getLockedFunds);
router.get("/:channelId", getChannel);
router.get("/:channelId/status", getChannelStatus);
router.get("/:channelId/settlement", getSettlementState);

export default router;
