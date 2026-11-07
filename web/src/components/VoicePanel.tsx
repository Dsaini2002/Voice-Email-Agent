import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BriefingItem } from "../../../shared/types";
import { themeFor } from "../statusTheme";
import { PlayIcon, SendIcon } from "./icons";

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
  "Aaj mere Gmail mein kya important aaya?",
  "Kaunse emails mein mera kaam pending hai?",
  "Is hafte kitne rejection aaye?",
  "Sirf important batao",
];

export function VoicePanel(p: Props) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [p.messages.length, p.busy]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || p.busy) return;
    p.onAsk(text.trim());
    setText("");
  };

  return (
    <section aria-label="Voice assistant" className="relative overflow-hidden rounded-3xl border border-line bg-card p-5 shadow-sm sm:p-6">
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-gradient-to-br from-saffron/25 to-teal/20 blur-3xl" />

      <div className="relative flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-soft">Vaani background mein sun rahi hai</p>
          <p className="mt-0.5 text-lg font-semibold">{p.listeningHint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.speaking && (
            <button
              type="button"
              onClick={p.onStopSpeaking}
              className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-4 py-2.5 font-medium hover:bg-paper"
              title="'Stop' bolo ya Esc dabao"
            >
              <span className="wave text-saffron" aria-hidden><span /><span /><span /><span /></span>
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={p.onBriefing}
            disabled={p.busy}
            className="inline-flex items-center gap-2 rounded-full bg-saffron px-5 py-2.5 font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            <PlayIcon width={16} height={16} /> Aaj ki briefing suno
          </button>
        </div>
      </div>

      {p.messages.length > 0 && (
        <div className="relative mt-5 max-h-[320px] space-y-3 overflow-y-auto pr-1" aria-live="polite">
          {p.messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
                  m.role === "user"
                    ? "rounded-br-md bg-ink text-paper"
                    : m.error
                      ? "rounded-bl-md bg-danger-soft text-danger"
                      : "rounded-bl-md bg-paper"
                }`}
              >
                <p className="whitespace-pre-line">{m.text}</p>
                {m.role === "agent" && !m.error && (
                  <button type="button" onClick={() => p.onReplay(m.text)} className="mt-1 text-xs text-ink-soft underline-offset-2 hover:underline">
                    Dobara suno
                  </button>
                )}
                {m.refs && m.refs.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.refs.map((r) => {
                      const t = themeFor(r);
                      return (
                        <button
                          key={r.gmailId}
                          type="button"
                          onClick={() => p.onOpen(r)}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${t.badge}`}
                          title={r.subject}
                        >
                          <t.Icon width={12} height={12} /> {r.entity}
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
              <div className="rounded-2xl rounded-bl-md bg-paper px-4 py-3 text-ink-soft"><span className="wave"><span /><span /><span /></span></div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {p.messages.length === 0 && (
        <div className="relative mt-5 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => p.onAsk(s)}
              disabled={p.busy}
              className="rounded-full border border-line bg-card px-3.5 py-1.5 text-sm text-ink-soft hover:border-saffron hover:text-ink disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="relative mt-5 flex gap-2">
        <label htmlFor="ask" className="sr-only">Type karke poochho</label>
        <input
          id="ask"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ya type karke poochho…"
          maxLength={500}
          className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-4 py-2.5 outline-none focus:border-saffron"
        />
        <button type="submit" disabled={!text.trim() || p.busy} className="rounded-xl bg-ink px-4 text-paper disabled:opacity-40" aria-label="Bhejo">
          <SendIcon width={18} height={18} />
        </button>
      </form>
    </section>
  );
}
