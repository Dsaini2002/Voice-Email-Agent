/** Background inbox sync (chrome.alarms) — reads new mail, redacts PII, then analyses it. */
import { redactPII } from "../../../server/src/privacy/redact";
import { analyzePending } from "./ai";
import { backfillTick, mirror, syncSent } from "./history";
import { AuthError } from "./auth";
import { INITIAL_SYNC_DAYS, INITIAL_SYNC_MAX, RETENTION_DAYS } from "./env";
import { extractBody, gmail, GmailError, header, parseFrom } from "./gmail";
import { db, type EmailRec } from "./store";

let running = false;

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

async function fetchAndStore(ids: string[]): Promise<number> {
  const known = await db.emails();
  const fresh = ids.filter((id) => !known[id]);
  const recs: EmailRec[] = [];
  await mapLimit(fresh, 5, async (id) => {
    try {
      const m = await gmail.get(id, "full");
      const labels = m.labelIds ?? [];
      if (labels.some((l) => ["SPAM", "TRASH", "DRAFT", "SENT"].includes(l))) return;
      const from = header(m, "From");
      const { name, email } = parseFrom(from);
      const date = m.internalDate ? new Date(Number(m.internalDate)) : new Date(header(m, "Date"));
      recs.push({
        gmailId: m.id,
        threadId: m.threadId,
        from,
        fromName: name,
        fromEmail: email,
        subject: redactPII(header(m, "Subject") || "(no subject)"),
        date: (isNaN(date.getTime()) ? new Date() : date).toISOString(),
        labelIds: labels,
        body: redactPII(extractBody(m.payload)),
        analysis: null,
        analyzedAt: null,
        analysisError: null,
      });
    } catch (err) {
      if (!(err instanceof GmailError && err.status === 404)) console.warn("Vaani: could not fetch", id, err);
    }
  });
  if (recs.length) await db.updateEmails((map) => recs.forEach((r) => (map[r.gmailId] = r)));
  return recs.length;
}

async function initialSync(): Promise<void> {
  await db.patchSync({ state: "syncing", message: "Reading your inbox…" });
  const profile = await gmail.profile();
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const r = await gmail.list({ q: `in:inbox newer_than:${INITIAL_SYNC_DAYS}d`, maxResults: Math.min(100, INITIAL_SYNC_MAX - ids.length), ...(pageToken ? { pageToken } : {}) });
    r.messages?.forEach((m) => ids.push(m.id));
    pageToken = r.nextPageToken;
  } while (pageToken && ids.length < INITIAL_SYNC_MAX);
  await db.patchSync({ message: `Downloading ${ids.length} emails…` });
  await fetchAndStore(ids);
  await db.patchSync({ historyId: profile.historyId, lastSyncAt: new Date().toISOString(), state: "idle", message: "" });
}

async function incrementalSync(historyId: string): Promise<void> {
  const ids = new Set<string>();
  let latest = historyId;
  let pageToken: string | undefined;
  do {
    const r = await gmail.history(historyId, pageToken);
    r.history?.forEach((h) => h.messagesAdded?.forEach((a) => a.message?.id && ids.add(a.message.id)));
    if (r.historyId) latest = r.historyId;
    pageToken = r.nextPageToken;
  } while (pageToken);
  if (ids.size) await fetchAndStore([...ids]);
  await db.patchSync({ historyId: latest, lastSyncAt: new Date().toISOString() });
}

async function prune(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  await db.updateEmails((m) => {
    for (const [id, e] of Object.entries(m)) if (e.date < cutoff) delete m[id];
  });
}

export async function runSync(): Promise<void> {
  if (running || !(await db.get("account"))) return;
  running = true;
  try {
    const s = await db.sync();
    if (!s.historyId) await initialSync();
    else {
      try {
        await incrementalSync(s.historyId);
      } catch (err) {
        if (err instanceof GmailError && err.status === 404) {
          await db.patchSync({ historyId: null });
          await initialSync(); // history too old
        } else throw err;
      }
    }
    await mirror(); // keep a permanent copy in SQLite before old emails leave chrome.storage
    await prune();
  } catch (err) {
    if (err instanceof AuthError) return;
    await db.patchSync({ state: "error", message: (err as Error).message.slice(0, 160) });
    return;
  } finally {
    running = false;
  }
  await analyzePending();
  await mirror(); // store the AI results too
  await syncSent(); // which emails you already answered
  await backfillTick(); // old-email import, a little at a time
}
