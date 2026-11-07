import { useState } from "react";
import type { MicState } from "../hooks/useSpeechRecognition";
import { MicIcon, MicOffIcon } from "./icons";

interface Props {
  state: MicState;
  enabled: boolean;
  caption: string;
  awaiting: boolean;
  agentSpeaking: boolean;
  wakeWord: boolean;
  error: string | null;
  onToggle: () => void;
  onWakeWord: (v: boolean) => void;
}

/**
 * Small always-on mic in the top-left corner. Mic runs in the background;
 * this only shows its state, live captions, and lets the user mute it.
 */
export function MicDock(p: Props) {
  const [open, setOpen] = useState(false);
  const live = p.enabled && p.state === "listening";
  const hearing = live && p.caption.length > 0 && !p.agentSpeaking;

  const tone =
    p.state === "blocked" || p.state === "unsupported"
      ? "bg-red-500 text-white"
      : !p.enabled
        ? "bg-zinc-300 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
        : hearing || p.awaiting
          ? "bg-saffron text-white"
          : "bg-teal text-white";

  const hint = !p.enabled
    ? "Mic band hai"
    : p.state === "unsupported"
      ? "Voice ke liye Chrome / Edge chahiye"
      : p.state === "blocked"
        ? "Mic blocked"
        : p.agentSpeaking
          ? "Bol rahi hoon… 'Stop' bolo to ruk jaaungi"
          : p.awaiting
            ? "Haan, boliye…"
            : p.wakeWord
              ? "Bolo: \"Vaani, aaj kya important aaya?\""
              : "Sun rahi hoon…";

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Mic: ${hint}`}
        aria-expanded={open}
        className={`relative isolate flex h-10 w-10 items-center justify-center rounded-full shadow-sm transition ${tone} ${hearing || p.awaiting ? "mic-ring" : ""}`}
      >
        {p.enabled && p.state !== "blocked" ? <MicIcon width={18} height={18} /> : <MicOffIcon width={18} height={18} />}
        {live && !hearing && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-paper bg-emerald-400 live-dot" />}
      </button>

      {/* Live caption bubble */}
      {(hearing || p.awaiting || p.agentSpeaking) && !open && (
        <div className="caption-in pointer-events-none absolute left-0 top-12 z-30 w-max max-w-[60vw] rounded-full border border-line bg-card/90 px-3.5 py-1.5 text-sm shadow-lg backdrop-blur">
          {hearing ? <span className="text-ink">“{p.caption}”</span> : <span className="text-ink-soft">{hint}</span>}
        </div>
      )}

      {open && (
        <div className="absolute left-0 top-12 z-40 w-72 rounded-2xl border border-line bg-card p-4 text-sm shadow-xl" role="dialog" aria-label="Mic settings">
          <p className="font-semibold">Vaani mic</p>
          <p className="mt-1 text-ink-soft">{hint}</p>
          {p.error && <p className="mt-2 text-danger">{p.error}</p>}

          <label className="mt-3 flex items-center justify-between gap-3">
            <span>Mic on rakho</span>
            <input type="checkbox" checked={p.enabled} onChange={p.onToggle} className="h-4 w-4 accent-[var(--color-saffron)]" />
          </label>
          <label className="mt-2 flex items-center justify-between gap-3">
            <span>
              Wake word "Vaani"
              <span className="block text-xs text-ink-soft">On: sirf "Vaani, …" se shuru hone wali baat sunegi</span>
            </span>
            <input type="checkbox" checked={p.wakeWord} onChange={(e) => p.onWakeWord(e.target.checked)} className="h-4 w-4 accent-[var(--color-saffron)]" />
          </label>
          <p className="mt-3 border-t border-line pt-3 text-xs text-ink-soft">
            Tab band ya minimize karne par mic apne aap ruk jaata hai. Awaaz save nahi hoti.
          </p>
        </div>
      )}
    </div>
  );
}
