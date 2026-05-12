import {
  TransferExecuted as TransferExecutedEvent,
} from "../generated/templates/ClientVault/ClientAgentVault";
import { Payment, Session, SessionIndex, User } from "../generated/schema";

export function handleTransferExecuted(event: TransferExecutedEvent): void {
  const sessionIdHex = event.params.sessionId.toHexString();
  const index = SessionIndex.load(sessionIdHex);
  if (!index) {
    return;
  }

  const session = Session.load(index.session);
  if (!session) {
    return;
  }

  const paymentId =
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const payment = new Payment(paymentId);

  payment.session = session.id;
  payment.agent = session.agent;
  payment.user = session.user;
  payment.channel = null;

  payment.recipient = event.params.to;
  payment.token = event.params.token;
  payment.amount = event.params.amount;

  payment.timestamp = event.block.timestamp;
  payment.txHash = event.transaction.hash;
  payment.type = "PerCall";

  payment.save();

  const user = User.load(session.user);
  if (user) {
    user.totalSpent = user.totalSpent.plus(event.params.amount);
    user.updatedAt = event.block.timestamp;
    user.save();
  }
}
