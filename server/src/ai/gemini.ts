import { ApiError, GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

// Simple global rate limiter: keeps us inside free-tier requests-per-minute limits.
let nextSlot = 0;
async function waitForSlot(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + config.GEMINI_MIN_INTERVAL_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CallOptions {
  system: string;
  prompt: string;
  /** JSON schema for structured output. If omitted, plain text is returned. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
}

async function call({ system, prompt, jsonSchema, temperature = 0.2 }: CallOptions): Promise<string> {
  const maxAttempts = 4;
  for (let attempt = 1; ; attempt++) {
    await waitForSlot();
    try {
      const res = await ai.models.generateContent({
        model: config.GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: system,
          temperature,
          ...(jsonSchema
            ? { responseMimeType: "application/json", responseJsonSchema: jsonSchema }
            : {}),
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

export async function generateJSON<T>(opts: Required<Pick<CallOptions, "jsonSchema">> & CallOptions): Promise<T> {
  const text = await call(opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    // Occasionally models wrap JSON in ```json fences — strip and retry parse.
    const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "");
    return JSON.parse(stripped) as T;
  }
}

export async function generateText(opts: Omit<CallOptions, "jsonSchema">): Promise<string> {
  return (await call(opts)).trim();
}
