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
  /** tag text colour + tint (blue / white family only; red only for scam) */
  tag: string;
  /** accent bar + progress colour */
  bar: string;
  /** icon tile */
  tile: string;
  priority: number;
}

// Monochrome JARVIS palette: shades of cyan / blue / white. Full class strings so Tailwind keeps them.
const CY = { tag: "text-cy bg-cy/10", bar: "bg-cy", tile: "bg-cy/15 text-cy border border-cy/50" };
const CY2 = { tag: "text-cy2 bg-cy2/10", bar: "bg-cy2", tile: "bg-cy2/10 text-cy2 border border-cy2/40" };
const BLUE = { tag: "text-[#8fb8ff] bg-hblue/20", bar: "bg-hblue", tile: "bg-hblue/25 text-[#8fb8ff] border border-hblue/60" };
const WHITE = { tag: "text-snow bg-snow/10", bar: "bg-snow", tile: "bg-snow/10 text-snow border border-snow/40" };
const DIM = { tag: "text-dim bg-dim/10", bar: "bg-dim", tile: "bg-dim/10 text-dim border border-dim/40" };
const ALERT = { tag: "text-alert bg-alert/10", bar: "bg-alert", tile: "bg-alert/15 text-alert border border-alert/50" };

export const THEMES: Record<ThemeKey, StatusTheme> = {
  offer: { label: "Offer", Icon: TrophyIcon, priority: 0, ...WHITE },
  interview: { label: "Interview", Icon: CalendarIcon, priority: 1, ...BLUE },
  shortlisted: { label: "Shortlisted", Icon: StarIcon, priority: 2, ...CY },
  action: { label: "Action", Icon: BoltIcon, priority: 3, ...WHITE },
  assessment: { label: "Test", Icon: PencilIcon, priority: 4, ...CY2 },
  security: { label: "Scam alert", Icon: ShieldIcon, priority: 5, ...ALERT },
  personal: { label: "Personal", Icon: HeartIcon, priority: 6, ...CY2 },
  finance: { label: "Bank", Icon: WalletIcon, priority: 7, ...BLUE },
  unverified: { label: "Verify", Icon: AlertIcon, priority: 8, ...WHITE },
  important: { label: "Important", Icon: BellIcon, priority: 9, ...CY },
  application_received: { label: "Applied", Icon: InboxIcon, priority: 10, ...DIM },
  rejected: { label: "Rejected", Icon: XCircleIcon, priority: 11, ...DIM },
};

export const SECTION_TITLES: Record<string, string> = {
  action: "Action pending",
  offer: "Offers",
  interview: "Interviews",
  shortlisted: "Shortlisted",
  assessment: "Tests & assessments",
  application_received: "Applications received",
  rejected: "Rejected",
  personal: "Personal",
  finance: "Bank & payments",
  other_important: "Other important",
  security: "Security alerts",
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
