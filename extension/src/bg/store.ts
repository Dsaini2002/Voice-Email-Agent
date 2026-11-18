/**
 * Local database in chrome.storage.local (lives only in this browser profile).
 * Nothing is sent to any Vaani server — there is none.
 */
import type { EmailAnalysis } from "../../../shared/types";
import type { Account } from "./auth";

export interface EmailRec {
  gmailId: string;
  threadId: string;
  from: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  date: string; // ISO
  labelIds: string[];
  /** Plain-text body, PII-redacted, truncated. */
  body: string;
  analysis: EmailAnalysis | null;
  analyzedAt: string | null;
  analysisError: string | null;
}

export interface SyncState {
  historyId: string | null;
  lastSyncAt: string | null;
  state: "idle" | "syncing" | "analyzing" | "error" | "needs_key" | "quota";
  message: string;
  /** While the free Gemini limit is used up, analysis waits until this time (ISO). */
  pausedUntil?: string | null;
}

interface Schema {
  /** The user's own Google OAuth Client ID (not a secret). */
  clientId: string;
  account: Account;
  geminiKey: string;
  sync: SyncState;
  /** Google permissions the user actually granted (silent renewals ask for exactly these). */
  grantedScopes: string[];
  emails: Record<string, EmailRec>;
  /** What "undo" reverses. */
  lastAction:
    | { type: "trash_spam" | "trash"; ids: string[]; at: string }
    | { type: "modify"; ids: string[]; add: string[]; remove: string[]; at: string }
    | { type: "event"; ids: string[]; at: string }
    | { type: "note"; ids: string[]; at: string }
    | null;
}

type Key = keyof Schema;

// Serialise all read-modify-write operations on the email map.
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

export const db = {
  async get<K extends Key>(k: K): Promise<Schema[K] | undefined> {
    const r = await chrome.storage.local.get(k);
    return r[k] as Schema[K] | undefined;
  },
  async set<K extends Key>(k: K, v: Schema[K]): Promise<void> {
    await chrome.storage.local.set({ [k]: v });
  },
  async remove(k: Key): Promise<void> {
    await chrome.storage.local.remove(k);
  },
  async sync(): Promise<SyncState> {
    return (await db.get("sync")) ?? { historyId: null, lastSyncAt: null, state: "idle", message: "" };
  },
  async patchSync(p: Partial<SyncState>): Promise<void> {
    await db.set("sync", { ...(await db.sync()), ...p });
  },
  async emails(): Promise<Record<string, EmailRec>> {
    return (await db.get("emails")) ?? {};
  },
  /** Atomically update the email map. */
  updateEmails(fn: (m: Record<string, EmailRec>) => void): Promise<void> {
    return locked(async () => {
      const m = await db.emails();
      fn(m);
      await db.set("emails", m);
    });
  },
  async clearUserData(): Promise<void> {
    await chrome.storage.local.remove(["emails", "sync", "lastAction"]);
  },
};
