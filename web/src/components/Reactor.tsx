import { AGENT_NAME } from "../brand";

/** JARVIS-style "arc reactor" core. `size` in px. */
export function Reactor({ size = 260, label = AGENT_NAME, sub, active = false }: {
  size?: number;
  label?: string;
  sub?: string;
  active?: boolean;
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      {/* Static layer */}
      <svg viewBox="-210 -210 420 420" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <radialGradient id="rcore" r="1">
            <stop offset="0" stopColor="#bff4ff" stopOpacity=".95" />
            <stop offset=".35" stopColor="#46d9ff" stopOpacity=".55" />
            <stop offset="1" stopColor="#0a3a7a" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle r="205" fill="none" stroke="rgba(70,217,255,.15)" strokeWidth="1" />
        <circle r="160" fill="none" stroke="rgba(155,236,255,.5)" strokeWidth="10" strokeDasharray="1 7" />
        <circle r="120" fill="rgba(10,40,90,.35)" stroke="rgba(70,217,255,.45)" strokeWidth="1" />
        <g stroke="#9becff" strokeWidth="2" opacity=".75">
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1="0" y1="-104" x2="0" y2="-92" transform={`rotate(${i * 30})`} />
          ))}
        </g>
        <circle r="96" fill="url(#rcore)" opacity={active ? 0.8 : 0.5} />
        <circle r="96" fill="none" stroke="#46d9ff" strokeWidth="1.5" />
      </svg>
      {/* Outer ring — rotates clockwise (whole layer spins around its centre) */}
      <svg viewBox="-210 -210 420 420" className="spin-slow absolute inset-0 h-full w-full overflow-visible">
        <circle r="196" fill="none" stroke="rgba(70,217,255,.55)" strokeWidth="1" strokeDasharray="2 6" />
        <circle r="180" fill="none" stroke="#46d9ff" strokeWidth="3" strokeDasharray="160 40 60 40 220 70" style={{ filter: "drop-shadow(0 0 4px #46d9ff)" }} />
        <path d="M -180 0 A 180 180 0 0 1 -127 -127" fill="none" stroke="#fff" strokeWidth="4" style={{ filter: "drop-shadow(0 0 4px #fff)" }} />
      </svg>
      {/* Inner ring — rotates anti-clockwise */}
      <svg viewBox="-210 -210 420 420" className="spin-rev absolute inset-0 h-full w-full overflow-visible">
        <circle r="138" fill="none" stroke="#2a7bff" strokeWidth="2" strokeDasharray="300 60 120 60" />
        <path d="M 127 127 A 180 180 0 0 1 0 180" fill="none" stroke="#fff" strokeWidth="4" style={{ filter: "drop-shadow(0 0 4px #fff)" }} />
      </svg>
      {label && (
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <b className="hud-title block text-snow" style={{ fontSize: size * 0.075, letterSpacing: "0.3em", textShadow: "0 0 18px #46d9ff" }}>
              {label}
            </b>
            {sub && <small className="hud-label mt-1 block" style={{ fontSize: Math.max(9, size * 0.027) }}>{sub}</small>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Small reactor ring used as the logo / mic button. */
export function MiniReactor({ size = 40, children }: { size?: number; children?: React.ReactNode }) {
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 52 52" className="absolute inset-0 h-full w-full">
        <circle cx="26" cy="26" r="24" fill="none" stroke="rgba(70,217,255,.35)" strokeWidth="1.5" />
        <circle cx="26" cy="26" r="18" fill="rgba(20,90,170,.55)" stroke="#9becff" strokeWidth="1" />
      </svg>
      <svg viewBox="0 0 52 52" className="spin-slow absolute inset-0 h-full w-full">
        <circle cx="26" cy="26" r="24" fill="none" stroke="#46d9ff" strokeWidth="2.5" strokeDasharray="20 9" />
      </svg>
      <span className="relative text-snow">{children}</span>
    </span>
  );
}
