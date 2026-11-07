import { useEffect } from "react";
import type { BriefingItem } from "../../../shared/types";
import { themeFor } from "../statusTheme";
import { formatDeadline } from "./ItemCard";
import { CheckIcon, AlertIcon, ClockIcon, CloseIcon, ExternalIcon, PlayIcon } from "./icons";

/** Full detail popup for one email, opened from a status popup or a card. */
export function EmailModal({ item, onClose, onSpeak }: {
  item: BriefingItem;
  onClose: () => void;
  onSpeak: (text: string) => void;
}) {
  const t = themeFor(item);
  const dl = item.deadline ? formatDeadline(item.deadline) : null;
  const security = item.category === "scam";
  const conf = Math.round(item.confidence * 100);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`${t.label}: ${item.entity}`}>
      <button type="button" aria-label="Band karo" onClick={onClose} className="backdrop-in absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div className="modal-in relative w-full max-w-lg overflow-hidden rounded-3xl bg-card shadow-2xl">
        <div className={`relative bg-gradient-to-br ${t.gradient} px-6 pb-6 pt-5 text-white`}>
          <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
          <button type="button" onClick={onClose} aria-label="Band karo" className="absolute right-3 top-3 rounded-full p-2 hover:bg-white/20">
            <CloseIcon width={16} height={16} />
          </button>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
              <t.Icon width={26} height={26} />
            </span>
            <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider">{t.label}</span>
          </div>
          <h2 className="mt-4 text-2xl font-bold leading-tight">{item.entity}</h2>
          <p className="mt-1 text-sm text-white/85">{item.subject}</p>
        </div>

        <div className="space-y-4 p-6">
          <p className="text-[15px] leading-relaxed">{item.summary}</p>

          {security && (
            <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
              Is email ke links mat kholo. Koi payment, OTP ya password share mat karo.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            {item.actionText && !security && (
              <div className="rounded-xl bg-paper p-3">
                <p className="text-xs text-ink-soft">Aapko kya karna hai</p>
                <p className="mt-0.5 font-medium">{item.actionText}</p>
              </div>
            )}
            {dl && (
              <div className={`rounded-xl p-3 ${dl.urgent ? "bg-danger-soft text-danger" : "bg-paper"}`}>
                <p className="text-xs opacity-80">Deadline</p>
                <p className="mt-0.5 flex items-center gap-1 font-medium"><ClockIcon width={14} height={14} />{dl.label.replace("Deadline: ", "")}</p>
              </div>
            )}
            {!security && (
              <div className="col-span-2 rounded-xl bg-paper p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className={`inline-flex items-center gap-1 font-medium ${item.verified ? "text-teal" : "text-danger"}`}>
                    {item.verified ? <CheckIcon width={14} height={14} /> : <AlertIcon width={14} height={14} />}
                    {item.verified ? "Original email se verified" : "Verify nahi hua, khud check karo"}
                  </span>
                  <span className="text-ink-soft">AI confidence {conf}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${conf}%` }} />
                </div>
              </div>
            )}
          </div>

          {item.mergedCount > 1 && (
            <p className="text-xs text-ink-soft">Is matter ke {item.mergedCount} emails (reminders) ek saath jode gaye. Ye sabse latest wala hai.</p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={item.gmailUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:opacity-90"
            >
              <ExternalIcon width={16} height={16} /> Gmail mein kholo
            </a>
            {!security && (
              <button
                type="button"
                onClick={() => onSpeak(`${item.entity}. ${t.label}. ${item.summary}`)}
                className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-medium hover:bg-paper"
              >
                <PlayIcon width={14} height={14} /> Suno
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
