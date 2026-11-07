import type { ObjectId } from "mongodb";
import type { Briefing, BriefingMode, Lang } from "../../../shared/types.js";
import { emails, users } from "../db.js";
import { buildSections, type AnalyzedEmail } from "../intel/briefingBuilder.js";
import { generateText } from "./gemini.js";
import { briefingPrompt, fallbackSpeech } from "./speech.js";

export const TIMEZONE = process.env.TIMEZONE || "Asia/Kolkata";

export function todayLabel(): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

/** YYYY-MM-DD in the user's timezone. */
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
}

const LOOKBACK_HOURS = 7 * 24;

export async function loadAnalyzed(userId: ObjectId, hours: number): Promise<AnalyzedEmail[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const docs = await emails()
    .find(
      { userId, date: { $gte: since }, analysis: { $ne: null } },
      { projection: { gmailId: 1, threadId: 1, subject: 1, date: 1, analysis: 1 } },
    )
    .sort({ date: -1 })
    .limit(500)
    .toArray();
  return docs.map((d) => ({
    gmailId: d.gmailId,
    threadId: d.threadId,
    subject: d.subject,
    date: d.date,
    analysis: d.analysis!,
  }));
}

/** The 30-second intelligent daily briefing. */
export async function generateBriefing(
  userId: ObjectId,
  lang: Lang,
  mode: BriefingMode,
  hours: number,
): Promise<Briefing> {
  const user = await users().findOne({ _id: userId });
  if (!user) throw new Error("User not found");

  // Load a week so reminders merge with their originals and open deadlines stay visible.
  const list = await loadAnalyzed(userId, Math.max(hours, LOOKBACK_HOURS));
  const { sections, stats } = buildSections(list, lang, user.email, {
    windowStart: new Date(Date.now() - hours * 60 * 60 * 1000),
    today: todayISO(),
  });

  let speech: string;
  try {
    const firstName = user.name.split(" ")[0] || "dost";
    const { system, prompt } = briefingPrompt(sections, stats, lang, mode, todayLabel(), firstName);
    speech = await generateText({ system, prompt, temperature: 0.4 });
  } catch (err) {
    console.warn("Briefing speech fell back to template:", (err as Error).message);
    speech = fallbackSpeech(sections, stats, lang);
  }

  return {
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    lang,
    mode,
    speech,
    sections,
    stats,
  };
}
