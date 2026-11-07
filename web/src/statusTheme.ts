import type { ComponentType, SVGProps } from "react";
import type { BriefingItem } from "../../shared/types";
import {
  AlertIcon, BellIcon, BoltIcon, CalendarIcon, HeartIcon, InboxIcon, PencilIcon,
  ShieldIcon, StarIcon, TrophyIcon, WalletIcon, XCircleIcon,
} from "./components/icons";

export type ThemeKey =
  | "offer" | "interview" | "shortlisted" | "assessment" | "application_received" | "rejected"
  | "action" | "personal" | "finance" | "unverified" | "important" | "security";

export interface StatusTheme {
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** gradient for icon tile + popup glow */
  gradient: string;
  /** soft background + text for badges */
  badge: string;
  /** left accent bar */
  bar: string;
  /** ring around popup */
  ring: string;
  /** spoken intro for "Suno" */
  priority: number;
}

// Full class strings (Tailwind only keeps classes it can see literally).
export const THEMES: Record<ThemeKey, StatusTheme> = {
  offer: {
    label: "Offer mila", Icon: TrophyIcon, priority: 0,
    gradient: "from-amber-400 to-orange-500", badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    bar: "bg-amber-500", ring: "ring-amber-400/40",
  },
  interview: {
    label: "Interview", Icon: CalendarIcon, priority: 1,
    gradient: "from-blue-500 to-indigo-600", badge: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
    bar: "bg-blue-500", ring: "ring-blue-400/40",
  },
  shortlisted: {
    label: "Shortlisted", Icon: StarIcon, priority: 2,
    gradient: "from-emerald-400 to-teal-600", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    bar: "bg-emerald-500", ring: "ring-emerald-400/40",
  },
  action: {
    label: "Action pending", Icon: BoltIcon, priority: 3,
    gradient: "from-orange-400 to-rose-500", badge: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
    bar: "bg-orange-500", ring: "ring-orange-400/40",
  },
  assessment: {
    label: "Test / Assessment", Icon: PencilIcon, priority: 4,
    gradient: "from-violet-500 to-purple-600", badge: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
    bar: "bg-violet-500", ring: "ring-violet-400/40",
  },
  security: {
    label: "Scam alert", Icon: ShieldIcon, priority: 5,
    gradient: "from-red-500 to-rose-700", badge: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
    bar: "bg-red-600", ring: "ring-red-500/50",
  },
  personal: {
    label: "Personal", Icon: HeartIcon, priority: 6,
    gradient: "from-pink-400 to-fuchsia-500", badge: "bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300",
    bar: "bg-pink-500", ring: "ring-pink-400/40",
  },
  finance: {
    label: "Bank / Payment", Icon: WalletIcon, priority: 7,
    gradient: "from-cyan-500 to-teal-600", badge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300",
    bar: "bg-cyan-500", ring: "ring-cyan-400/40",
  },
  unverified: {
    label: "Khud check karo", Icon: AlertIcon, priority: 8,
    gradient: "from-yellow-400 to-amber-500", badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300",
    bar: "bg-yellow-500", ring: "ring-yellow-400/40",
  },
  important: {
    label: "Important", Icon: BellIcon, priority: 9,
    gradient: "from-slate-500 to-slate-700", badge: "bg-slate-100 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300",
    bar: "bg-slate-500", ring: "ring-slate-400/40",
  },
  application_received: {
    label: "Application received", Icon: InboxIcon, priority: 10,
    gradient: "from-sky-400 to-sky-600", badge: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
    bar: "bg-sky-500", ring: "ring-sky-400/40",
  },
  rejected: {
    label: "Rejected", Icon: XCircleIcon, priority: 11,
    gradient: "from-zinc-400 to-zinc-600", badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300",
    bar: "bg-zinc-400", ring: "ring-zinc-400/40",
  },
};

export function themeKeyFor(item: BriefingItem): ThemeKey {
  if (item.category === "scam") return "security";
  if (item.status !== "none") return item.verified ? item.status : "unverified";
  if (item.actionText) return "action";
  if (item.category === "personal") return "personal";
  if (item.category === "finance") return "finance";
  return "important";
}

export const themeFor = (item: BriefingItem): StatusTheme => THEMES[themeKeyFor(item)];
