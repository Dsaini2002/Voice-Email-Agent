import type { ObjectId } from "mongodb";
import { config } from "../config.js";
import { decrypt } from "../crypto.js";
import { users } from "../db.js";

export class MissingGeminiKeyError extends Error {
  readonly code = "NEEDS_GEMINI_KEY";
  constructor() {
    super("Add your Gemini API key from the dashboard (account menu → Gemini API key).");
  }
}

/**
 * Returns the Gemini key to use for this user:
 * 1. the user's own key (always preferred), else
 * 2. the server key — ONLY if the owner set ALLOW_SERVER_GEMINI_KEY=true.
 */
export async function geminiKeyForUser(userId: ObjectId): Promise<string> {
  const u = await users().findOne({ _id: userId }, { projection: { encGeminiKey: 1 } });
  if (u?.encGeminiKey) return decrypt(u.encGeminiKey, config.ENCRYPTION_KEY);
  if (config.ALLOW_SERVER_GEMINI_KEY && config.GEMINI_API_KEY) return config.GEMINI_API_KEY;
  throw new MissingGeminiKeyError();
}
