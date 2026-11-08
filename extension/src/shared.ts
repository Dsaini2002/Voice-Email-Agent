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

/** Never hangs: a lost reply (extension reloaded / background restarted) or a slow call becomes an error. */
export function api<T>(path: string, method: ApiRequest["method"] = "GET", body?: unknown, timeoutMs = 60_000): Promise<ApiResponse<T>> {
  const fail = (error: string) => ({ ok: false, status: 0, error }) as unknown as ApiResponse<T>;
  let timer = 0;
  const timeout = new Promise<ApiResponse<T>>((r) => {
    timer = setTimeout(() => r(fail("Vaani did not answer in time. Please try again.")), timeoutMs) as unknown as number;
  });
  let sent: Promise<ApiResponse<T>>;
  try {
    sent = Promise.resolve(chrome.runtime.sendMessage({ type: "api", path, method, body } satisfies ApiRequest)).then(
      (r) => (r as ApiResponse<T>) ?? fail("No answer from Vaani. Please try again."),
      (e: Error) => fail(/context invalidated/i.test(e?.message ?? "") ? "Vaani was updated. Please refresh this Gmail tab." : "Could not reach Vaani. Refresh the Gmail tab and try again."),
    );
  } catch {
    sent = Promise.resolve(fail("Vaani was updated. Please refresh this Gmail tab."));
  }
  return Promise.race([sent, timeout]).finally(() => clearTimeout(timer));
}
