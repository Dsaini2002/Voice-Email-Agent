import { MongoClient, type Collection, type Db, type ObjectId } from "mongodb";
import type { EmailAnalysis } from "../../shared/types.js";
import { config } from "./config.js";

export interface UserDoc {
  _id?: ObjectId;
  googleId: string;
  email: string;
  name: string;
  picture: string;
  encRefreshToken: string;
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

let client: MongoClient;
let db: Db;

export async function connectDb(): Promise<Db> {
  client = new MongoClient(config.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  db = client.db(config.MONGODB_DB);
  await users().createIndex({ googleId: 1 }, { unique: true });
  await emails().createIndex({ userId: 1, gmailId: 1 }, { unique: true });
  await emails().createIndex({ userId: 1, date: -1 });
  await emails().createIndex({ userId: 1, analyzedAt: 1 });
  return db;
}

export async function closeDb(): Promise<void> {
  await client?.close();
}

export const users = (): Collection<UserDoc> => db.collection<UserDoc>("users");
export const emails = (): Collection<EmailDoc> => db.collection<EmailDoc>("emails");
