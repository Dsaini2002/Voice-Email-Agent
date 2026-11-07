import { useEffect } from "react";
import type { BriefingItem } from "../../../shared/types";
import { themeFor } from "../statusTheme";
import { formatDeadline } from "./ItemCard";
import { CloseIcon, ExternalIcon, PlayIcon } from "./icons";

/** Transparent HUD detail view for one email — opens over the dashboard, no new window. */
export function EmailModal({ item, onClose, onSpeak }: {
  item: BriefingItem;
  onClose: () => void;
  onSpeak: (text: string) => void;
}) {
  const t = themeFor(item);
  const dl = item.deadline ? formatDeadline(item.deadline) : null;
  const security = item.category === "scam";
  const conf = Math.round(item.confidence * 100);
  const when = new Date(item.date).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`${t.label}: ${item.entity}`}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="backdrop-in absolute inset-0 bg-[rgba(2,8,20,.72)] backdrop-blur-[3px]"
      />

      <div
        className="modal-in hud-panel hud-panel-glow relative w-full max-w-2xl p-7"
        style={{ clipPath: "polygon(0 0, calc(100% - 28px) 0, 100% 28px, 100% 100%, 28px 100%, 0 calc(100% - 28px))" }}
      >
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-8 top-4 p-2 text-dim hover:text-snow">
          <CloseIcon width={18} height={18} />
        </button>

        <div className="flex items-center gap-3">
          <span className={`hud-tag inline-flex items-center gap-1 ${t.tag}`}><t.Icon width={12} height={12} /> {t.label}</span>
          <span className="font-mono text-[11px] tracking-[0.1em] text-dim">{when.toUpperCase()}</span>
        </div>
        <h2 className="hud-title mt-4 text-4xl font-bold text-snow" style={{ textShadow: "0 0 20px rgba(70,220,255,.5)" }}>{item.entity}</h2>
        <p className="mt-1 text-lg text-dim">{item.subject}</p>

        <p className="mt-4 text-xl font-semibold leading-snug text-snow">{item.summary}</p>

        {security && (
          <p className="mt-4 border border-alert/50 bg-alert/10 px-4 py-2.5 text-alert">
            Do not open links in this email. Never share payments, OTPs or passwords.
          </p>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {item.actionText && !security && (
            <div className="border border-line bg-cy/5 px-4 py-3">
              <p className="hud-label text-[10px]">Your action</p>
              <p className="mt-0.5 text-xl font-bold">{item.actionText}</p>
            </div>
          )}
          {dl && (
            <div className={`border px-4 py-3 ${dl.urgent ? "border-snow/70 bg-snow/10" : "border-line bg-cy/5"}`}>
              <p className="hud-label text-[10px]">Deadline</p>
              <p className="mt-0.5 text-xl font-bold">{dl.label.replace(/^Due (\w)/, (_m, c: string) => c.toUpperCase())}</p>
            </div>
          )}
          {item.mergedCount > 1 && (
            <div className="border border-line bg-cy/5 px-4 py-3">
              <p className="hud-label text-[10px]">Reminders merged</p>
              <p className="mt-0.5 text-xl font-bold">{item.mergedCount} emails · latest shown</p>
            </div>
          )}
        </div>

        {!security && (
          <div className="mt-5 flex items-center gap-3 font-mono text-[11px] tracking-[0.1em]">
            <span className={item.verified ? "text-cy" : "text-snow"}>{item.verified ? "✓ VERIFIED FROM ORIGINAL EMAIL" : "⚠ NOT VERIFIED · CHECK MANUALLY"}</span>
            <div className="relative h-1.5 flex-1 bg-snow/10">
              <i className="absolute inset-y-0 left-0 bg-gradient-to-r from-hblue to-cy shadow-[0_0_10px_#46d9ff]" style={{ width: `${conf}%` }} />
            </div>
            <span className="text-cy2">AI CONFIDENCE {conf}%</span>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <a href={item.gmailUrl} target="_blank" rel="noreferrer noopener" className="hud-btn hud-btn-solid">
            <ExternalIcon width={15} height={15} /> Open in Gmail
          </a>
          {!security && (
            <button type="button" onClick={() => onSpeak(`${item.entity}. ${t.label}. ${item.summary}`)} className="hud-btn">
              <PlayIcon width={13} height={13} /> Read aloud
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
