import type { Briefing, BriefingItem } from "../../../shared/types";
import { SECTION_TITLES } from "../statusTheme";
import { ItemCard } from "./ItemCard";

export function BriefingView({ briefing, onOpen }: { briefing: Briefing; onOpen: (i: BriefingItem) => void }) {
  const { stats, sections } = briefing;
  const tiles = [
    { label: "Emails scanned", value: stats.totalEmails },
    { label: "Important", value: stats.shownEmails },
    { label: "Promo hidden", value: stats.hiddenSpamPromo },
    { label: "Duplicates merged", value: stats.duplicatesMerged },
    { label: "Scams blocked", value: stats.scamCount, alert: stats.scamCount > 0 },
  ];

  return (
    <section aria-label="Briefing" className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="hud-panel px-4 py-3" style={{ clipPath: "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)" }}>
            <p className="hud-label text-[10px]">{t.label}</p>
            <p className={`hud-title mt-1 text-3xl font-bold tabular-nums ${t.alert ? "text-alert" : "text-snow"}`}>{t.value}</p>
          </div>
        ))}
      </div>

      {sections.length === 0 ? (
        <div className="hud-panel p-8 text-center text-lg text-dim">
          Nothing important in the last {briefing.windowHours} hours.
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {sections.map((s) => (
            <div key={s.key}>
              <h3 className={`mb-3 flex items-center justify-between border-b pb-2 font-mono text-[11px] uppercase tracking-[0.16em] ${s.key === "security" ? "border-alert/50 text-alert" : "border-line text-cy"}`}>
                <span>{SECTION_TITLES[s.key] ?? s.title}</span>
                <span>{String(s.items.length).padStart(2, "0")}</span>
              </h3>
              {s.key === "security" && (
                <p className="mb-3 text-[14px] text-alert">Suspicious emails. Do not open their links or share payments, OTPs or passwords.</p>
              )}
              <ul className="space-y-3">
                {s.items.map((i, idx) => (
                  <ItemCard key={i.gmailId} item={i} index={idx} security={s.key === "security"} onOpen={onOpen} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
