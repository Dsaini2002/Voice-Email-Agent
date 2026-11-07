/**
 * Tiny in-memory stand-in for the subset of the MongoDB driver this app uses.
 * Lets the end-to-end test run without a MongoDB server.
 */
import { ObjectId } from "mongodb";

type Doc = Record<string, any>;

function same(a: any, b: any): boolean {
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a == null && b == null) return true;
  return a === b;
}

function cmp(a: any, b: any): number {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
}

function matchValue(v: any, cond: any): boolean {
  if (cond && typeof cond === "object" && !(cond instanceof ObjectId) && !(cond instanceof Date)) {
    return Object.entries(cond).every(([op, c]) => {
      switch (op) {
        case "$ne": return !same(v, c);
        case "$gte": return v != null && cmp(v, c) >= 0;
        case "$lt": return v != null && cmp(v, c) < 0;
        case "$in": return (c as any[]).some((x) => same(v, x));
        default: throw new Error(`fakeDb: unsupported operator ${op}`);
      }
    });
  }
  return same(v, cond);
}

function matches(doc: Doc, q: Doc): boolean {
  return Object.entries(q).every(([k, cond]) => {
    if (k === "$or") return (cond as Doc[]).some((sub) => matches(doc, sub));
    return matchValue(doc[k], cond);
  });
}

class Cursor {
  constructor(private docs: Doc[]) {}
  sort(spec: Record<string, 1 | -1>) {
    const [[k, dir]] = Object.entries(spec);
    this.docs.sort((a, b) => cmp(a[k], b[k]) * dir);
    return this;
  }
  limit(n: number) {
    this.docs = this.docs.slice(0, n);
    return this;
  }
  async toArray() {
    return this.docs.map((d) => ({ ...d }));
  }
}

export class FakeCollection {
  docs: Doc[] = [];
  async createIndex() { return "ok"; }
  find(q: Doc = {}) { return new Cursor(this.docs.filter((d) => matches(d, q))); }
  async findOne(q: Doc) {
    const d = this.docs.find((x) => matches(x, q));
    return d ? { ...d } : null;
  }
  async countDocuments(q: Doc = {}) { return this.docs.filter((d) => matches(d, q)).length; }
  private apply(doc: Doc, update: Doc, inserted: boolean) {
    Object.assign(doc, update.$set ?? {});
    if (inserted) Object.assign(doc, update.$setOnInsert ?? {});
  }
  async updateOne(q: Doc, update: Doc, opts: { upsert?: boolean } = {}) {
    const d = this.docs.find((x) => matches(x, q));
    if (d) {
      this.apply(d, update, false);
      return { matchedCount: 1 };
    }
    if (opts.upsert) {
      const fresh: Doc = { _id: new ObjectId(), ...Object.fromEntries(Object.entries(q).filter(([k]) => !k.startsWith("$"))) };
      this.apply(fresh, update, true);
      this.docs.push(fresh);
    }
    return { matchedCount: 0 };
  }
  async findOneAndUpdate(q: Doc, update: Doc, opts: { upsert?: boolean } = {}) {
    await this.updateOne(q, update, opts);
    return this.findOne(q);
  }
  async deleteMany(q: Doc) {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matches(d, q));
    return { deletedCount: before - this.docs.length };
  }
  async deleteOne(q: Doc) {
    const i = this.docs.findIndex((d) => matches(d, q));
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }
}

export const fake = { users: new FakeCollection(), emails: new FakeCollection() };
