import initSqlJs, { type SqlJsStatic } from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addSent, addWatch, backfillCounts, backfillPending, byIntent, contacts, deadlines, findContact, funnel, ghosting, listWatches,
  matchWatches, openDb, pendingReplies, responseTimes, setAnalysis, upsertEmails, weekly, type MailRow,
} from "../src/bg/sql";

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});
const now = new Date(2026, 10, 18, 12);
const an = (o: Record<string, unknown>) => ({
  category: "other", status: "none", priority: "medium", entity: "X", groupKey: "", summary: "s", actionRequired: false, actionText: "",
  deadline: "", isScam: false, scamReason: "", evidence: "", confidence: 0.9, verified: true, intent: "update", ask: "", tags: [], needsReply: false, fromPerson: false, ...o,
});
const m = (id: string, date: string, from: string, a: Record<string, unknown>, extra: Partial<MailRow> = {}): MailRow => ({
  id, threadId: `t${id}`, fromName: from, fromEmail: `${from.split(" ")[0].toLowerCase()}@mail.com`, subject: `subj ${id}`, date, labels: ["INBOX"],
  body: "body", analysis: an({ entity: from, ...a }) as never, analyzedAt: date, ...extra,
});

function seed() {
  const db = openDb(SQL);
  upsertEmails(db, [
    m("h1", "2026-11-18T02:00:00.000Z", "Rahul Sharma", { intent: "help_request", ask: "Rahul wants you to review his resume", needsReply: true, fromPerson: true, category: "personal" }),
    m("h2", "2026-11-14T08:00:00.000Z", "Priya Patel", { intent: "question", ask: "Priya asks when the project is due", needsReply: true, fromPerson: true }),
    m("h3", "2026-11-17T08:00:00.000Z", "Fake Help", { intent: "help_request", verified: false, needsReply: true }), // unproven: never shown
    m("j1", "2026-10-01T08:00:00.000Z", "TCS", { category: "job", status: "application_received", groupKey: "tcs:app", intent: "job" }),
    m("j2", "2026-10-05T08:00:00.000Z", "TCS", { category: "job", status: "interview", groupKey: "tcs:app", intent: "job" }),
    m("j3", "2026-11-10T08:00:00.000Z", "Amazon", { category: "job", status: "shortlisted", groupKey: "amazon:app", intent: "job", deadline: "2026-11-25" }),
    m("j4", "2026-11-12T08:00:00.000Z", "Amazon", { category: "job", status: "offer", groupKey: "amazon:app", intent: "job" }),
    m("j5", "2026-11-01T08:00:00.000Z", "Wipro", { category: "job", status: "rejected", groupKey: "wipro:app", intent: "job" }),
    m("p1", "2026-11-16T08:00:00.000Z", "College Office", { intent: "deadline", deadline: "2026-11-20", ask: "Pay semester fee by 20 Nov" }),
  ]);
  return db;
}

describe("for everyone: intents + pending replies", () => {
  it("kisi ne aaj help maangi hai? (verified only)", () => {
    const db = seed();
    expect(byIntent(db, { intents: ["help_request"], period: "today", now }).map((r) => r.entity)).toEqual(["Rahul Sharma"]);
    expect(byIntent(db, { intents: ["help_request"], period: "week", now }).map((r) => r.id)).toEqual(["h1"]); // h3 unverified
  });
  it("pending replies disappear once you answered in that thread", () => {
    const db = seed();
    expect(pendingReplies(db, { now }).map((r) => r.id).sort()).toEqual(["h1", "h2"]);
    expect(pendingReplies(db, { now, minDays: 3 }).map((r) => r.id)).toEqual(["h2"]); // reminder after 3 days
    addSent(db, [{ id: "s1", threadId: "th2", date: "2026-11-15T09:00:00.000Z" }]);
    expect(pendingReplies(db, { now }).map((r) => r.id)).toEqual(["h1"]);
  });
});

describe("job search analytics", () => {
  it("funnel", () => {
    expect(funnel(seed())).toMatchObject({ total: 3, shortlisted: 2, interview: 2, offer: 1, rejected: 1, rates: { offer: 33 } });
  });
  it("ghosting: TCS silent since 5 Oct", () => {
    const g = ghosting(seed(), 14, now);
    expect(g.map((j) => j.entity)).toEqual(["TCS"]);
    expect(g[0].silentDays).toBeGreaterThan(40);
  });
  it("response times per company", () => {
    const r = responseTimes(seed());
    expect(r.companies.find((c) => c.entity === "Amazon")!.avgDays).toBe(2);
    expect(r.companies.find((c) => c.entity === "TCS")!.avgDays).toBe(4);
  });
  it("deadlines (newest email per matter, soonest first)", () => {
    expect(deadlines(seed(), now).map((d) => d.deadline)).toEqual(["2026-11-20", "2026-11-25"]);
  });
  it("weekly report", () => {
    const w = weekly(seed(), now);
    expect(w.intents.help_request).toBe(1);
    expect(w.jobMoves.map((j) => j.entity)).toContain("Amazon");
    expect(w.pending).toBe(2);
  });
});

describe("contacts, alerts, old-email import", () => {
  it("contacts are real people only, and names resolve to addresses", () => {
    const db = seed();
    expect(contacts(db).map((c) => c.name)).toEqual(expect.arrayContaining(["Rahul Sharma", "Priya Patel"]));
    expect(contacts(db).map((c) => c.name)).not.toContain("TCS");
    expect(findContact(db, "rahul")?.email).toBe("rahul@mail.com");
  });
  it("alerts: 'tell me whenever someone asks for help'", () => {
    const db = seed();
    addWatch(db, { kind: "intent", value: "help_request", label: "someone asks for help" });
    addWatch(db, { kind: "sender", value: "infosys", label: "Infosys emails" });
    const w = listWatches(db);
    const hits = matchWatches(w, [
      { id: "n1", fromName: "Neha", fromEmail: "neha@x.com", subject: "Need your help", analysis: an({ intent: "help_request" }) as never },
      { id: "n2", fromName: "Infosys Careers", fromEmail: "careers@infosys.com", subject: "Update", analysis: an({}) as never },
      { id: "n3", fromName: "Promo", fromEmail: "deals@x.com", subject: "Sale", analysis: an({ intent: "promotion" }) as never },
      { id: "n4", fromName: "Liar", fromEmail: "l@x.com", subject: "help?", analysis: an({ intent: "help_request", verified: false }) as never },
    ]);
    expect(hits.map((h) => h.mail.id)).toEqual(["n1", "n2"]);
  });
  it("imported old emails wait for analysis, then become searchable history", () => {
    const db = seed();
    upsertEmails(db, [{ ...m("old1", "2026-06-01T08:00:00.000Z", "Infosys", {}), analysis: null, analyzedAt: null, src: "backfill" }]);
    expect(backfillPending(db, 10).map((r) => r.id)).toEqual(["old1"]);
    setAnalysis(db, "old1", an({ category: "job", status: "application_received", entity: "Infosys", groupKey: "infosys:app", intent: "job" }) as never);
    expect(backfillPending(db, 10)).toEqual([]);
    expect(backfillCounts(db)).toEqual({ total: 1, analysed: 1 });
  });
  it("old histories get the new columns automatically", () => {
    const db = openDb(SQL);
    db.exec("DROP TABLE emails; CREATE TABLE emails (id TEXT PRIMARY KEY, thread_id TEXT, from_name TEXT, from_email TEXT, subject TEXT, date TEXT, labels TEXT, body TEXT, category TEXT, status TEXT, priority TEXT, entity TEXT, group_key TEXT, summary TEXT, action_text TEXT, deadline TEXT, is_scam INTEGER, verified INTEGER, confidence REAL, sig TEXT)");
    const db2 = openDb(SQL, db.export());
    const cols = (db2.exec("PRAGMA table_info(emails)")[0].values ?? []).map((r) => r[1]);
    expect(cols).toEqual(expect.arrayContaining(["intent", "ask", "needs_reply", "src"]));
  });
});
