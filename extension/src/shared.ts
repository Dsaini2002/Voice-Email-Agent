/** Messages between the content scripts / popup and the background service worker. */
export type ApiRequest = { type: "api"; method?: "GET" | "POST" | "PUT" | "DELETE"; path: string; body?: unknown };
export type ApiResponse<T = unknown> = { ok: boolean; status: number; data: T; error?: string };

export interface Settings {
  micOn: boolean;
  wakeWord: boolean;
  recLang: "en-IN" | "hi-IN" | "en-US";
  /** Vaani's speaking voice, chosen by the user ("" = pick a good one automatically). */
  voiceName: string;
  voiceRate: number;
  voicePitch: number;
  /** The name the user gave their assistant ("" = not chosen yet → it asks). */
  assistantName: string;
  /** What you mostly use email for — decides which boxes come first ("job", "study", "work", "business", "personal"). */
  useFor: string[];
  /** Show what the assistant says as live subtitles (word by word). */
  subtitles: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  micOn: true,
  wakeWord: true,
  recLang: "en-IN",
  voiceName: "",
  voiceRate: 1.15, // a little quicker than default: feels more natural for short answers
  voicePitch: 1,
  assistantName: "",
  useFor: [],
  subtitles: true,
};

export const VOICE_SAMPLE = "Hi! I'm Vaani. This is how I'll sound when I read your emails.";

/** Voices worth offering: English and Hindi, best-sounding (online / natural) first. */
export function usefulVoices(all: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const ok = all.filter((v) => /^(en|hi)([-_]|$)/i.test(v.lang));
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|online|neural/i.test(v.name) ? 0 : /google/i.test(v.name) ? 1 : 2) * 10 + (/IN$/i.test(v.lang) ? 0 : /hi/i.test(v.lang) ? 1 : 2);
  return [...ok].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

/** Short, friendly label for a voice: "Microsoft Neerja Online (Natural) - English (India)" → "Neerja · English (India)". */
export function voiceLabel(v: SpeechSynthesisVoice): string {
  const name = v.name.replace(/^(Microsoft|Google)\s+/i, "").replace(/\s*\((Natural|Online)[^)]*\)/gi, "").split(" - ")[0].replace(/\s+Online$/i, "").trim();
  let lang = v.lang;
  try {
    const [l, r] = v.lang.split(/[-_]/);
    lang = `${new Intl.DisplayNames(["en"], { type: "language" }).of(l)}${r ? ` (${new Intl.DisplayNames(["en"], { type: "region" }).of(r.toUpperCase())})` : ""}`;
  } catch { /* keep code */ }
  const tag = /natural|online|neural/i.test(v.name) ? " · natural" : "";
  return `${name} · ${lang}${tag}`;
}

export const displayName = (s: Pick<Settings, "assistantName">) => s.assistantName || "Vaani";

export async function getSettings(): Promise<Settings> {
  // read EVERY setting (name, voice, speed, "use email for"…), not just the first few
  const s = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
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
