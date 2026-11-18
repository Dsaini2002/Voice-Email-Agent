/**
 * Small request router inside the extension: the Gmail overlay and popup send
 * "API" requests here (same shape as the old server API), all handled locally.
 */
import type { Lang } from "../../../shared/types";
import { analyzePending, ask, assist, briefing, friendlyGeminiError, GeminiError, validateKey } from "./ai";
import { AuthError, clientIdConfigured, redirectUri, setClientId, signIn, signOutAndDelete } from "./auth";
import { CLIENT_ID_RE, normalizeClientId } from "./oauth";
import { gmail, GmailError, header, parseFrom } from "./gmail";
import { redactPII } from "../../../server/src/privacy/redact";
import type { BriefingItem } from "../../../shared/types";
import { db } from "./store";
import { runSync } from "./sync";
import * as reply from "./reply";
import * as g from "./google";
import * as sql from "./sql";
import { backfillStatus, log, mirror, startBackfill } from "./history";
import { GoogleApiError } from "./google";
import { ReplyError } from "./reply";

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
      const [account, key, sync, emails, clientId, granted] = await Promise.all([db.get("account"), db.get("geminiKey"), db.sync(), db.emails(), db.get("clientId"), db.get("grantedScopes")]);
      const list = Object.values(emails);
      return ok({
        clientIdOk: await clientIdConfigured(),
        clientIdShort: clientId ? `${clientId.slice(0, 12)}…` : null,
        redirectUri: redirectUri(),
        extensionId: chrome.runtime.id,
        signedIn: Boolean(account),
        email: account?.email ?? "",
        name: account?.name ?? "",
        hasGeminiKey: Boolean(key),
        keyLast4: key ? key.slice(-4) : null,
        canModify: true,
        // signed in before Calendar & Notes existed → ask once to allow them
        needsReauth: Boolean(account) && !(granted ?? []).some((s) => s.includes("calendar")),
        sync: { ...sync, total: list.length, analyzed: list.filter((e) => e.analyzedAt).length },
      });
    }
    if (p === "/settings/client" && method === "PUT") {
      const id = normalizeClientId(String(b.clientId ?? ""));
      if (/GOCSPX-/i.test(id)) return fail(400, "That is the Client SECRET. Paste the Client ID (ends with .apps.googleusercontent.com). Never share the secret.");
      if (!CLIENT_ID_RE.test(id)) return fail(400, "That does not look like a Client ID. It should end with .apps.googleusercontent.com");
      const prev = await db.get("clientId");
      if (prev && prev !== id) await signOutAndDelete();
      await setClientId(id);
      return ok({ clientIdOk: true });
    }
    if (p === "/auth/signin" && method === "POST") {
      const account = await signIn();
      void runSync();
      return ok(account);
    }
    if (p === "/auth/signout" && method === "POST") {
      await signOutAndDelete();
      await sql.clearHistory();
      return ok({ ok: true });
    }
    if (p === "/settings/gemini" && method === "PUT") {
      const apiKey = String(b.apiKey ?? "").trim();
      const check = await validateKey(apiKey);
      if (!check.ok) return fail(400, check.message);
      await db.set("geminiKey", apiKey);
      await db.patchSync({ pausedUntil: null, state: "idle", message: "" });
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
    // Any Gmail search (dates, unread, attachments, senders…) — works for ALL mail, not just the synced week.
    if (p === "/gmail/find" && method === "POST") {
      const q = String(b.query ?? "").replace(/[\r\n]/g, " ").trim().slice(0, 200);
      if (!q) return fail(400, "What should I look for?");
      const r = await gmail.list({ q, maxResults: 20 });
      const ids = (r.messages ?? []).map((m) => m.id);
      const known = await db.emails();
      const items: BriefingItem[] = [];
      await mapLimit(ids, 8, async (id) => {
        const rec = known[id];
        if (rec?.analysis) {
          const a = rec.analysis;
          items.push({ gmailId: id, threadId: rec.threadId, entity: a.entity, subject: rec.subject, summary: a.summary, date: rec.date, status: a.status,
            category: a.category, priority: a.priority, deadline: a.deadline, actionText: a.actionText, confidence: a.confidence, verified: a.verified, mergedCount: 1, gmailUrl: "" });
          return;
        }
        const m = await gmail.get(id, "metadata", ["From", "Subject", "Date"]);
        const from = parseFrom(header(m, "From"));
        const date = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString();
        items.push({ gmailId: id, threadId: m.threadId, entity: (from.name || from.email).slice(0, 40), subject: redactPII(header(m, "Subject") || "(no subject)"),
          summary: redactPII((m.snippet ?? "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").slice(0, 160)), date,
          status: "none", category: "other", priority: "medium", deadline: "", actionText: "", confidence: 0, verified: true, mergedCount: 1, gmailUrl: "", basic: true });
      });
      items.sort((x, y) => y.date.localeCompare(x.date));
      return ok({ items, more: Boolean(r.nextPageToken) });
    }
    if (p === "/assist" && method === "POST") {
      const said = String(b.text ?? "").trim().slice(0, 400);
      if (!said) return fail(400, "I didn't catch that.");
      return ok(await assist(said, String(b.name ?? "Vaani").slice(0, 30), String(b.focusId ?? "").slice(0, 64)));
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
      void log("trash", `Moved ${ids.length} spam emails to Trash`);
      return ok({ trashed: ids.length });
    }
    if (p === "/gmail/undo" && method === "POST") {
      const last = await db.get("lastAction");
      if (!last?.ids.length) return fail(404, "There's nothing to undo right now.");
      if (last.type === "modify") await gmail.batchModify(last.ids, last.remove, last.add); // reverse the labels
      else if (last.type === "event") await mapLimit(last.ids, 4, (id) => g.deleteEvent(id));
      else if (last.type === "note") await mapLimit(last.ids, 4, (id) => g.deleteNote(id));
      else await mapLimit(last.ids, 10, (id) => gmail.untrash(id));
      await db.set("lastAction", null);
      void log("undo", `Undid the last ${last.type === "modify" ? "change" : last.type} (${last.ids.length})`);
      return ok({ restored: last.ids.length, type: last.type });
    }

    // ---- Organise emails: archive, read/unread, star, important, trash (all undoable) ----
    if (p === "/gmail/act" && method === "POST") {
      const ACTS: Record<string, [string[], string[]]> = {
        archive: [[], ["INBOX"]], read: [[], ["UNREAD"]], unread: [["UNREAD"], []], star: [["STARRED"], []],
        unstar: [[], ["STARRED"]], important: [["IMPORTANT"], []], unimportant: [[], ["IMPORTANT"]], inbox: [["INBOX"], []],
      };
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter((x) => /^[A-Za-z0-9_-]{1,64}$/.test(x)).slice(0, 50);
      const act = String(b.action ?? "");
      if (!ids.length) return fail(400, "Which email? Open one first, then ask again.");
      if (act === "trash") {
        await mapLimit(ids, 10, (id) => gmail.trash(id));
        await db.set("lastAction", { type: "trash", ids, at: new Date().toISOString() });
        void log("trash", `Deleted ${ids.length} email${ids.length === 1 ? "" : "s"}`);
        return ok({ done: ids.length });
      }
      const spec = ACTS[act];
      if (!spec) return fail(400, "I can't do that to an email.");
      await gmail.batchModify(ids, spec[0], spec[1]);
      await db.set("lastAction", { type: "modify", ids, add: spec[0], remove: spec[1], at: new Date().toISOString() });
      const PAST: Record<string, string> = { archive: "Archived", read: "Marked as read:", unread: "Marked as unread:", star: "Starred", unstar: "Unstarred", important: "Marked as important:", unimportant: "Unmarked:", inbox: "Moved to inbox:" };
      void log(act, `${PAST[act] ?? "Changed"} ${ids.length} email${ids.length === 1 ? "" : "s"}`);
      return ok({ done: ids.length });
    }
    if (p === "/gmail/unread" && method === "GET") {
      const r = await gmail.list({ q: "in:inbox is:unread", maxResults: 500 });
      return ok({ count: r.messages?.length ?? 0, more: Boolean(r.nextPageToken) });
    }
    if (p === "/gmail/readall" && method === "POST") {
      if (b.confirm !== true) return fail(400, "Please confirm first.");
      const r = await gmail.list({ q: "in:inbox is:unread", maxResults: 500 });
      const ids = (r.messages ?? []).map((m) => m.id);
      for (let i = 0; i < ids.length; i += 500) await gmail.batchModify(ids.slice(i, i + 500), [], ["UNREAD"]);
      if (ids.length) await db.set("lastAction", { type: "modify", ids, add: [], remove: ["UNREAD"], at: new Date().toISOString() });
      void log("read", `Marked ${ids.length} emails as read`);
      return ok({ done: ids.length });
    }

    // ---- Your labels ----
    if (p === "/gmail/labels") {
      const r = await gmail.labels();
      return ok({ labels: (r.labels ?? []).filter((l) => l.type === "user").map((l) => ({ id: l.id, name: l.name })) });
    }
    if (p === "/gmail/label/create" && method === "POST") {
      const name = String(b.name ?? "").replace(/[\r\n]/g, " ").trim().slice(0, 60);
      if (!name) return fail(400, "What should the label be called?");
      const existing = (await gmail.labels()).labels?.find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (existing) return ok({ id: existing.id, name: existing.name, existed: true });
      const l = await gmail.createLabel(name);
      void log("label", `Created the label "${l.name}"`);
      return ok({ id: l.id, name: l.name, existed: false });
    }
    if (p === "/gmail/label/apply" && method === "POST") {
      const name = String(b.name ?? "").trim().slice(0, 60);
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter((x) => /^[A-Za-z0-9_-]{1,64}$/.test(x)).slice(0, 50);
      if (!name || !ids.length) return fail(400, "Open an email first, then tell me the label.");
      const all = (await gmail.labels()).labels ?? [];
      let label = all.find((l) => l.name.toLowerCase() === name.toLowerCase()) ?? all.find((l) => l.type === "user" && l.name.toLowerCase().includes(name.toLowerCase()));
      let created = false;
      if (!label) {
        label = { ...(await gmail.createLabel(name)), type: "user" };
        created = true;
      }
      await gmail.batchModify(ids, [label.id], []);
      await db.set("lastAction", { type: "modify", ids, add: [label.id], remove: [], at: new Date().toISOString() });
      void log("label", `Labelled ${ids.length} email${ids.length === 1 ? "" : "s"} "${label.name}"`);
      return ok({ name: label.name, created });
    }

    // ---- New emails ----
    if (p === "/compose/who" && method === "POST") {
      const who = await reply.resolveRecipient(String(b.to ?? "").slice(0, 120));
      return ok(who ?? { email: "", name: String(b.to ?? "") });
    }
    if (p === "/compose/draft" && method === "POST") {
      const topic = String(b.topic ?? "").trim().slice(0, 600);
      const prev = b.previous as { subject?: string; body?: string } | undefined;
      const change = b.change ? String(b.change).slice(0, 600) : undefined;
      if (!topic && !change) return fail(400, "What should the email say?");
      return ok(await reply.composeDraft({
        to: String(b.to ?? ""), toName: String(b.toName ?? ""), topic,
        previous: prev ? { subject: String(prev.subject ?? "").slice(0, 200), body: String(prev.body ?? "").slice(0, 6000) } : undefined, change,
      }));
    }
    if (p === "/compose/send" && method === "POST") {
      if (b.confirm !== true) return fail(400, "Say send to confirm first.");
      const sent = await reply.sendNew(String(b.to ?? "").trim(), String(b.subject ?? "").slice(0, 200), String(b.body ?? ""));
      void log("sent", `Sent a new email to ${sent.to}: ${String(b.subject ?? "").slice(0, 80)}`);
      return ok(sent);
    }
    if (p === "/compose/save" && method === "POST") return ok(await reply.saveNew(String(b.to ?? "").trim(), String(b.subject ?? "").slice(0, 200), String(b.body ?? "")));

    // ---- Calendar & notes (Google Tasks) ----
    if (p === "/calendar/list" && method === "POST") {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) ? new Date(`${b.date}T00:00:00`) : new Date(new Date().setHours(0, 0, 0, 0));
      const days = Math.min(Math.max(Number(b.days) || 1, 1), 14);
      const to = new Date(day);
      to.setDate(to.getDate() + days);
      return ok({ events: await g.listEvents(day, to) });
    }
    if (p === "/calendar/add" && method === "POST") {
      const title = String(b.title ?? "").trim();
      if (!title) return fail(400, "What should I call the event?");
      const ev = await g.addEvent({ title, date: String(b.date ?? ""), time: String(b.time ?? ""), durationMin: Number(b.durationMin) || 60, details: String(b.details ?? "") });
      await db.set("lastAction", { type: "event", ids: [ev.id], at: new Date().toISOString() });
      void log("calendar", `Added "${ev.title}" to your calendar`);
      return ok(ev);
    }
    if (p === "/notes/add" && method === "POST") {
      const title = String(b.title ?? "").trim();
      if (!title) return fail(400, "What should the note say?");
      const n = await g.addNote({ title, notes: String(b.notes ?? ""), due: String(b.due ?? "") });
      await db.set("lastAction", { type: "note", ids: [n.id], at: new Date().toISOString() });
      void log("note", `Saved a note: ${n.title}`);
      return ok(n);
    }
    if (p === "/notes/list" && method === "POST") return ok({ notes: await g.listNotes() });

    // ---- SQLite history: counts, job tracker, search, stats, activity, export (no AI quota) ----
    if (p.startsWith("/history/")) {
      await mirror();
      const sdb = await sql.getDb();
      const PERIODS = ["today", "week", "month", "last_month", "year", "all"];
      const period = (PERIODS.includes(String(b.period)) ? String(b.period) : "all") as sql.Period;
      if (p === "/history/count") {
        const status = /^[a-z_]{2,30}$/.test(String(b.status ?? "")) ? String(b.status) : undefined;
        const category = /^[a-z_]{2,30}$/.test(String(b.category ?? "")) ? String(b.category) : undefined;
        const from = String(b.from ?? "").slice(0, 60);
        return ok(sql.countBy(sdb, { status, category, from, period }));
      }
      if (p === "/history/tracker") return ok({ journeys: sql.tracker(sdb, b.entity ? String(b.entity).slice(0, 80) : undefined) });
      if (p === "/history/search") return ok({ items: sql.searchHistory(sdb, String(b.query ?? "").slice(0, 120)) });
      if (p === "/history/stats") return ok(sql.stats(sdb, period));
      if (p === "/history/actions") {
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        if (b.days) since.setDate(since.getDate() - Math.min(Number(b.days) || 0, 30));
        return ok({ actions: sql.recentActions(sdb, since.toISOString()) });
      }
      if (p === "/history/export") return ok({ csv: sql.trackerCsv(sql.tracker(sdb)) });
      // ---- for everyone ----
      if (p === "/history/intent") {
        const intents = (Array.isArray(b.intents) ? b.intents : []).map(String).filter((x) => /^[a-z_]{2,20}$/.test(x)).slice(0, 5);
        return ok({ items: sql.byIntent(sdb, { intents, period }) });
      }
      if (p === "/history/pending") return ok({ items: sql.pendingReplies(sdb, { minDays: Math.min(Number(b.minDays) || 0, 30) }) });
      if (p === "/history/funnel") return ok(sql.funnel(sdb));
      if (p === "/history/ghosting") return ok({ items: sql.ghosting(sdb, Math.min(Math.max(Number(b.days) || 14, 3), 90)) });
      if (p === "/history/response") return ok(sql.responseTimes(sdb));
      if (p === "/history/deadlines") return ok({ items: sql.deadlines(sdb) });
      if (p === "/history/contacts") return ok({ contacts: sql.contacts(sdb) });
      if (p === "/history/weekly") return ok(sql.weekly(sdb));
      // Monday report: due once a week (on the first Gmail visit from Monday on)
      if (p === "/history/weekly-due") {
        const d = new Date();
        const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).toISOString().slice(0, 10);
        const last = sql.getMeta<string>(sdb, "weeklyShown");
        if (method === "POST") {
          sql.setMeta(sdb, "weeklyShown", monday);
          sql.scheduleSave(sdb);
          return ok({ ok: true });
        }
        const enough = Number(sql.info(sdb).emails) >= 5;
        return ok({ due: enough && last !== monday });
      }
      if (p === "/history/watch" && method === "POST") {
        const kind = String(b.kind);
        if (!["intent", "status", "sender", "keyword"].includes(kind) || !String(b.value ?? "").trim()) return fail(400, "What should I watch for?");
        sql.addWatch(sdb, { kind: kind as sql.Watch["kind"], value: String(b.value).trim().toLowerCase(), label: String(b.label ?? b.value) });
        sql.scheduleSave(sdb);
        void log("alert", `Started watching: ${String(b.label ?? b.value)}`);
        return ok({ watches: sql.listWatches(sdb) });
      }
      if (p === "/history/watches") return ok({ watches: sql.listWatches(sdb) });
      if (p === "/history/unwatch" && method === "POST") {
        sql.clearWatches(sdb);
        sql.scheduleSave(sdb);
        return ok({ watches: [] });
      }
      if (p === "/history/import" && method === "POST") return ok(await startBackfill(Number(b.months) || 6));
      if (p === "/history/import-status") return ok(await backfillStatus());
      if (p === "/history/info") return ok(sql.info(sdb));
      if (p === "/history/clear" && method === "POST") {
        await sql.clearHistory();
        return ok({ ok: true });
      }
    }

    // ---- Phase 2: replies (never sent without an explicit "send" from the user) ----
    const gid = String(b.gmailId ?? "");
    if (p.startsWith("/reply/") && !/^[A-Za-z0-9_-]{1,64}$/.test(gid)) return fail(400, "Which email should I reply to?");
    if (p === "/reply/suggest" && method === "POST") return ok(await reply.suggest(gid));
    if (p === "/reply/draft" && method === "POST") {
      const intent = String(b.intent ?? "").trim().slice(0, 600);
      const previous = b.previous ? String(b.previous).slice(0, 6000) : undefined;
      const change = b.change ? String(b.change).trim().slice(0, 600) : undefined;
      if (!intent && !change) return fail(400, "What would you like to say?");
      return ok(await reply.draft(gid, intent, previous, change));
    }
    if (p === "/reply/send" && method === "POST") {
      if (b.confirm !== true) return fail(400, "Say send to confirm first.");
      const sent = await reply.send(gid, String(b.body ?? ""));
      void log("sent", `Sent a reply to ${sent.to}`);
      return ok(sent);
    }
    if (p === "/reply/save" && method === "POST") return ok(await reply.saveDraft(gid, String(b.body ?? "")));

    return fail(404, `Unknown request ${method} ${p}`);
  } catch (err) {
    if (err instanceof ReplyError) return fail(400, err.message);
    if (err instanceof GoogleApiError) return fail(err.status === 403 ? 403 : 400, err.message);
    if (err instanceof AuthError) return fail(err.code === "AUTH_FAILED" ? 400 : 401, err.code === "NOT_SIGNED_IN" ? "NOT_SIGNED_IN" : err.message);
    if (err instanceof GeminiError) {
      if (err.message === "NEEDS_GEMINI_KEY") return fail(400, "NEEDS_GEMINI_KEY");
      return fail(err.status === 429 ? 429 : 502, friendlyGeminiError(err));
    }
    if (err instanceof GmailError) {
      if (err.status === 403) return fail(403, "Gmail did not allow this. Sign out and sign in again, and allow all requested Gmail permissions.");
      return fail(502, `Gmail error: ${err.message}`);
    }
    return fail(500, (err as Error).message || "Something went wrong.");
  }
}
