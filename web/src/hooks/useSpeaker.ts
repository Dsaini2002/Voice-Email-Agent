import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "../../../shared/types";

/**
 * Text-to-speech with the browser's built-in voices.
 * - Hinglish (Roman script) sounds most natural with an Indian-English voice.
 * - Hindi (Devanagari) uses a Hindi voice.
 * Long text is split into sentences because Chrome stops long utterances (~15s).
 */
const VOICE_PREF: Record<Lang, string[]> = {
  hinglish: ["en-IN", "hi-IN", "en-GB", "en-US"],
  hi: ["hi-IN", "en-IN"],
  en: ["en-IN", "en-GB", "en-US"],
};

function pickVoice(voices: SpeechSynthesisVoice[], lang: Lang): SpeechSynthesisVoice | undefined {
  for (const code of VOICE_PREF[lang]) {
    const matches = voices.filter((v) => v.lang.replace("_", "-").toLowerCase() === code.toLowerCase());
    // Prefer natural/online voices (Google / Microsoft "Online (Natural)").
    const best = matches.find((v) => /google|natural|online/i.test(v.name)) ?? matches[0];
    if (best) return best;
  }
  return undefined;
}

export function splitSentences(text: string): string[] {
  return (
    text
      .replace(/\s+/g, " ")
      .match(/[^.!?।]+[.!?।]*/g)
      ?.map((s) => s.trim())
      .filter(Boolean) ?? []
  );
}

export function useSpeaker(lang: Lang) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    tokenRef.current++;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;
      stop();
      const token = ++tokenRef.current;
      const voice = pickVoice(voices, lang);
      const parts = splitSentences(text);
      setSpeaking(true);
      parts.forEach((part, i) => {
        const u = new SpeechSynthesisUtterance(part);
        if (voice) u.voice = voice;
        u.lang = voice?.lang ?? (lang === "en" ? "en-IN" : "hi-IN");
        u.rate = 1.02;
        if (i === parts.length - 1) {
          u.onend = () => token === tokenRef.current && setSpeaking(false);
        }
        u.onerror = () => token === tokenRef.current && setSpeaking(false);
        window.speechSynthesis.speak(u);
      });
    },
    [supported, voices, lang, stop],
  );

  useEffect(() => stop, [stop]);

  return { supported, speaking, speak, stop };
}
