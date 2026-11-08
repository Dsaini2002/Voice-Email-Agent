import path from "node:path";
import { MongoClient, type Db, type ObjectId } from "mongodb";
import type { EmailAnalysis } from "../../shared/types.js";
import { config } from "./config.js";
import { openJsonStore, type Coll } from "./store.js";

export interface UserDoc {
  _id?: ObjectId;
  googleId: string;
  email: string;
  name: string;
  picture: string;
  encRefreshToken: string;
  /** User's own Gemini API key, AES-256-GCM encrypted. Never sent back to the browser. */
  encGeminiKey?: string | null;
  geminiKeyLast4?: string | null;
  /** SHA-256 of the Chrome extension's access token (the token itself is never stored). */
  extTokenHash?: string | null;
  /** False if the user only granted read-only Gmail access. */
  canModify?: boolean;
  /** Gmail history id we have processed up to (for incremental sync). */
  historyId: string | null;
  lastSyncAt: Date | null;
  watchExpiration: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailDoc {
  _id?: ObjectId;
  userId: ObjectId;
  gmailId: string;
  threadId: string;
  from: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  date: Date;
  snippet: string;
  labelIds: string[];
  /** Plain text body, PII-redacted, truncated. Never stores the raw HTML. */
  bodyRedacted: string;
  analysis: EmailAnalysis | null;
  analyzedAt: Date | null;
  analysisError: string | null;
  createdAt: Date;
}

/** Audit log of every change the agent made in Gmail (used for Undo). */
export interface ActionDoc {
  _id?: ObjectId;
  userId: ObjectId;
  type: "trash_spam";
  messageIds: string[];
  createdAt: Date;
  undoneAt: Date | null;
}

let mongo: MongoClient | null = null;
let json: ReturnType<typeof openJsonStore> | null = null;
let db: Db | null = null;

export type StorageKind = "json" | "mongodb";
export let storage: StorageKind = "json";

/**
 * Default: built-in JSON files in DATA_DIR (nothing to install).
 * If MONGODB_URI is set, MongoDB is used instead (for big deployments).
 */
export async function connectDb(): Promise<StorageKind> {
  if (config.MONGODB_URI) {
    storage = "mongodb";
    mongo = new MongoClient(config.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await mongo.connect();
    db = mongo.db(config.MONGODB_DB);
    await users().createIndex({ googleId: 1 }, { unique: true });
    await emails().createIndex({ userId: 1, gmailId: 1 }, { unique: true });
    await emails().createIndex({ userId: 1, date: -1 });
    await emails().createIndex({ userId: 1, analyzedAt: 1 });
    await users().createIndex({ extTokenHash: 1 }, { sparse: true });
    await actions().createIndex({ userId: 1, createdAt: -1 });
  } else {
    storage = "json";
    json = openJsonStore(config.DATA_DIR ? path.resolve(config.DATA_DIR) : null);
  }
  return storage;
}

/** Saves pending JSON writes (call before exit) and closes MongoDB. */
export async function closeDb(): Promise<void> {
  await json?.flushAll();
  await mongo?.close();
}

function col<T>(name: string): Coll<T> {
  if (db) return db.collection(name) as unknown as Coll<T>;
  if (!json) json = openJsonStore(config.DATA_DIR ? path.resolve(config.DATA_DIR) : null);
  return json.collection<T>(name);
}

export const users = (): Coll<UserDoc> => col<UserDoc>("users");
export const emails = (): Coll<EmailDoc> => col<EmailDoc>("emails");
export const actions = (): Coll<ActionDoc> => col<ActionDoc>("actions");
