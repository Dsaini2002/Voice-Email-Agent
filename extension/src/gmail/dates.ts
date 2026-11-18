/**
 * Turns spoken dates into Gmail searches: "25 oct ka message dikhao", "show emails from yesterday",
 * "unread emails", "emails with attachments". Pure — unit tested.
 */
export interface Find { query: string; label: string; spoken: string }

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ORD = "(?:st|nd|rd|th)?";

const pad = (n: number) => String(n).padStart(2, "0");
const gmailDate = (d: Date) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const nice = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "long" });

/** A date said without a year means the most recent one (messages are in the past). */
function resolve(day: number, month: number, year: number | null, today: Date): Date | null {
  if (day < 1 || day > 31 || month < 0 || month > 11) return null;
  let y = year ?? today.getFullYear();
  if (year !== null && year < 100) y = 2000 + year;
  let d = new Date(y, month, day);
  if (d.getMonth() !== month) return null; // 31 Feb etc.
  if (year === null && d.getTime() > today.getTime()) d = new Date(y - 1, month, day);
  return d;
}

export function parseDateRange(raw: string, today = new Date()): { from: Date; to: Date; label: string; spoken: string } | null {
  const t = raw.toLowerCase().replace(/[,.]/g, " ").replace(/\s+/g, " ");
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const one = (d: Date, spoken = nice(d)) => ({ from: d, to: addDays(d, 1), label: nice(d).toUpperCase(), spoken });

  if (/\b(today|aaj|aj)\b/.test(t)) return one(t0, "today");
  if (/\b(yesterday|kal ka|kal ke|kal ki|kal wale|kal aaye|kal aaya)\b/.test(t)) return one(addDays(t0, -1), "yesterday");
  if (/\b(day before yesterday|parso|parson)\b/.test(t)) return one(addDays(t0, -2), "the day before yesterday");
  if (/\b(last week|pichhle hafte|pichle hafte|past week|this week|is hafte)\b/.test(t))
    return { from: addDays(t0, -7), to: addDays(t0, 1), label: "LAST 7 DAYS", spoken: "in the last 7 days" };
  if (/\b(last month|pichhle mahine|pichle mahine)\b/.test(t)) {
    const from = new Date(t0.getFullYear(), t0.getMonth() - 1, 1);
    const to = new Date(t0.getFullYear(), t0.getMonth(), 1);
    return { from, to, label: from.toLocaleDateString("en-IN", { month: "long", year: "numeric" }).toUpperCase(), spoken: `in ${from.toLocaleDateString("en-IN", { month: "long" })}` };
  }

  let m = t.match(new RegExp(`\\b(\\d{1,2})${ORD}(?: of)? ${MONTH_RE}(?: (\\d{4}))?\\b`));
  if (m) {
    const d = resolve(+m[1], MONTHS.indexOf(m[2].slice(0, 3)), m[3] ? +m[3] : null, t0);
    if (d) return one(d);
  }
  m = t.match(new RegExp(`\\b${MONTH_RE} (\\d{1,2})${ORD}(?: (\\d{4}))?\\b`));
  if (m) {
    const d = resolve(+m[2], MONTHS.indexOf(m[1].slice(0, 3)), m[3] ? +m[3] : null, t0);
    if (d) return one(d);
  }
  m = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/); // Indian order: day/month
  if (m) {
    const d = resolve(+m[1], +m[2] - 1, m[3] ? +m[3] : null, t0);
    if (d) return one(d);
  }
  return null;
}

/** Recognises "find"-style requests and builds the Gmail query. */
export function parseFind(raw: string, today = new Date()): Find | null {
  const t = raw.toLowerCase();
  const parts: string[] = [];
  const said: string[] = [];
  let label = "";

  const range = parseDateRange(raw, today);
  if (range) {
    parts.push(`after:${gmailDate(range.from)} before:${gmailDate(range.to)}`);
    said.push(range.spoken === "today" || range.spoken.startsWith("in ") || range.spoken.startsWith("the ") || range.spoken === "yesterday" ? range.spoken : `on ${range.spoken}`);
    label = range.label;
  }
  if (/\b(unread|unseen|not read|nahi padh|bina padhe|new emails?)\b/.test(t)) {
    parts.push("is:unread");
    said.unshift("unread");
    label = label ? `UNREAD · ${label}` : "UNREAD";
  }
  if (/\b(attachments?|attached|pdfs?|files?|resume|attachment wal[ae])\b/.test(t)) {
    parts.push("has:attachment");
    said.push("with attachments");
    label = label ? `${label} · ATTACHMENTS` : "ATTACHMENTS";
  }
  if (/\b(starred|star wal[ae])\b/.test(t) && !/\b(open|kholo|go to)\b/.test(t)) {
    parts.push("is:starred");
    said.unshift("starred");
    label = label ? `STARRED · ${label}` : "STARRED";
  }
  if (!parts.length) return null;
  // "25 oct ka TCS wala message": keep a sender / topic word if there is one
  const from = t.match(/\bfrom ([a-z0-9][\w.&-]{1,30})(?: (?:on|of|ka|ke|ki|wala|wale|emails?|messages?|mails?)\b|$)/);
  if (from && !/^(yesterday|today|last|the|my|this)$/.test(from[1])) {
    parts.push(`from:${from[1]}`);
    said.push(`from ${from[1]}`);
    label = `${label} · FROM ${from[1].toUpperCase()}`;
  }
  return { query: parts.join(" "), label, spoken: said.join(" ") };
}
