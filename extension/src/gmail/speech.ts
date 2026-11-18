/**
 * Always-on background listening + text-to-speech for the Gmail overlay.
 * - Restarts itself when Chrome ends a recognition session.
 * - Pauses while the Gmail tab is hidden.
 * - With the wake word on, only "Vaani, …" commands are used.
 * - While the agent speaks, only stop words are accepted (and its own voice is ignored).
 */

interface SRResult { isFinal: boolean; length?: number; [i: number]: { transcript: string } }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SR {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: SREvent) => void) | null; onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null; onstart: (() => void) | null;
}
type SRCtor = new () => SR;

export type MicState = "off" | "starting" | "listening" | "blocked" | "unsupported" | "unavailable";

export const IS_EDGE = /\bEdg\//.test(navigator.userAgent);

import { matchWake } from "./wake";

/** Stop words anywhere in a short phrase: "stop", "Nova stop", "arre ruko", "bas karo", "chup ho jao". */
export const STOP_ANY = /\b(stop|pause|be quiet|enough|shut up|ruko|ruk jao|bas karo|bas|chup|chup ho jao|रुको|बस|चुप|स्टॉप)\b(?!.*\b(alerts?|watching|notifications?|dictation|subtitles?|captions?)\b)/i;
export const isStopPhrase = (t: string) => t.trim().split(/\s+/).length <= 4 && STOP_ANY.test(t);
/** "stop", "Nova stop", "ruko"… (any name in front is fine) */
export const STOP = /^\s*(?:\S+[\s,]+)?(stop|pause|be quiet|enough|ruko|ruk jao|bas|chup|रुको|बस|चुप|स्टॉप)\b(?!.*\b(alerts?|watching|notifications?|subtitles?|captions?)\b)/i;

declare const __TEST__: boolean;

/**
 * Test builds only: a fake microphone that behaves like Chrome's (sessions end every few
 * seconds and restart) and "hears" whatever the test sends in a "vaani-hear" event.
 */
let fakeActive: { push(text: string, final: boolean): void } | null = null;
const fakeQueue: [string, boolean][] = [];
function fakeMic(): SRCtor {
  if (!(window as unknown as { __vaaniFakeHooked?: boolean }).__vaaniFakeHooked) {
    (window as unknown as { __vaaniFakeHooked?: boolean }).__vaaniFakeHooked = true;
    // Test speech arriving between two sessions is delivered to the next one (keeps tests deterministic).
    const deliver = (final: boolean) => (e: Event) => {
      const text = String((e as CustomEvent).detail);
      if (fakeActive) fakeActive.push(text, final);
      else fakeQueue.push([text, final]);
    };
    document.addEventListener("vaani-hear", deliver(true));
    document.addEventListener("vaani-interim", deliver(false));
  }
  return class implements SR {
    lang = ""; continuous = true; interimResults = true; maxAlternatives = 1;
    onresult: SR["onresult"] = null; onerror: SR["onerror"] = null; onend: SR["onend"] = null; onstart: SR["onstart"] = null;
    private t = 0;
    private list: SRResult[] = [];
    push(text: string, final: boolean) {
      const last = this.list[this.list.length - 1];
      const at = last && !last.isFinal ? this.list.length - 1 : this.list.length;
      this.list[at] = { isFinal: final, 0: { transcript: text } };
      this.onresult?.({ resultIndex: at, results: this.list });
    }
    start() {
      if (document.documentElement.dataset.vaaniFakeMicFail) {
        // behave like Edge's failing speech service
        window.setTimeout(() => this.finish("network"), 40);
        return;
      }
      window.setTimeout(() => {
        this.onstart?.();
        fakeActive = this;
        while (fakeQueue.length) { const [t, f] = fakeQueue.shift()!; this.push(t, f); }
      }, 20);
      this.t = window.setTimeout(() => this.finish("no-speech"), 3000); // Chrome ends idle sessions like this
    }
    private finish(err?: string) {
      if (fakeActive === this) fakeActive = null;
      window.clearTimeout(this.t);
      if (err) this.onerror?.({ error: err });
      this.onend?.();
    }
    stop() { this.finish(); }
    abort() { if (fakeActive === this) fakeActive = null; window.clearTimeout(this.t); }
  };
}

const getCtor = (): SRCtor | null => {
  if (typeof __TEST__ !== "undefined" && __TEST__ && document.documentElement.dataset.vaaniFakeMic) return fakeMic();
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const wordsOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0900-\u097f\s]/g, " ").split(/\s+/).filter(Boolean);
/** Words sound alike enough (the speaker → microphone path changes them a little: "summary" ≈ "sammary"). */
function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  let diff = 0;
  for (let i = 0, j = 0; i < a.length && j < b.length; i++, j++) {
    if (a[i] === b[j]) continue;
    if (++diff > 1) return false;
    if (a.length > b.length) j--;
    else if (b.length > a.length) i--;
  }
  return true;
}
/** Share of the heard words that also occur (or nearly occur) in what the assistant said. */
export function echoShare(heard: string, said: string): number {
  const h = wordsOf(heard);
  if (!h.length) return 1;
  const s = wordsOf(said);
  if (!s.length) return 0;
  if (h.length === 1) return s.some((x) => similar(h[0], x)) ? 1 : 0;
  // An echo is a stretch of what it said, in the same order — so compare word PAIRS, not loose words
  // (otherwise "open inbox" would look like an echo of "…3 new emails in your inbox").
  let hit = 0;
  for (let k = 0; k + 1 < h.length; k++) {
    for (let i = 0; i + 1 < s.length; i++) {
      if (similar(h[k], s[i]) && similar(h[k + 1], s[i + 1])) { hit++; break; }
    }
  }
  return hit / (h.length - 1);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, " ").trim();

export class Listener {
  state: MicState = getCtor() ? "off" : "unsupported";
  caption = "";
  awaiting = false;
  error: string | null = null;
  enabled = false;
  wakeWord = true;
  /** The assistant's name = the wake word. */
  name = "Vaani";
  lang = "en-IN";
  agentSpeaking = () => false;
  /** What Vaani is saying (or just said) — used to recognise its own voice coming back through the mic. */
  agentText = () => "";
  /** Return true if a half-finished sentence is already a complete, clear command (act without waiting). */
  quickOk = (_text: string) => false;
  /** You started talking while the assistant was speaking: it goes quiet at once and listens. */
  onBargeIn = () => {};
  private stoppedAt = 0;
  /** Called when only the name was said ("Nova?") — the assistant answers and waits. */
  onAwake = () => {};
  private fails = 0;
  private handled = "";
  private handledAt = 0;
  private quickTimer = 0;
  /**
   * People pause while they speak ("Nova… open my… inbox"). Chrome cuts that into pieces, so the
   * pieces are collected here and handed over as ONE sentence once you've really finished.
   */
  private parts: string[] = [];
  /** When the assistant last stopped talking. */
  private agentEndedAt = 0;
  /** Per piece of speech: did it START while the assistant was talking? (then it may be its own voice) */
  private segDuringAgent = new Map<number, boolean>();
  private lastInterimDuringAgent = false;
  private flushTimer = 0;
  /** Silence (ms) that means "I've finished my sentence". */
  pauseMs = 1100;

  private rec: SR | null = null;
  private backoff = 300;
  private awaitUntil = 0;
  private echoUntil = 0;

  constructor(
    private onChange: () => void,
    /** wake = the user addressed Vaani ("Vaani, …" or answered a question); otherwise main decides. */
    private onCommand: (text: string, wake: boolean) => void,
    private onStop: () => void,
  ) {
    document.addEventListener("visibilitychange", () => void this.onVisibility());
  }

  private clearAwait() {
    if (!this.awaiting && !this.awaitUntil) return;
    this.awaitUntil = 0;
    this.awaiting = false;
    this.onChange();
  }

  /** After Vaani asks a question: accept the next sentence without the wake word. */
  expectAnswer(ms = 15000) {
    if (!this.wakeWord || !this.enabled) return;
    this.awaitUntil = Date.now() + ms;
    this.awaiting = true;
    this.onChange();
    window.setTimeout(() => {
      if (Date.now() >= this.awaitUntil && this.awaiting) {
        this.awaiting = false;
        this.onChange();
      }
    }, ms + 50);
  }

  /** Call when the agent finishes speaking: ignore the tail of its own voice for a moment. */
  agentStopped() {
    // Recognition can deliver the tail of Vaani's own sentence a few seconds late.
    this.echoUntil = Date.now() + 4000;
    this.agentEndedAt = Date.now();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) {
      this.fails = 0;
      if (this.state === "unavailable") this.state = "off";
      this.error = null;
    }
    if (on) this.start();
    else this.kill("off");
  }

  restart() {
    if (this.enabled) {
      this.kill("off");
      this.start();
    }
  }

  private kill(state: MicState) {
    const r = this.rec;
    this.rec = null;
    r?.abort();
    if (this.state !== "unsupported" && this.state !== "blocked") this.state = state;
    this.caption = "";
    this.onChange();
  }

  start() {
    const Ctor = getCtor();
    if (!Ctor || !this.enabled || this.state === "unsupported") return;
    this.rec?.abort();
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    let startedAt = 0;
    this.segDuringAgent = new Map();
    let failed = false; // a real problem (network / no mic), not just "nobody spoke"
    rec.onstart = () => {
      startedAt = Date.now();
      const changed = this.state !== "listening";
      this.state = "listening";
      this.error = null;
      if (changed) this.onChange();
    };
    rec.onresult = (e) => {
      let interim = "";
      this.fails = 0;
      const nearAgent = this.agentSpeaking() || Date.now() - this.agentEndedAt < 700;
      for (let i = e.resultIndex; i < e.results.length; i++) if (!this.segDuringAgent.has(i)) this.segDuringAgent.set(i, nearAgent);
      // ---- STOP comes first: react to the half-heard words, don't wait for the sentence to finish ----
      if (this.agentSpeaking()) {
        let heard = "";
        for (let i = e.resultIndex; i < e.results.length; i++) heard += e.results[i][0].transcript;
        heard = heard.trim();
        // (it's only ignored if it is clearly the assistant's own sentence that contained a stop word)
        if (heard && isStopPhrase(heard) && !(this.isEcho(heard) && STOP_ANY.test(this.agentText()))) {
          this.stoppedAt = Date.now();
          this.onStop(); // silence now
          return;
        }
        // Clearly different words from what it is saying → that's YOU talking over it: go quiet and listen.
        if (heard.split(/\s+/).length >= 2 && echoShare(heard, this.agentText()) < 0.35) this.onBargeIn();
      }
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          // the final version of a "stop" we already obeyed: nothing more to do
          if (Date.now() - this.stoppedAt < 4000 && isStopPhrase(r[0].transcript)) continue;
          // Already acted on this sentence while it was still being spoken? Then don't run it twice.
          const best = this.pickAlternative(r);
          // Started while the assistant was talking and sounds like its own words → its own voice. Ignore.
          if (this.segDuringAgent.get(i) && this.ownVoice(best)) continue;
          const f = norm(best);
          // Same sentence we already ran early? Skip it — unless you kept talking and said more.
          const extra = f.split(" ").length - (this.handled ? this.handled.split(" ").length : 0);
          const dup = this.handled && Date.now() - this.handledAt < 8000 && (f === this.handled || this.handled.startsWith(f) || (f.startsWith(this.handled) && extra < 2));
          this.handled = "";
          if (!dup) this.collect(best);
        } else if (!(this.segDuringAgent.get(i) && this.ownVoice(r[0].transcript))) {
          interim += r[0].transcript;
          this.lastInterimDuringAgent = Boolean(this.segDuringAgent.get(i));
        }
      }
      if (interim.trim()) window.clearTimeout(this.flushTimer);
      else if (this.parts.length) this.scheduleFlush();
      const shown = this.agentSpeaking() ? "" : interim.trim();
      // Speed: Chrome waits ~1 s of silence before it "finalises". Clear commands run after 0.6 s of no change.
      window.clearTimeout(this.quickTimer);
      if (shown) {
        const snapshot = shown;
        this.quickTimer = window.setTimeout(() => {
          if (this.rec !== rec || this.caption !== snapshot || this.agentSpeaking() || this.parts.length) return;
          const clean = (matchWake(snapshot, this.name) ?? snapshot).trim();
          if (!clean || !this.quickOk(clean)) return;
          this.handled = norm(snapshot);
          this.handledAt = Date.now();
          this.caption = "";
          this.handleFinal(snapshot);
        }, 800);
      }
      if (shown !== this.caption) {
        this.caption = shown;
        this.onChange();
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.enabled = false;
        this.state = "blocked";
        this.error = "Microphone blocked. Click the lock icon in the address bar → allow Microphone, then turn the mic on again.";
      } else if (e.error === "audio-capture") {
        failed = true;
        this.error = "No microphone found.";
      } else if (e.error === "network") {
        failed = true;
        this.error = IS_EDGE
          ? "Microsoft Edge's speech service isn't responding. Retrying…"
          : "Voice recognition needs internet. Retrying…";
      }
      this.onChange();
    };
    rec.onend = () => {
      // Chrome ended the session in the middle of your sentence: keep what it heard so far.
      const half = this.caption;
      this.caption = "";
      if (this.rec !== rec) return;
      if (half && !this.agentSpeaking() && !(this.lastInterimDuringAgent && this.ownVoice(half)) && !(this.handled && norm(half).startsWith(this.handled))) this.collect(half);
      // Chrome ends listening sessions on its own (silence, "no-speech") — restart right away so
      // nothing you say is missed. Only real failures (network, no mic) back off, up to 10 s.
      const lived = startedAt ? Date.now() - startedAt : 0;
      if (failed) {
        this.backoff = Math.min(Math.max(this.backoff, 500) * 2, 10_000);
        // Don't keep retrying forever (it looks like Vaani is "restarting"): stop and explain once.
        if (++this.fails >= 4) {
          this.enabled = false;
          this.state = "unavailable";
          this.error = IS_EDGE
            ? "Voice doesn't work in Microsoft Edge on this computer (its speech service keeps failing). For voice, please use Google Chrome. You can still type commands here (Alt+V)."
            : "I can't reach the speech service right now. Check your internet, then switch the microphone on again. You can still type commands (Alt+V).";
          this.onChange();
          return;
        }
      } else if (lived > 3000) this.fails = 0;
      else if (lived < 1000) this.backoff = Math.min(Math.max(this.backoff, 250) * 2, 2000); // instant ends: small pause
      else this.backoff = 150;
      if (!failed && this.error?.startsWith("Voice recognition needs internet")) this.error = null;
      if (this.enabled) {
        // keep showing "listening" during the short gap so the UI doesn't flicker.
        // Quick restarts happen right away: background tabs slow timers down, which would make the mic deaf.
        if (this.backoff <= 200) this.start();
        else window.setTimeout(() => this.start(), this.backoff);
      } else {
        this.state = "off";
        this.onChange();
      }
    };

    this.rec = rec;
    if (this.state !== "listening") this.state = "starting";
    try {
      rec.start();
    } catch {
      window.setTimeout(() => this.start(), 1000);
    }
  }

  /**
   * In another tab: the Gmail tab you used last keeps listening for your assistant's name
   * (so "Nova, open inbox" brings Gmail back). Other Gmail tabs stop listening.
   */
  private async onVisibility() {
    if (!document.hidden) {
      void chrome.runtime.sendMessage({ type: "tab", action: "visible" }).catch(() => undefined);
      if (this.enabled && !this.rec) this.start();
      return;
    }
    const r = (await chrome.runtime.sendMessage({ type: "tab", action: "primary" }).catch(() => ({ primary: false }))) as { primary?: boolean };
    if (!r?.primary || !this.wakeWord) this.kill("off");
  }

  /** True when the words heard are (mostly) Vaani's own sentence coming back through the speakers. */
  isEcho(text: string): boolean {
    const n = wordsOf(text).length;
    if (!n) return true;
    // Short answers ("yes", "send it") that START after it finished talking are you (checked per piece above).
    if (!this.agentSpeaking() && n < 3) return false;
    return echoShare(text, this.agentText()) >= 0.6;
  }

  /** Words that began while the assistant was talking: its own voice if they mostly match what it said. */
  private ownVoice(text: string): boolean {
    if (isStopPhrase(text)) return false; // "stop" always counts
    const n = wordsOf(text).length;
    if (!n) return true;
    return echoShare(text, this.agentText()) >= 0.5;
  }

  /** Chrome offers up to 3 guesses: prefer one that starts with the assistant's name. */
  private pickAlternative(r: SRResult): string {
    const first = r[0].transcript;
    if (matchWake(first, this.name) !== null) return first;
    for (let k = 1; k < (r.length ?? 1); k++) {
      const t = r[k]?.transcript;
      if (t && matchWake(t, this.name) !== null) return t;
    }
    return first;
  }

  /** A piece of a sentence arrived. "Stop" acts at once; everything else waits for your pause. */
  private collect(piece: string) {
    const t = piece.trim();
    if (!t) return;
    if (STOP.test(t) || isStopPhrase(t)) {
      this.parts = [];
      window.clearTimeout(this.flushTimer);
      return this.onStop();
    }
    this.parts.push(t);
    this.scheduleFlush();
  }

  private scheduleFlush() {
    window.clearTimeout(this.flushTimer);
    const joined = this.parts.join(" ");
    const rest = matchWake(joined, this.name);
    // Only the name so far ("Nova…")? Give you time to say the rest.
    // A short clear command ("open inbox")? Go quickly. Otherwise wait for a real pause.
    const wait = rest === "" ? 1600 : this.quickOk((rest ?? joined).trim()) && joined.split(/\s+/).length <= 4 ? 450 : this.pauseMs;
    this.flushTimer = window.setTimeout(() => this.flush(), wait);
  }

  private flush() {
    window.clearTimeout(this.flushTimer);
    if (!this.parts.length) return;
    if (this.caption) return this.scheduleFlush(); // still talking
    const text = this.parts.join(" ");
    this.parts = [];
    this.handleFinal(text);
  }

  private handleFinal(raw: string) {
    const text = raw.trim();
    if (!text) return;
    if (STOP.test(text) || isStopPhrase(text)) return this.onStop();
    // While Vaani talks (and just after), ignore only its OWN voice — the user can still interrupt with a command.
    const busy = this.agentSpeaking() || Date.now() < this.echoUntil;
    if (busy && this.isEcho(text)) return;

    const now = Date.now();
    const rest0 = matchWake(text, this.name);
    if (rest0 !== null) {
      const rest = rest0;
      if (rest) {
        this.clearAwait();
        this.onCommand(rest, true);
        return;
      }
    } else {
      const addressed = !this.wakeWord || now < this.awaitUntil;
      this.clearAwait();
      this.onCommand(text, addressed);
      return;
    }
    {
      this.onAwake();
      this.awaitUntil = now + 8000;
      this.awaiting = true;
      window.setTimeout(() => {
        if (Date.now() >= this.awaitUntil) {
          this.awaiting = false;
          this.onChange();
        }
      }, 8050);
    }
    this.onChange();
  }
}

/** Automated tests run without real voices: keep the visual pace short there. */
const pace = () => (typeof __TEST__ !== "undefined" && __TEST__ ? Number(document.documentElement.dataset.vaaniPace || 0.04) : 1);

export class Speaker {
  speaking = false;
  /** Live subtitles: how many characters of `lastText` have been spoken so far. */
  onProgress: (spokenChars: number, text: string) => void = () => {};
  /** The sentence being spoken (or last spoken) — lets the listener ignore Vaani's own voice. */
  lastText = "";
  private said: { text: string; at: number }[] = [];
  /** Everything the assistant said in the last 20 s (its voice can come back late through the speakers). */
  recentText(): string {
    const now = Date.now();
    this.said = this.said.filter((x) => now - x.at < 20_000);
    return this.said.map((x) => x.text).join(" ");
  }
  /** Chosen by the user in the voice picker ("" = automatic). */
  voiceName = "";
  rate = 1;
  pitch = 1;
  voices: SpeechSynthesisVoice[] = [];
  private token = 0;

  constructor(private onChange: () => void) {
    const load = () => {
      this.voices = speechSynthesis.getVoices();
      this.onChange();
    };
    this.voices = speechSynthesis.getVoices();
    speechSynthesis.addEventListener("voiceschanged", load);
  }

  voice(): SpeechSynthesisVoice | undefined {
    if (this.voiceName) {
      const chosen = this.voices.find((v) => v.name === this.voiceName);
      if (chosen) return chosen;
    }
    for (const code of ["en-IN", "en-GB", "en-US"]) {
      const m = this.voices.filter((v) => v.lang.replace("_", "-").toLowerCase() === code.toLowerCase());
      const best = m.find((v) => /google|natural|online/i.test(v.name)) ?? m[0];
      if (best) return best;
    }
    return undefined;
  }

  stop() {
    this.token++;
    speechSynthesis.cancel();
    if (this.speaking) {
      this.speaking = false;
      this.onChange();
    }
  }

  /** Speaks text; resolves true when finished, false if interrupted. */
  say(text: string): Promise<boolean> {
    this.stop();
    this.lastText = text;
    this.said.push({ text, at: Date.now() + text.length * 70 }); // counted from roughly when it ends
    const token = ++this.token;
    const parts = text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
    if (parts.length === 0) return Promise.resolve(true);
    this.speaking = true;
    this.onChange();
    const v = this.voice();
    return new Promise((resolve) => {
      let finished = false;
      const done = (ok: boolean) => {
        if (finished) return;
        finished = true;
        if (token === this.token) {
          this.speaking = false;
          this.onChange();
        }
        resolve(ok && token === this.token);
      };
      // where each sentence starts inside the full text (for word-by-word subtitles)
      const flat = text.replace(/\s+/g, " ");
      let from = 0;
      const offsets = parts.map((p) => {
        const at = flat.indexOf(p, from);
        from = at >= 0 ? at + p.length : from;
        return at >= 0 ? at : from;
      });
      parts.forEach((p, i) => {
        const u = new SpeechSynthesisUtterance(p);
        u.onstart = () => token === this.token && this.onProgress(offsets[i], flat);
        u.onboundary = (ev) => {
          if (token !== this.token || ev.name !== "word") return;
          const end = flat.indexOf(" ", offsets[i] + ev.charIndex + 1);
          this.onProgress(end < 0 ? flat.length : end, flat);
        };
        if (v) u.voice = v;
        u.lang = v?.lang ?? "en-IN";
        u.rate = this.rate;
        u.pitch = this.pitch;
        if (i === parts.length - 1) u.onend = () => {
          if (token === this.token) this.onProgress(flat.length, flat);
          done(true);
        };
        // No voice / audio error: keep the visual pace (cards still advance) instead of aborting.
        u.onerror = (ev) => {
          if (ev.error === "interrupted" || ev.error === "canceled") return done(false);
          window.setTimeout(() => done(true), (1500 + text.length * 55) * pace());
        };
        speechSynthesis.speak(u);
      });
      // Safety net: some systems have no voices and never fire events.
      window.setTimeout(() => done(true), (3000 + text.length * 110) * pace());
    });
  }
}
