import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { GeminiKeyStatus } from "../../../shared/types.js";
import { analyzePending } from "../ai/analyzer.js";
import { answerQuestion } from "../ai/ask.js";
import { validateGeminiKey } from "../ai/gemini.js";
import { MissingGeminiKeyError } from "../ai/keys.js";
import { generateBriefing } from "../ai/briefing.js";
import { requireAuth, requireSession } from "../auth/session.js";
import { config } from "../config.js";
import { encrypt } from "../crypto.js";
import { users } from "../db.js";
import { getSyncStatus, incrementalSync, startInitialSync } from "../gmail/sync.js";

export const apiRouter = Router();

const LANGS = ["hinglish", "hi", "en"] as const;

// AI endpoints cost Gemini quota — limit them per user/IP.
const aiLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

apiRouter.get("/status", requireAuth, async (req, res) => {
  res.json(await getSyncStatus(req.userId!));
});

apiRouter.post("/sync", requireAuth, rateLimit({ windowMs: 60_000, limit: 4 }), async (req, res) => {
  const user = await users().findOne({ _id: req.userId }, { projection: { historyId: 1 } });
  void (user?.historyId ? incrementalSync(req.userId!) : startInitialSync(req.userId!));
  res.json({ ok: true });
});

const briefingQuery = z.object({
  lang: z.enum(LANGS).default("en"),
  mode: z.enum(["short", "detailed"]).default("short"),
  hours: z.coerce.number().min(1).max(24 * 7).default(24),
});

apiRouter.get("/briefing", requireAuth, aiLimiter, async (req, res) => {
  const q = briefingQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  try {
    res.json(await generateBriefing(req.userId!, q.data.lang, q.data.mode, q.data.hours));
  } catch (err) {
    console.error("Briefing failed:", err);
    res.status(500).json({ error: "Could not generate the briefing." });
  }
});

const askBody = z.object({
  question: z.string().trim().min(1).max(500),
  lang: z.enum(LANGS).default("en"),
});

apiRouter.post("/ask", requireAuth, aiLimiter, async (req, res) => {
  const b = askBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: "The question is empty or too long." });
    return;
  }
  try {
    res.json(await answerQuestion(req.userId!, b.data.question, b.data.lang));
  } catch (err) {
    if (err instanceof MissingGeminiKeyError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    console.error("Ask failed:", err);
    res.status(500).json({ error: "Could not answer right now. Please try again shortly." });
  }
});

// ---------- Bring-your-own Gemini key ----------

async function keyStatus(userId: import("mongodb").ObjectId): Promise<GeminiKeyStatus> {
  const u = await users().findOne({ _id: userId }, { projection: { encGeminiKey: 1, geminiKeyLast4: 1 } });
  return {
    hasKey: Boolean(u?.encGeminiKey),
    last4: u?.geminiKeyLast4 ?? null,
    serverKeyAllowed: config.ALLOW_SERVER_GEMINI_KEY,
  };
}

apiRouter.get("/settings/gemini", requireAuth, async (req, res) => {
  res.json(await keyStatus(req.userId!));
});

const keyBody = z.object({ apiKey: z.string().trim().min(1).max(400) });
// Strict limit: stops anyone using this endpoint to test stolen keys.
const keyLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

apiRouter.put("/settings/gemini", requireSession, keyLimiter, async (req, res) => {
  const b = keyBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: "The API key is empty." });
    return;
  }
  const check = await validateGeminiKey(b.data.apiKey);
  if (!check.ok) {
    res.status(400).json({ error: check.reason });
    return;
  }
  await users().updateOne(
    { _id: req.userId },
    {
      $set: {
        encGeminiKey: encrypt(b.data.apiKey, config.ENCRYPTION_KEY),
        geminiKeyLast4: b.data.apiKey.slice(-4),
        updatedAt: new Date(),
      },
    },
  );
  // Start analysing emails that were waiting for a key.
  void analyzePending(req.userId!);
  res.json({ ...(await keyStatus(req.userId!)), warning: check.warning ?? null });
});

apiRouter.delete("/settings/gemini", requireSession, async (req, res) => {
  await users().updateOne({ _id: req.userId }, { $set: { encGeminiKey: null, geminiKeyLast4: null } });
  res.json(await keyStatus(req.userId!));
});

/**
 * Gmail push endpoint (SYNC_MODE=pubsub). Pub/Sub POSTs here when a user's inbox changes.
 * Configure the push subscription URL as: https://<your-domain>/api/gmail/push?token=<PUBSUB_VERIFICATION_TOKEN>
 */
apiRouter.post("/gmail/push", async (req, res) => {
  if (config.SYNC_MODE !== "pubsub" || req.query.token !== config.PUBSUB_VERIFICATION_TOKEN) {
    res.status(403).end();
    return;
  }
  // Acknowledge immediately so Pub/Sub doesn't retry; process in background.
  res.status(204).end();
  try {
    const data = req.body?.message?.data;
    if (typeof data !== "string") return;
    const { emailAddress } = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as { emailAddress?: string };
    if (!emailAddress) return;
    const user = await users().findOne({ email: emailAddress.toLowerCase() }, { projection: { _id: 1 } });
    if (user) void incrementalSync(user._id);
  } catch (err) {
    console.warn("Bad Pub/Sub push payload:", (err as Error).message);
  }
});
