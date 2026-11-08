import { createHash } from "node:crypto";
import { ApiError, GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

/**
 * Every call uses the API key of the user it is made for (bring-your-own-key),
 * so one user's usage never costs another user's quota.
 */
const clients = new Map<string, GoogleGenAI>();
const nextSlot = new Map<string, number>();

/** Never use the raw key as a map key or in logs. */
const keyId = (apiKey: string) => createHash("sha256").update(apiKey).digest("hex").slice(0, 16);

function clientFor(apiKey: string): GoogleGenAI {
  const id = keyId(apiKey);
  let c = clients.get(id);
  if (!c) {
    c = new GoogleGenAI({ apiKey });
    clients.set(id, c);
  }
  return c;
}

// Per-key rate limiter: keeps each user inside their own free-tier limits.
async function waitForSlot(apiKey: string): Promise<void> {
  const id = keyId(apiKey);
  const now = Date.now();
  const slot = nextSlot.get(id) ?? 0;
  const wait = Math.max(0, slot - now);
  nextSlot.set(id, Math.max(now, slot) + config.GEMINI_MIN_INTERVAL_MS);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CallOptions {
  apiKey: string;
  system: string;
  prompt: string;
  /** JSON schema for structured output. If omitted, plain text is returned. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
}

async function call({ apiKey, system, prompt, jsonSchema, temperature = 0.2 }: CallOptions): Promise<string> {
  const maxAttempts = 4;
  for (let attempt = 1; ; attempt++) {
    await waitForSlot(apiKey);
    try {
      const res = await clientFor(apiKey).models.generateContent({
        model: config.GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: system,
          temperature,
          ...(jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: jsonSchema } : {}),
        },
      });
      const text = res.text;
      if (!text) throw new Error("Gemini returned an empty response");
      return text;
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const retryable = status === 429 || status >= 500 || status === 0;
      if (!retryable || attempt >= maxAttempts) throw err;
      const backoff = 2000 * 2 ** (attempt - 1) + Math.random() * 1000;
      console.warn(`Gemini call failed (status ${status}), retry ${attempt}/${maxAttempts - 1} in ${Math.round(backoff)}ms`);
      await sleep(backoff);
    }
  }
}

export async function generateJSON<T>(opts: CallOptions & { jsonSchema: Record<string, unknown> }): Promise<T> {
  const text = await call(opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    // Occasionally models wrap JSON in ```json fences — strip and retry parse.
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
  }
}

export async function generateText(opts: Omit<CallOptions, "jsonSchema">): Promise<string> {
  return (await call(opts)).trim();
}

export type KeyCheck = { ok: true; warning?: string } | { ok: false; reason: string };

/** Checks a user's key with one tiny request before we save it. */
export async function validateGeminiKey(apiKey: string): Promise<KeyCheck> {
  // Classic "AIza…" keys and the newer "AQ.…" auth keys (AI Studio default since May 2026).
  if (!/^[A-Za-z0-9._-]{20,400}$/.test(apiKey)) {
    return { ok: false, reason: "That does not look like a Gemini API key. Copy the full key from AI Studio." };
  }
  try {
    await clientFor(apiKey).models.generateContent({
      model: config.GEMINI_MODEL,
      contents: "Reply with the single word OK.",
      config: { maxOutputTokens: 5, temperature: 0 },
    });
    return { ok: true };
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    if (status === 429) return { ok: true, warning: "The key works, but its free quota is used up right now. Analysis will resume automatically." };
    if (status === 400 || status === 401 || status === 403) {
      return { ok: false, reason: "Google rejected this key. Copy it again or create a new key in AI Studio." };
    }
    if (status === 404) return { ok: false, reason: `Model "${config.GEMINI_MODEL}" is not available for this key.` };
    return { ok: false, reason: "Could not check the key right now (network problem). Please try again." };
  }
}
