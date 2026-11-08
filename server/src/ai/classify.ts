import type { EmailAnalysis } from "../../../shared/types.js";
import { buildClassifyRequest, toAnalyses, type EmailForAI } from "./classifyCore.js";
import { generateJSON } from "./gemini.js";

export { slug, type EmailForAI } from "./classifyCore.js";

/** Classifies up to ~8 emails in ONE Gemini call (saves free-tier quota). */
export async function classifyBatch(batch: EmailForAI[], apiKey: string): Promise<Map<string, EmailAnalysis>> {
  const raw = await generateJSON<{ results: unknown[] }>({ apiKey, ...buildClassifyRequest(batch) });
  return toAnalyses(raw, batch);
}
