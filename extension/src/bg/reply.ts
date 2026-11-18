/**
 * Phase 2: voice replies. Drafts are written by Gemini with the user's own key;
 * sending only happens after the user explicitly says "send" in the overlay.
 */
import {
  buildDraftRequest, buildSuggestRequest, NO_REPLY, placeholders, replySubject, toDraft, toSuggestions,
  type ReplyDraft, type ReplySource, type ReplySuggestions,
} from "../../../server/src/ai/replyCore";
import { redactPII } from "../../../server/src/privacy/redact";
import { callGemini, GeminiError } from "./ai";
import { extractBody, gmail, header, parseFrom } from "./gmail";
import { b64url, buildReplyMime, EMAIL_RE } from "./mime";
import { db } from "./store";

export interface ReplyTarget {
  gmailId: string;
  threadId: string;
  to: string;
  toName: string;
  subject: string;
  messageId: string;
  references: string;
  noReply: boolean;
  scam: boolean;
  source: ReplySource;
}

async function target(gmailId: string): Promise<ReplyTarget> {
  const m = await gmail.get(gmailId, "metadata", ["From", "Reply-To", "Subject", "Message-ID", "References", "Date"]);
  const from = parseFrom(header(m, "From"));
  const replyTo = parseFrom(header(m, "Reply-To") || header(m, "From"));
  const rec = (await db.emails())[gmailId];
  let body = rec?.body ?? "";
  if (!body) {
    const full = await gmail.get(gmailId, "full");
    body = redactPII(extractBody(full.payload));
  }
  const subject = header(m, "Subject") || rec?.subject || "";
  return {
    gmailId,
    threadId: m.threadId,
    to: replyTo.email,
    toName: replyTo.name || from.name,
    subject: replySubject(subject),
    messageId: header(m, "Message-ID") || header(m, "Message-Id"),
    references: header(m, "References"),
    noReply: NO_REPLY.test(replyTo.email),
    scam: rec?.analysis?.category === "scam",
    source: { fromName: from.name, fromEmail: from.email, subject, date: rec?.date ?? header(m, "Date"), body },
  };
}

function key(): Promise<string> {
  return db.get("geminiKey").then((k) => {
    if (!k) throw new GeminiError(400, "NEEDS_GEMINI_KEY");
    return k;
  });
}

export async function suggest(gmailId: string): Promise<{ to: string; toName: string; subject: string; noReply: boolean; scam: boolean } & ReplySuggestions> {
  const t = await target(gmailId);
  const base = { to: t.to, toName: t.toName, subject: t.subject, noReply: t.noReply, scam: t.scam };
  if (t.scam) return { ...base, asks: [], options: [] };
  const raw = await callGemini<{ asks?: unknown; options?: unknown }>(await key(), buildSuggestRequest(t.source));
  return { ...base, ...toSuggestions(raw) };
}

export async function draft(gmailId: string, intent: string, previous?: string, change?: string): Promise<ReplyDraft & { to: string; toName: string; subject: string; noReply: boolean }> {
  const t = await target(gmailId);
  if (t.scam) throw new ReplyError("This email looks like a scam, so I won't reply to it. It's safer to just ignore it.");
  const account = await db.get("account");
  const raw = await callGemini<{ body?: unknown; hints?: unknown; spoken?: unknown }>(
    await key(),
    buildDraftRequest({ userName: account?.name ?? "", userEmail: account?.email ?? "", email: t.source, intent, previous, change }),
  );
  const d = toDraft(raw);
  if (!d.body) throw new ReplyError("I couldn't write that reply. Could you say it a little differently?");
  if (t.noReply) d.hints.unshift("This came from a no-reply address, so nobody will read a reply.");
  return { ...d, to: t.to, toName: t.toName, subject: t.subject, noReply: t.noReply };
}

export class ReplyError extends Error {}

/** Final checks happen here too, so a bug in the overlay can never send something unchecked. */
function check(t: ReplyTarget, body: string) {
  if (t.scam) throw new ReplyError("This email looks like a scam, so I won't reply to it.");
  if (t.noReply) throw new ReplyError("That address doesn't accept replies, so I didn't send it.");
  if (!EMAIL_RE.test(t.to)) throw new ReplyError("I couldn't find a valid address to reply to.");
  const blanks = placeholders(body);
  if (blanks.length) throw new ReplyError(`Please fill in ${blanks.join(", ")} first.`);
  if (body.trim().length < 2) throw new ReplyError("The reply is empty.");
  if (body.length > 10_000) throw new ReplyError("The reply is too long.");
}

async function raw(t: ReplyTarget, body: string): Promise<string> {
  const account = await db.get("account");
  const mime = buildReplyMime({
    from: account?.name ? `${account.name} <${account.email}>` : account?.email ?? "",
    to: t.to,
    subject: t.subject,
    body: body.trim(),
    inReplyTo: t.messageId,
    references: t.references,
  });
  return b64url(mime);
}

export async function send(gmailId: string, body: string): Promise<{ id: string; to: string }> {
  const t = await target(gmailId);
  check(t, body);
  const r = await gmail.send(await raw(t, body), t.threadId);
  return { id: r.id, to: t.to };
}

export async function saveDraft(gmailId: string, body: string): Promise<{ id: string }> {
  const t = await target(gmailId);
  if (t.scam) throw new ReplyError("This email looks like a scam, so I won't reply to it.");
  const r = await gmail.createDraft(await raw(t, body), t.threadId);
  return { id: r.id };
}

// ---------------- New emails (compose) ----------------
import { buildComposeRequest, spokenEmail, toCompose } from "../../../server/src/ai/replyCore";
import { findContact, getDb } from "./sql";

/** Finds an email address for a spoken name: from people who wrote to you, or your Gmail history. */
export async function resolveRecipient(said: string): Promise<{ email: string; name: string } | null> {
  const direct = spokenEmail(said);
  if (direct) return { email: direct, name: "" };
  // 1) your contacts book in the SQLite history (people who wrote to you, even months ago)
  try {
    const c = findContact(await getDb(), said);
    if (c?.email && !NO_REPLY.test(c.email)) return { email: c.email, name: c.name };
  } catch { /* history not ready: fall back below */ }
  const name = said.trim().toLowerCase();
  if (name.length < 2) return null;
  const tokens = name.split(/\s+/).filter((t) => t.length >= 2);
  const hit = (s: string) => tokens.every((t) => s.toLowerCase().includes(t));
  const recs = Object.values(await db.emails()).sort((a, b) => b.date.localeCompare(a.date));
  const known = recs.find((r) => !NO_REPLY.test(r.fromEmail) && (hit(r.fromName) || hit(r.fromEmail.split("@")[0])));
  if (known) return { email: known.fromEmail, name: known.fromName };
  try {
    const r = await gmail.list({ q: `from:(${tokens.join(" ")}) OR to:(${tokens.join(" ")})`, maxResults: 5 });
    for (const m of r.messages ?? []) {
      const msg = await gmail.get(m.id, "metadata", ["From", "To"]);
      for (const h of [header(msg, "From"), ...header(msg, "To").split(",")]) {
        const p = parseFrom(h);
        if (p.email && !NO_REPLY.test(p.email) && (hit(p.name) || hit(p.email.split("@")[0]))) return { email: p.email, name: p.name };
      }
    }
  } catch { /* search is best effort */ }
  return null;
}

export async function composeDraft(o: { to: string; toName: string; topic: string; previous?: { subject: string; body: string }; change?: string }) {
  const account = await db.get("account");
  const raw = await callGemini<{ subject?: unknown; body?: unknown; hints?: unknown; spoken?: unknown }>(
    await key(),
    buildComposeRequest({ userName: account?.name ?? "", userEmail: account?.email ?? "", toName: o.toName || o.to, topic: o.topic, previous: o.previous, change: o.change }),
  );
  const d = toCompose(raw);
  if (!d.body) throw new ReplyError("I couldn't write that email. Could you say it a little differently?");
  return d;
}

async function rawNew(to: string, subject: string, body: string): Promise<string> {
  const account = await db.get("account");
  return b64url(buildReplyMime({ from: account?.name ? `${account.name} <${account.email}>` : account?.email ?? "", to, subject, body: body.trim() }));
}

export async function sendNew(to: string, subject: string, body: string): Promise<{ id: string; to: string }> {
  if (!EMAIL_RE.test(to)) throw new ReplyError("Please check the email address first.");
  const blanks = placeholders(body);
  if (blanks.length) throw new ReplyError(`Please fill in ${blanks.join(", ")} first.`);
  if (body.trim().length < 2) throw new ReplyError("The email is empty.");
  const r = await gmail.send(await rawNew(to, subject || "(no subject)", body));
  return { id: r.id, to };
}

export async function saveNew(to: string, subject: string, body: string): Promise<{ id: string }> {
  if (to && !EMAIL_RE.test(to)) throw new ReplyError("Please check the email address first.");
  const account = await db.get("account");
  const mime = buildReplyMime({ from: account?.email ?? "", to: to || (account?.email ?? ""), subject: subject || "(no subject)", body: body.trim() });
  const r = await gmail.createDraft(b64url(mime));
  return { id: r.id };
}
