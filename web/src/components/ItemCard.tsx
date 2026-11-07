import type { BriefingItem } from "../../../shared/types";
import { themeFor } from "../statusTheme";
import { AlertIcon, CheckIcon, ClockIcon, ExternalIcon } from "./icons";

export function formatDeadline(iso: string): { label: string; urgent: boolean } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso}T00:00:00`);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { label: `Deadline nikal gayi (${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })})`, urgent: true };
  if (days === 0) return { label: "Deadline: aaj", urgent: true };
  if (days === 1) return { label: "Deadline: kal", urgent: true };
  return { label: `Deadline: ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`, urgent: days <= 3 };
}

export function ItemCard({ item, security = false, onOpen }: { item: BriefingItem; security?: boolean; onOpen?: (i: BriefingItem) => void }) {
  const t = themeFor(item);
  const dl = item.deadline ? formatDeadline(item.deadline) : null;
  const when = new Date(item.date).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  return (
    <li
      className="group relative cursor-pointer overflow-hidden rounded-xl border border-line bg-card p-3.5 pl-4 transition hover:-translate-y-0.5 hover:shadow-md"
      onClick={() => onOpen?.(item)}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${t.bar}`} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${t.gradient} text-white`}>
            <t.Icon width={16} height={16} />
          </span>
          <div className="min-w-0">
          <p className="font-semibold leading-snug truncate" title={item.entity}>{item.entity}</p>
          <p className="text-xs text-ink-soft truncate" title={item.subject}>{item.subject}</p>
          </div>
        </div>
        <a
          href={item.gmailUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded-lg p-1.5 text-ink-soft hover:bg-paper hover:text-ink"
          title="Gmail mein kholo"
          aria-label={`${item.entity} ka email Gmail mein kholo`}
        >
          <ExternalIcon width={16} height={16} />
        </a>
      </div>

      <p className="mt-2 text-sm leading-relaxed">{item.summary}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
        {item.actionText && !security && (
          <span className="rounded-full bg-saffron-soft px-2 py-0.5 font-medium text-saffron">{item.actionText}</span>
        )}
        {dl && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${dl.urgent ? "bg-danger-soft text-danger" : "bg-paper text-ink-soft"}`}>
            <ClockIcon width={12} height={12} /> {dl.label}
          </span>
        )}
        {item.mergedCount > 1 && (
          <span className="rounded-full bg-paper px-2 py-0.5 text-ink-soft" title="Duplicate/reminder emails merge kiye gaye">
            {item.mergedCount} emails merged
          </span>
        )}
        {!security &&
          (item.verified ? (
            <span className="inline-flex items-center gap-1 text-teal" title={`Original email se verify hua · confidence ${Math.round(item.confidence * 100)}%`}>
              <CheckIcon width={12} height={12} /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-danger" title="AI is status ka saboot email mein nahi dhoondh paya">
              <AlertIcon width={12} height={12} /> Khud check karo
            </span>
          ))}
        <span className="ml-auto text-ink-soft">{when}</span>
      </div>
    </li>
  );
}
