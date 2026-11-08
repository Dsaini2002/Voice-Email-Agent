import type { ObjectId } from "mongodb";
import type { AskResponse, Lang } from "../../../shared/types.js";
import { users } from "../db.js";
import { ASK_CONTEXT_DAYS, buildAskRequest, toAskResponse } from "./askCore.js";
import { loadAnalyzed, todayLabel } from "./briefing.js";
import { generateJSON } from "./gemini.js";
import { geminiKeyForUser } from "./keys.js";

/**
 * Voice Q&A over already-analyzed emails ("How many rejections?", "Sirf important batao").
 * Uses AI summaries, not raw bodies — fast, cheap and privacy-friendly.
 */
export async function answerQuestion(userId: ObjectId, question: string, lang: Lang): Promise<AskResponse> {
  const user = await users().findOne({ _id: userId });
  if (!user) throw new Error("User not found");
  const apiKey = await geminiKeyForUser(userId); // throws MissingGeminiKeyError → 400 for the UI
  const list = await loadAnalyzed(userId, ASK_CONTEXT_DAYS * 24);
  const req = buildAskRequest(user.name.split(" ")[0], question, lang, list, todayLabel());
  const res = await generateJSON<{ answer: string; refIds: string[] }>({ apiKey, ...req });
  return toAskResponse(res, list, user.email);
}
