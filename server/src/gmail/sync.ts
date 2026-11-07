import type { gmail_v1 } from "googleapis";
import type { ObjectId } from "mongodb";
import type { SyncStatus } from "../../../shared/types.js";
import { analyzePending } from "../ai/analyzer.js";
import { gmailForUser } from "../auth/google.js";
import { config } from "../config.js";
import { emails, users } from "../db.js";
import { redactPII } from "../privacy/redact.js";
import { getStatus, setStatus } from "../status.js";
import { parseMessage } from "./parse.js";
import { startWatch } from "./watch.js";

const running = new Set<string>();

export async function getSyncStatus(userId: ObjectId): Promise<SyncStatus> {
  const [totalStored, analyzed, user] = await Promise.all([
    emails().countDocuments({ userId }),
    emails().countDocuments({ userId, analyzedAt: { $ne: null } }),
    users().findOne({ _id: userId }, { projection: { lastSyncAt: 1 } }),
  ]);
  const s = getStatus(userId);
  return {
    ...s,
    totalStored,
    analyzed,
    pending: totalStored - analyzed,
    lastSyncAt: user?.lastSyncAt?.toISOString() ?? null,
    mode: config.SYNC_MODE,
  };
}

/** Runs `fn` only if no other sync is running for this user. */
async function withLock(userId: ObjectId, fn: () => Promise<void>): Promise<void> {
  const key = userId.toHexString();
  if (running.has(key)) return;
  running.add(key);
  try {
    await fn();
  } catch (err) {
    console.error(`Sync error for ${key}:`, err);
    setStatus(userId, { state: "error", message: (err as Error).message });
  } finally {
    running.delete(key);
  }
}

/** Small concurrency helper so we don't hammer the Gmail API. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchAndStore(gmail: gmail_v1.Gmail, userId: ObjectId, ids: string[]): Promise<number> {
  const existing = new Set(
    (await emails().find({ userId, gmailId: { $in: ids } }, { projection: { gmailId: 1 } }).toArray()).map((e) => e.gmailId),
  );
  const fresh = ids.filter((id) => !existing.has(id));
  let stored = 0;
  await mapLimit(fresh, 5, async (id) => {
    try {
      const { data } = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const m = parseMessage(data);
      // Skip spam/trash/drafts/sent — briefing is about what you RECEIVED.
      if (m.labelIds.some((l) => ["SPAM", "TRASH", "DRAFT", "SENT"].includes(l))) return;
      await emails().updateOne(
        { userId, gmailId: m.gmailId },
        {
          $setOnInsert: {
            userId,
            gmailId: m.gmailId,
            threadId: m.threadId,
            from: m.from,
            fromName: m.fromName,
            fromEmail: m.fromEmail,
            subject: redactPII(m.subject),
            date: m.date,
            snippet: redactPII(m.snippet),
            labelIds: m.labelIds,
            bodyRedacted: redactPII(m.bodyText),
            analysis: null,
            analyzedAt: null,
            analysisError: null,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
      stored++;
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 404) console.warn(`Could not fetch message ${id}:`, (err as Error).message);
    }
  });
  return stored;
}

/** First login: read the last N days of the inbox, then analyze. */
export async function startInitialSync(userId: ObjectId): Promise<void> {
  const existing = await users().findOne({ _id: userId }, { projection: { historyId: 1 } });
  if (!existing) return;
  // Already synced before — only fetch what's new.
  if (existing.historyId) return incrementalSync(userId);

  await withLock(userId, async () => {
    const gmail = await gmailForUser(userId);
    setStatus(userId, { state: "syncing", message: "Reading your inbox…" });

    const profile = await gmail.users.getProfile({ userId: "me" });
    const historyId = profile.data.historyId ?? null;

    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await gmail.users.messages.list({
        userId: "me",
        q: `in:inbox newer_than:${config.INITIAL_SYNC_DAYS}d`,
        maxResults: Math.min(100, config.INITIAL_SYNC_MAX - ids.length),
        pageToken,
      });
      data.messages?.forEach((m) => m.id && ids.push(m.id));
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken && ids.length < config.INITIAL_SYNC_MAX);

    setStatus(userId, { state: "syncing", message: `Downloading ${ids.length} emails…` });
    await fetchAndStore(gmail, userId, ids);
    await users().updateOne({ _id: userId }, { $set: { historyId, lastSyncAt: new Date() } });

    if (config.SYNC_MODE === "pubsub") await startWatch(userId);
  });
  await analyzePending(userId);
}

/** Fetch only messages added since the last known historyId. */
export async function incrementalSync(userId: ObjectId): Promise<void> {
  let needsFullResync = false;
  await withLock(userId, async () => {
    const user = await users().findOne({ _id: userId });
    if (!user) return;
    if (!user.historyId) {
      needsFullResync = true;
      return;
    }
    const gmail = await gmailForUser(userId);
    const ids = new Set<string>();
    let pageToken: string | undefined;
    let latestHistoryId = user.historyId;
    try {
      do {
        const { data } = await gmail.users.history.list({
          userId: "me",
          startHistoryId: user.historyId,
          historyTypes: ["messageAdded"],
          labelId: "INBOX",
          pageToken,
        });
        data.history?.forEach((h) => h.messagesAdded?.forEach((a) => a.message?.id && ids.add(a.message.id)));
        if (data.historyId) latestHistoryId = data.historyId;
        pageToken = data.nextPageToken ?? undefined;
      } while (pageToken);
    } catch (err) {
      // 404 = our historyId is too old (Gmail keeps ~1 week). Start fresh.
      if ((err as { code?: number }).code === 404) {
        needsFullResync = true;
        return;
      }
      throw err;
    }

    if (ids.size > 0) {
      setStatus(userId, { state: "syncing", message: `${ids.size} new emails…` });
      await fetchAndStore(gmail, userId, [...ids]);
    }
    await users().updateOne({ _id: userId }, { $set: { historyId: latestHistoryId, lastSyncAt: new Date() } });
    setStatus(userId, { state: "idle", message: "" });
  });

  if (needsFullResync) {
    await users().updateOne({ _id: userId }, { $set: { historyId: null } });
    return startInitialSync(userId);
  }
  await analyzePending(userId);
}
