import type { ObjectId } from "mongodb";
import { gmailForUser } from "../auth/google.js";
import { config } from "../config.js";
import { users } from "../db.js";

/**
 * Gmail push notifications (SYNC_MODE=pubsub).
 * Gmail sends a Pub/Sub message whenever the INBOX changes. A watch expires
 * after ~7 days, so the scheduler renews it daily.
 */
export async function startWatch(userId: ObjectId): Promise<void> {
  if (config.SYNC_MODE !== "pubsub") return;
  const gmail = await gmailForUser(userId);
  const { data } = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName: config.GMAIL_PUBSUB_TOPIC,
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE",
    },
  });
  await users().updateOne(
    { _id: userId },
    { $set: { watchExpiration: data.expiration ? new Date(Number(data.expiration)) : null } },
  );
}

export async function stopWatch(userId: ObjectId): Promise<void> {
  if (config.SYNC_MODE !== "pubsub") return;
  const gmail = await gmailForUser(userId);
  await gmail.users.stop({ userId: "me" });
}
