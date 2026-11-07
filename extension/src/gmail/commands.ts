/**
 * Voice / typed command parser. Pure function — unit tested in test/commands.test.ts.
 * Understands English and common Hinglish phrasing ("spam kholo", "spam ke saare message delete karo").
 */

export type Folder =
  | "inbox" | "spam" | "sent" | "drafts" | "trash" | "starred" | "snoozed" | "scheduled"
  | "all" | "promotions" | "social" | "updates";

export type FilterKey =
  | "interview" | "shortlisted" | "offer" | "rejected" | "assessment" | "action"
  | "personal" | "finance" | "security" | "application_received";

export type Command =
  | { type: "stop" }
  | { type: "cancel" }
  | { type: "confirm" }
  | { type: "undo" }
  | { type: "close" }
  | { type: "trashSpam" }
  | { type: "folder"; folder: Folder }
  | { type: "openCurrent" }
  | { type: "full" }
  | { type: "summary" }
  | { type: "focus"; entity: string }
  | { type: "filter"; key: FilterKey }
  | { type: "search"; query: string }
  | { type: "ask"; text: string };

/** Gmail web URL fragment for each folder (opened in the SAME tab). */
export const FOLDER_HASH: Record<Folder, string> = {
  inbox: "#inbox",
  spam: "#spam",
  sent: "#sent",
  drafts: "#drafts",
  trash: "#trash",
  starred: "#starred",
  snoozed: "#snoozed",
  scheduled: "#scheduled",
  all: "#all",
  promotions: "#category/promotions",
  social: "#category/social",
  updates: "#category/updates",
};

export const FOLDER_LABEL: Record<Folder, string> = {
  inbox: "Inbox", spam: "Spam", sent: "Sent", drafts: "Drafts", trash: "Trash", starred: "Starred",
  snoozed: "Snoozed", scheduled: "Scheduled", all: "All Mail", promotions: "Promotions", social: "Social", updates: "Updates",
};

const FOLDER_WORDS: [RegExp, Folder][] = [
  [/\bspam\b/, "spam"],
  [/\binbox\b/, "inbox"],
  [/\bsent\b/, "sent"],
  [/\bdrafts?\b/, "drafts"],
  [/\b(trash|bin|recycle)\b/, "trash"],
  [/\bstarred\b/, "starred"],
  [/\bsnoozed\b/, "snoozed"],
  [/\bscheduled\b/, "scheduled"],
  [/\ball mail\b/, "all"],
  [/\bpromotions?\b/, "promotions"],
  [/\bsocial\b/, "social"],
  [/\bupdates\b/, "updates"],
];

const FILTER_WORDS: [RegExp, FilterKey][] = [
  [/\binterviews?\b/, "interview"],
  [/\bshort ?list(ed|s)?\b/, "shortlisted"],
  [/\boffers?\b/, "offer"],
  [/\breject(ed|ion|ions)?\b/, "rejected"],
  [/\b(tests?|assessments?|exams?)\b/, "assessment"],
  [/\b(pending|action|actions|kaam|to ?do)\b/, "action"],
  [/\b(personal|family)\b/, "personal"],
  [/\b(bank|banking|payments?|bills?|finance)\b/, "finance"],
  [/\b(scams?|fraud|phishing|security|suspicious)\b/, "security"],
  [/\b(applications?|applied)\b/, "application_received"],
];

const OPEN = /\b(open|show|go to|goto|take me to|display|kholo|khol do|khol|dikhao|dikha do|dikhaao|le chalo)\b/;
const DELETE = /\b(delete|remove|clear|empty|trash|clean|saaf|hatao|hata do|mita do|mitao|uda do|delete karo)\b/;

export function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[“”"'‘’`.,!?।]/g, " ")
    // speech recognisers often hear "spam" as "span" / "spum" / "spaam"
    .replace(/\b(span|spum|spaam|spams|spamm)\b/g, "spam")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCommand(raw: string, knownEntities: string[] = []): Command {
  const t = normalize(raw);
  if (!t) return { type: "ask", text: raw };

  if (/^(stop|pause|ruko|ruk jao|bas|chup|be quiet|quiet|shut up|enough)\b/.test(t)) return { type: "stop" };
  if (/^(cancel|no|nope|nahi|nahin|mat karo|rehne do|don ?t)\b/.test(t)) return { type: "cancel" };
  if (/^(confirm|confirmed|yes|yeah|yep|haan|han|ha|haa|ok|okay|do it|kar do|go ahead|sure|delete it)\b/.test(t)) return { type: "confirm" };
  if (/\bundo\b|\bwapas (lao|karo|la do)\b|\brestore\b/.test(t)) return { type: "undo" };
  if (/^(close|hide|exit|dismiss|minimi[sz]e|band karo|band kar do|chhota karo|go away)\b/.test(t)) return { type: "close" };
  if (/^(back|go back|wapas|peeche)\b/.test(t)) return { type: "summary" };

  // "delete all spam", "spam ke saare message delete karo", "spam saaf karo"
  if (/\bspam\b/.test(t) && DELETE.test(t)) return { type: "trashSpam" };

  // "open it in gmail", "gmail mein kholo"
  if (/\b(open it|open this|open in gmail|gmail (me|mein) kholo|ise kholo|isko kholo|read it in gmail)\b/.test(t)) return { type: "openCurrent" };

  // Folders: "open spam", "spam kholo", "go to sent"
  for (const [re, folder] of FOLDER_WORDS) {
    if (re.test(t) && (OPEN.test(t) || t.split(" ").length <= 2)) return { type: "folder", folder };
  }

  if (/\b(full (window|screen|view)|full mode|overview|everything|sab dikhao|sab kuch)\b/.test(t)) return { type: "full" };

  // A specific company / person beats a generic filter: "TCS ka interview message dikhao"
  const entity = matchEntity(t, knownEntities);
  if (entity) return { type: "focus", entity };

  if (
    /\b(summary|summari[sz]e|briefing|brief me|daily brief|what( ?s| is) (new|important)|anything (new|important)|what came( in)? today|today ?s (mail|email|emails|inbox)|kya (aaya|important)|aaj ka)\b/.test(t)
  ) {
    return { type: "summary" };
  }

  for (const [re, key] of FILTER_WORDS) if (re.test(t)) return { type: "filter", key };

  const search = t.match(/^(search( for)?|find|look for|dhundo|dhoondo|dhoondho)\s+(.+)$/);
  if (search) return { type: "search", query: search[3] };

  return { type: "ask", text: raw.trim() };
}

/** Finds a known sender/company name inside the command (whole-word, case-insensitive). */
export function matchEntity(text: string, entities: string[]): string | null {
  const t = ` ${normalize(text)} `;
  const sorted = [...new Set(entities)].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const e of sorted) {
    const n = normalize(e);
    if (n.length < 2) continue;
    if (t.includes(` ${n} `)) return e;
    // also match the first word of multi-word names ("hdfc" for "HDFC Bank") if distinctive
    const first = n.split(" ")[0];
    if (first.length >= 3 && n.includes(" ") && t.includes(` ${first} `) && !GENERIC.has(first)) return e;
  }
  return null;
}

const GENERIC = new Set(["the", "bank", "mail", "team", "google", "jobs", "job", "hr", "careers", "india", "my", "mom", "dad"]);
