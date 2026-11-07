import type { ObjectId } from "mongodb";
import { emails } from "../db.js";
import { setStatus } from "../status.js";
import { classifyBatch } from "./classify.js";
import { geminiKeyForUser, MissingGeminiKeyError } from "./keys.js";

const BATCH_SIZE = 8;
const running = new Set<string>();

/**
 * Silent Background Intelligence: analyzes every not-yet-analyzed email so
 * that when the user asks, the answer is already prepared.
 */
export async function analyzePending(userId: ObjectId): Promise<void> {
  const key = userId.toHexString();
  if (running.has(key)) return;
  running.add(key);
  try {
    let apiKey: string;
    try {
      apiKey = await geminiKeyForUser(userId);
    } catch (err) {
      if (err instanceof MissingGeminiKeyError) {
        const waiting = await emails().countDocuments({ userId, analyzedAt: null, analysisError: null });
        setStatus(userId, {
          state: "needs_key",
          message: `${waiting} emails waiting for AI analysis. Add your Gemini API key.`,
        });
        return;
      }
      throw err;
    }
    for (;;) {
      const pending = await emails()
        .find({ userId, analyzedAt: null, analysisError: null })
        .sort({ date: -1 })
        .limit(BATCH_SIZE)
        .toArray();
      if (pending.length === 0) break;

      const left = await emails().countDocuments({ userId, analyzedAt: null, analysisError: null });
      setStatus(userId, { state: "analyzing", message: `Analysing emails… ${left} left` });

      let results;
      try {
        results = await classifyBatch(
          pending.map((e) => ({
            id: e.gmailId,
            from: `${e.fromName} <${e.fromEmail}>`,
            subject: e.subject,
            date: e.date.toISOString(),
            gmailLabels: e.labelIds,
            body: e.bodyRedacted,
          })),
          apiKey,
        );
      } catch (err) {
        // Leave emails pending; the next scheduler tick retries.
        console.error("Gemini batch failed:", (err as Error).message);
        setStatus(userId, { state: "error", message: `AI analysis paused: ${(err as Error).message.slice(0, 140)}` });
        return;
      }

      const now = new Date();
      await Promise.all(
        pending.map((e) => {
          const a = results.get(e.gmailId);
          return emails().updateOne(
            { _id: e._id },
            a
              ? { $set: { analysis: a, analyzedAt: now, analysisError: null } }
              : { $set: { analysisError: "AI did not return a result for this email" } },
          );
        }),
      );
    }
    setStatus(userId, { state: "idle", message: "" });
  } finally {
    running.delete(key);
  }
}
