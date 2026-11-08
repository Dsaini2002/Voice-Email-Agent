/**
 * Gemini calls made directly from the extension with the USER'S OWN key.
 * Prompts, schemas and Truth Verification are shared with the server code.
 */
import { buildAskRequest, toAskResponse } from "../../../server/src/ai/askCore";
import { buildClassifyRequest, toAnalyses, type EmailForAI } from "../../../server/src/ai/classifyCore";
import { buildSections, type AnalyzedEmail } from "../../../server/src/intel/briefingBuilder";
import type { AskResponse, Briefing, BriefingMode, Lang } from "../../../shared/types";
import { GEMINI_API, GEMINI_MIN_INTERVAL_MS, GEMINI_MODEL } from "./env";
import { db, type EmailRec } from "./store";

export class GeminiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let nextSlot = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CallOpts {
  system: string;
  prompt: string;
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

async function rawCall(apiKey: string, o: CallOpts, useSchema = true): Promise<string> {
  const generationConfig: Record<string, unknown> = { temperature: o.temperature ?? 0.2 };
  if (o.maxOutputTokens) generationConfig.maxOutputTokens = o.maxOutputTokens;
  if (o.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    if (useSchema) generationConfig.responseJsonSchema = o.jsonSchema;
  }
  const res = await fetch(`${GEMINI_API}/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: o.system }] },
      contents: [{ role: "user", parts: [{ text: o.prompt }] }],
      generationConfig,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new GeminiError(res.status, body.error?.message ?? `Gemini error ${res.status}`);
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new GeminiError(502, "Gemini returned an empty response");
  return text;
}

/** Rate-limited, retried Gemini call. */
async function call(apiKey: string, o: CallOpts): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const wait = Math.max(0, nextSlot - Date.now());
    nextSlot = Math.max(Date.now(), nextSlot) + GEMINI_MIN_INTERVAL_MS;
    if (wait) await sleep(wait);
    try {
      return await rawCall(apiKey, o);
    } catch (err) {
      const status = err instanceof GeminiError ? err.status : 0;
      // Older API versions may not know responseJsonSchema — retry once without it.
      if (status === 400 && /responseJsonSchema|response_json_schema/i.test((err as Error).message)) return rawCall(apiKey, o, false);
      if (!(status === 429 || status >= 500 || status === 0) || attempt >= 4) throw err;
      await sleep(2000 * 2 ** (attempt - 1));
    }
  }
}

function parseJSON<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
  }
}

/**
 * Gemini keys: classic "AIza…" keys and the newer "auth keys" that start with "AQ."
 * (default in AI Studio since May 2026) — both are sent in the x-goog-api-key header.
 */
export function looksLikeGeminiKey(k: string): boolean {
  return /^[A-Za-z0-9._-]{20,400}$/.test(k);
}

export async function validateKey(rawKey: string): Promise<{ ok: boolean; message: string }> {
  const apiKey = rawKey.trim();
  if (!looksLikeGeminiKey(apiKey)) return { ok: false, message: "That does not look like a Gemini API key. Use \"Copy key\" in AI Studio and paste the whole key (it starts with AIza or AQ.)." };
  try {
    await rawCall(apiKey, { system: "Reply with OK.", prompt: "Say OK.", maxOutputTokens: 5, temperature: 0 });
    return { ok: true, message: "Key saved. Analysing your emails now." };
  } catch (err) {
    const s = err instanceof GeminiError ? err.status : 0;
    if (s === 429) return { ok: true, message: "Key saved. Its free quota is busy right now; analysis will continue automatically." };
    if (s === 400 || s === 401 || s === 403) return { ok: false, message: "Google rejected this key. Copy it again or create a new one in AI Studio." };
    return { ok: false, message: "Could not check the key right now (network). Please try again." };
  }
}

// ---------------- analysis ----------------
const BATCH = 8;
let analysing = false;

export async function analyzePending(): Promise<void> {
  if (analysing) return;
  const apiKey = await db.get("geminiKey");
  const pendingCount = Object.values(await db.emails()).filter((e) => !e.analyzedAt && !e.analysisError).length;
  if (!pendingCount) return;
  if (!apiKey) {
    await db.patchSync({ state: "needs_key", message: `${pendingCount} emails waiting. Add your Gemini API key.` });
    return;
  }
  analysing = true;
  try {
    for (;;) {
      const all = Object.values(await db.emails());
      const pending = all.filter((e) => !e.analyzedAt && !e.analysisError).sort((a, b) => b.date.localeCompare(a.date));
      if (!pending.length) break;
      await db.patchSync({ state: "analyzing", message: `Analysing emails… ${pending.length} left` });
      const batch: EmailForAI[] = pending.slice(0, BATCH).map((e) => ({
        id: e.gmailId,
        from: `${e.fromName} <${e.fromEmail}>`,
        subject: e.subject,
        date: e.date,
        gmailLabels: e.labelIds,
        body: e.body,
      }));
      const req = buildClassifyRequest(batch);
      let results;
      try {
        results = toAnalyses(parseJSON(await call(apiKey, req)), batch);
      } catch (err) {
        await db.patchSync({ state: "error", message: `AI analysis paused: ${(err as Error).message.slice(0, 120)}` });
        return;
      }
      const now = new Date().toISOString();
      await db.updateEmails((m) => {
        for (const b of batch) {
          const rec = m[b.id];
          if (!rec) continue;
          const a = results.get(b.id);
          if (a) Object.assign(rec, { analysis: a, analyzedAt: now, analysisError: null });
          else rec.analysisError = "No AI result";
        }
      });
    }
    await db.patchSync({ state: "idle", message: "" });
  } finally {
    analysing = false;
  }
}

// ---------------- briefing & questions ----------------
function analyzed(recs: EmailRec[], hours: number): AnalyzedEmail[] {
  const since = Date.now() - hours * 3600_000;
  return recs
    .filter((e) => e.analysis && new Date(e.date).getTime() >= since)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => ({ gmailId: e.gmailId, threadId: e.threadId, subject: e.subject, date: new Date(e.date), analysis: e.analysis! }));
}

export async function briefing(hours: number, lang: Lang = "en", mode: BriefingMode = "short"): Promise<Briefing> {
  const account = await db.get("account");
  const recs = Object.values(await db.emails());
  const list = analyzed(recs, Math.max(hours, 7 * 24));
  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  const { sections, stats } = buildSections(list, lang, account?.email ?? "", {
    windowStart: new Date(Date.now() - hours * 3600_000),
    today,
  });
  return { generatedAt: new Date().toISOString(), windowHours: hours, lang, mode, speech: "", sections, stats };
}

export async function ask(question: string, lang: Lang = "en"): Promise<AskResponse> {
  const apiKey = await db.get("geminiKey");
  if (!apiKey) throw new GeminiError(400, "NEEDS_GEMINI_KEY");
  const account = await db.get("account");
  const list = analyzed(Object.values(await db.emails()), 7 * 24);
  const todayLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const req = buildAskRequest((account?.name ?? "there").split(" ")[0], question, lang, list, todayLabel);
  const res = parseJSON<{ answer?: string; refIds?: string[] }>(await call(apiKey, req));
  return toAskResponse(res, list, account?.email ?? "");
}
