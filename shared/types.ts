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
  state: "idle" | "syncing" | "analyzing" | "error";
  message: string;
  totalStored: number;
  analyzed: number;
  pending: number;
  lastSyncAt: string | null;
  mode: "poll" | "pubsub";
}

export interface Me {
  email: string;
  name: string;
  picture: string;
}
