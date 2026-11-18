import type {
  BriefingItem,
  BriefingSection,
  BriefingStats,
  EmailAnalysis,
  Lang,
  SectionKey,
} from "../../../shared/types.js";

/** Minimal email shape the builder needs (keeps it pure and testable). */
export interface AnalyzedEmail {
  gmailId: string;
  threadId: string;
  subject: string;
  date: Date;
  analysis: EmailAnalysis;
}

const HIDDEN_CATEGORIES = new Set(["promotion", "newsletter", "social", "spam"]);

export const SECTION_ORDER: SectionKey[] = [
  "action", "offer", "interview", "shortlisted", "assessment", "personal", "finance",
  "other_important", "application_received", "rejected", "security",
];

const TITLES: Record<Lang, Record<SectionKey, string>> = {
  hinglish: {
    action: "Kaam pending hai", offer: "Offer mila", interview: "Interview", shortlisted: "Shortlisted",
    assessment: "Test / Assessment", application_received: "Application received", rejected: "Rejected",
    personal: "Personal", finance: "Bank & Payments", other_important: "Baaki important", security: "Security warning",
  },
  hi: {
    action: "बाकी काम", offer: "ऑफ़र मिला", interview: "इंटरव्यू", shortlisted: "शॉर्टलिस्ट",
    assessment: "टेस्ट / असेसमेंट", application_received: "आवेदन प्राप्त", rejected: "रिजेक्ट",
    personal: "व्यक्तिगत", finance: "बैंक और पेमेंट", other_important: "अन्य ज़रूरी", security: "सुरक्षा चेतावनी",
  },
  en: {
    action: "Action pending", offer: "Offers", interview: "Interviews", shortlisted: "Shortlisted",
    assessment: "Tests / Assessments", application_received: "Applications received", rejected: "Rejected",
    personal: "Personal", finance: "Bank & Payments", other_important: "Other important", security: "Security warnings",
  },
};

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export function gmailUrl(threadId: string, accountEmail: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${threadId}`;
}

/** Decides which section an email belongs to, or null if it should stay out of the briefing. */
export function sectionFor(a: EmailAnalysis): SectionKey | null {
  if (a.isScam || a.category === "scam") return "security";
  if (a.category === "spam") return null;

  if (a.status !== "none") {
    // Truth Verification: unverified claims are never presented as a confirmed status.
    if (!a.verified) return "other_important";
    return a.status as SectionKey;
  }
  if (a.actionRequired && a.verified) return "action";
  // Someone is waiting for you (help, question, meeting, task…): always show it, whatever the category.
  if (a.verified && (a.needsReply || ["help_request", "question", "meeting", "task", "deadline"].includes(a.intent ?? ""))) {
    return a.category === "personal" ? "personal" : a.actionRequired ? "action" : "other_important";
  }
  if (HIDDEN_CATEGORIES.has(a.category)) return a.priority === "high" ? "other_important" : null;
  if (a.category === "personal") return "personal";
  if (a.category === "finance" && a.priority !== "low") return "finance";
  if (a.priority === "high") return "other_important";
  return null;
}

/**
 * Duplicate Intelligence: emails sharing a groupKey (reminders, follow-ups,
 * status updates on the same application) collapse into the LATEST one.
 */
export function dedupe(list: AnalyzedEmail[]): { item: AnalyzedEmail; merged: number }[] {
  const groups = new Map<string, AnalyzedEmail[]>();
  for (const e of list) {
    const key = e.analysis.groupKey || `thread:${e.threadId}`;
    const g = groups.get(key) ?? [];
    g.push(e);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    g.sort((x, y) => y.date.getTime() - x.date.getTime());
    const latest = g[0];
    // Keep the most useful deadline among reminders (the latest email's deadline wins if present).
    const deadline = latest.analysis.deadline || g.find((x) => x.analysis.deadline)?.analysis.deadline || "";
    return { item: { ...latest, analysis: { ...latest.analysis, deadline } }, merged: g.length };
  });
}

export interface BuildOptions {
  /** Only groups with an email newer than this are "new" in the briefing. */
  windowStart?: Date;
  /** Today as YYYY-MM-DD (user's timezone). Pending actions with deadline >= today stay visible. */
  today?: string;
}

/**
 * `list` may contain older emails (e.g. last 7 days) so reminders are merged with
 * their originals; only groups with fresh activity — or a still-open deadline — are shown.
 */
export function buildSections(
  list: AnalyzedEmail[],
  lang: Lang,
  accountEmail: string,
  opts: BuildOptions = {},
): { sections: BriefingSection[]; stats: BriefingStats } {
  const windowStart = opts.windowStart ?? new Date(0);
  const inWindow = (d: Date) => d.getTime() >= windowStart.getTime();
  const stats: BriefingStats = {
    totalEmails: list.filter((e) => inWindow(e.date)).length,
    shownEmails: 0,
    hiddenSpamPromo: 0,
    duplicatesMerged: 0,
    scamCount: 0,
  };

  const deduped = dedupe(list);
  const buckets = new Map<SectionKey, BriefingItem[]>();

  for (const { item, merged } of deduped) {
    const a = item.analysis;
    const fresh = inWindow(item.date);
    const openDeadline = Boolean(a.actionRequired && a.deadline && opts.today && a.deadline >= opts.today);
    if (!fresh && !openDeadline) continue;
    const section = sectionFor(a);
    if (!section) {
      stats.hiddenSpamPromo += merged;
      continue;
    }
    if (section === "security") stats.scamCount += merged;
    stats.duplicatesMerged += merged - 1;
    stats.shownEmails += 1;

    const bi: BriefingItem = {
      gmailId: item.gmailId,
      threadId: item.threadId,
      entity: a.entity,
      subject: item.subject,
      summary: a.isScam && a.scamReason ? `${a.summary} — ${a.scamReason}` : a.summary,
      date: item.date.toISOString(),
      status: a.status,
      category: a.category,
      priority: a.priority,
      deadline: a.deadline,
      actionText: a.actionText,
      confidence: a.confidence,
      verified: a.verified,
      mergedCount: merged,
      gmailUrl: gmailUrl(item.threadId, accountEmail),
      intent: a.intent,
      ask: a.ask,
      tags: a.tags,
      needsReply: a.needsReply,
    };
    const arr = buckets.get(section) ?? [];
    arr.push(bi);
    buckets.set(section, arr);
  }

  const sections: BriefingSection[] = SECTION_ORDER.filter((k) => buckets.has(k)).map((key) => ({
    key,
    title: TITLES[lang][key],
    items: buckets.get(key)!.sort(compareItems),
  }));
  return { sections, stats };
}

function compareItems(x: BriefingItem, y: BriefingItem): number {
  const p = PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority];
  if (p !== 0) return p;
  if (x.deadline && y.deadline && x.deadline !== y.deadline) return x.deadline < y.deadline ? -1 : 1;
  if (x.deadline && !y.deadline) return -1;
  if (!x.deadline && y.deadline) return 1;
  return y.date.localeCompare(x.date);
}
