import { useEffect, useRef, useState } from "react";
import type { BriefingItem } from "../../../shared/types";
import { themeFor } from "../statusTheme";
import { CloseIcon, ClockIcon } from "./icons";
import { formatDeadline } from "./ItemCard";

export interface Popup {
  key: number;
  item: BriefingItem;
}

const LIFETIME_MS = 9000;

/** Floating, animated status popups (top-right), one per important email. */
export function StatusPopups({ popups, onDismiss, onOpen }: {
  popups: Popup[];
  onDismiss: (key: number) => void;
  onOpen: (item: BriefingItem) => void;
}) {
  return (
    <div className="pointer-events-none fixed right-4 top-20 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-3" aria-live="polite">
      {popups.slice(0, 4).map((p, i) => (
        <PopupCard key={p.key} popup={p} index={i} onDismiss={onDismiss} onOpen={onOpen} />
      ))}
      {popups.length > 4 && (
        <div className="pointer-events-auto self-end rounded-full bg-ink px-3 py-1 text-xs text-paper shadow">
          +{popups.length - 4} aur
        </div>
      )}
    </div>
  );
}

function PopupCard({ popup, index, onDismiss, onOpen }: {
  popup: Popup;
  index: number;
  onDismiss: (key: number) => void;
  onOpen: (item: BriefingItem) => void;
}) {
  const { item } = popup;
  const t = themeFor(item);
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const remaining = useRef(LIFETIME_MS + index * 600);
  const startedAt = useRef(Date.now());

  const close = () => {
    setLeaving(true);
    window.setTimeout(() => onDismiss(popup.key), 220);
  };

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const id = window.setTimeout(close, remaining.current);
    return () => {
      window.clearTimeout(id);
      remaining.current -= Date.now() - startedAt.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const dl = item.deadline ? formatDeadline(item.deadline) : null;

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{ animationDelay: `${index * 120}ms` }}
      className={`popup-in pointer-events-auto relative overflow-hidden rounded-2xl border border-white/40 bg-card/95 shadow-2xl ring-1 ${t.ring} backdrop-blur-xl dark:border-white/10 ${leaving ? "popup-out" : ""}`}
    >
      {/* glow */}
      <div className={`pointer-events-none absolute -left-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${t.gradient} opacity-25 blur-2xl`} />

      <button type="button" onClick={() => onOpen(item)} className="relative flex w-full gap-3 p-4 pr-10 text-left">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${t.gradient} text-white shadow-lg`}>
          <t.Icon width={22} height={22} />
        </span>
        <span className="min-w-0">
          <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${t.badge}`}>{t.label}</span>
          <span className="mt-1 block truncate font-semibold">{item.entity}</span>
          <span className="mt-0.5 line-clamp-2 block text-sm text-ink-soft">{item.summary}</span>
          {dl && (
            <span className={`mt-1.5 inline-flex items-center gap-1 text-xs font-medium ${dl.urgent ? "text-danger" : "text-ink-soft"}`}>
              <ClockIcon width={12} height={12} /> {dl.label}
            </span>
          )}
        </span>
      </button>

      <button
        type="button"
        onClick={close}
        aria-label="Popup band karo"
        className="absolute right-2 top-2 rounded-full p-1.5 text-ink-soft hover:bg-paper hover:text-ink"
      >
        <CloseIcon width={14} height={14} />
      </button>

      {/* life bar */}
      <div className="h-1 w-full bg-line/60">
        <div
          className={`h-full ${t.bar} popup-life`}
          style={{ animationDuration: `${LIFETIME_MS + index * 600}ms`, animationPlayState: paused ? "paused" : "running" }}
        />
      </div>
    </div>
  );
}
