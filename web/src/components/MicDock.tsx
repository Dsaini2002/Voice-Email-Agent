import { useState } from "react";
import { AGENT_NAME, WAKE_WORD } from "../brand";
import type { MicState } from "../hooks/useSpeechRecognition";
import { MicIcon, MicOffIcon } from "./icons";
import { MiniReactor } from "./Reactor";

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
 * Small always-on mic in the top-left corner. The mic runs in the background;
 * this shows its state and live captions, and lets the user mute it.
 */
export function MicDock(p: Props) {
  const [open, setOpen] = useState(false);
  const live = p.enabled && p.state === "listening";
  const hearing = live && p.caption.length > 0 && !p.agentSpeaking;
  const blocked = p.state === "blocked" || p.state === "unsupported";

  const stateText = !p.enabled
    ? "MIC OFF"
    : p.state === "unsupported"
      ? "USE CHROME / EDGE"
      : p.state === "blocked"
        ? "MIC BLOCKED"
        : p.agentSpeaking
          ? 'SPEAKING · SAY "STOP"'
          : p.awaiting
            ? "GO AHEAD…"
            : "LISTENING";

  const hint = p.awaiting
    ? "Go ahead, I'm listening…"
    : p.agentSpeaking
      ? 'Say "stop" to interrupt'
      : p.wakeWord
        ? `Say: "${WAKE_WORD}, what's important today?"`
        : "Listening…";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Microphone: ${stateText}`}
        aria-expanded={open}
        className={`flex items-center gap-2.5 rounded-full border bg-void/85 py-1 pl-1 pr-3.5 shadow-[0_0_24px_rgba(70,200,255,.25)] backdrop-blur ${blocked ? "border-alert/60" : "border-cy/50"}`}
      >
        <span className={`relative isolate ${hearing || p.awaiting ? "mic-ring" : ""} rounded-full`}>
          <MiniReactor size={38}>
            {p.enabled && !blocked ? <MicIcon width={16} height={16} /> : <MicOffIcon width={16} height={16} className="text-alert" />}
          </MiniReactor>
        </span>
        <span className="hidden text-left sm:block">
          <b className="hud-title block text-[11px] text-snow" style={{ letterSpacing: "0.25em" }}>{AGENT_NAME}</b>
          <small className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.12em] text-cy">
            <i className={`h-1.5 w-1.5 rounded-full ${live ? "live-dot bg-[#3dffa8]" : blocked ? "bg-alert" : "bg-dim"}`} />
            {stateText}
          </small>
        </span>
        <span className={`eq ${hearing || p.agentSpeaking ? "" : "idle"}`} aria-hidden><i /><i /><i /><i /><i /></span>
      </button>

      {(hearing || p.awaiting || p.agentSpeaking) && !open && (
        <div className="caption-in hud-panel pointer-events-none absolute left-0 top-14 z-30 w-max max-w-[70vw] px-4 py-2">
          <small className="hud-label block text-[10px]">{hearing ? "HEARING" : AGENT_NAME}</small>
          <span className="text-lg font-semibold">{hearing ? `“${p.caption}”` : hint}</span>
        </div>
      )}

      {open && (
        <div className="hud-panel absolute left-0 top-14 z-40 w-80 p-4 text-[15px]" role="dialog" aria-label="Microphone settings">
          <p className="hud-label">Microphone</p>
          <p className="mt-1 text-dim">{hint}</p>
          {p.error && <p className="mt-2 text-alert">{p.error}</p>}

          <label className="mt-3 flex items-center justify-between gap-3">
            <span>Keep mic on</span>
            <input type="checkbox" checked={p.enabled} onChange={p.onToggle} className="h-4 w-4 accent-[#46d9ff]" />
          </label>
          <label className="mt-2 flex items-center justify-between gap-3">
            <span>
              Wake word "{WAKE_WORD}"
              <span className="block text-xs text-dim">When on, only commands that start with "{WAKE_WORD}" are used.</span>
            </span>
            <input type="checkbox" checked={p.wakeWord} onChange={(e) => p.onWakeWord(e.target.checked)} className="h-4 w-4 accent-[#46d9ff]" />
          </label>
          <p className="mt-3 border-t border-line pt-3 text-xs text-dim">
            The mic pauses automatically when this tab is hidden. Audio is never saved.
          </p>
        </div>
      )}
    </div>
  );
}
