/**
 * Long-term email history in SQLite (WebAssembly, runs inside the extension — nothing to install).
 * chrome.storage keeps the last 30 days for the live briefing; this database keeps everything,
 * so questions like "how many interviews this month?" are answered instantly, offline, and
 * without spending any AI quota.
 *
 * The query functions are pure (they take a Database) and are unit tested in Node.
 */
import type { Database, SqlJsStatic, SqlValue } from "sql.js";
import type { AppStatus, Category, EmailAnalysis } from "../../../shared/types";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY, thread_id TEXT, from_name TEXT, from_email TEXT, subject TEXT, date TEXT,
  labels TEXT, body TEXT, category TEXT, status TEXT, priority TEXT, entity TEXT, group_key TEXT,
  summary TEXT, action_text TEXT, deadline TEXT, is_scam INTEGER DEFAULT 0, verified INTEGER DEFAULT 0,
  confidence REAL DEFAULT 0, sig TEXT
);
CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date);
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status, date);
CREATE INDEX IF NOT EXISTS idx_emails_entity ON emails(entity);
CREATE INDEX IF NOT EXISTS idx_emails_from ON emails(from_email);
CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts4(id, subject, body, sender, entity, summary, notindexed=id, tokenize=unicode61);
CREATE TABLE IF NOT EXISTS actions (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_actions_at ON actions(at);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS sent (id TEXT PRIMARY KEY, thread_id TEXT, date TEXT);
CREATE INDEX IF NOT EXISTS idx_sent_thread ON sent(thread_id, date);
CREATE TABLE IF NOT EXISTS watches (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, value TEXT NOT NULL, label TEXT NOT NULL, created TEXT NOT NULL);
`;

/** Columns added after v2.1 — added in place so existing histories keep working. */
const MIGRATIONS: [string, string][] = [
  ["intent", "TEXT"], ["ask", "TEXT"], ["tags", "TEXT"], ["needs_reply", "INTEGER DEFAULT 0"], ["from_person", "INTEGER DEFAULT 0"],
  ["src", "TEXT DEFAULT 'live'"],
];
function migrate(db: Database) {
  const cols = new Set((db.exec("PRAGMA table_info(emails)")[0]?.values ?? []).map((r) => String(r[1])));
  for (const [c, type] of MIGRATIONS) if (!cols.has(c)) db.exec(`ALTER TABLE emails ADD COLUMN ${c} ${type}`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_emails_intent ON emails(intent, date); CREATE INDEX IF NOT EXISTS idx_emails_src ON emails(src, category);");
}

export interface MailRow {
  id: string; threadId: string; fromName: string; fromEmail: string; subject: string; date: string;
  labels: string[]; body: string; analysis: EmailAnalysis | null; analyzedAt: string | null;
  /** "live" = mirrored from the last 30 days; "backfill" = imported old email. */
  src?: "live" | "backfill";
}

// ---------------- engine (extension) ----------------
let SQL: SqlJsStatic | null = null;
let dbp: Promise<Database> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export interface Persist { load(): Promise<Uint8Array | null>; save(bytes: Uint8Array): Promise<void>; clear(): Promise<void> }

const IDB = "vaani-history";
function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(IDB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("db");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("db", mode);
      const req = fn(tx.objectStore("db"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => open.result.close();
    };
  });
}
let persist: Persist = {
  load: () => idb<Uint8Array | undefined>("readonly", (s) => s.get("main") as IDBRequest<Uint8Array | undefined>).then((v) => v ?? null),
  save: (bytes) => idb("readwrite", (s) => s.put(bytes, "main")).then(() => undefined),
  clear: () => idb("readwrite", (s) => s.delete("main")).then(() => undefined),
};
/** Tests swap the storage (Node has no IndexedDB). */
export function setPersist(p: Persist) {
  persist = p;
  dbp = null;
}

export async function engine(init?: (o?: object) => Promise<SqlJsStatic>): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  const initSqlJs = init ?? (await import("sql.js")).default;
  const inExtension = typeof chrome !== "undefined" && Boolean(chrome.runtime?.getURL);
  SQL = await initSqlJs(inExtension ? { locateFile: (f: string) => chrome.runtime.getURL(`dist/${f}`) } : undefined);
  return SQL;
}

export function openDb(SQLs: SqlJsStatic, bytes?: Uint8Array | null): Database {
  const db = bytes ? new SQLs.Database(bytes) : new SQLs.Database();
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** The shared database (loaded once per service-worker life). */
export function getDb(): Promise<Database> {
  dbp ??= (async () => openDb(await engine(), await persist.load().catch(() => null)))();
  return dbp;
}

/** Saves shortly after the last change (one write for a burst of updates). */
export function scheduleSave(db: Database, ms = 1500) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persist.save(db.export()).catch((e) => console.warn("Vaani: could not save history", e)), ms);
}

export async function clearHistory(): Promise<void> {
  const db = await getDb();
  db.exec("DELETE FROM emails; DELETE FROM emails_fts; DELETE FROM actions; DELETE FROM meta; DELETE FROM sent; DELETE FROM watches;");
  await persist.clear();
}

// ---------------- writes ----------------
const sigOf = (r: MailRow) => `${r.analyzedAt ?? ""}|${r.labels.join(",")}`;

/** Copies emails into the archive; only rows that changed are rewritten. Returns how many were written. */
export function upsertEmails(db: Database, rows: MailRow[]): number {
  if (!rows.length) return 0;
  const known = new Map<string, string>();
  const res = db.exec("SELECT id, sig FROM emails");
  for (const [id, sig] of res[0]?.values ?? []) known.set(String(id), String(sig ?? ""));
  const changed = rows.filter((r) => known.get(r.id) !== sigOf(r));
  if (!changed.length) return 0;
  const put = db.prepare(`INSERT OR REPLACE INTO emails (id, thread_id, from_name, from_email, subject, date, labels, body, category, status, priority,
    entity, group_key, summary, action_text, deadline, is_scam, verified, confidence, sig, intent, ask, tags, needs_reply, from_person, src)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const delFts = db.prepare("DELETE FROM emails_fts WHERE id = ?");
  const putFts = db.prepare("INSERT INTO emails_fts (id, subject, body, sender, entity, summary) VALUES (?,?,?,?,?,?)");
  db.exec("BEGIN");
  try {
    for (const r of changed) {
      const a = r.analysis;
      put.run([r.id, r.threadId, r.fromName, r.fromEmail, r.subject, r.date, r.labels.join(","), r.body.slice(0, 4000),
        a?.category ?? null, a?.status ?? null, a?.priority ?? null, a?.entity || r.fromName || r.fromEmail, a?.groupKey ?? null,
        a?.summary ?? null, a?.actionText ?? null, a?.deadline ?? null, a?.isScam ? 1 : 0, a?.verified ? 1 : 0, a?.confidence ?? 0, sigOf(r),
        a?.intent ?? null, a?.ask ?? null, (a?.tags ?? []).join(", ") || null, a?.needsReply && a.verified ? 1 : 0, a?.fromPerson ? 1 : 0, r.src ?? "live"]);
      delFts.run([r.id]);
      putFts.run([r.id, r.subject, r.body.slice(0, 4000), `${r.fromName} ${r.fromEmail}`, a?.entity ?? r.fromName, a?.summary ?? ""]);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    put.free();
    delFts.free();
    putFts.free();
  }
  return changed.length;
}

export function logAction(db: Database, kind: string, detail: string, at = new Date().toISOString()) {
  db.run("INSERT INTO actions (at, kind, detail) VALUES (?,?,?)", [at, kind, detail.slice(0, 300)]);
  db.run("DELETE FROM actions WHERE id NOT IN (SELECT id FROM actions ORDER BY id DESC LIMIT 2000)");
}

// ---------------- reads ----------------
function rows<T = Record<string, SqlValue>>(db: Database, sql: string, params: SqlValue[] = []): T[] {
  const st = db.prepare(sql);
  st.bind(params);
  const out: T[] = [];
  while (st.step()) out.push(st.getAsObject() as T);
  st.free();
  return out;
}

export type Period = "today" | "week" | "month" | "last_month" | "year" | "all";
export const PERIOD_LABEL: Record<Period, string> = {
  today: "today", week: "this week", month: "this month", last_month: "last month", year: "this year", all: "so far",
};

/** [from, to) as ISO strings for a period, in local time. */
export function periodRange(p: Period, now = new Date()): [string, string] {
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(d0.getTime() + 86_400_000).toISOString();
  switch (p) {
    case "today": return [d0.toISOString(), end];
    case "week": return [new Date(d0.getTime() - 6 * 86_400_000).toISOString(), end];
    case "month": return [new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), end];
    case "last_month": return [new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(), new Date(now.getFullYear(), now.getMonth(), 1).toISOString()];
    case "year": return [new Date(now.getFullYear(), 0, 1).toISOString(), end];
    default: return ["0000", "9999"];
  }
}

export interface HistItem {
  id: string; threadId: string; entity: string; subject: string; summary: string; date: string;
  status: AppStatus; category: Category; verified: boolean; actionText: string; deadline: string;
}
const ITEM_COLS = `id, thread_id AS threadId, COALESCE(entity, from_name) AS entity, subject, COALESCE(summary, subject) AS summary, date,
  COALESCE(status, 'none') AS status, COALESCE(category, 'other') AS category, verified, COALESCE(action_text, '') AS actionText, COALESCE(deadline, '') AS deadline`;
const ITEM_COLS_E = `e.id AS id, e.thread_id AS threadId, COALESCE(e.entity, e.from_name) AS entity, e.subject AS subject, COALESCE(e.summary, e.subject) AS summary,
  e.date AS date, COALESCE(e.status, 'none') AS status, COALESCE(e.category, 'other') AS category, e.verified AS verified,
  COALESCE(e.action_text, '') AS actionText, COALESCE(e.deadline, '') AS deadline`;
const toItem = (r: Record<string, SqlValue>): HistItem => ({ ...(r as unknown as HistItem), verified: Boolean(r.verified) });

/**
 * "How many interviews this month?" → counts emails AND distinct companies (3 reminders from TCS = 1 company).
 * Only verified statuses count (Truth Verification), so "application received" never becomes "shortlisted".
 */
export function countBy(db: Database, o: { status?: string; category?: string; from?: string; period: Period; now?: Date }) {
  const [from, to] = periodRange(o.period, o.now);
  const where = ["date >= ?", "date < ?"];
  const params: SqlValue[] = [from, to];
  if (o.status) {
    where.push("status = ?", "verified = 1");
    params.push(o.status);
  }
  if (o.category) {
    where.push(o.category === "scam" ? "(category = 'scam' OR is_scam = 1)" : "category = ?");
    if (o.category !== "scam") params.push(o.category);
  }
  if (o.from) {
    const like = `%${o.from.replace(/[%_]/g, "")}%`;
    where.push("(from_name LIKE ? OR from_email LIKE ? OR entity LIKE ?)");
    params.push(like, like, like);
  }
  const w = where.join(" AND ");
  const emails = Number(rows<{ n: number }>(db, `SELECT COUNT(*) AS n FROM emails WHERE ${w}`, params)[0]?.n ?? 0);
  const companies = rows<{ entity: string }>(db, `SELECT COALESCE(entity, from_name) AS entity, MAX(date) AS last FROM emails WHERE ${w} GROUP BY COALESCE(group_key, entity) ORDER BY last DESC`, params).map((r) => r.entity);
  const items = rows(db, `SELECT ${ITEM_COLS} FROM emails WHERE ${w} ORDER BY date DESC LIMIT 30`, params).map(toItem);
  return { emails, companies: [...new Set(companies)], items };
}

const STAGE_RANK: Record<string, number> = { application_received: 1, assessment: 2, shortlisted: 3, interview: 4, offer: 5, rejected: 5 };

export interface Journey { entity: string; groupKey: string; current: AppStatus; lastDate: string; firstDate: string; steps: { status: AppStatus; date: string; id: string }[]; latestId: string; threadId: string }

/** Job tracker: one row per application (company + matter), with every stage it went through. */
export function tracker(db: Database, entity?: string): Journey[] {
  const params: SqlValue[] = [];
  let extra = "";
  if (entity) {
    extra = " AND LOWER(entity) = LOWER(?)";
    params.push(entity);
  }
  const all = rows<{ id: string; threadId: string; entity: string; groupKey: string; status: AppStatus; date: string }>(db,
    `SELECT id, thread_id AS threadId, entity, COALESCE(group_key, entity) AS groupKey, status, date FROM emails
     WHERE status IS NOT NULL AND status != 'none' AND verified = 1${extra} ORDER BY date ASC`, params);
  const byKey = new Map<string, Journey>();
  for (const r of all) {
    const j = byKey.get(r.groupKey) ?? { entity: r.entity, groupKey: r.groupKey, current: r.status, firstDate: r.date, lastDate: r.date, steps: [], latestId: r.id, threadId: r.threadId };
    if (!j.steps.some((s) => s.status === r.status)) j.steps.push({ status: r.status, date: r.date, id: r.id });
    // the newest email decides where you are; a later "application received" never moves you backwards
    if (r.date >= j.lastDate && (STAGE_RANK[r.status] ?? 0) >= (STAGE_RANK[j.current] ?? 0) - (j.current === "rejected" ? 5 : 0)) {
      j.current = r.status;
      j.latestId = r.id;
      j.threadId = r.threadId;
    }
    j.lastDate = r.date > j.lastDate ? r.date : j.lastDate;
    byKey.set(r.groupKey, j);
  }
  return [...byKey.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

/** Instant search across the whole archive (FTS4). Every word must match; the last word may be a prefix. */
export function searchHistory(db: Database, q: string, limit = 20): HistItem[] {
  const words = q.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1).slice(0, 8);
  if (!words.length) return [];
  const match = words.map((w, i) => (i === words.length - 1 ? `${w}*` : w)).join(" ");
  return rows(db, `SELECT ${ITEM_COLS_E} FROM emails_fts f JOIN emails e ON e.id = f.id
    WHERE emails_fts MATCH ? ORDER BY e.date DESC LIMIT ?`, [match, limit]).map(toItem);
}

export function stats(db: Database, period: Period, now?: Date) {
  const [from, to] = periodRange(period, now);
  const p: SqlValue[] = [from, to];
  const total = Number(rows<{ n: number }>(db, "SELECT COUNT(*) AS n FROM emails WHERE date >= ? AND date < ?", p)[0]?.n ?? 0);
  const byStatus = rows<{ status: string; n: number }>(db,
    "SELECT status, COUNT(DISTINCT COALESCE(group_key, entity)) AS n FROM emails WHERE date >= ? AND date < ? AND status != 'none' AND verified = 1 GROUP BY status", p);
  const byCategory = rows<{ category: string; n: number }>(db,
    "SELECT COALESCE(category, 'not analysed') AS category, COUNT(*) AS n FROM emails WHERE date >= ? AND date < ? GROUP BY 1 ORDER BY n DESC", p);
  const topSenders = rows<{ sender: string; n: number }>(db,
    "SELECT COALESCE(NULLIF(from_name, ''), from_email) AS sender, COUNT(*) AS n FROM emails WHERE date >= ? AND date < ? GROUP BY from_email ORDER BY n DESC LIMIT 5", p);
  const perMonth = rows<{ month: string; n: number; jobs: number }>(db,
    "SELECT substr(date, 1, 7) AS month, COUNT(*) AS n, SUM(CASE WHEN status IN ('shortlisted','interview','offer','assessment') AND verified = 1 THEN 1 ELSE 0 END) AS jobs FROM emails GROUP BY 1 ORDER BY 1 DESC LIMIT 6").reverse();
  return { total, byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])), byCategory, topSenders, perMonth };
}

export function recentActions(db: Database, sinceIso: string, limit = 30) {
  return rows<{ at: string; kind: string; detail: string }>(db, "SELECT at, kind, detail FROM actions WHERE at >= ? ORDER BY id DESC LIMIT ?", [sinceIso, limit]);
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  // also defuses spreadsheet formulas (=, +, -, @) in email text
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export function trackerCsv(list: Journey[]): string {
  const head = ["Company", "Current stage", "Stages", "First email", "Latest email"];
  const lines = list.map((j) => [j.entity, j.current, j.steps.map((s) => `${s.status} (${s.date.slice(0, 10)})`).join(" → "), j.firstDate.slice(0, 10), j.lastDate.slice(0, 10)].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\n");
}

export function info(db: Database) {
  const n = Number(rows<{ n: number }>(db, "SELECT COUNT(*) AS n FROM emails")[0]?.n ?? 0);
  const first = rows<{ d: string }>(db, "SELECT MIN(date) AS d FROM emails")[0]?.d ?? null;
  return { emails: n, since: first, bytes: db.export().length };
}


// =====================================================================================
// v2.2 — for everyone: intents ("who asked me for help?"), pending replies, funnel,
// ghosting, response times, weekly report, deadlines, contacts, alerts, old-email import
// =====================================================================================
export interface IntentItem extends HistItem { intent: string; ask: string; tags: string; needsReply: boolean; daysWaiting: number; fromEmail: string }
const INTENT_COLS = `${ITEM_COLS}, COALESCE(intent, 'other') AS intent, COALESCE(ask, '') AS ask, COALESCE(tags, '') AS tags, needs_reply AS needsReply, from_email AS fromEmail`;
const toIntentItem = (now: Date) => (r: Record<string, SqlValue>): IntentItem => ({
  ...(r as unknown as IntentItem), verified: Boolean(r.verified), needsReply: Boolean(r.needsReply),
  daysWaiting: Math.max(0, Math.floor((now.getTime() - Date.parse(String(r.date))) / 86_400_000)),
});

/** "Kisi ne aaj help maangi hai?" → verified emails with that intent. */
export function byIntent(db: Database, o: { intents: string[]; period: Period; now?: Date }): IntentItem[] {
  const now = o.now ?? new Date();
  const [from, to] = periodRange(o.period, now);
  const q = o.intents.map(() => "?").join(",");
  return rows(db, `SELECT ${INTENT_COLS} FROM emails WHERE intent IN (${q}) AND verified = 1 AND date >= ? AND date < ? ORDER BY date DESC LIMIT 30`,
    [...o.intents, from, to]).map(toIntentItem(now));
}

/** You haven't answered yet: a person is waiting and there is no email from you in that thread afterwards. */
export function pendingReplies(db: Database, o: { minDays?: number; now?: Date } = {}): IntentItem[] {
  const now = o.now ?? new Date();
  const before = new Date(now.getTime() - (o.minDays ?? 0) * 86_400_000).toISOString();
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  return rows(db, `SELECT ${INTENT_COLS} FROM emails e WHERE e.needs_reply = 1 AND e.verified = 1 AND e.date <= ? AND e.date >= ?
      AND NOT EXISTS (SELECT 1 FROM sent s WHERE s.thread_id = e.thread_id AND s.date > e.date)
    ORDER BY e.date ASC LIMIT 30`, [before, since]).map(toIntentItem(now));
}

export function addSent(db: Database, list: { id: string; threadId: string; date: string }[]): number {
  if (!list.length) return 0;
  const st = db.prepare("INSERT OR IGNORE INTO sent (id, thread_id, date) VALUES (?,?,?)");
  let n = 0;
  for (const s of list) {
    st.run([s.id, s.threadId, s.date]);
    n += db.getRowsModified();
  }
  st.free();
  return n;
}
export const knownSentIds = (db: Database) => new Set((db.exec("SELECT id FROM sent")[0]?.values ?? []).map((r) => String(r[0])));

/** Job funnel: how far your applications get. */
export function funnel(db: Database) {
  const t = tracker(db);
  const reached = (set: string[]) => t.filter((j) => j.steps.some((s) => set.includes(s.status))).length;
  const total = t.length;
  const shortlisted = reached(["shortlisted", "assessment", "interview", "offer"]);
  const interview = reached(["interview", "offer"]);
  const offer = reached(["offer"]);
  const rejected = t.filter((j) => j.current === "rejected").length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return { total, shortlisted, interview, offer, rejected, rates: { shortlisted: pct(shortlisted), interview: pct(interview), offer: pct(offer) } };
}

/** Companies that went quiet: still in progress, no news for `days`. */
export function ghosting(db: Database, days = 14, now = new Date()) {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  return tracker(db)
    .filter((j) => !["rejected", "offer"].includes(j.current) && j.lastDate < cutoff)
    .map((j) => ({ ...j, silentDays: Math.floor((now.getTime() - Date.parse(j.lastDate)) / 86_400_000) }))
    .sort((a, b) => b.silentDays - a.silentDays);
}

/** How long each company takes between steps (applied → next update …). */
export function responseTimes(db: Database) {
  const out: { entity: string; avgDays: number; samples: number }[] = [];
  for (const j of tracker(db)) {
    const ds = j.steps.map((s) => Date.parse(s.date)).sort((a, b) => a - b);
    const gaps = ds.slice(1).map((d, i) => (d - ds[i]) / 86_400_000).filter((g) => g >= 0);
    if (gaps.length) out.push({ entity: j.entity, avgDays: Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10, samples: gaps.length });
  }
  out.sort((a, b) => a.avgDays - b.avgDays);
  const all = out.flatMap((o) => Array(o.samples).fill(o.avgDays) as number[]);
  return { companies: out, overall: all.length ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10 : null };
}

/** Upcoming deadlines found in emails (one per matter). */
export function deadlines(db: Database, now = new Date()) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const all = rows(db, `SELECT ${INTENT_COLS}, COALESCE(group_key, id) AS gk FROM emails WHERE deadline IS NOT NULL AND deadline >= ? AND verified = 1
    ORDER BY date DESC LIMIT 200`, [today]);
  const seen = new Set<string>();
  const latest = all.filter((r) => (seen.has(String(r.gk)) ? false : (seen.add(String(r.gk)), true))); // newest email per matter
  return latest.map(toIntentItem(now)).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 20);
}

/** People who write to you (real people only), most frequent first. */
export function contacts(db: Database, limit = 30) {
  return rows<{ name: string; email: string; n: number; last: string }>(db,
    `SELECT COALESCE(NULLIF(from_name, ''), from_email) AS name, from_email AS email, COUNT(*) AS n, MAX(date) AS last
     FROM emails WHERE from_person = 1 AND from_email != '' GROUP BY LOWER(from_email) ORDER BY n DESC, last DESC LIMIT ?`, [limit]);
}
export function findContact(db: Database, said: string) {
  const words = said.toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 3);
  if (!words.length) return null;
  const where = words.map(() => "(LOWER(from_name) LIKE ? OR LOWER(from_email) LIKE ?)").join(" AND ");
  const params = words.flatMap((w) => [`%${w}%`, `%${w}%`]);
  return rows<{ name: string; email: string }>(db, `SELECT from_name AS name, from_email AS email, COUNT(*) AS n FROM emails
    WHERE from_person = 1 AND ${where} GROUP BY LOWER(from_email) ORDER BY n DESC LIMIT 1`, params)[0] ?? null;
}

/** Last 7 days in one go — for the Monday report. */
export function weekly(db: Database, now = new Date()) {
  const [from, to] = periodRange("week", now);
  const p: SqlValue[] = [from, to];
  const total = Number(rows<{ n: number }>(db, "SELECT COUNT(*) AS n FROM emails WHERE date >= ? AND date < ?", p)[0]?.n ?? 0);
  const intents = Object.fromEntries(rows<{ intent: string; n: number }>(db,
    "SELECT intent, COUNT(*) AS n FROM emails WHERE date >= ? AND date < ? AND verified = 1 AND intent IS NOT NULL GROUP BY intent", p).map((r) => [r.intent, Number(r.n)]));
  const jobMoves = rows<{ entity: string; status: string }>(db,
    "SELECT entity, status FROM emails WHERE date >= ? AND date < ? AND verified = 1 AND status IN ('shortlisted','interview','offer','assessment','rejected') GROUP BY COALESCE(group_key, entity), status ORDER BY date DESC", p);
  const topSenders = rows<{ sender: string; n: number }>(db,
    "SELECT COALESCE(NULLIF(from_name, ''), from_email) AS sender, COUNT(*) AS n FROM emails WHERE date >= ? AND date < ? GROUP BY from_email ORDER BY n DESC LIMIT 3", p);
  return { total, intents, jobMoves, topSenders, pending: pendingReplies(db, { now }).length, deadlines: deadlines(db, now).slice(0, 3) };
}

// ---------------- alerts ("tell me whenever someone asks for help") ----------------
export interface Watch { id: number; kind: "intent" | "status" | "sender" | "keyword"; value: string; label: string }
export function addWatch(db: Database, w: Omit<Watch, "id">) {
  db.run("DELETE FROM watches WHERE kind = ? AND value = ?", [w.kind, w.value]);
  db.run("INSERT INTO watches (kind, value, label, created) VALUES (?,?,?,?)", [w.kind, w.value.slice(0, 80), w.label.slice(0, 120), new Date().toISOString()]);
}
export const listWatches = (db: Database) => rows<Watch>(db, "SELECT id, kind, value, label FROM watches ORDER BY id");
export const clearWatches = (db: Database) => db.run("DELETE FROM watches");

/** Which of these freshly analysed emails match an alert. Pure (no DB) so it's easy to test. */
export function matchWatches(watches: Watch[], mails: { id: string; fromName: string; fromEmail: string; subject: string; analysis: EmailAnalysis }[]) {
  const out: { watch: Watch; mail: (typeof mails)[number] }[] = [];
  for (const m of mails) {
    const a = m.analysis;
    for (const w of watches) {
      const v = w.value.toLowerCase();
      const hit =
        (w.kind === "intent" && a.verified && a.intent === w.value) ||
        (w.kind === "status" && a.verified && a.status === w.value) ||
        (w.kind === "sender" && `${m.fromName} ${m.fromEmail} ${a.entity}`.toLowerCase().includes(v)) ||
        (w.kind === "keyword" && `${m.subject} ${a.summary} ${(a.tags ?? []).join(" ")}`.toLowerCase().includes(v));
      if (hit) {
        out.push({ watch: w, mail: m });
        break;
      }
    }
  }
  return out;
}

// ---------------- old-email import ----------------
export function getMeta<T>(db: Database, k: string): T | null {
  const v = rows<{ v: string }>(db, "SELECT v FROM meta WHERE k = ?", [k])[0]?.v;
  return v ? (JSON.parse(v) as T) : null;
}
export function setMeta(db: Database, k: string, v: unknown) {
  db.run("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", [k, JSON.stringify(v)]);
}
export const knownEmailIds = (db: Database) => new Set((db.exec("SELECT id FROM emails")[0]?.values ?? []).map((r) => String(r[0])));
export function backfillPending(db: Database, limit: number) {
  return rows<{ id: string; fromName: string; fromEmail: string; subject: string; date: string; labels: string; body: string }>(db,
    `SELECT id, from_name AS fromName, from_email AS fromEmail, subject, date, labels, body FROM emails WHERE src = 'backfill' AND category IS NULL ORDER BY date DESC LIMIT ?`, [limit]);
}
export const backfillCounts = (db: Database) => rows<{ total: number; analysed: number }>(db,
  "SELECT COUNT(*) AS total, SUM(CASE WHEN category IS NOT NULL THEN 1 ELSE 0 END) AS analysed FROM emails WHERE src = 'backfill'")[0];
export function setAnalysis(db: Database, id: string, a: EmailAnalysis) {
  db.run(`UPDATE emails SET category = ?, status = ?, priority = ?, entity = ?, group_key = ?, summary = ?, action_text = ?, deadline = ?,
    is_scam = ?, verified = ?, confidence = ?, intent = ?, ask = ?, tags = ?, needs_reply = ?, from_person = ? WHERE id = ?`,
  [a.category, a.status, a.priority, a.entity, a.groupKey, a.summary, a.actionText, a.deadline, a.isScam ? 1 : 0, a.verified ? 1 : 0, a.confidence,
    a.intent ?? null, a.ask ?? null, (a.tags ?? []).join(", ") || null, a.needsReply && a.verified ? 1 : 0, a.fromPerson ? 1 : 0, id]);
  db.run("UPDATE emails_fts SET entity = ?, summary = ? WHERE id = ?", [a.entity, a.summary, id]);
}
