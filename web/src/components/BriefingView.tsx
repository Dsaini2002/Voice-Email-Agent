import type { Briefing, BriefingItem, SectionKey } from "../../../shared/types";
import { ItemCard } from "./ItemCard";

const ACCENT: Partial<Record<SectionKey, string>> = {
  action: "bg-saffron",
  offer: "bg-teal",
  interview: "bg-teal",
  shortlisted: "bg-teal",
  assessment: "bg-saffron",
  rejected: "bg-ink-soft",
  security: "bg-danger",
};

export function BriefingView({ briefing, onOpen }: { briefing: Briefing; onOpen: (i: BriefingItem) => void }) {
  const { stats, sections } = briefing;
  const tiles = [
    { label: "Emails padhe", value: stats.totalEmails },
    { label: "Important dikhaye", value: stats.shownEmails },
    { label: "Promo / spam chhupaye", value: stats.hiddenSpamPromo },
    { label: "Duplicates merge", value: stats.duplicatesMerged },
  ];

  return (
    <section aria-label="Briefing" className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-line bg-card px-4 py-3">
            <p className="text-2xl font-bold tabular-nums">{t.value}</p>
            <p className="text-xs text-ink-soft">{t.label}</p>
          </div>
        ))}
      </div>

      {sections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-card p-8 text-center text-ink-soft">
          Pichhle {briefing.windowHours} ghante mein koi important email nahi aaya.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sections.map((s) => (
            <div
              key={s.key}
              className={`rounded-2xl border p-4 ${s.key === "security" ? "border-danger/30 bg-danger-soft/40" : "border-line bg-card/60"}`}
            >
              <h3 className="mb-3 flex items-center gap-2 font-semibold">
                <span className={`h-2.5 w-2.5 rounded-full ${ACCENT[s.key] ?? "bg-ink-soft/50"}`} />
                {s.title}
                <span className="rounded-full bg-paper px-2 text-xs font-medium text-ink-soft">{s.items.length}</span>
              </h3>
              {s.key === "security" && (
                <p className="mb-3 text-xs text-danger">
                  Ye emails suspicious lage. Inke links mat kholo aur koi payment ya OTP share mat karo.
                </p>
              )}
              <ul className="space-y-2.5">
                {s.items.map((i) => (
                  <ItemCard key={i.gmailId} item={i} security={s.key === "security"} onOpen={onOpen} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
