import { parseDateRange, parseFind } from "./dates";
import { cleanName } from "./wake";

/**
 * Voice / typed command parser. Pure function — unit tested in test/commands.test.ts.
 * Understands English and common Hinglish phrasing ("spam kholo", "spam ke saare message delete karo").
 */

export type Folder =
  | "inbox" | "spam" | "sent" | "drafts" | "trash" | "starred" | "snoozed" | "scheduled"
  | "all" | "promotions" | "social" | "updates"
  // everything else in Gmail's left sidebar
  | "important" | "purchases" | "forums" | "chats" | "subscriptions" | "labels" | "settings" | "primary";

export type FilterKey =
  | "interview" | "shortlisted" | "offer" | "rejected" | "assessment" | "action"
  | "personal" | "finance" | "security" | "application_received";

export type Command =
  | { type: "stop" }
  | { type: "cancel" }
  | { type: "confirm" }
  | { type: "undo" }
  | { type: "close" }
  | { type: "setup" }
  | { type: "trashSpam" }
  | { type: "folder"; folder: Folder }
  | { type: "openCurrent" }
  | { type: "full" }
  | { type: "summary" }
  | { type: "focus"; entity: string }
  | { type: "filter"; key: FilterKey }
  | { type: "search"; query: string }
  | { type: "ask"; text: string }
  // Phase 2
  | { type: "reply"; entity: string | null; intent: string }
  | { type: "send" }
  | { type: "saveDraft" }
  | { type: "readAgain" }
  | { type: "voice"; action: "open" | "next" }
  | { type: "find"; query: string; label: string; spoken: string }
  // v2: your own assistant, full Gmail, calendar, notes
  | { type: "rename"; name: string }
  | { type: "rate"; delta: number }
  | { type: "compose"; to: string; topic: string; gmail: boolean }
  | { type: "gmailAct"; act: "archive" | "read" | "unread" | "star" | "unstar" | "important" | "trash" }
  | { type: "readAll" }
  | { type: "calendar"; date: string; days: number; label: string }
  | { type: "noteAdd"; text: string }
  | { type: "notesList" }
  // SQLite history (instant, no AI quota)
  | { type: "count"; status: string; category: string; period: Period; what: string; from: string }
  | { type: "tracker"; entity: string }
  | { type: "history"; query: string }
  | { type: "stats"; period: Period }
  | { type: "activity"; days: number }
  | { type: "export" }
  // for everyone (v2.2)
  | { type: "intentList"; intents: string[]; period: Period; label: string }
  | { type: "pending"; minDays: number }
  | { type: "funnel" }
  | { type: "ghosting" }
  | { type: "followUp"; entity: string }
  | { type: "responseTime" }
  | { type: "weekly" }
  | { type: "deadlines" }
  | { type: "contacts" }
  | { type: "import"; months: number }
  | { type: "importStatus" }
  | { type: "watch"; kind: "intent" | "status" | "sender" | "keyword"; value: string; label: string }
  | { type: "watchList" }
  | { type: "unwatch" }
  // your Gmail labels
  | { type: "label"; name: string }
  | { type: "createLabel"; name: string }
  | { type: "applyLabel"; name: string }
  | { type: "subtitles"; on: boolean };

/** Spoken words → universal intents (used by "who asked me for help?" and by alerts). */
const INTENT_WORDS: [RegExp, string[], string][] = [
  [/\b(help|madad|favou?r|help maang\w*|help chahiye)\b/, ["help_request"], "help requests"],
  [/\b(questions?|sawaal|sawal|poocha|puchha|puchhe|asked me)\b/, ["question"], "questions for you"],
  [/\b(invites?|invitations?|meeting requests?)\b/, ["meeting"], "meeting invites"],
  [/\b(bills?|invoices?|payments? due|dues)\b/, ["payment"], "bills and payments"],
  [/\b(orders?|deliver(y|ies)|parcels?|packages?|shipments?)\b/, ["order"], "orders and deliveries"],
  [/\b(tasks?|to ?dos?|kaam)\b/, ["task"], "things to do"],
  [/\b(college|school|university|class(es)?|exam notices?|course)\b/, ["education"], "school and college emails"],
  [/\b(travel|tickets?|bookings?|flights?|trains?)\b/, ["travel"], "travel emails"],
  [/\b(security|login alerts?|password)\b/, ["security"], "security alerts"],
];
const STATUS_WORDS: [RegExp, string, string][] = [
  [/\binterviews?\b/, "interview", "interview emails"], [/\boffers?\b/, "offer", "offer letters"], [/\bshort ?list/, "shortlisted", "shortlists"],
  [/\breject/, "rejected", "rejections"], [/\b(tests?|assessments?)\b/, "assessment", "tests"],
];

export type Period = "today" | "week" | "month" | "last_month" | "year" | "all";

/** "is mahine" → month, "last month" → last_month … (default: everything so far) */
export function parsePeriod(t: string, fallback: Period = "all"): Period {
  if (/\b(today|aaj|aj)\b/.test(t)) return "today";
  if (/\b(last month|pichhle mahine|pichle mahine|previous month)\b/.test(t)) return "last_month";
  if (/\b(this week|is hafte|past week|last 7 days|week)\b/.test(t)) return "week";
  if (/\b(this month|is mahine|month|mahine)\b/.test(t)) return "month";
  if (/\b(this year|is saal|year|saal)\b/.test(t)) return "year";
  return fallback;
}

const COUNT_WORDS: [RegExp, { status?: string; category?: string; what: string }][] = [
  [/\binterviews?\b/, { status: "interview", what: "interview" }],
  [/\bshort ?list(ed|s)?\b/, { status: "shortlisted", what: "shortlist" }],
  [/\boffers?\b/, { status: "offer", what: "offer" }],
  [/\breject(ed|ion|ions|s)?\b/, { status: "rejected", what: "rejection" }],
  [/\b(tests?|assessments?|coding rounds?)\b/, { status: "assessment", what: "test" }],
  [/\b(applications?|applied)\b/, { status: "application_received", what: "application" }],
  [/\b(scams?|fraud|phishing)\b/, { category: "scam", what: "scam email" }],
  [/\b(bank|payments?|bills?)\b/, { category: "finance", what: "bank email" }],
  [/\b(personal|family)\b/, { category: "personal", what: "personal email" }],
  [/\b(emails?|mails?|messages?)\b/, { what: "email" }],
];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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
  important: "#imp",
  purchases: "#purchases",
  forums: "#category/forums",
  chats: "#chats",
  subscriptions: "#sub",
  labels: "#settings/labels",
  settings: "#settings/general",
  primary: "#category/primary",
};

/** Sidebar text for items whose address may change: we click Gmail's own link when we can find it. */
export const FOLDER_SIDEBAR: Partial<Record<Folder, RegExp>> = {
  purchases: /^purchases\b/i, subscriptions: /^manage subscriptions\b/i, chats: /^chats\b/i, important: /^important\b/i,
  scheduled: /^scheduled\b/i, snoozed: /^snoozed\b/i, forums: /^forums\b/i,
};

export const FOLDER_LABEL: Record<Folder, string> = {
  inbox: "Inbox", spam: "Spam", sent: "Sent", drafts: "Drafts", trash: "Trash", starred: "Starred",
  snoozed: "Snoozed", scheduled: "Scheduled", all: "All Mail", promotions: "Promotions", social: "Social", updates: "Updates",
  important: "Important", purchases: "Purchases", forums: "Forums", chats: "Chats", subscriptions: "Manage subscriptions",
  labels: "Manage labels", settings: "Gmail settings", primary: "Primary",
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
  [/\b(manage )?subscriptions?\b/, "subscriptions"],
  [/\bmanage labels?\b|\blabels? (settings|manage)\b/, "labels"],
  [/\bgmail settings\b|\bsettings (of|in) gmail\b/, "settings"],
  [/\bpurchases?\b/, "purchases"],
  [/\bforums?\b/, "forums"],
  [/\bchats?\b/, "chats"],
  [/\bimportant\b/, "important"],
  [/\bprimary\b/, "primary"],
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

const SUMMARY_RE = /\b(summary|summari[sz]e|briefing|brief me|daily brief|what( ?s| is) (new|important)|anything (new|important)|what came( in)? today|today ?s (mail|email|emails|inbox)|kya (aaya|important)|aaj ka)\b/;
const OPEN = /\b(open|show|go to|goto|take me to|display|kholo|khol do|khol|dikhao|dikha do|dikhaao|le chalo)\b/;
const DELETE = /\b(delete|remove|clear|empty|trash|clean|saaf|hatao|hata do|mita do|mitao|uda do|delete karo)\b/;

const cleanLabel = (s: string) => s.replace(/^["'“]+|["'”.!?]+$/g, "").replace(/\s+label$/i, "").trim().slice(0, 60);

export function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[“”"'‘’`.,!?।]/g, " ")
    // speech recognisers often hear "spam" as "span" / "spum" / "spaam"
    .replace(/\b(span|spum|spaam|spams|spamm)\b/g, "spam")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCommand(raw: string, knownEntities: string[] = [], knownLabels: string[] = []): Command {
  const t = normalize(raw);
  if (!t) return { type: "ask", text: raw };

  if (/^(stop|pause|ruko|ruk jao|bas|chup|be quiet|quiet|shut up|enough)\b/.test(t) && !/\b(alerts?|watching|notifications?|subtitles?|captions?)\b/.test(t)) return { type: "stop" };
  if (/^(cancel|no|nope|nahi|nahin|mat karo|rehne do|don ?t)\b/.test(t)) return { type: "cancel" };
  // New email: "compose kholo", "write an email to Rahul about the meeting", "Priya ko mail bhejo ki main late hoon"
  // "open the gmail compose", "gmail compose kholo", "compose window open karo"
  const openCompose = /^(?:please )?(?:open|start|show|kholo|khol do|khol)\s+(?:the |a |my )?(?:gmail(?: ka| ki)? )?(?:compose|new (?:mail|email) window)(?: window| box)?$|^(?:gmail )?compose(?: window| box)?\s+(?:kholo|khol do|open karo|open|kar do|karo)$|^gmail compose$/.test(t);
  if (openCompose) return { type: "compose", to: "", topic: "", gmail: true };
  if (/^(?:please )?(compose|new (email|mail|message)|write (an |a )?(new )?(email|mail)|send (an |a )?(email|mail)|draft (an |a )?(new )?(email|mail))\b|\b(compose kholo|compose karo|mail likho|email likho|mail bhejo|email bhejo|mail karo|email karo)\b/.test(t)) {
    const gmailOnly = /^(open )?(gmail )?compose( window)?( kholo| open)?$|compose kholo$/.test(t);
    let to = "", topic = "";
    const tm = raw.match(/\b(?:to|for)\s+(.+?)(?=\s+(?:about|regarding|saying|that|telling|ki|ke bare me|ke baare mein|:)\b|$)/i);
    if (tm) to = tm[1].trim();
    const hk = raw.match(/^(.+?)\s+ko\s+(?:ek\s+)?(?:mail|email|message)\b/i);
    if (!to && hk) to = hk[1].replace(/^(please|vaani)\s+/i, "").trim();
    const top = raw.match(/\b(?:about|regarding|saying|that|telling (?:him|her|them)|ki|ke bare me|ke baare mein)\s+(.+)$/i) ?? raw.match(/:\s*(.+)$/);
    if (top) topic = top[1].trim();
    to = to.replace(/\b(?:an?|new|the)\s+(email|mail)\b/i, "").trim();
    return { type: "compose", to, topic, gmail: gmailOnly && !to && !topic };
  }

  // Organise the email on screen
  if (/\b(mark all (as )?read|read all|sab(ko)? read (kar do|karo)|saare? (mail|email)s? read)\b/.test(t)) return { type: "readAll" };
  if (/\barchive\b/.test(t) && !/\b(open|show|dikhao|kholo)\b/.test(t)) return { type: "gmailAct", act: "archive" };
  if (/\b(mark (it |this )?(as )?unread|unread (mark )?karo|unread kar do)\b/.test(t)) return { type: "gmailAct", act: "unread" };
  if (/\b(mark (it |this )?(as )?read|read (mark )?karo|read kar do)\b/.test(t)) return { type: "gmailAct", act: "read" };
  if (/\b(unstar|remove (the )?star|star hatao)\b/.test(t)) return { type: "gmailAct", act: "unstar" };
  if (/^(star (it|this|this email|this mail)|add (a )?star)\b|\bstar (karo|kar do|laga do)\b/.test(t)) return { type: "gmailAct", act: "star" };
  if (/\b(mark (it |this )?(as )?important|important mark karo)\b/.test(t)) return { type: "gmailAct", act: "important" };
  if (/^(delete|trash|remove) (it|this|this email|this mail|this message)\b|\b(isko|ise|ye|yeh) (delete|hata|mita) (karo|kar do|do)\b/.test(t) && !/\bspam\b/.test(t)) return { type: "gmailAct", act: "trash" };

  // Calendar: "what's on my calendar tomorrow", "aaj ka schedule", "meetings today"
  if (/\b(calendar|schedule|meetings?|events?|appointments?)\b/.test(t) && !/\b(add|create|schedule (a|an|my)|set up|book|daal|daalo|laga|lagao|put|new)\b/.test(t)) {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let label = "today", days = 1;
    if (/\b(tomorrow|kal)\b/.test(t)) { base.setDate(base.getDate() + 1); label = "tomorrow"; }
    else if (/\b(day after tomorrow|parso|parson)\b/.test(t)) { base.setDate(base.getDate() + 2); label = "the day after tomorrow"; }
    else if (/\b(this week|is hafte|week)\b/.test(t)) { days = 7; label = "this week"; }
    else {
      const r = parseDateRange(raw.replace(/\b(today|aaj)\b/gi, ""));
      if (r && /\d/.test(raw)) {
        // a date said for the calendar may be in the future: keep it in the current year when it's ahead
        const d = r.from;
        const fwd = new Date(now.getFullYear(), d.getMonth(), d.getDate());
        const use = fwd.getTime() >= base.getTime() - 86_400_000 * 1 ? fwd : d;
        base.setTime(use.getTime());
        label = use.toLocaleDateString("en-IN", { day: "numeric", month: "long" });
      }
    }
    return { type: "calendar", date: ymd(base), days, label };
  }

  // Notes (Google Tasks): "note: buy milk", "add a note call mom", "yeh note kar lo: ...", "show my notes"
  if (/\b(my notes|show (my )?notes|notes dikhao|meri notes|mere notes|my tasks|my to ?dos?|to ?do list|tasks dikhao|read my notes)\b/.test(t)) return { type: "notesList" };
  const nt = raw.match(/^(?:please\s+)?(?:note(?: down| this| that| karo| kar lo)?|add (?:a )?note|make (?:a )?note|save (?:a )?note|write down|take (?:a )?note|add (?:a )?(?:task|to ?do))\s*(?:that|:|-|,)?\s*(.+)$/i)
    ?? raw.match(/^(.+?)\s+(?:note kar lo|note karo|note kar do|yaad rakhna|likh lo)$/i);
  if (nt && nt[1].trim().length > 1) return { type: "noteAdd", text: nt[1].trim() };

  // ---- alerts: "jab bhi koi help maange mujhe batana", "tell me whenever TCS emails" ----
  if (/\b(stop|remove|delete|band karo|hatao|clear)\b.*\b(alerts?|watch(ing)?|notifications?)\b|\bstop watching\b/.test(t)) return { type: "unwatch" };
  if (/\b(my alerts|show (my )?alerts|alerts dikhao|what are you watching)\b/.test(t)) return { type: "watchList" };
  if (/\b(jab bhi|whenever|notify me|alert me|tell me when|batana jab|mujhe batana|let me know when|inform me when)\b/.test(t)) {
    for (const [re, intents, label] of INTENT_WORDS) if (re.test(t)) return { type: "watch", kind: "intent", value: intents[0], label: `someone sends ${label}` };
    for (const [re, status, label] of STATUS_WORDS) if (re.test(t)) return { type: "watch", kind: "status", value: status, label };
    const known = matchEntity(t, knownEntities);
    const who = known ?? (raw.match(/\b(?:from|by)\s+([\w.&-]+(?:\s[\w.&-]+)?)/i)?.[1] ?? raw.match(/\b(?:whenever|jab bhi)\s+([A-Z][\w.&-]+)/)?.[1] ?? "");
    if (who && !/^(someone|anyone|koi|kisi)$/i.test(who)) return { type: "watch", kind: "sender", value: who.toLowerCase(), label: `${who} emails you` };
    const kw = raw.match(/\b(?:about|mentions?|regarding)\s+(.+?)[.?!]*$/i)?.[1];
    if (kw) return { type: "watch", kind: "keyword", value: kw.toLowerCase(), label: `an email about ${kw}` };
  }

  // ---- old-email import ----
  if (/\b(import|load|bring|laao|lao|le aao|backfill)\b/.test(t) && /\b(old|purane|past|months?|mahine|history|previous)\b/.test(t)) {
    if (/\b(status|progress|kahan tak|how far|kitna hua)\b/.test(t)) return { type: "importStatus" };
    const n = t.match(/\b(\d{1,2})\s*(months?|mahine)/);
    return { type: "import", months: n ? Math.min(Number(n[1]), 24) : 6 };
  }
  if (/\bimport (status|progress)\b/.test(t)) return { type: "importStatus" };

  // ---- reports ----
  if (/\b(weekly report|week(ly)? summary|hafte ki report|last week( ka| ki)? (report|summary)|pichhle hafte (ka|ki) (summary|report)|monday report)\b/.test(t)) return { type: "weekly" };
  if (/\b(funnel|conversion|success rate|interview rate|selection rate|hit rate|kitne percent)\b/.test(t)) return { type: "funnel" };
  if (/\b(response time|reply time|how (fast|quickly|long).*(reply|respond|take)|kitne din mein (reply|jawab)|kaunsi company.*(din|fast|jaldi))\b/.test(t)) return { type: "responseTime" };
  if (/\b(ghost(ed|ing)?|went quiet|no (reply|response) from|kisne reply nahi|reply nahi (kiya|aaya)|jawab nahi (aaya|diya) (company|companies)|silent companies)\b/.test(t)) return { type: "ghosting" };
  if (/\bfollow[ -]?up\b/.test(t)) {
    const e = matchEntity(t, knownEntities) ?? raw.match(/\bfollow[ -]?up (?:with |to )?([A-Z][\w.&-]+)/i)?.[1] ?? raw.match(/^([\w.&-]+)\s+(?:ko|se)\s+follow/i)?.[1] ?? "";
    return e && !/^(on|with|the|a|an)$/i.test(e) ? { type: "followUp", entity: e } : { type: "ghosting" };
  }
  if (/\b(pending|unanswered|not (yet )?replied|haven'?t replied|reply pending|jinka (reply|jawab) nahi diya|reply karna (hai|baaki)|kya baaki hai|reminders?|who is waiting)\b/.test(t))
    return { type: "pending", minDays: /\breminders?\b/.test(t) ? 3 : 0 };
  if (/\b(deadlines?|due dates?|kya due hai|last dates?|what'?s due)\b/.test(t)) return { type: "deadlines" };
  if (/\b(my contacts|contacts? (list|dikhao|book)|people i (talk|email|write) (to|with)|who (do i|i) talk to)\b/.test(t)) return { type: "contacts" };

  // ---- "kisi ne aaj help maangi hai?", "any questions for me?", "show my bills" ----
  if (/\b(kisi ne|kisne|anyone|someone|any|koi|who|kaun|show|dikhao|list|my|mere|meri)\b/.test(t) || /\b(maangi|manga|maanga|poocha|puchha|bheja|aaya|aaye|aayi)\b/.test(t)) {
    for (const [re, intents, label] of INTENT_WORDS) {
      if (!re.test(t)) continue;
      if (intents[0] === "task" && /\b(note|notes|tasks dikhao|my tasks|to ?do list)\b/.test(t)) break; // notes handle these
      if (intents[0] === "security" && /\bspam\b/.test(t)) break;
      return { type: "intentList", intents, period: parsePeriod(t, "week"), label };
    }
  }

  // ---- SQLite history ----
  if (/\b(export|download)\b.*\b(applications?|tracker|csv|data|history|excel|sheet)\b/.test(t)) return { type: "export" };
  if (/\b(what did you do|what have you done|activity( log)?|aaj kya kiya|tumne kya kiya|kya kya kiya)\b/.test(t))
    return { type: "activity", days: /\b(week|hafte)\b/.test(t) ? 7 : /\b(yesterday|kal)\b/.test(t) ? 1 : 0 };
  if (/\b(my stats|inbox stats|email stats|statistics|stats|report|monthly report|analytics)\b/.test(t)) return { type: "stats", period: parsePeriod(t, "month") };
  if (/\b(job tracker|application tracker|my applications|applications? (dikhao|status|tracker|track)|job status|naukri ka status|where do i stand|all applications)\b/.test(t)) return { type: "tracker", entity: "" };
  if (/\b(status|kahan tak|where am i|journey|progress)\b/.test(t) && /\b(application|status|journey|kahan tak|where am i|progress)\b/.test(t)) {
    const known = matchEntity(t, knownEntities);
    const m = raw.match(/^(?:what(?:'s| is) )?(?:the )?(?:status of )?(?:my )?(.+?)\s+(?:ka|ki|ke)\s+(?:application|status|journey)/i)
      ?? raw.match(/(?:status of (?:my )?|where am i with |journey (?:of|with) |progress (?:of|with) )(.+?)(?:\s+application)?[?.!]*$/i);
    const entity = known ?? (m ? m[1].replace(/^(my|the)\s+/i, "").trim() : "");
    if (entity) return { type: "tracker", entity };
  }
  if (/\b(history|archive|purane (emails?|mails?|messages?)|old emails?)\b/.test(t) && /\b(search|find|dhundo|dhoondo|dhoondho|look for|mein|me|in|for)\b/.test(t)) {
    const q = t.replace(/\b(please|search|find|look for|dhundo|dhoondo|dhoondho|my|the|email|emails|mail|mails|history|archive|purane|old|in|mein|me|for|se|ka|ki|ke|messages?)\b/g, " ").replace(/\s+/g, " ").trim();
    if (q) return { type: "history", query: q };
  }
  if (/\b(how many|kitne|kitni|kitna|number of|count|total)\b/.test(t)) {
    const fm = t.match(/\bfrom ([a-z0-9][\w.&-]*(?: [a-z0-9][\w.&-]*)?)(?= (?:this|last|today|is|pichhle|pichle|ab|so|in|mein|me)\b|$)/);
    const from = fm && !/^(the|my|this|last|today)$/.test(fm[1]) ? fm[1] : "";
    for (const [re, v] of COUNT_WORDS) if (re.test(t)) return { type: "count", status: v.status ?? "", category: v.category ?? "", period: parsePeriod(t), what: v.what, from };
  }

  if (/^(?:haan |ha |yes )?(send|send it|send now|bhej do|bhejo|send kar do|send karo)\b/.test(t)) return { type: "send" };
  if (/^(confirm|confirmed|yes|yeah|yep|haan|han|ha|haa|ok|okay|do it|kar do|go ahead|sure|delete it)\b/.test(t)) return { type: "confirm" };
  if (/\bundo\b|\bwapas (lao|karo|la do)\b|\brestore\b/.test(t)) return { type: "undo" };
  if (/^(close|hide|exit|dismiss|minimi[sz]e|band karo|band kar do|chhota karo|go away)\b/.test(t)) return { type: "close" };
  if (/^(back|go back|wapas|peeche)\b/.test(t)) return { type: "summary" };

  // Your assistant's name: "change your name to Nova", "tumhara naam Zara rakho"
  const rn = raw.match(/\b(?:change your name to|rename yourself(?: to)?|call yourself|your new name is|from now on (?:you are|your name is)|i(?:'ll| will) call you|tumhara naam|aapka naam|apna naam)\s*(.*)$/i);
  if (rn) return { type: "rename", name: cleanName(rn[1] ?? "") };
  if (/\b(change|badlo|badal do) (your|apna|tumhara) name\b|\bnaam badlo\b/.test(t)) return { type: "rename", name: "" };

  // Speaking speed
  const talk = /\b(speak|talk|bolo|bol|read|voice|awaaz)\b/.test(t) || t.split(" ").length <= 2;
  if (talk && /\b(faster|quicker|fast|jaldi|tez)\b/.test(t)) return { type: "rate", delta: 0.1 };
  if (talk && /\b(slower|slow|dheere|aaram se)\b/.test(t)) return { type: "rate", delta: -0.1 };

  // Subtitles: "subtitles off", "subtitle band karo", "captions on"
  if (/\b(subtitles?|captions?|cc)\b/.test(t)) {
    if (/\b(off|band|hatao|hide|disable|stop|mat dikhao|nahi)\b/.test(t)) return { type: "subtitles", on: false };
    if (/\b(on|chalu|show|dikhao|enable|start|lagao)\b/.test(t)) return { type: "subtitles", on: true };
  }

  // Voice picker: "change voice", "voice settings", "awaaz badlo", "next voice"
  if (/\b(next|another|different|dusri|doosri|agli) (voice|awaaz|aawaz|avaaz)\b/.test(t)) return { type: "voice", action: "next" };
  if (/\b(voice|awaaz|aawaz|avaaz|sound)\b/.test(t) && /\b(change|settings?|select|choose|pick|badlo|badal|chuno|set)\b/.test(t)) return { type: "voice", action: "open" };

  if (/^(setup|set up|settings|sign in|signin|log ?in|connect|account)\b/.test(t)) return { type: "setup" };

  // Replies: "reply to TCS saying I'll attend", "TCS ko reply karo ki main kal aaunga", "iska reply do"
  if (/^(please )?(reply|respond|write (a )?reply|draft (a )?reply|answer (this|it|the))\b/.test(t) || /\b(reply|jawab|jawaab) (karo|kar do|do|bhejo|likho|de do|dena)\b/.test(t)) {
    const m = raw.match(/(?:\bsaying\b|\bsay that\b|\band say\b|\btelling them\b|\bthat\b|\bki\b|:)\s*(.+)$/i);
    const intent = m ? m[1].trim() : "";
    const head = m ? raw.slice(0, raw.length - m[0].length) : raw;
    return { type: "reply", entity: matchEntity(head, knownEntities), intent };
  }
  if (/\b(save (it )?(as )?(a )?draft|draft (me|mein) (rakho|save karo|daal do)|keep (it )?as (a )?draft)\b/.test(t)) return { type: "saveDraft" };
  if (/\b(read (it )?again|repeat|phir se (padho|sunao)|dobara (padho|sunao))\b/.test(t)) return { type: "readAgain" };

  // "delete all spam", "spam ke saare message delete karo", "spam saaf karo"
  if (/\bspam\b/.test(t) && DELETE.test(t)) return { type: "trashSpam" };

  // "open it in gmail", "gmail mein kholo"
  if (/\b(open it|open this|open in gmail|gmail (me|mein) kholo|ise kholo|isko kholo|read it in gmail)\b/.test(t)) return { type: "openCurrent" };

  // Dates & Gmail searches: "25 oct ka message dikhao", "unread emails", "yesterday ke mail"
  if (!SUMMARY_RE.test(t)) {
    const f = parseFind(raw);
    if (f) return { type: "find", ...f };
  }

  // Labels: "create a label called Jobs", "isko Jobs label mein daalo", "IMPORTANT MAIL label kholo"
  const cl = raw.match(/\b(?:create|make|add|new|banao|bana do)\s+(?:a\s+)?(?:new\s+)?label(?:\s+(?:called|named|naam|for))?\s*[:"]?\s*(.*)$/i)
    ?? raw.match(/^(.+?)\s+(?:naam ka|name ka)\s+label\s+(?:banao|bana do)/i);
  if (cl) return { type: "createLabel", name: cleanLabel(cl[1] ?? "") };
  if (/\bcreate new label\b/.test(t)) return { type: "createLabel", name: "" };
  const al = raw.match(/\b(?:label (?:this|it)(?: as)?|move (?:this|it) to|put (?:this|it) in|add (?:this|it) to|tag (?:this|it)(?: as)?)\s+(?:the\s+)?(.+?)(?:\s+label)?[.!?]*$/i)
    ?? raw.match(/\b(?:isko|ise|ye|yeh)\s+(.+?)\s+label\s+(?:mein|me|main)\s+(?:daalo|dalo|daal do|rakho|lagao)/i);
  if (al && !/\b(spam|trash|inbox|calendar|notes?)\b/i.test(al[1])) return { type: "applyLabel", name: cleanLabel(al[1]) };
  const lbl = knownLabels.find((l) => l.length > 1 && t.includes(normalize(l)));
  if (lbl && (OPEN.test(t) || /\blabel\b/.test(t) || t === normalize(lbl))) return { type: "label", name: lbl };
  const ol = raw.match(/\b(?:open|show)\s+(?:the\s+|my\s+)?label\s+(.+?)[.!?]*$/i) ?? raw.match(/^(.+?)\s+label\s+(?:kholo|khol do|dikhao|open)/i);
  if (ol) return { type: "label", name: cleanLabel(ol[1]) };

  // Folders: "open spam", "spam kholo", "go to sent"
  for (const [re, folder] of FOLDER_WORDS) {
    if (re.test(t) && (OPEN.test(t) || t.split(" ").length <= 2)) return { type: "folder", folder };
  }

  if (/\b(full (window|screen|view)|full mode|overview|everything|sab dikhao|sab kuch)\b/.test(t)) return { type: "full" };

  // A specific company / person beats a generic filter: "TCS ka interview message dikhao"
  // A name alone isn't enough ("add a meeting with Rahul…" is not "open Rahul's email"):
  // open it only when the sentence is about showing / opening an email, or is just the name.
  const entity = matchEntity(t, knownEntities);
  if (entity && !/\b(add|schedule|create|book|remind|note|meeting with|call)\b/.test(t) &&
    (OPEN.test(t) || /\b(email|mail|message|msg|wala|wali|wale|ka|ki|ke|from|read|padho|sunao)\b/.test(t) || t.split(" ").length <= 3)) {
    return { type: "focus", entity };
  }

  if (SUMMARY_RE.test(t)) return { type: "summary" };

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
