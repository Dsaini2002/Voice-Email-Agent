import { useState, type ReactNode } from "react";
import type { BriefingMode, Lang, Me, SyncStatus } from "../../../shared/types";
import { LogoMark, RefreshIcon } from "./icons";

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

function StatusPill({ status }: { status: SyncStatus | null }) {
  if (!status) return null;
  const working = status.state === "syncing" || status.state === "analyzing";
  const color =
    status.state === "error" || status.state === "needs_key" ? "bg-danger" : working ? "bg-saffron animate-pulse" : "bg-teal";
  const text =
    status.message ||
    (status.lastSyncAt
      ? `Live · ${status.analyzed} emails samjhe · last sync ${new Date(status.lastSyncAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`
      : "Shuru ho raha hai…");
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-xs text-ink-soft" title={text}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
      <span className="truncate">{text}</span>
    </span>
  );
}

export function Header(p: Props) {
  const [menu, setMenu] = useState(false);

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          {p.micSlot}
          <LogoMark width={32} height={32} />
          <span className="font-semibold tracking-tight">VaaniMail AI</span>
        </div>

        <div className="order-3 w-full sm:order-none sm:w-auto sm:flex-1 sm:px-3">
          <StatusPill status={p.status} />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={p.lang}
            onChange={(e) => p.onLang(e.target.value as Lang)}
            className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm"
            aria-label="Language"
          >
            <option value="hinglish">Hinglish</option>
            <option value="hi">हिंदी</option>
            <option value="en">English</option>
          </select>

          <div className="hidden rounded-lg border border-line bg-card p-0.5 text-sm sm:flex" role="group" aria-label="Briefing length">
            {(["short", "detailed"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => p.onMode(m)}
                aria-pressed={p.mode === m}
                className={`rounded-md px-2.5 py-1 ${p.mode === m ? "bg-ink text-paper" : "text-ink-soft"}`}
              >
                {m === "short" ? "30 sec" : "Detail"}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={p.onSync}
            className="rounded-lg border border-line bg-card p-2 text-ink-soft hover:text-ink"
            title="Naye emails abhi check karo"
            aria-label="Sync now"
          >
            <RefreshIcon width={16} height={16} />
          </button>

          <div className="relative">
            <button type="button" onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-label="Account menu" className="block">
              {p.me.picture ? (
                <img src={p.me.picture} alt="" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-sm text-paper">
                  {p.me.name.charAt(0).toUpperCase()}
                </span>
              )}
            </button>
            {menu && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-line bg-card p-2 text-sm shadow-lg" role="menu">
                <p className="px-2 py-1.5 font-medium">{p.me.name}</p>
                <p className="truncate px-2 pb-2 text-xs text-ink-soft">{p.me.email}</p>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); p.onGeminiKey(); }} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-paper">
                  Gemini API key
                </button>
                <button type="button" role="menuitem" onClick={p.onLogout} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-paper">
                  Logout
                </button>
                <button type="button" role="menuitem" onClick={p.onDelete} className="w-full rounded-lg px-2 py-1.5 text-left text-danger hover:bg-danger-soft">
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
