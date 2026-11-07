import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BriefingItem } from "../../../shared/types";
import { WAKE_WORD } from "../brand";
import { themeFor } from "../statusTheme";
import { PlayIcon, SendIcon, StopIcon } from "./icons";
import { Reactor } from "./Reactor";

export interface ChatMessage {
  id: number;
  role: "user" | "agent";
  text: string;
  refs?: BriefingItem[];
  error?: boolean;
}

interface Props {
  speaking: boolean;
  busy: boolean;
  listeningHint: string;
  messages: ChatMessage[];
  onStopSpeaking: () => void;
  onBriefing: () => void;
  onAsk: (text: string) => void;
  onReplay: (text: string) => void;
  onOpen: (item: BriefingItem) => void;
}

const SUGGESTIONS = [
  "What's important today?",
  "Which emails need my action?",
  "Show interview emails",
  "How many rejections this week?",
];

export function VoicePanel(p: Props) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const lastAgent = [...p.messages].reverse().find((m) => m.role === "agent" && !m.error);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [p.messages.length, p.busy]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || p.busy) return;
    p.onAsk(text.trim());
    setText("");
  };

  const mode = p.busy ? "PROCESSING" : p.speaking ? "SPEAKING" : "STANDBY";

  return (
    <section aria-label="Voice console" className="hud-panel hud-corners p-5 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        {/* Core + live subtitle */}
        <div className="flex flex-col items-center text-center">
          <Reactor size={220} sub={mode} active={p.speaking || p.busy} />
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {p.speaking ? (
              <button type="button" onClick={p.onStopSpeaking} className="hud-btn" title='Say "stop" or press Esc'>
                <StopIcon width={14} height={14} /> Stop
              </button>
            ) : (
              <button type="button" onClick={p.onBriefing} disabled={p.busy} className="hud-btn hud-btn-solid">
                <PlayIcon width={14} height={14} /> Today's briefing
              </button>
            )}
          </div>
        </div>

        {/* Console */}
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center justify-between gap-3">
            <p className="hud-label">Command console</p>
            <p className="font-mono text-[11px] tracking-[0.12em] text-dim">VOICE · TEXT</p>
          </div>
          <p className="mt-1 text-2xl font-semibold text-snow">{p.listeningHint}</p>

          {lastAgent && (
            <p className="mt-3 border-l-2 border-cy bg-cy/5 px-4 py-2 text-xl font-semibold leading-snug text-snow" aria-live="polite">
              “{lastAgent.text}”
            </p>
          )}

          {p.messages.length > 0 && (
            <div className="mt-4 max-h-[260px] space-y-2.5 overflow-y-auto pr-1">
              {p.messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`card-in max-w-[85%] border px-3.5 py-2 text-[16px] leading-relaxed ${
                      m.role === "user"
                        ? "border-cy/40 bg-cy/10 text-snow"
                        : m.error
                          ? "border-alert/50 bg-alert/10 text-alert"
                          : "border-line bg-panel/70 text-snow/90"
                    }`}
                  >
                    <span className="hud-label mb-0.5 block text-[9.5px]">{m.role === "user" ? "YOU" : m.error ? "ERROR" : "AGENT"}</span>
                    <p className="whitespace-pre-line">{m.text}</p>
                    {m.role === "agent" && !m.error && (
                      <button type="button" onClick={() => p.onReplay(m.text)} className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cy hover:text-cy2">
                        ▶ Replay
                      </button>
                    )}
                    {m.refs && m.refs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.refs.map((r) => {
                          const t = themeFor(r);
                          return (
                            <button key={r.gmailId} type="button" onClick={() => p.onOpen(r)} className={`hud-tag inline-flex items-center gap-1 ${t.tag}`} title={r.subject}>
                              <t.Icon width={11} height={11} /> {r.entity}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {p.busy && (
                <div className="flex justify-start">
                  <div className="border border-line bg-panel/70 px-4 py-3"><span className="eq"><i /><i /><i /><i /></span></div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}

          {p.messages.length === 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => p.onAsk(s)}
                  disabled={p.busy}
                  className="border border-line bg-panel/60 px-3 py-1.5 text-[15px] font-semibold text-dim hover:border-cy hover:text-snow disabled:opacity-50"
                >
                  "{WAKE_WORD}, <span className="text-cy">{s}</span>"
                </button>
              ))}
            </div>
          )}

          <form onSubmit={submit} className="mt-auto flex gap-2 pt-4">
            <label htmlFor="ask" className="sr-only">Type a command</label>
            <input
              id="ask"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Or type a command…"
              maxLength={500}
              className="hud-input min-w-0 flex-1"
            />
            <button type="submit" disabled={!text.trim() || p.busy} className="hud-btn px-4" aria-label="Send">
              <SendIcon width={16} height={16} />
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
