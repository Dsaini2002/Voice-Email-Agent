/** Messages between the content scripts / popup and the background service worker. */
export type ApiRequest = { type: "api"; method?: "GET" | "POST" | "PUT" | "DELETE"; path: string; body?: unknown };
export type ApiResponse<T = unknown> = { ok: boolean; status: number; data: T; error?: string };

export interface Settings {
  micOn: boolean;
  wakeWord: boolean;
  recLang: "en-IN" | "hi-IN" | "en-US";
}

export const DEFAULT_SETTINGS: Settings = {
  micOn: true,
  wakeWord: true,
  recLang: "en-IN",
};

export async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.local.get(["micOn", "wakeWord", "recLang"]);
  return { ...DEFAULT_SETTINGS, ...(s as Partial<Settings>) };
}

export function api<T>(path: string, method: ApiRequest["method"] = "GET", body?: unknown): Promise<ApiResponse<T>> {
  return chrome.runtime.sendMessage({ type: "api", path, method, body } satisfies ApiRequest);
}
