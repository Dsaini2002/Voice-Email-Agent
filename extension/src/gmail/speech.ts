/**
 * Always-on background listening + text-to-speech for the Gmail overlay.
 * - Restarts itself when Chrome ends a recognition session.
 * - Pauses while the Gmail tab is hidden.
 * - With the wake word on, only "Vaani, …" commands are used.
 * - While the agent speaks, only stop words are accepted (and its own voice is ignored).
 */

interface SRResult { isFinal: boolean; 0: { transcript: string } }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SR {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: SREvent) => void) | null; onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null; onstart: (() => void) | null;
}
type SRCtor = new () => SR;

export type MicState = "off" | "starting" | "listening" | "blocked" | "unsupported";

export const WAKE = /^\s*(?:hey|hi|ok|okay|हे|ओके)?[\s,]*(?:vaani|vani|vaanee|baani|bani|waani|wani|vany|vaney|bunny|वाणी|वानी)\b[\s,.!?।]*/i;
export const STOP = /^\s*(?:vaani[\s,]*)?(stop|pause|be quiet|enough|ruko|ruk jao|bas|chup|रुको|बस|चुप|स्टॉप)\b/i;

const getCtor = (): SRCtor | null => {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export class Listener {
  state: MicState = getCtor() ? "off" : "unsupported";
  caption = "";
  awaiting = false;
  error: string | null = null;
  enabled = false;
  wakeWord = true;
  lang = "en-IN";
  agentSpeaking = () => false;

  private rec: SR | null = null;
  private backoff = 300;
  private awaitUntil = 0;
  private echoUntil = 0;

  constructor(
    private onChange: () => void,
    private onCommand: (text: string) => void,
    private onStop: () => void,
  ) {
    document.addEventListener("visibilitychange", () => (document.hidden ? this.kill("off") : this.enabled && this.start()));
  }

  /** Call when the agent finishes speaking: ignore the tail of its own voice for a moment. */
  agentStopped() {
    this.echoUntil = Date.now() + 1200;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
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
    if (!Ctor || !this.enabled || document.hidden || this.state === "unsupported") return;
    this.rec?.abort();
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      this.state = "listening";
      this.error = null;
      this.backoff = 300;
      this.onChange();
    };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.handleFinal(r[0].transcript);
        else interim += r[0].transcript;
      }
      this.caption = this.agentSpeaking() ? "" : interim.trim();
      this.onChange();
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.enabled = false;
        this.state = "blocked";
        this.error = "Microphone blocked. Click the lock icon in the address bar → allow Microphone, then turn the mic on again.";
      } else if (e.error === "audio-capture") {
        this.error = "No microphone found.";
      } else if (e.error === "network") {
        this.error = "Voice recognition needs internet. Retrying…";
        this.backoff = Math.min(this.backoff * 2, 10_000);
      }
      this.onChange();
    };
    rec.onend = () => {
      this.caption = "";
      if (this.rec !== rec) return;
      if (this.enabled && !document.hidden) {
        this.state = "starting";
        window.setTimeout(() => this.start(), this.backoff);
      }
      this.onChange();
    };

    this.rec = rec;
    this.state = "starting";
    try {
      rec.start();
    } catch {
      window.setTimeout(() => this.start(), 1000);
    }
    this.onChange();
  }

  private handleFinal(raw: string) {
    const text = raw.trim();
    if (!text) return;
    if (STOP.test(text)) return this.onStop();
    if (this.agentSpeaking() || Date.now() < this.echoUntil) return;

    const now = Date.now();
    if (!this.wakeWord || now < this.awaitUntil) {
      this.awaitUntil = 0;
      this.awaiting = false;
      const clean = text.replace(WAKE, "").trim();
      if (clean && (this.wakeWord || clean.split(/\s+/).length >= 2)) this.onCommand(clean);
      this.onChange();
      return;
    }
    const m = text.match(WAKE);
    if (!m) return;
    const rest = text.slice(m[0].length).trim();
    if (rest) {
      this.onCommand(rest);
    } else {
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

export class Speaker {
  speaking = false;
  private token = 0;
  private voices: SpeechSynthesisVoice[] = [];

  constructor(private onChange: () => void) {
    const load = () => (this.voices = speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
  }

  private voice(): SpeechSynthesisVoice | undefined {
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
      parts.forEach((p, i) => {
        const u = new SpeechSynthesisUtterance(p);
        if (v) u.voice = v;
        u.lang = v?.lang ?? "en-IN";
        u.rate = 1.03;
        if (i === parts.length - 1) u.onend = () => done(true);
        // No voice / audio error: keep the visual pace (cards still advance) instead of aborting.
        u.onerror = (ev) => {
          if (ev.error === "interrupted" || ev.error === "canceled") return done(false);
          window.setTimeout(() => done(true), 1500 + text.length * 55);
        };
        speechSynthesis.speak(u);
      });
      // Safety net: some systems have no voices and never fire events.
      window.setTimeout(() => done(true), 3000 + text.length * 110);
    });
  }
}
