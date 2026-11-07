import type { AskResponse, Briefing, BriefingMode, GeminiKeyStatus, Lang, Me, SyncStatus } from "../../shared/types";

export class AuthError extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (res.status === 401) throw new AuthError("Not logged in");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error((data as { error?: string }).error || `Request failed (${res.status})`) as Error & { code?: string };
    e.code = (data as { code?: string }).code;
    throw e;
  }
  return data as T;
}

export const api = {
  me: () => req<Me>("/me"),
  status: () => req<SyncStatus>("/status"),
  sync: () => req<{ ok: boolean }>("/sync", { method: "POST" }),
  briefing: (lang: Lang, mode: BriefingMode, hours = 24) =>
    req<Briefing>(`/briefing?lang=${lang}&mode=${mode}&hours=${hours}`),
  ask: (question: string, lang: Lang) =>
    req<AskResponse>("/ask", { method: "POST", body: JSON.stringify({ question, lang }) }),
  geminiKey: () => req<GeminiKeyStatus>("/settings/gemini"),
  saveGeminiKey: (apiKey: string) =>
    req<GeminiKeyStatus & { warning: string | null }>("/settings/gemini", { method: "PUT", body: JSON.stringify({ apiKey }) }),
  deleteGeminiKey: () => req<GeminiKeyStatus>("/settings/gemini", { method: "DELETE" }),
  logout: () => req<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  deleteAccount: () => req<{ ok: boolean }>("/account", { method: "DELETE" }),
};
