/** Glue between the live email store (chrome.storage), Gmail, and the SQLite history. */
import { redactPII } from "../../../server/src/privacy/redact";
import { classifyBatch, GeminiError, localAnalysis, onAnalysed } from "./ai";
import { extractBody, gmail, header, parseFrom } from "./gmail";
import {
  addSent, backfillCounts, backfillPending, getDb, getMeta, knownEmailIds, knownSentIds, listWatches, logAction, matchWatches,
  scheduleSave, setAnalysis, setMeta, upsertEmails, type MailRow,
} from "./sql";
import { db, type EmailRec } from "./store";

let mirroring: Promise<number> | null = null;

/** Copies new / changed emails into SQLite (before old ones are pruned from chrome.storage). */
export function mirror(): Promise<number> {
  mirroring ??= (async () => {
    try {
      const recs = Object.values(await db.emails());
      const rows: MailRow[] = recs.map((r) => ({
        id: r.gmailId, threadId: r.threadId, fromName: r.fromName, fromEmail: r.fromEmail, subject: r.subject, date: r.date,
        labels: r.labelIds, body: r.body, analysis: r.analysis, analyzedAt: r.analyzedAt, src: "live",
      }));
      const sdb = await getDb();
      const n = upsertEmails(sdb, rows);
      if (n) scheduleSave(sdb);
      return n;
    } catch (e) {
      console.warn("Vaani: history update failed", e);
      return 0;
    } finally {
      mirroring = null;
    }
  })();
  return mirroring;
}

/** Remembers what the assistant did ("sent a reply to TCS", "archived …") for "what did you do today?". */
export async function log(kind: string, detail: string): Promise<void> {
  try {
    const sdb = await getDb();
    logAction(sdb, kind, detail);
    scheduleSave(sdb);
  } catch (e) {
    console.warn("Vaani: could not log action", e);
  }
}

const mapLimit = async <T,>(items: T[], n: number, fn: (t: T) => Promise<void>) => {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
};

/** Your sent emails (only thread + time) — so Vaani knows which questions you already answered. */
export async function syncSent(): Promise<void> {
  try {
    const sdb = await getDb();
    const first = !getMeta<boolean>(sdb, "sentSynced");
    const r = await gmail.list({ q: `in:sent newer_than:${first ? 60 : 3}d`, maxResults: first ? 300 : 100 });
    const known = knownSentIds(sdb);
    const fresh = (r.messages ?? []).filter((m) => !known.has(m.id));
    const out: { id: string; threadId: string; date: string }[] = [];
    await mapLimit(fresh, 5, async (m) => {
      const g = await gmail.get(m.id, "metadata", ["Date"]).catch(() => null);
      if (g) out.push({ id: g.id, threadId: g.threadId, date: new Date(Number(g.internalDate ?? Date.now())).toISOString() });
    });
    if (addSent(sdb, out) || first) {
      setMeta(sdb, "sentSynced", true);
      scheduleSave(sdb);
    }
  } catch (e) {
    console.warn("Vaani: could not read sent mail", e);
  }
}

// ---------------- alerts ----------------
export interface Alert { at: string; label: string; text: string; gmailId: string; threadId: string }

/** New emails that match "tell me whenever …" → a Chrome notification + a spoken heads-up in Gmail. */
onAnalysed((recs: EmailRec[]) => {
  void (async () => {
    try {
      const sdb = await getDb();
      const watches = listWatches(sdb);
      if (!watches.length) return;
      const hits = matchWatches(watches, recs.map((r) => ({ id: r.gmailId, fromName: r.fromName, fromEmail: r.fromEmail, subject: r.subject, analysis: r.analysis! })));
      if (!hits.length) return;
      const alerts: Alert[] = hits.map((h) => ({
        at: new Date().toISOString(), label: h.watch.label, gmailId: h.mail.id, threadId: recs.find((r) => r.gmailId === h.mail.id)?.threadId ?? "",
        text: h.mail.analysis.ask || `${h.mail.analysis.entity}: ${h.mail.analysis.summary}`,
      }));
      const prev = ((await chrome.storage.local.get("alerts")).alerts as Alert[] | undefined) ?? [];
      await chrome.storage.local.set({ alerts: [...alerts, ...prev].slice(0, 20) });
      for (const a of alerts) {
        chrome.notifications?.create(`vaani-${a.gmailId}`, {
          type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"), title: `Heads up: ${a.label}`, message: a.text.slice(0, 180), priority: 2,
        });
        void log("alert", `Told you: ${a.text.slice(0, 120)}`);
      }
    } catch (e) {
      console.warn("Vaani: alert check failed", e);
    }
  })();
});

// ---------------- old-email import (backfill) ----------------
export interface Backfill { status: "idle" | "running" | "done" | "paused"; months: number; pageToken: string | null; fetchDone: boolean; day: string; callsToday: number; message: string }
const BACKFILL_CALLS_PER_DAY = 20; // ≈ 300 old emails a day on the free tier, leaving plenty for new mail
const today = () => new Date().toISOString().slice(0, 10);

export async function startBackfill(months: number): Promise<Backfill> {
  const sdb = await getDb();
  const b: Backfill = { status: "running", months: Math.min(Math.max(months, 1), 24), pageToken: null, fetchDone: false, day: today(), callsToday: 0, message: "" };
  setMeta(sdb, "backfill", b);
  scheduleSave(sdb, 200);
  void backfillTick();
  return b;
}

export async function backfillStatus() {
  const sdb = await getDb();
  const b = getMeta<Backfill>(sdb, "backfill") ?? { status: "idle", months: 0, pageToken: null, fetchDone: false, day: today(), callsToday: 0, message: "" };
  const c = backfillCounts(sdb) ?? { total: 0, analysed: 0 };
  return { ...b, imported: Number(c.total ?? 0), analysed: Number(c.analysed ?? 0) };
}

let ticking = false;
/** One gentle step, run with every sync: fetch the next 50 old emails, then analyse one batch if the daily budget allows. */
export async function backfillTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const sdb = await getDb();
    const b = getMeta<Backfill>(sdb, "backfill");
    if (!b || b.status !== "running") return;
    if (b.day !== today()) Object.assign(b, { day: today(), callsToday: 0 });

    if (!b.fetchDone) {
      const r = await gmail.list({ q: `in:inbox newer_than:${b.months * 30}d older_than:7d`, maxResults: 50, ...(b.pageToken ? { pageToken: b.pageToken } : {}) });
      const known = knownEmailIds(sdb);
      const ids = (r.messages ?? []).map((m) => m.id).filter((id) => !known.has(id));
      const rows: MailRow[] = [];
      await mapLimit(ids, 5, async (id) => {
        const m = await gmail.get(id, "full").catch(() => null);
        if (!m) return;
        const from = parseFrom(header(m, "From"));
        const labels = m.labelIds ?? [];
        const base = { labelIds: labels, fromName: from.name, fromEmail: from.email, subject: redactPII(header(m, "Subject") || "(no subject)") };
        const local = localAnalysis(base); // promotions / social: no AI needed
        rows.push({
          id: m.id, threadId: m.threadId, fromName: from.name, fromEmail: from.email, subject: base.subject,
          date: new Date(Number(m.internalDate ?? Date.now())).toISOString(), labels, body: redactPII(extractBody(m.payload)),
          analysis: local, analyzedAt: local ? new Date().toISOString() : null, src: "backfill",
        });
      });
      upsertEmails(sdb, rows);
      b.pageToken = r.nextPageToken ?? null;
      b.fetchDone = !r.nextPageToken;
    }

    // New mail always goes first; old mail uses a small daily share of the free AI quota.
    const livePending = Object.values(await db.emails()).some((e) => !e.analyzedAt && !e.analysisError);
    if (!livePending && b.callsToday < BACKFILL_CALLS_PER_DAY && (await db.get("geminiKey"))) {
      const pend = backfillPending(sdb, 15);
      if (pend.length) {
        try {
          const batch = pend.map((p) => ({ id: p.id, from: `${p.fromName} <${p.fromEmail}>`, subject: p.subject, date: p.date, gmailLabels: p.labels.split(","), body: p.body }));
          const res = await classifyBatch(batch);
          for (const p of pend) {
            const a = res.get(p.id);
            if (a) setAnalysis(sdb, p.id, a);
          }
          b.callsToday++;
          b.message = "";
        } catch (e) {
          if (e instanceof GeminiError && e.status === 429) {
            b.callsToday = BACKFILL_CALLS_PER_DAY; // free limit used up: continue tomorrow
            b.message = "Paused until tomorrow (free AI limit).";
          } else b.message = (e as Error).message.slice(0, 120);
        }
      } else if (b.fetchDone) {
        b.status = "done";
        void log("import", `Finished importing ${b.months} months of old emails`);
      }
    }
    setMeta(sdb, "backfill", b);
    scheduleSave(sdb);
  } catch (e) {
    console.warn("Vaani: import step failed", e);
  } finally {
    ticking = false;
  }
}
