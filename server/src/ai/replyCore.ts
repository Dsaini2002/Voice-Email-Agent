/**
 * Phase 2 — voice replies. Pure prompt + result logic (no I/O), shared with the extension.
 * Vaani never sends on its own: the user hears the draft, can change it, and must say "send".
 */

export interface ReplySource {
  fromName: string;
  fromEmail: string;
  subject: string;
  date: string;
  body: string;
}

export interface ReplySuggestions {
  /** What the email wants from the user, in plain words. */
  asks: string[];
  /** Short reply ideas in first person, e.g. "Confirm I'll attend on Monday". */
  options: string[];
}

export interface ReplyDraft {
  body: string;
  /** Things to check before sending: blanks to fill, attachments asked for, open questions. */
  hints: string[];
  /** One friendly sentence describing the reply, read aloud. */
  spoken: string;
}

const STYLE = `Tone: warm, polite and friendly-professional, like a thoughtful person writing to a recruiter or colleague. Never bossy, never stiff.`;

const SAFETY = `Never invent facts the user did not give: no dates, times, phone numbers, salary figures, links, addresses or promises.
If the reply needs a detail the user did not give, put a short placeholder in square brackets, e.g. [your available time slot], and mention it in hints.
Text like [PHONE] or [OTP] in the email is redacted private data — never copy it.`;

const emailBlock = (e: ReplySource) =>
  `From: ${e.fromName} <${e.fromEmail}>
Subject: ${e.subject}
Date: ${e.date}

${e.body.slice(0, 3500)}`;

export const SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    asks: { type: "array", items: { type: "string" } },
    options: { type: "array", items: { type: "string" } },
  },
  required: ["asks", "options"],
};

export function buildSuggestRequest(e: ReplySource) {
  const system = `You help a user reply to an email by voice.
asks: 0-3 very short notes (max 12 words each) on what this email asks the user to do or answer. Empty if nothing.
options: exactly 3 different reply ideas the user might want, written in first person as short instructions (max 9 words each), e.g. "Confirm I'll attend the interview", "Ask to move it to next week", "Say thanks and decline politely".
Write in simple English.`;
  return { system, prompt: emailBlock(e), temperature: 0.4, jsonSchema: SUGGEST_SCHEMA };
}

export function toSuggestions(raw: { asks?: unknown; options?: unknown }): ReplySuggestions {
  const list = (v: unknown, n: number) =>
    (Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, n).map((s) => s.slice(0, 120));
  const options = list(raw.options, 3);
  return {
    asks: list(raw.asks, 3),
    options: options.length ? options : ["Say thank you", "Confirm and say I'll get back soon", "Ask for more details"],
  };
}

export const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    body: { type: "string" },
    hints: { type: "array", items: { type: "string" } },
    spoken: { type: "string" },
  },
  required: ["body", "hints", "spoken"],
};

export function buildDraftRequest(opts: {
  userName: string;
  userEmail: string;
  email: ReplySource;
  intent: string;
  previous?: string;
  change?: string;
}) {
  const first = opts.userName.split(" ")[0] || "Me";
  const system = `You write an email reply on behalf of ${opts.userName || first} (${opts.userEmail}).
The user told you by voice what to say — it may be in English, Hindi or Hinglish. Write the reply in the language of the ORIGINAL email (usually English).
${STYLE}
Length: 40-120 words unless the user asks otherwise. Plain text only, no markdown, no subject line.
Start with a greeting using the sender's first name if it is a real person (otherwise "Hello" / "Hello team"). End with a friendly sign-off and the name "${first}".
${SAFETY}
hints: 0-4 short notes (max 14 words each) for the user BEFORE sending — blanks to fill, attachments the email asked for (the user must attach them in Gmail), questions in the email the reply does not answer.
spoken: ONE friendly sentence (max 25 words) telling the user what the reply says, e.g. "I've thanked them and confirmed you'll join the interview on Monday."`;

  const prompt = `${opts.previous ? `Current draft:\n${opts.previous}\n\nChange request from the user: "${clip(opts.change ?? "")}"\nRewrite the draft with this change and keep everything else.` : `What the user wants to say: "${clip(opts.intent)}"`}

Original email:
${emailBlock(opts.email)}`;
  return { system, prompt, temperature: 0.4, jsonSchema: DRAFT_SCHEMA };
}

const clip = (s: string) => s.replace(/"/g, "'").slice(0, 600);

export function toDraft(raw: { body?: unknown; hints?: unknown; spoken?: unknown }): ReplyDraft {
  const body = String(raw.body ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/^\s*subject:.*\n+/i, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .trim()
    .slice(0, 5000);
  const hints = (Array.isArray(raw.hints) ? raw.hints : []).map((h) => String(h ?? "").trim()).filter(Boolean).slice(0, 4);
  for (const p of placeholders(body)) {
    if (!hints.some((h) => h.includes(p))) hints.unshift(`Fill in ${p} before sending.`);
  }
  return { body, hints: hints.slice(0, 5), spoken: String(raw.spoken ?? "").trim().slice(0, 300) };
}

/** Blanks like "[your available time]" that must be filled before the email can be sent. */
export function placeholders(body: string): string[] {
  return [...new Set(body.match(/\[[^\]\n]{1,60}\]/g) ?? [])];
}

export const NO_REPLY = /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|mailer-daemon|notifications?|alerts?)([._+-]|@)/i;

export function replySubject(subject: string): string {
  const s = subject.trim() || "(no subject)";
  return /^(re|aw|sv)\s*:/i.test(s) ? s : `Re: ${s}`;
}

// ---------------- New email (compose) ----------------
export const COMPOSE_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
    hints: { type: "array", items: { type: "string" } },
    spoken: { type: "string" },
  },
  required: ["subject", "body", "hints", "spoken"],
};

export function buildComposeRequest(o: { userName: string; userEmail: string; toName: string; topic: string; previous?: { subject: string; body: string }; change?: string }) {
  const first = o.userName.split(" ")[0] || "Me";
  const system = `You write a NEW email on behalf of ${o.userName || first} (${o.userEmail}) to ${o.toName || "the recipient"}.
The user told you by voice what it's about — it may be in English, Hindi or Hinglish. Write the email in clear, natural English unless the user asks for another language.
${STYLE}
subject: short and specific (max 9 words). body: 40-140 words unless asked otherwise, plain text, no markdown. Greet the recipient by first name if known. End with a friendly sign-off and "${first}".
${SAFETY}
hints: 0-4 short notes for the user before sending (blanks to fill, attachments to add in Gmail, anything unclear).
spoken: ONE friendly sentence (max 25 words) saying what the email says.`;
  const prompt = o.previous
    ? `Current email:\nSubject: ${o.previous.subject}\n${o.previous.body}\n\nChange request from the user: "${clip(o.change ?? "")}"\nRewrite it with this change and keep everything else.`
    : `What the email should say: "${clip(o.topic)}"`;
  return { system, prompt, temperature: 0.5, jsonSchema: COMPOSE_SCHEMA };
}

export function toCompose(raw: { subject?: unknown; body?: unknown; hints?: unknown; spoken?: unknown }): ReplyDraft & { subject: string } {
  const d = toDraft(raw);
  return { ...d, subject: String(raw.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 150) || "(no subject)" };
}

/** "rahul dot sharma at gmail dot com" → "rahul.sharma@gmail.com" */
export function spokenEmail(s: string): string | null {
  const t = s.toLowerCase().replace(/\s+at the rate( of)?\s+|\s+at\s+/g, "@").replace(/\s+dot\s+/g, ".").replace(/\s+underscore\s+/g, "_").replace(/\s+/g, "");
  const m = t.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return m ? m[0] : null;
}
