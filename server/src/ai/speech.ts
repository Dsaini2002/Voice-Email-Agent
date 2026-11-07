import type { BriefingMode, BriefingSection, BriefingStats, Lang } from "../../../shared/types.js";

/**
 * Language rules shared by the briefing and Q&A prompts.
 * Hinglish uses Roman script on purpose: browser text-to-speech with an
 * Indian voice reads it naturally, and it matches how users type.
 */
export const LANG_RULES: Record<Lang, string> = {
  hinglish:
    "Speak in natural Hinglish (Hindi + English mix) written in ROMAN script, like Indians speak casually. Example: \"Aaj 4 companies ne aapko shortlist kiya hai.\"",
  hi: "Speak in simple, natural Hindi written in DEVANAGARI script. Company and product names can stay in English letters.",
  en: "Speak in simple, clear Indian English.",
};

export const SPEECH_STYLE = `This text will be read aloud by text-to-speech:
- Plain sentences only. No markdown, no bullets, no emojis, no URLs, no email addresses.
- Group similar things in ONE sentence ("A, B aur C ne shortlist kiya") — never list emails one by one.
- Most important first: pending actions with deadlines, offers, interviews, shortlists; then the rest.
- Say dates naturally ("aaj", "kal", "15 November"), never as YYYY-MM-DD.`;

export function compactSections(sections: BriefingSection[]) {
  return sections.map((s) => ({
    section: s.key,
    items: s.items.map((i) => ({
      entity: i.entity,
      summary: i.summary,
      deadline: i.deadline || undefined,
      action: i.actionText || undefined,
      verified: i.verified,
      reminders: i.mergedCount > 1 ? i.mergedCount : undefined,
    })),
  }));
}

export function briefingPrompt(
  sections: BriefingSection[],
  stats: BriefingStats,
  lang: Lang,
  mode: BriefingMode,
  todayLabel: string,
  userName: string,
): { system: string; prompt: string } {
  const limit = mode === "short" ? "at most 75 words (about 30 seconds of speech)" : "at most 180 words";
  const system = `You are VaaniMail AI, a warm, efficient voice assistant reading a personal email briefing to ${userName}.
${LANG_RULES[lang]}
${SPEECH_STYLE}
Length: ${limit}.
Truth rules (very important):
- Only use facts from the JSON. Never invent companies, dates or results.
- Items in section "other_important" with verified=false: do NOT state their status as fact; say an email needs checking.
- "application_received" means only the application was received — never call it a shortlist or selection.
- "personal" items: in short mode, do not read the content; just say there is a personal message and ask if they want to hear it.
- "security" items: warn briefly that suspicious/scam emails were found and were kept aside; do not read links.
- Mention reminders count only if it helps ("3 reminders aaye, latest deadline kal hai").
Start with a short greeting. End with ONE short follow-up question if useful.`;
  const prompt = `Today is ${todayLabel}. Mode: ${mode}.
Stats: ${JSON.stringify(stats)}
Briefing data (most important first):
${JSON.stringify(compactSections(sections), null, 1)}
If there are no sections, say nothing important came and how many promotional emails were hidden.`;
  return { system, prompt };
}

/** Deterministic fallback when Gemini is unavailable — the briefing never fails completely. */
export function fallbackSpeech(sections: BriefingSection[], stats: BriefingStats, lang: Lang): string {
  const names = (k: string) =>
    sections.find((s) => s.key === k)?.items.map((i) => i.entity).filter(Boolean) ?? [];
  const join = (arr: string[], and: string) =>
    arr.length <= 1 ? arr.join("") : `${arr.slice(0, -1).join(", ")} ${and} ${arr[arr.length - 1]}`;

  const parts: string[] = [];
  const and = lang === "en" ? "and" : lang === "hi" ? "और" : "aur";
  const action = sections.find((s) => s.key === "action")?.items ?? [];
  const offer = names("offer");
  const interview = names("interview");
  const shortlisted = names("shortlisted");
  const rejected = names("rejected");

  if (lang === "en") {
    if (offer.length) parts.push(`You have an offer from ${join(offer, and)}.`);
    if (interview.length) parts.push(`Interview updates from ${join(interview, and)}.`);
    if (shortlisted.length) parts.push(`${join(shortlisted, and)} shortlisted you.`);
    if (action.length) parts.push(`${action.length} emails need your action.`);
    if (rejected.length) parts.push(`${join(rejected, and)} sent a rejection.`);
    if (stats.scamCount) parts.push(`${stats.scamCount} suspicious emails were kept aside.`);
    if (!parts.length) parts.push("Nothing important came in.");
    parts.push(`${stats.hiddenSpamPromo} promotional emails were hidden.`);
  } else if (lang === "hi") {
    if (offer.length) parts.push(`${join(offer, and)} से ऑफ़र आया है।`);
    if (interview.length) parts.push(`${join(interview, and)} से इंटरव्यू की जानकारी आई है।`);
    if (shortlisted.length) parts.push(`${join(shortlisted, and)} ने आपको शॉर्टलिस्ट किया है।`);
    if (action.length) parts.push(`${action.length} ईमेल में आपका काम बाकी है।`);
    if (rejected.length) parts.push(`${join(rejected, and)} से रिजेक्शन आया है।`);
    if (stats.scamCount) parts.push(`${stats.scamCount} संदिग्ध ईमेल अलग रखे गए हैं।`);
    if (!parts.length) parts.push("कोई ज़रूरी ईमेल नहीं आया।");
    parts.push(`${stats.hiddenSpamPromo} प्रमोशनल ईमेल छुपा दिए गए।`);
  } else {
    if (offer.length) parts.push(`${join(offer, and)} se offer aaya hai.`);
    if (interview.length) parts.push(`${join(interview, and)} se interview ki update aayi hai.`);
    if (shortlisted.length) parts.push(`${join(shortlisted, and)} ne aapko shortlist kiya hai.`);
    if (action.length) parts.push(`${action.length} emails mein aapka kaam pending hai.`);
    if (rejected.length) parts.push(`${join(rejected, and)} se rejection aaya hai.`);
    if (stats.scamCount) parts.push(`${stats.scamCount} suspicious emails alag rakhe gaye hain.`);
    if (!parts.length) parts.push("Koi important email nahi aaya.");
    parts.push(`${stats.hiddenSpamPromo} promotional emails hide kar diye.`);
  }
  return parts.join(" ");
}
