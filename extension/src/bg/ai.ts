/**
 * Gemini calls made directly from the extension with the USER'S OWN key.
 * Prompts, schemas and Truth Verification are shared with the server code.
 */
import { buildAskRequest, toAskResponse } from "../../../server/src/ai/askCore";
import { buildAssistRequest, toAssistResult, type AssistResult } from "../../../server/src/ai/assistCore";
import { buildClassifyRequest, toAnalyses, type EmailForAI } from "../../../server/src/ai/classifyCore";
import { buildSections, type AnalyzedEmail } from "../../../server/src/intel/briefingBuilder";
import type { AskResponse, Briefing, BriefingItem, BriefingMode, Category, Lang } from "../../../shared/types";
import { GEMINI_API, GEMINI_FALLBACK_MODELS, GEMINI_MIN_INTERVAL_MS, GEMINI_MODEL } from "./env";
import { db, type EmailRec } from "./store";

export class GeminiError extends Error {
  constructor(public status: number, message: string, public retryAfterMs = 0, public daily = false) {
    super(message);
  }
}

/** "Quota" errors from Google: per-minute limits clear quickly, per-day limits don't. */
export function quotaInfo(body: unknown): { retryAfterMs: number; daily: boolean } {
  const details = ((body as { error?: { details?: unknown[] } })?.error?.details ?? []) as Record<string, unknown>[];
  let retryAfterMs = 0;
  let daily = false;
  for (const d of details) {
    const delay = typeof d.retryDelay === "string" ? parseFloat(d.retryDelay) : NaN;
    if (!isNaN(delay)) retryAfterMs = Math.round(delay * 1000);
    const v = JSON.stringify(d.violations ?? "");
    if (/PerDay/i.test(v)) daily = true;
  }
  return { retryAfterMs, daily };
}

/** Friendly words instead of Google's long error text. */
export function friendlyGeminiError(err: unknown): string {
  const e = err as GeminiError;
  if (e?.status === 429) return "Your free Gemini AI limit is used up for now. I'll continue automatically later.";
  if (e?.status === 401 || e?.status === 403) return "Google didn't accept your Gemini key. Please add a new key in setup.";
  if (e?.status === 0) return "I couldn't reach Google AI. Please check your internet.";
  return "The AI had a hiccup. I'll try again in a moment.";
}

/** Models that ran out of free quota today → skipped until this time. */
const modelBlockedUntil = new Map<string, number>();
const modelsToTry = () => [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS].filter((m) => (modelBlockedUntil.get(m) ?? 0) < Date.now());

let nextSlot = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CallOpts {
  system: string;
  prompt: string;
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

async function rawCall(apiKey: string, o: CallOpts, useSchema = true, timeoutMs = 90_000, model = GEMINI_MODEL): Promise<string> {
  const generationConfig: Record<string, unknown> = { temperature: o.temperature ?? 0.2 };
  if (o.maxOutputTokens) generationConfig.maxOutputTokens = o.maxOutputTokens;
  if (o.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    if (useSchema) generationConfig.responseJsonSchema = o.jsonSchema;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const res = await fetch(`${GEMINI_API}/models/${model}:generateContent`, {
    method: "POST",
    signal: ctl.signal,
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: o.system }] },
      contents: [{ role: "user", parts: [{ text: o.prompt }] }],
      generationConfig,
    }),
  }).catch((e: Error) => {
    throw new GeminiError(0, e.name === "AbortError" ? "Gemini took too long to answer" : "Network error");
  }).finally(() => clearTimeout(timer));
  const body = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    const q = res.status === 429 ? quotaInfo(body) : { retryAfterMs: 0, daily: false };
    throw new GeminiError(res.status, body.error?.message ?? `Gemini error ${res.status}`, q.retryAfterMs, q.daily);
  }
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new GeminiError(502, "Gemini returned an empty response");
  return text;
}

/**
 * Rate-limited, retried Gemini call. When a model's free quota for the day is used up,
 * the next model (with its own free quota) is tried automatically.
 */
async function call(apiKey: string, o: CallOpts, interactive = false): Promise<string> {
  let lastErr: unknown = new GeminiError(429, "quota");
  // You're waiting for an answer: skip the background queue and use the fastest model first.
  const models = interactive ? [...modelsToTry().filter((m) => m !== GEMINI_MODEL), ...modelsToTry().filter((m) => m === GEMINI_MODEL)] : modelsToTry();
  for (const model of models) {
    for (let attempt = 1; ; attempt++) {
      if (!interactive) {
        const wait = Math.max(0, nextSlot - Date.now());
        nextSlot = Math.max(Date.now(), nextSlot) + GEMINI_MIN_INTERVAL_MS;
        if (wait) await sleep(wait);
      }
      try {
        return await rawCall(apiKey, o, true, interactive ? 25_000 : 90_000, model);
      } catch (err) {
        lastErr = err;
        const e = err instanceof GeminiError ? err : null;
        const status = e?.status ?? 0;
        // Older API versions may not know responseJsonSchema — retry once without it.
        if (status === 400 && /responseJsonSchema|response_json_schema/i.test((err as Error).message)) return rawCall(apiKey, o, false, 90_000, model);
        if (status === 404) break; // model not available for this key → next model
        if (status === 429 && (e!.daily || attempt >= 2)) {
          modelBlockedUntil.set(model, Date.now() + (e!.daily ? 6 * 3600_000 : Math.max(e!.retryAfterMs, 60_000)));
          break; // try the next model
        }
        if (interactive && attempt >= 2) break; // don't make you wait: try the next model
        if (!(status === 429 || status >= 500 || status === 0) || attempt >= 4) throw err;
        await sleep(status === 429 && e!.retryAfterMs ? Math.min(e!.retryAfterMs, 60_000) : 2000 * 2 ** (attempt - 1));
      }
    }
  }
  throw lastErr;
}

/** One structured Gemini call (used by Phase 2 replies). */
export async function callGemini<T>(apiKey: string, req: CallOpts): Promise<T> {
  return parseJSON<T>(await call(apiKey, req, true));
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
    await rawCall(apiKey, { system: "Reply with OK.", prompt: "Say OK.", temperature: 0 }, true, 25_000);
    return { ok: true, message: "Key saved. Analysing your emails now." };
  } catch (err) {
    const s = err instanceof GeminiError ? err.status : 0;
    const msg = err instanceof Error ? err.message : "";
    if (s === 429) return { ok: true, message: "Key saved. Its free quota is busy right now; analysis will continue automatically." };
    if (s === 400 || s === 401 || s === 403) return { ok: false, message: `Google rejected this key (${msg.slice(0, 90)}). Copy it again or create a new one in AI Studio.` };
    // Google answered but with no text (e.g. only "thinking") — the key itself works.
    if (s === 502 && /empty response/i.test(msg)) return { ok: true, message: "Key saved. Analysing your emails now." };
    // Slow network / Google busy: keep the key; analysis retries by itself and shows any error.
    return { ok: true, message: "Key saved. Google is slow right now, so analysis may take a little longer." };
  }
}

// ---------------- analysis ----------------
// Fewer, bigger requests: free Gemini limits count requests, not emails.
const BATCH = 15;

/** Gmail already knows these are promotions/social: no need to spend AI quota on them. */
const LOCAL_LABELS: [string, Category][] = [
  ["CATEGORY_PROMOTIONS", "promotion"],
  ["CATEGORY_SOCIAL", "social"],
  ["CATEGORY_FORUMS", "newsletter"],
];
export function localAnalysis(e: Pick<EmailRec, "labelIds" | "fromName" | "fromEmail" | "subject">): EmailRec["analysis"] {
  const hit = LOCAL_LABELS.find(([l]) => e.labelIds.includes(l));
  if (!hit) return null;
  const entity = (e.fromName || e.fromEmail.split("@")[0] || "Unknown").slice(0, 40);
  return {
    category: hit[1], status: "none", priority: "low", entity, groupKey: `${entity.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:promo`,
    summary: e.subject.slice(0, 120), actionRequired: false, actionText: "", deadline: "", isScam: false, scamReason: "",
    evidence: "", confidence: 0.6, verified: true,
    intent: hit[1] === "promotion" ? "promotion" : hit[1] === "social" ? "social" : "newsletter", ask: "", tags: [], needsReply: false, fromPerson: false,
  };
}

/** Old-email import: classify one batch of history-only emails (same prompt, same Truth Verification). */
export async function classifyBatch(batch: EmailForAI[]) {
  const apiKey = await db.get("geminiKey");
  if (!apiKey) throw new GeminiError(400, "NEEDS_GEMINI_KEY");
  return toAnalyses(parseJSON(await call(apiKey, buildClassifyRequest(batch))), batch);
}

/** Set by the background script: called with freshly analysed emails (for alerts). */
let analysedHook: (recs: EmailRec[]) => void = () => {};
export const onAnalysed = (fn: (recs: EmailRec[]) => void) => (analysedHook = fn);
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
  const sync = await db.sync();
  if (sync.pausedUntil && Date.parse(sync.pausedUntil) > Date.now()) return; // free limit used up: wait quietly
  analysing = true;
  try {
    // 1) Promotions / social: classify locally, no AI call.
    const now0 = new Date().toISOString();
    await db.updateEmails((m) => {
      for (const rec of Object.values(m)) {
        if (rec.analyzedAt || rec.analysisError) continue;
        const a = localAnalysis(rec);
        if (a) Object.assign(rec, { analysis: a, analyzedAt: now0 });
      }
    });
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
        const quota = err instanceof GeminiError && err.status === 429;
        await db.patchSync({
          state: quota ? "quota" : "error",
          message: friendlyGeminiError(err),
          pausedUntil: new Date(Date.now() + (quota ? 30 * 60_000 : 2 * 60_000)).toISOString(),
        });
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
      const fresh = await db.emails();
      analysedHook(batch.map((b) => fresh[b.id]).filter((r) => r?.analysis));
    }
    await db.patchSync({ state: "idle", message: "", pausedUntil: null });
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
  // Emails the AI hasn't read yet (e.g. free limit used up): still show them, plainly, so the briefing is never empty.
  const since = Date.now() - hours * 3600_000;
  const basic: BriefingItem[] = recs
    .filter((e) => !e.analysis && new Date(e.date).getTime() >= since && !e.labelIds.some((l) => LOCAL_LABELS.some(([x]) => x === l)))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10)
    .map((e) => ({
      gmailId: e.gmailId, threadId: e.threadId, entity: (e.fromName || e.fromEmail).slice(0, 40), subject: e.subject,
      summary: e.subject, date: e.date, status: "none", category: "other", priority: "medium", deadline: "", actionText: "",
      confidence: 0, verified: true, mergedCount: 1, gmailUrl: "", basic: true,
    }));
  if (basic.length) {
    sections.push({ key: "other_important", title: "Not analysed yet", items: basic });
    stats.shownEmails += basic.length;
  }
  return { generatedAt: new Date().toISOString(), windowHours: hours, lang, mode, speech: "", sections, stats };
}

/** Understands any sentence: chat, a question about the emails, or a Gmail action (validated). */
export async function assist(said: string, assistantName = "Vaani", focusId = ""): Promise<AssistResult & { refs: BriefingItem[] }> {
  const apiKey = await db.get("geminiKey");
  if (!apiKey) throw new GeminiError(400, "NEEDS_GEMINI_KEY");
  const account = await db.get("account");
  const list = analyzed(Object.values(await db.emails()), 7 * 24);
  const todayLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const f = focusId ? (await db.emails())[focusId] : undefined;
  const onScreen = f?.analysis ? { subject: f.subject, entity: f.analysis.entity, summary: f.analysis.summary, date: f.date.slice(0, 10), deadline: f.analysis.deadline } : undefined;
  const raw = parseJSON<Record<string, unknown>>(await call(apiKey, buildAssistRequest((account?.name ?? "").split(" ")[0], said, list, todayLabel, assistantName, onScreen), true));
  const res = toAssistResult(raw, list);
  const refs = res.kind === "answer" ? toAskResponse({ answer: res.reply, refIds: res.refIds }, list, account?.email ?? "").refs : [];
  return { ...res, refs };
}

export async function ask(question: string, lang: Lang = "en"): Promise<AskResponse> {
  const apiKey = await db.get("geminiKey");
  if (!apiKey) throw new GeminiError(400, "NEEDS_GEMINI_KEY");
  const account = await db.get("account");
  const list = analyzed(Object.values(await db.emails()), 7 * 24);
  const todayLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const req = buildAskRequest((account?.name ?? "there").split(" ")[0], question, lang, list, todayLabel);
  const res = parseJSON<{ answer?: string; refIds?: string[] }>(await call(apiKey, req, true));
  return toAskResponse(res, list, account?.email ?? "");
}
