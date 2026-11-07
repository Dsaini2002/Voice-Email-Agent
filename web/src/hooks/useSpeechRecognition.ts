import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "../../../shared/types";

// Minimal typings for the Web Speech API (Chrome/Edge expose it as webkitSpeechRecognition).
interface SRResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SREvent {
  resultIndex: number;
  results: ArrayLike<SRResult>;
}
interface SR {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SRCtor = new () => SR;

function getCtor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** hi-IN understands Hindi AND Hinglish speech best; en-IN for English. */
export const RECOGNITION_LANG: Record<Lang, string> = { hinglish: "hi-IN", hi: "hi-IN", en: "en-IN" };

/** "Vaani, ..." / "Hey Vaani ..." in Roman or Devanagari (recognizers spell it many ways). */
export const WAKE_WORD = /^\s*(?:hey|hi|ok|okay|हे|हाय|ओके)?[\s,]*(?:vaani|vani|vaanee|baani|bani|waani|wani|vaniya|वाणी|वानी|वाणि|बानी)\b[\s,.!?।]*/i;

/** Voice "stop" words — work even while the agent is talking (barge-in). */
export const STOP_WORDS = /^\s*(?:vaani[\s,]*)?(stop|ruko|ruk jao|bas|chup|band karo|enough|रुको|रुक जाओ|बस|चुप|स्टॉप|बंद करो)\b/i;

export type MicState = "off" | "starting" | "listening" | "blocked" | "unsupported";

const AWAIT_COMMAND_MS = 8000;
const ECHO_GRACE_MS = 1200;

interface Options {
  lang: Lang;
  enabled: boolean;
  wakeWord: boolean;
  /** True while the agent is speaking: only stop-words are accepted then. */
  agentSpeaking: boolean;
  onCommand: (text: string) => void;
  onStop: () => void;
}

/**
 * Always-on background listening.
 * - Starts automatically, restarts itself when Chrome ends the session.
 * - Pauses when the tab is hidden (privacy + Chrome limits) and resumes when visible.
 * - With wakeWord=true only "Vaani, ..." commands are acted on, so normal
 *   conversation in the room is ignored.
 */
export function useBackgroundListening({ lang, enabled, wakeWord, agentSpeaking, onCommand, onStop }: Options) {
  const supported = getCtor() !== null;
  const [state, setState] = useState<MicState>(supported ? "off" : "unsupported");
  const [caption, setCaption] = useState("");
  const [awaiting, setAwaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SR | null>(null);
  const wantRef = useRef(false);
  const backoffRef = useRef(300);
  const awaitUntil = useRef(0);
  const latest = useRef({ wakeWord, agentSpeaking, onCommand, onStop });
  latest.current = { wakeWord, agentSpeaking, onCommand, onStop };

  // Remember when the agent stopped talking: the mic can still deliver the tail of
  // the agent's own voice for a moment, which must not become a new command.
  const spokeUntil = useRef(0);
  useEffect(() => {
    if (!agentSpeaking) spokeUntil.current = Date.now() + ECHO_GRACE_MS;
  }, [agentSpeaking]);

  const handleFinal = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const { wakeWord: ww, agentSpeaking: talking, onCommand: cmd, onStop: stop } = latest.current;

    if (STOP_WORDS.test(text)) {
      stop();
      return;
    }
    if (talking || Date.now() < spokeUntil.current) return; // ignore the agent's own voice

    const now = Date.now();
    if (!ww || now < awaitUntil.current) {
      awaitUntil.current = 0;
      setAwaiting(false);
      const clean = text.replace(WAKE_WORD, "").trim();
      // Without a wake word, ignore one-word noise like "haan" / "ok".
      if (clean && (ww || clean.split(/\s+/).length >= 2)) cmd(clean);
      return;
    }
    const m = text.match(WAKE_WORD);
    if (!m) return;
    const rest = text.slice(m[0].length).trim();
    if (rest) {
      cmd(rest);
    } else {
      // Only "Vaani" was said — wait a few seconds for the actual question.
      awaitUntil.current = now + AWAIT_COMMAND_MS;
      setAwaiting(true);
      window.setTimeout(() => {
        if (Date.now() >= awaitUntil.current) setAwaiting(false);
      }, AWAIT_COMMAND_MS + 50);
    }
  }, []);

  const startRec = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || !wantRef.current || document.hidden) return;
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = RECOGNITION_LANG[lang];
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setState("listening");
      setError(null);
      backoffRef.current = 300;
    };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) handleFinal(r[0].transcript);
        else interim += r[0].transcript;
      }
      setCaption(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantRef.current = false;
        setState("blocked");
        setError("Mic ki permission nahi mili. Address bar ke 🔒 icon se mic allow karo, phir mic icon dabao.");
      } else if (e.error === "audio-capture") {
        setError("Koi microphone nahi mila.");
      } else if (e.error === "network") {
        setError("Voice ke liye internet chahiye. Dobara try kar raha hoon…");
        backoffRef.current = Math.min(backoffRef.current * 2, 10_000);
      }
      // "no-speech" and "aborted" are normal — onend will restart.
    };
    rec.onend = () => {
      setCaption("");
      if (recRef.current !== rec) return;
      if (wantRef.current && !document.hidden) {
        setState("starting");
        window.setTimeout(startRec, backoffRef.current);
      } else if (wantRef.current) {
        setState("off"); // paused because tab is hidden
      }
    };

    recRef.current = rec;
    setState("starting");
    try {
      rec.start();
    } catch {
      window.setTimeout(startRec, 1000);
    }
  }, [lang, handleFinal]);

  // Start / stop with `enabled` and restart when language changes.
  useEffect(() => {
    if (!supported) return;
    wantRef.current = enabled;
    if (enabled) startRec();
    else {
      const r = recRef.current;
      recRef.current = null;
      r?.abort();
      setState("off");
      setCaption("");
    }
    return () => {
      const r = recRef.current;
      recRef.current = null;
      r?.abort();
    };
  }, [enabled, startRec, supported]);

  // Pause in background tabs, resume when the user comes back.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        const r = recRef.current;
        recRef.current = null;
        r?.abort();
        setState(wantRef.current ? "off" : "off");
      } else if (wantRef.current) {
        startRec();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [startRec]);

  /** Let a manual click retry after the user fixed a blocked permission. */
  const retry = useCallback(() => {
    wantRef.current = true;
    setError(null);
    startRec();
  }, [startRec]);

  return { supported, state, caption, awaiting, error, retry };
}
