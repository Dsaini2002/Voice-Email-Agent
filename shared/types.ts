// Shared types used by both the server and the web dashboard.
// Only `import type` from here so nothing is needed at runtime.

export type Lang = "hinglish" | "hi" | "en";
export type BriefingMode = "short" | "detailed";

export type Category =
  | "job"
  | "education"
  | "finance"
  | "personal"
  | "work"
  | "travel"
  | "shopping"
  | "promotion"
  | "newsletter"
  | "social"
  | "notification"
  | "spam"
  | "scam"
  | "other";

/**
 * Strict job-application status. The Truth Verification step keeps these apart:
 * an acknowledgement is NOT a shortlist, an interview invite is NOT an offer.
 */
export type AppStatus =
  | "none"
  | "application_received"
  | "assessment"
  | "shortlisted"
  | "interview"
  | "offer"
  | "rejected";

export type Priority = "high" | "medium" | "low";

/**
 * What an email is FOR — the same list works for everyone (student, job seeker, shop owner, office worker).
 * Briefing buckets are built from these, so nobody gets job-only boxes they don't need.
 */
export type Intent =
  | "help_request" | "question" | "meeting" | "task" | "deadline" | "payment" | "order" | "travel"
  | "security" | "job" | "education" | "personal" | "update" | "newsletter" | "promotion" | "social" | "other";

export interface EmailAnalysis {
  category: Category;
  status: AppStatus;
  priority: Priority;
  /** Organisation or person this is about, e.g. "Infosys" or "Mummy". */
  entity: string;
  /** Stable key that groups reminders / duplicates, e.g. "infosys:application". */
  groupKey: string;
  /** One-line English summary. */
  summary: string;
  actionRequired: boolean;
  actionText: string;
  /** ISO date (YYYY-MM-DD) or empty string. */
  deadline: string;
  isScam: boolean;
  scamReason: string;
  /** Exact sentence copied from the email that proves the status. */
  evidence: string;
  /** Model confidence 0..1, lowered if evidence cannot be verified. */
  confidence: number;
  /** True when the evidence sentence was found in the original email text. */
  verified: boolean;
  /** What the email is for (universal, not job-only). */
  intent?: Intent;
  /** What the sender wants from you, one short line ("Review Rahul's resume by Friday"). */
  ask?: string;
  /** 0-3 short topic tags ("resume review", "fee payment"). */
  tags?: string[];
  /** A real person is waiting for your answer. */
  needsReply?: boolean;
  /** Written by a real person (not a system / newsletter). */
  fromPerson?: boolean;
}

export interface BriefingItem {
  gmailId: string;
  threadId: string;
  entity: string;
  subject: string;
  summary: string;
  date: string;
  status: AppStatus;
  category: Category;
  priority: Priority;
  deadline: string;
  actionText: string;
  confidence: number;
  verified: boolean;
  /** How many duplicate / reminder emails were merged into this item. */
  mergedCount: number;
  gmailUrl: string;
  /** Shown without AI analysis (e.g. the free AI limit is used up): sender + subject only. */
  basic?: boolean;
  intent?: Intent;
  ask?: string;
  tags?: string[];
  needsReply?: boolean;
  /** Not an email: a calendar event or a note shown as a card. */
  kind?: "event" | "note" | "log";
}

export type SectionKey =
  | "action"
  | "offer"
  | "interview"
  | "shortlisted"
  | "assessment"
  | "application_received"
  | "rejected"
  | "personal"
  | "finance"
  | "other_important"
  | "security";

export interface BriefingSection {
  key: SectionKey;
  title: string;
  items: BriefingItem[];
}

export interface BriefingStats {
  totalEmails: number;
  shownEmails: number;
  hiddenSpamPromo: number;
  duplicatesMerged: number;
  scamCount: number;
}

export interface Briefing {
  generatedAt: string;
  windowHours: number;
  lang: Lang;
  mode: BriefingMode;
  speech: string;
  sections: BriefingSection[];
  stats: BriefingStats;
}

export interface AskResponse {
  answer: string;
  refs: BriefingItem[];
}

export interface SyncStatus {
  state: "idle" | "syncing" | "analyzing" | "error" | "needs_key";
  message: string;
  totalStored: number;
  analyzed: number;
  pending: number;
  lastSyncAt: string | null;
  mode: "poll" | "pubsub";
}

export interface GeminiKeyStatus {
  /** The user has saved their own Gemini key. */
  hasKey: boolean;
  /** Last 4 characters only — the full key is never sent to the browser. */
  last4: string | null;
  /** Server owner allows using the server's key when a user has none (self-host mode). */
  serverKeyAllowed: boolean;
}

export interface Me {
  email: string;
  name: string;
  picture: string;
}
