import { config } from "../config.js";
import { emails, users } from "../db.js";
import { incrementalSync } from "./sync.js";
import { startWatch } from "./watch.js";

/**
 * Background intelligence loop.
 * - poll mode:   every POLL_INTERVAL_SEC, fetch new mail for every user and analyze it.
 * - pubsub mode: Gmail pushes changes to /api/gmail/push; here we only renew watches
 *                and run a slow safety-net sync every 15 minutes.
 */
export function startScheduler(): void {
  const intervalMs =
    config.SYNC_MODE === "poll" ? config.POLL_INTERVAL_SEC * 1000 : 15 * 60 * 1000;

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const all = await users().find({ historyId: { $ne: null } }, { projection: { _id: 1 } }).toArray();
      for (const u of all) await incrementalSync(u._id);
    } catch (err) {
      console.error("Scheduler tick failed:", err);
    } finally {
      busy = false;
    }
  };
  setInterval(tick, intervalMs);

  // Keep storage small: drop our copies of old emails (Gmail itself is not touched).
  const prune = async () => {
    const cutoff = new Date(Date.now() - config.RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { deletedCount } = await emails().deleteMany({ date: { $lt: cutoff } });
    if (deletedCount) console.log(`🧹 Removed ${deletedCount} stored emails older than ${config.RETENTION_DAYS} days`);
  };
  setInterval(() => void prune().catch(() => undefined), 6 * 60 * 60 * 1000);
  void prune().catch(() => undefined);

  if (config.SYNC_MODE === "pubsub") {
    const renew = async () => {
      const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const due = await users()
        .find({ $or: [{ watchExpiration: null }, { watchExpiration: { $lt: soon } }], historyId: { $ne: null } })
        .toArray();
      for (const u of due) await startWatch(u._id!).catch((e) => console.warn("Watch renew failed:", e.message));
    };
    setInterval(() => void renew(), 60 * 60 * 1000);
    void renew();
  }

  console.log(`⏱  Background sync: ${config.SYNC_MODE} mode, every ${intervalMs / 1000}s`);
}
