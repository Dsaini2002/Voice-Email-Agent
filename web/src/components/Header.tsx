import { useState, type ReactNode } from "react";
import type { BriefingMode, Lang, Me, SyncStatus } from "../../../shared/types";
import { AGENT_NAME } from "../brand";
import { RefreshIcon } from "./icons";

interface Props {
  /** Always-on mic indicator, shown in the top-left corner. */
  micSlot: ReactNode;
  me: Me;
  status: SyncStatus | null;
  lang: Lang;
  mode: BriefingMode;
  onLang: (l: Lang) => void;
  onMode: (m: BriefingMode) => void;
  onSync: () => void;
  onLogout: () => void;
  onGeminiKey: () => void;
  onDelete: () => void;
}

function StatusChip({ status }: { status: SyncStatus | null }) {
  if (!status) return null;
  const working = status.state === "syncing" || status.state === "analyzing";
  const bad = status.state === "error" || status.state === "needs_key";
  const text =
    status.message ||
    (status.lastSyncAt
      ? `ONLINE · ${status.analyzed} EMAILS ANALYSED · SYNC ${new Date(status.lastSyncAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
      : "STARTING…");
  return (
    <span className="inline-flex max-w-full items-center gap-2 border border-line bg-panel/70 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-cy2" title={text}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${bad ? "bg-alert" : working ? "bg-cy live-dot" : "bg-cy"}`} style={{ boxShadow: `0 0 8px ${bad ? "#ff6b6b" : "#46d9ff"}` }} />
      <span className="truncate">{text}</span>
    </span>
  );
}

export function Header(p: Props) {
  const [menu, setMenu] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-void/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          {p.micSlot}
          <span className="hud-title text-lg font-bold text-snow" style={{ textShadow: "0 0 12px rgba(70,217,255,.5)" }}>{AGENT_NAME}</span>
        </div>

        <div className="order-3 w-full sm:order-none sm:w-auto sm:flex-1 sm:px-3">
          <StatusChip status={p.status} />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={p.lang}
            onChange={(e) => p.onLang(e.target.value as Lang)}
            className="hud-input py-1.5 text-sm"
            aria-label="Voice language"
            title="Language the agent speaks"
          >
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="hinglish">Hinglish</option>
          </select>

          <div className="hidden border border-line p-0.5 sm:flex" role="group" aria-label="Briefing length">
            {(["short", "detailed"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => p.onMode(m)}
                aria-pressed={p.mode === m}
                className={`px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] ${p.mode === m ? "bg-cy text-void" : "text-dim hover:text-snow"}`}
              >
                {m === "short" ? "30 sec" : "Detailed"}
              </button>
            ))}
          </div>

          <button type="button" onClick={p.onSync} className="hud-btn hud-btn-ghost px-2.5 py-2" title="Check for new email now" aria-label="Sync now">
            <RefreshIcon width={16} height={16} />
          </button>

          <div className="relative">
            <button type="button" onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-label="Account menu" className="block">
              {p.me.picture ? (
                <img src={p.me.picture} alt="" referrerPolicy="no-referrer" className="h-9 w-9 rounded-full border border-cy/60" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-cy/60 bg-panel text-lg font-bold text-cy">
                  {p.me.name.charAt(0).toUpperCase()}
                </span>
              )}
            </button>
            {menu && (
              <div className="hud-panel absolute right-0 mt-2 w-64 p-2 text-[15px]" role="menu">
                <p className="px-2 pt-1 font-semibold">{p.me.name}</p>
                <p className="truncate px-2 pb-2 font-mono text-[11px] text-dim">{p.me.email}</p>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); p.onGeminiKey(); }} className="w-full px-2 py-1.5 text-left hover:bg-cy/10">
                  Gemini API key
                </button>
                <button type="button" role="menuitem" onClick={p.onLogout} className="w-full px-2 py-1.5 text-left hover:bg-cy/10">
                  Sign out
                </button>
                <button type="button" role="menuitem" onClick={p.onDelete} className="w-full px-2 py-1.5 text-left text-alert hover:bg-alert/10">
                  Delete my data
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
