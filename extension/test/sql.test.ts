import initSqlJs from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";
import { countBy, logAction, openDb, recentActions, searchHistory, stats, tracker, trackerCsv, upsertEmails, type MailRow } from "../src/bg/sql";
import type { SqlJsStatic } from "sql.js";

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

const now = new Date(2026, 10, 18, 12); // 18 Nov 2026
const a = (entity: string, status: string, extra: Record<string, unknown> = {}) => ({
  category: "job", status, priority: "high", entity, groupKey: `${entity.toLowerCase()}:application`, summary: `${entity} ${status}`,
  actionRequired: false, actionText: "", deadline: "", isScam: false, scamReason: "", evidence: "x", confidence: 0.9, verified: true, ...extra,
});
const mail = (id: string, date: string, entity: string, status: string, extra: Record<string, unknown> = {}, body = ""): MailRow => ({
  id, threadId: `t${id}`, fromName: `${entity} HR`, fromEmail: `hr@${entity.toLowerCase()}.com`, subject: `${entity} update`, date,
  labels: ["INBOX"], body: body || `Mail from ${entity}`, analysis: a(entity, status, extra) as never, analyzedAt: date,
});

function seed() {
  const db = openDb(SQL);
  upsertEmails(db, [
    mail("1", "2026-11-02T10:00:00.000Z", "TCS", "application_received"),
    mail("2", "2026-11-05T10:00:00.000Z", "TCS", "shortlisted"),
    mail("3", "2026-11-09T10:00:00.000Z", "TCS", "interview", {}, "Technical interview on 12 November. Please bring your offer letter copy."),
    mail("4", "2026-11-10T10:00:00.000Z", "TCS", "interview"), // reminder: same company
    mail("5", "2026-11-11T10:00:00.000Z", "Amazon", "interview"),
    mail("6", "2026-10-20T10:00:00.000Z", "Wipro", "rejected"),
    mail("7", "2026-11-12T10:00:00.000Z", "Infosys", "shortlisted", { verified: false }), // unproven claim
    mail("8", "2026-11-12T11:00:00.000Z", "Flipkart", "none", { category: "promotion" }),
  ]);
  return db;
}

describe("SQLite history (real SQLite via WebAssembly)", () => {
  it("is mahine kitne interview aaye → emails and distinct companies", () => {
    const r = countBy(seed(), { status: "interview", period: "month", now });
    expect(r.emails).toBe(3);
    expect(r.companies.sort()).toEqual(["Amazon", "TCS"]);
  });
  it("last month / unverified claims are not counted", () => {
    const db = seed();
    expect(countBy(db, { status: "rejected", period: "last_month", now }).companies).toEqual(["Wipro"]);
    expect(countBy(db, { status: "shortlisted", period: "month", now }).companies).toEqual(["TCS"]); // Infosys is unverified
  });
  it("job tracker shows each application's journey", () => {
    const t = tracker(seed());
    const tcs = t.find((j) => j.entity === "TCS")!;
    expect(tcs.current).toBe("interview");
    expect(tcs.steps.map((s) => s.status)).toEqual(["application_received", "shortlisted", "interview"]);
    expect(t.find((j) => j.entity === "Wipro")!.current).toBe("rejected");
    expect(tracker(seed(), "tcs")).toHaveLength(1);
  });
  it("full-text search over the archive (prefix on the last word)", () => {
    const db = seed();
    expect(searchHistory(db, "offer let").map((r) => r.id)).toEqual(["3"]);
    expect(searchHistory(db, "amazon").map((r) => r.entity)).toContain("Amazon");
    expect(searchHistory(db, "'); DROP TABLE emails; --")).toEqual([]); // input is sanitised + bound
    expect(countBy(db, { period: "all", now }).emails).toBe(8);
    expect(countBy(db, { period: "all", from: "tcs", now }).emails).toBe(4);
  });
  it("only rewrites rows that changed", () => {
    const db = seed();
    expect(upsertEmails(db, [mail("1", "2026-11-02T10:00:00.000Z", "TCS", "application_received")])).toBe(0);
    expect(upsertEmails(db, [{ ...mail("1", "2026-11-02T10:00:00.000Z", "TCS", "application_received"), analyzedAt: "later" }])).toBe(1);
  });
  it("stats, activity log, CSV export (formula-safe)", () => {
    const db = seed();
    const s = stats(db, "month", now);
    expect(s.total).toBe(7);
    expect(s.byStatus.interview).toBe(2);
    logAction(db, "sent", "Reply to TCS", "2026-11-18T09:00:00.000Z");
    expect(recentActions(db, "2026-11-18T00:00:00.000Z")[0].detail).toBe("Reply to TCS");
    const csv = trackerCsv([{ entity: "=HYPERLINK(evil)", current: "offer", steps: [], firstDate: "2026-11-01", lastDate: "2026-11-02", groupKey: "", latestId: "", threadId: "" }]);
    expect(csv.split("\n")[1].startsWith("'=HYPERLINK")).toBe(true);
  });
  it("survives a save + reload (export → new Database)", () => {
    const db2 = openDb(SQL, seed().export());
    expect(countBy(db2, { period: "all", now }).emails).toBe(8);
  });
});
