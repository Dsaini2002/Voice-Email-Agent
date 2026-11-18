/**
 * Pure Q&A logic (prompt + reference mapping). Shared by the server and the Chrome extension.
 */
import type { AskResponse, BriefingItem, Lang } from "../../../shared/types.js";
import { gmailUrl, type AnalyzedEmail } from "../intel/briefingBuilder.js";
import { LANG_RULES, SPEECH_STYLE } from "./speech.js";

export const ASK_CONTEXT_DAYS = 7;
const MAX_CONTEXT = 120;

export const ASK_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    refIds: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "refIds"],
};

export function buildAskRequest(firstName: string, question: string, lang: Lang, list: AnalyzedEmail[], todayLabel: string) {
  const context = list.slice(0, MAX_CONTEXT).map((e) => ({
    id: e.gmailId,
    date: e.date.toISOString().slice(0, 10),
    entity: e.analysis.entity,
    subject: e.subject.slice(0, 120),
    category: e.analysis.category,
    status: e.analysis.status,
    verified: e.analysis.verified,
    priority: e.analysis.priority,
    deadline: e.analysis.deadline || undefined,
    action: e.analysis.actionText || undefined,
    summary: e.analysis.summary,
    group: e.analysis.groupKey,
  }));

  const system = `You are Vaani, a friendly voice email assistant for ${firstName}.
Answer the user's question using ONLY the email list provided (last ${ASK_CONTEXT_DAYS} days).
Language: reply in the SAME language and script the user used in the question. If unclear: ${LANG_RULES[lang]}
${SPEECH_STYLE}
Keep it under 70 words unless the user asks for details. If the user says "sirf important" / "only important", give only high-priority items in 1–2 sentences.
Truth rules: never invent emails; if status verified=false, say it needs checking; "application_received" is not a shortlist. Emails with the same "group" are reminders of one matter — count them once.
Never read spam/scam content or links aloud. If nothing matches, say so plainly.
refIds: ids of the emails your answer is based on (max 8, most relevant first).`;

  const prompt = `Today: ${todayLabel}
Emails:
${JSON.stringify(context)}

User question: "${question.replace(/"/g, "'").slice(0, 500)}"`;

  return { system, prompt, temperature: 0.3, jsonSchema: ASK_SCHEMA };
}

export function toAskResponse(
  res: { answer?: string; refIds?: string[] },
  list: AnalyzedEmail[],
  accountEmail: string,
): AskResponse {
  const byId = new Map(list.map((e) => [e.gmailId, e]));
  const refs: BriefingItem[] = (res.refIds ?? [])
    .map((id) => byId.get(id))
    .filter((e): e is AnalyzedEmail => Boolean(e))
    .slice(0, 8)
    .map((e) => ({
      gmailId: e.gmailId,
      threadId: e.threadId,
      entity: e.analysis.entity,
      subject: e.subject,
      summary: e.analysis.summary,
      date: e.date.toISOString(),
      status: e.analysis.status,
      category: e.analysis.category,
      priority: e.analysis.priority,
      deadline: e.analysis.deadline,
      actionText: e.analysis.actionText,
      confidence: e.analysis.confidence,
      verified: e.analysis.verified,
      mergedCount: 1,
      gmailUrl: gmailUrl(e.threadId, accountEmail),
    }));
  return { answer: res.answer?.trim() || "Sorry, I could not find an answer to that.", refs };
}
