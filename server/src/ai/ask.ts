import type { ObjectId } from "mongodb";
import type { AskResponse, BriefingItem, Lang } from "../../../shared/types.js";
import { users } from "../db.js";
import { gmailUrl } from "../intel/briefingBuilder.js";
import { loadAnalyzed, todayLabel } from "./briefing.js";
import { generateJSON } from "./gemini.js";
import { LANG_RULES, SPEECH_STYLE } from "./speech.js";

const CONTEXT_DAYS = 7;
const MAX_CONTEXT = 120;

/**
 * Voice Q&A over already-analyzed emails ("Kitne rejection aaye?",
 * "Sirf important batao", "Infosys ka kya status hai?").
 * Uses AI summaries, not raw bodies — fast, cheap and privacy-friendly.
 */
export async function answerQuestion(userId: ObjectId, question: string, lang: Lang): Promise<AskResponse> {
  const user = await users().findOne({ _id: userId });
  if (!user) throw new Error("User not found");

  const list = (await loadAnalyzed(userId, CONTEXT_DAYS * 24)).slice(0, MAX_CONTEXT);
  const context = list.map((e) => ({
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

  const system = `You are VaaniMail AI, a voice email assistant for ${user.name.split(" ")[0]}.
Answer the user's question using ONLY the email list provided (last ${CONTEXT_DAYS} days).
Language: reply in the SAME language and script the user used in the question. If unclear: ${LANG_RULES[lang]}
${SPEECH_STYLE}
Keep it under 70 words unless the user asks for details. If the user says "sirf important" / "only important", give only high-priority items in 1–2 sentences.
Truth rules: never invent emails; if status verified=false, say it needs checking; "application_received" is not a shortlist. Emails with the same "group" are reminders of one matter — count them once.
Never read spam/scam content or links aloud. If nothing matches, say so plainly.
refIds: ids of the emails your answer is based on (max 8, most relevant first).`;

  const prompt = `Today: ${todayLabel()}
Emails:
${JSON.stringify(context)}

User question: "${question.replace(/"/g, "'").slice(0, 500)}"`;

  const res = await generateJSON<{ answer: string; refIds: string[] }>({
    system,
    prompt,
    temperature: 0.3,
    jsonSchema: {
      type: "object",
      properties: {
        answer: { type: "string" },
        refIds: { type: "array", items: { type: "string" } },
      },
      required: ["answer", "refIds"],
    },
  });

  const byId = new Map(list.map((e) => [e.gmailId, e]));
  const refs: BriefingItem[] = (res.refIds ?? [])
    .map((id) => byId.get(id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e))
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
      gmailUrl: gmailUrl(e.threadId, user.email),
    }));

  return { answer: res.answer?.trim() || "Maaf kijiye, iska jawab nahi mil paya.", refs };
}
