import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const MicIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" /></svg>
);
export const StopIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /></svg>
);
export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" /></svg>
);
export const RefreshIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20 11a8 8 0 0 0-14.9-3.9L3 9M4 13a8 8 0 0 0 14.9 3.9L21 15M3 4v5h5M21 20v-5h-5" /></svg>
);
export const ExternalIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
);
export const ShieldIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
);
export const AlertIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17.5v.01" /></svg>
);
export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const ClockIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const SendIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 12l16-8-6 16-2-6z" /></svg>
);
export const LogoMark = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 64 64" width={36} height={36} aria-hidden {...p}>
    <rect width="64" height="64" rx="16" fill="#1d1b3a" />
    <path d="M14 22h36v22a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4z" fill="none" stroke="#f59e3b" strokeWidth="4" strokeLinejoin="round" />
    <path d="M14 22l18 13 18-13" fill="none" stroke="#f59e3b" strokeWidth="4" strokeLinejoin="round" />
    <path d="M24 54c3-2 5-2 8 0s5 2 8 0" fill="none" stroke="#5eead4" strokeWidth="3" strokeLinecap="round" />
  </svg>
);
export const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
  </svg>
);
export const MicOffIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 3l18 18M9 9v1a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.7-1.3M5 10a7 7 0 0 0 11.9 5M19 10a7 7 0 0 1-.6 2.8M12 17v4M8 21h8" /></svg>
);
export const StarIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>
);
export const CalendarIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M8 14h3v3H8z" /></svg>
);
export const TrophyIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 21h8M10 17h4v4h-4z" /></svg>
);
export const PencilIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></svg>
);
export const XCircleIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>
);
export const BoltIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>
);
export const HeartIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
);
export const WalletIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18M16 15h2M7 3h10" /></svg>
);
export const BellIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" /></svg>
);
export const InboxIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5" /></svg>
);
export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
