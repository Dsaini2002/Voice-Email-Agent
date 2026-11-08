/**
 * Built-in JSON file database — no MongoDB (or anything else) to install.
 *
 * Each collection lives in memory and is saved to `<DATA_DIR>/<name>.json`.
 * - Writes are debounced and atomic (write to a temp file, then rename), so a
 *   crash never leaves a half-written file.
 * - ObjectIds and Dates survive the round-trip (Extended JSON).
 * - Supports exactly the query/update features this app uses.
 *
 * Good for one server with many users at small scale. For large deployments set
 * MONGODB_URI and the same code runs on MongoDB instead.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
// Use the driver's own BSON so ObjectIds are the same class everywhere.
import { BSON, ObjectId } from "mongodb";
const { EJSON } = BSON;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Query = Record<string, any>;
export type WithId<T> = T & { _id: ObjectId };

export interface Cursor<T> {
  sort(spec: Record<string, 1 | -1>): Cursor<T>;
  limit(n: number): Cursor<T>;
  toArray(): Promise<WithId<T>[]>;
}

/** The small collection API the app uses (MongoDB's Collection also satisfies it). */
export interface Coll<T> {
  find(q?: Query, opts?: unknown): Cursor<T>;
  findOne(q: Query, opts?: unknown): Promise<WithId<T> | null>;
  countDocuments(q?: Query): Promise<number>;
  insertOne(doc: Doc): Promise<{ insertedId: ObjectId }>;
  updateOne(q: Query, update: Query, opts?: { upsert?: boolean }): Promise<unknown>;
  findOneAndUpdate(q: Query, update: Query, opts?: { upsert?: boolean; returnDocument?: "after" | "before" }): Promise<WithId<T> | null>;
  deleteMany(q: Query): Promise<{ deletedCount: number }>;
  deleteOne(q: Query): Promise<{ deletedCount: number }>;
  createIndex(spec: unknown, opts?: unknown): Promise<unknown>;
}

// ---------------- query matching ----------------
function same(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a == null && b == null) return true;
  return a === b;
}
function cmp(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number);
  const y = b instanceof Date ? b.getTime() : (b as number);
  return x < y ? -1 : x > y ? 1 : 0;
}
function matchValue(v: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && !(cond instanceof ObjectId) && !(cond instanceof Date) && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, c]) => {
      switch (op) {
        case "$ne": return !same(v, c);
        case "$eq": return same(v, c);
        case "$gt": return v != null && cmp(v, c) > 0;
        case "$gte": return v != null && cmp(v, c) >= 0;
        case "$lt": return v != null && cmp(v, c) < 0;
        case "$lte": return v != null && cmp(v, c) <= 0;
        case "$in": return (c as unknown[]).some((x) => same(v, x));
        case "$exists": return (v !== undefined) === Boolean(c);
        default: throw new Error(`JSON store: unsupported operator ${op}`);
      }
    });
  }
  return same(v, cond);
}
export function matches(doc: Doc, q: Query): boolean {
  return Object.entries(q).every(([k, cond]) => {
    if (k === "$or") return (cond as Query[]).some((sub) => matches(doc, sub));
    if (k === "$and") return (cond as Query[]).every((sub) => matches(doc, sub));
    return matchValue(doc[k], cond);
  });
}

class JsonCursor<T> implements Cursor<T> {
  constructor(private docs: Doc[]) {}
  sort(spec: Record<string, 1 | -1>) {
    const keys = Object.entries(spec);
    this.docs.sort((a, b) => {
      for (const [k, dir] of keys) {
        const c = cmp(a[k], b[k]);
        if (c !== 0) return c * dir;
      }
      return 0;
    });
    return this;
  }
  limit(n: number) {
    this.docs = this.docs.slice(0, n);
    return this;
  }
  async toArray() {
    return this.docs.map((d) => ({ ...d })) as WithId<T>[];
  }
}

export class JsonCollection<T> implements Coll<T> {
  private docs: Doc[] = [];
  private timer: NodeJS.Timeout | null = null;
  private saving: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(private file: string | null) {
    if (file && existsSync(file)) {
      const text = readFileSync(file, "utf8");
      if (text.trim()) this.docs = EJSON.parse(text, { relaxed: false }) as Doc[];
    }
  }

  // ----- persistence -----
  private changed() {
    if (!this.file) return;
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 200);
  }

  async flush(): Promise<void> {
    if (!this.file || !this.dirty) return this.saving;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.dirty = false;
    const text = EJSON.stringify(this.docs, { relaxed: false });
    const file = this.file;
    this.saving = this.saving.then(async () => {
      const tmp = `${file}.tmp`;
      await writeFile(tmp, text, "utf8");
      await rename(tmp, file);
    });
    return this.saving;
  }

  // ----- API -----
  find(q: Query = {}) {
    return new JsonCursor<T>(this.docs.filter((d) => matches(d, q)));
  }
  async findOne(q: Query) {
    const d = this.docs.find((x) => matches(x, q));
    return d ? ({ ...d } as WithId<T>) : null;
  }
  async countDocuments(q: Query = {}) {
    return this.docs.reduce((n, d) => (matches(d, q) ? n + 1 : n), 0);
  }
  async insertOne(doc: Doc) {
    const d = { _id: new ObjectId(), ...doc };
    this.docs.push(d);
    this.changed();
    return { insertedId: d._id as ObjectId };
  }
  private apply(doc: Doc, update: Query, inserted: boolean) {
    for (const op of Object.keys(update)) {
      if (!["$set", "$setOnInsert", "$unset"].includes(op)) throw new Error(`JSON store: unsupported update ${op}`);
    }
    if (inserted) Object.assign(doc, update.$setOnInsert ?? {});
    Object.assign(doc, update.$set ?? {});
    for (const k of Object.keys(update.$unset ?? {})) delete doc[k];
  }
  async updateOne(q: Query, update: Query, opts: { upsert?: boolean } = {}) {
    const d = this.docs.find((x) => matches(x, q));
    if (d) {
      this.apply(d, update, false);
      this.changed();
      return { matchedCount: 1, upsertedId: null };
    }
    if (opts.upsert) {
      const eq = Object.fromEntries(
        Object.entries(q).filter(([k, v]) => !k.startsWith("$") && (typeof v !== "object" || v instanceof ObjectId || v instanceof Date || v === null)),
      );
      const fresh: Doc = { _id: new ObjectId(), ...eq };
      this.apply(fresh, update, true);
      this.docs.push(fresh);
      this.changed();
      return { matchedCount: 0, upsertedId: fresh._id };
    }
    return { matchedCount: 0, upsertedId: null };
  }
  async findOneAndUpdate(q: Query, update: Query, opts: { upsert?: boolean } = {}) {
    const r = (await this.updateOne(q, update, opts)) as { upsertedId: ObjectId | null };
    return r.upsertedId ? this.findOne({ _id: r.upsertedId }) : this.findOne(q);
  }
  async deleteMany(q: Query) {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matches(d, q));
    const deletedCount = before - this.docs.length;
    if (deletedCount) this.changed();
    return { deletedCount };
  }
  async deleteOne(q: Query) {
    const i = this.docs.findIndex((d) => matches(d, q));
    if (i >= 0) {
      this.docs.splice(i, 1);
      this.changed();
    }
    return { deletedCount: i >= 0 ? 1 : 0 };
  }
  async createIndex() {
    return "ok";
  }
}

/** Opens (or creates) a folder of JSON collections. `dir = null` keeps everything in memory (tests). */
export function openJsonStore(dir: string | null) {
  if (dir) mkdirSync(dir, { recursive: true });
  const cols = new Map<string, JsonCollection<unknown>>();
  return {
    collection<T>(name: string): JsonCollection<T> {
      if (!/^[a-z_]+$/.test(name)) throw new Error("bad collection name");
      let c = cols.get(name);
      if (!c) {
        c = new JsonCollection<unknown>(dir ? path.join(dir, `${name}.json`) : null);
        cols.set(name, c);
      }
      return c as JsonCollection<T>;
    },
    async flushAll() {
      await Promise.all([...cols.values()].map((c) => c.flush()));
    },
  };
}
