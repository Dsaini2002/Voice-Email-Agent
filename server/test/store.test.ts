import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { openJsonStore } from "../src/store.js";

describe("built-in JSON storage", () => {
  it("saves to disk and reloads ObjectIds and Dates correctly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vaani-store-"));
    const a = openJsonStore(dir);
    const userId = new ObjectId();
    const when = new Date("2026-11-08T10:00:00Z");
    await a.collection("emails").insertOne({ userId, gmailId: "g1", date: when, analysis: null });
    await a.collection("emails").updateOne({ userId, gmailId: "g2" }, { $setOnInsert: { date: when }, $set: { x: 1 } }, { upsert: true });
    await a.flushAll();

    const raw = readFileSync(join(dir, "emails.json"), "utf8");
    expect(raw).toContain("$oid");
    expect(raw).toContain("$date");

    const b = openJsonStore(dir); // a fresh "server start"
    const docs = await b.collection<{ userId: ObjectId; date: Date; gmailId: string }>("emails").find({ userId }).sort({ gmailId: 1 }).toArray();
    expect(docs.map((d) => d.gmailId)).toEqual(["g1", "g2"]);
    expect(docs[0].userId).toBeInstanceOf(ObjectId);
    expect(docs[0].userId.equals(userId)).toBe(true);
    expect(docs[0].date).toBeInstanceOf(Date);
    expect(docs[0].date.getTime()).toBe(when.getTime());
  });

  it("supports the queries the app uses", async () => {
    const s = openJsonStore(null);
    const c = s.collection<{ n: number; tag: string | null; d: Date }>("t");
    for (let n = 1; n <= 5; n++) await c.insertOne({ n, tag: n % 2 ? "odd" : null, d: new Date(2026, 0, n) });
    expect(await c.countDocuments({ tag: null })).toBe(2);
    expect(await c.countDocuments({ tag: { $ne: null } })).toBe(3);
    expect(await c.countDocuments({ n: { $in: [1, 2, 9] } })).toBe(2);
    expect(await c.countDocuments({ d: { $gte: new Date(2026, 0, 3) } })).toBe(3);
    expect(await c.countDocuments({ $or: [{ n: 1 }, { n: { $lt: 3 } }] })).toBe(2);
    expect((await c.find({}).sort({ n: -1 }).limit(2).toArray()).map((x) => x.n)).toEqual([5, 4]);
    const r = await c.findOneAndUpdate({ n: 9 }, { $set: { tag: "new" }, $setOnInsert: { d: new Date() } }, { upsert: true });
    expect(r?.n).toBe(9);
    expect((await c.deleteMany({ tag: null })).deletedCount).toBe(2);
  });
});
