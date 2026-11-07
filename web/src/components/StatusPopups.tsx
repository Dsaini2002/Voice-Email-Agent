import { useEffect, useRef, useState } from "react";
import type { BriefingItem } from "../../../shared/types";
import { themeFor } from "../statusTheme";
import { CloseIcon } from "./icons";
import { formatDeadline } from "./ItemCard";

export interface Popup {
  key: number;
  item: BriefingItem;
}

const LIFETIME_MS = 9000;

/** Floating HUD notifications (top-right), one per important email. */
export function StatusPopups({ popups, onDismiss, onOpen }: {
  popups: Popup[];
  onDismiss: (key: number) => void;
  onOpen: (item: BriefingItem) => void;
}) {
  return (
    <div className="pointer-events-none fixed right-4 top-20 z-50 flex w-[min(390px,calc(100vw-2rem))] flex-col gap-3" aria-live="polite">
      {popups.slice(0, 4).map((p, i) => (
        <PopupCard key={p.key} popup={p} index={i} onDismiss={onDismiss} onOpen={onOpen} />
      ))}
      {popups.length > 4 && (
        <div className="pointer-events-auto self-end border border-cy/50 bg-void/90 px-3 py-1 font-mono text-[11px] tracking-[0.12em] text-cy">
          +{popups.length - 4} MORE
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
  const life = LIFETIME_MS + index * 600;
  const remaining = useRef(life);
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
      className={`popup-in hud-panel hud-panel-glow pointer-events-auto ${leaving ? "popup-out" : ""}`}
    >
      <button type="button" onClick={() => onOpen(item)} className="flex w-full gap-3 p-4 pr-10 text-left">
        <span className={`grid h-11 w-11 shrink-0 place-items-center ${t.tile}`}>
          <t.Icon width={20} height={20} />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className={`hud-tag ${t.tag}`}>{t.label}</span>
            <span className="font-mono text-[10px] tracking-[0.12em] text-dim">NEW</span>
          </span>
          <span className="mt-1 block truncate text-[21px] font-bold leading-tight text-snow">{item.entity}</span>
          <span className="mt-0.5 line-clamp-2 block text-[15px] leading-snug text-snow/80">{item.summary}</span>
          {dl && <span className="hud-chip mt-2 inline-block">{dl.label}</span>}
        </span>
      </button>

      <button type="button" onClick={close} aria-label="Dismiss" className="absolute right-6 top-2.5 p-1.5 text-dim hover:text-snow">
        <CloseIcon width={14} height={14} />
      </button>

      <div className="h-[3px] w-full bg-line/50">
        <div
          className={`h-full ${t.bar} popup-life`}
          style={{ animationDuration: `${life}ms`, animationPlayState: paused ? "paused" : "running", boxShadow: "0 0 8px currentColor" }}
        />
      </div>
    </div>
  );
}
