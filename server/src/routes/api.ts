import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { answerQuestion } from "../ai/ask.js";
import { generateBriefing } from "../ai/briefing.js";
import { requireAuth } from "../auth/session.js";
import { config } from "../config.js";
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
  lang: z.enum(LANGS).default("hinglish"),
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
    res.status(500).json({ error: "Briefing generate nahi ho payi." });
  }
});

const askBody = z.object({
  question: z.string().trim().min(1).max(500),
  lang: z.enum(LANGS).default("hinglish"),
});

apiRouter.post("/ask", requireAuth, aiLimiter, async (req, res) => {
  const b = askBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: "Question khaali hai ya bahut lamba hai." });
    return;
  }
  try {
    res.json(await answerQuestion(req.userId!, b.data.question, b.data.lang));
  } catch (err) {
    console.error("Ask failed:", err);
    res.status(500).json({ error: "Abhi jawab nahi de pa raha, thodi der baad try karo." });
  }
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
