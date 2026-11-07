import type { BriefingItem } from "../../../shared/types";
import { themeFor } from "../statusTheme";
import { ExternalIcon } from "./icons";

export function formatDeadline(iso: string): { label: string; urgent: boolean } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso}T00:00:00`);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const pretty = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  if (days < 0) return { label: `Overdue · ${pretty}`, urgent: true };
  if (days === 0) return { label: "Due today", urgent: true };
  if (days === 1) return { label: "Due tomorrow", urgent: true };
  return { label: `Due ${pretty}`, urgent: days <= 3 };
}

export function ItemCard({ item, security = false, onOpen, index }: {
  item: BriefingItem;
  security?: boolean;
  onOpen?: (i: BriefingItem) => void;
  index?: number;
}) {
  const t = themeFor(item);
  const dl = item.deadline ? formatDeadline(item.deadline) : null;
  const when = new Date(item.date).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <li
      className="card-in group relative cursor-pointer border border-line bg-panel/70 p-3.5 pl-4 transition hover:border-cy/70 hover:shadow-[0_0_24px_rgba(70,200,255,.18)]"
      style={{ clipPath: "polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%)", animationDelay: index ? `${index * 60}ms` : undefined }}
      onClick={() => onOpen?.(item)}
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${t.bar}`} aria-hidden />
      <div className="flex items-center gap-2">
        <span className={`hud-tag inline-flex items-center gap-1 ${t.tag}`}>
          <t.Icon width={11} height={11} /> {t.label}
        </span>
        <span className="ml-auto font-mono text-[10.5px] tracking-[0.08em] text-dim">{when}</span>
        <a
          href={item.gmailUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          className="p-1 text-dim hover:text-cy"
          title="Open in Gmail"
          aria-label={`Open ${item.entity} email in Gmail`}
        >
          <ExternalIcon width={15} height={15} />
        </a>
      </div>

      <p className="mt-1.5 truncate text-[21px] font-bold leading-tight text-snow" title={item.entity}>{item.entity}</p>
      <p className="truncate font-mono text-[11px] text-dim" title={item.subject}>{item.subject}</p>
      <p className="mt-1.5 text-[16px] leading-snug text-snow/85">{item.summary}</p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {item.actionText && !security && <span className="hud-chip">{item.actionText}</span>}
        {dl && (
          <span className={`hud-chip ${dl.urgent ? "!border-snow !bg-snow/15 !text-snow" : ""}`}>{dl.label}</span>
        )}
        {item.mergedCount > 1 && <span className="hud-chip">{item.mergedCount} merged</span>}
        {!security &&
          (item.verified ? (
            <span className="hud-chip" title={`Verified against the original email · confidence ${Math.round(item.confidence * 100)}%`}>✓ Verified</span>
          ) : (
            <span className="hud-chip !border-snow !text-snow" title="The AI could not find proof of this status in the email">⚠ Check manually</span>
          ))}
      </div>
    </li>
  );
}
