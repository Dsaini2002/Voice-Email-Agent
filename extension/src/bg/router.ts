/**
 * Small request router inside the extension: the Gmail overlay and popup send
 * "API" requests here (same shape as the old server API), all handled locally.
 */
import type { Lang } from "../../../shared/types";
import { analyzePending, ask, briefing, GeminiError, validateKey } from "./ai";
import { AuthError, clientIdConfigured, signIn, signOutAndDelete } from "./auth";
import { gmail, GmailError, header } from "./gmail";
import { db } from "./store";
import { runSync } from "./sync";

export type ApiResult = { ok: boolean; status: number; data: unknown; error?: string };
const ok = (data: unknown): ApiResult => ({ ok: true, status: 200, data });
const fail = (status: number, error: string): ApiResult => ({ ok: false, status, data: null, error });

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<unknown>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

async function spamIds(): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const r = await gmail.list({ labelIds: ["SPAM"], includeSpamTrash: true, maxResults: 500, ...(pageToken ? { pageToken } : {}) });
    r.messages?.forEach((m) => ids.push(m.id));
    pageToken = r.nextPageToken;
  } while (pageToken && ids.length < 5000);
  return ids;
}

export async function handle(path: string, method = "GET", body?: unknown): Promise<ApiResult> {
  const url = new URL(path, "https://vaani.local");
  const p = url.pathname;
  const b = (body ?? {}) as Record<string, unknown>;
  try {
    // ----- status & setup -----
    if (p === "/ext/status") {
      const [account, key, sync, emails] = await Promise.all([db.get("account"), db.get("geminiKey"), db.sync(), db.emails()]);
      const list = Object.values(emails);
      return ok({
        clientIdOk: clientIdConfigured(),
        signedIn: Boolean(account),
        email: account?.email ?? "",
        name: account?.name ?? "",
        hasGeminiKey: Boolean(key),
        keyLast4: key ? key.slice(-4) : null,
        canModify: true,
        sync: { ...sync, total: list.length, analyzed: list.filter((e) => e.analyzedAt).length },
      });
    }
    if (p === "/auth/signin" && method === "POST") {
      const account = await signIn();
      void runSync();
      return ok(account);
    }
    if (p === "/auth/signout" && method === "POST") {
      await signOutAndDelete();
      return ok({ ok: true });
    }
    if (p === "/settings/gemini" && method === "PUT") {
      const apiKey = String(b.apiKey ?? "").trim();
      const check = await validateKey(apiKey);
      if (!check.ok) return fail(400, check.message);
      await db.set("geminiKey", apiKey);
      void analyzePending();
      return ok({ hasKey: true, last4: apiKey.slice(-4), message: check.message });
    }
    if (p === "/settings/gemini" && method === "DELETE") {
      await db.remove("geminiKey");
      return ok({ hasKey: false });
    }
    if (p === "/sync" && method === "POST") {
      void runSync();
      return ok({ ok: true });
    }

    // Everything below needs a signed-in account.
    if (!(await db.get("account"))) return fail(401, "NOT_SIGNED_IN");

    if (p === "/briefing") {
      const hours = Math.min(Math.max(Number(url.searchParams.get("hours") ?? 24), 1), 24 * 7);
      return ok(await briefing(hours, (url.searchParams.get("lang") as Lang) ?? "en"));
    }
    if (p === "/ask" && method === "POST") {
      const q = String(b.question ?? "").trim().slice(0, 500);
      if (!q) return fail(400, "The question is empty.");
      return ok(await ask(q, (b.lang as Lang) ?? "en"));
    }
    if (p === "/gmail/spam") {
      const ids = await spamIds();
      const preview = await Promise.all(
        ids.slice(0, 5).map(async (id) => {
          const m = await gmail.get(id, "metadata", ["From", "Subject"]);
          return { id, from: header(m, "From").replace(/<.*>/, "").replace(/"/g, "").trim(), subject: header(m, "Subject") };
        }),
      );
      return ok({ count: ids.length, preview });
    }
    if (p === "/gmail/spam/trash" && method === "POST") {
      if (b.confirm !== true) return fail(400, "Confirmation is required before deleting.");
      const ids = await spamIds();
      const expected = typeof b.expectedCount === "number" ? b.expectedCount : undefined;
      if (expected !== undefined && ids.length > expected + 20) return fail(409, `Spam changed: there are now ${ids.length} emails. Please confirm again.`);
      await mapLimit(ids, 10, (id) => gmail.trash(id));
      if (ids.length) await db.set("lastAction", { type: "trash_spam", ids, at: new Date().toISOString() });
      return ok({ trashed: ids.length });
    }
    if (p === "/gmail/undo" && method === "POST") {
      const last = await db.get("lastAction");
      if (!last?.ids.length) return fail(404, "Nothing to undo.");
      await mapLimit(last.ids, 10, (id) => gmail.untrash(id));
      await db.set("lastAction", null);
      return ok({ restored: last.ids.length });
    }
    return fail(404, `Unknown request ${method} ${p}`);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.code === "AUTH_FAILED" ? 400 : 401, err.code === "NOT_SIGNED_IN" ? "NOT_SIGNED_IN" : err.message);
    if (err instanceof GeminiError) {
      if (err.message === "NEEDS_GEMINI_KEY") return fail(400, "NEEDS_GEMINI_KEY");
      return fail(502, `AI error: ${err.message}`);
    }
    if (err instanceof GmailError) {
      if (err.status === 403) return fail(403, "Gmail did not allow this. Sign out and sign in again, and allow all requested Gmail permissions.");
      return fail(502, `Gmail error: ${err.message}`);
    }
    return fail(500, (err as Error).message || "Something went wrong.");
  }
}
