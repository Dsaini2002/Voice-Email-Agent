import { AGENT_NAME, TAGLINE } from "../brand";
import { GoogleIcon, ShieldIcon } from "./icons";
import { Reactor } from "./Reactor";

export function Login({ error }: { error: string | null }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-5xl items-center gap-10 md:grid-cols-[1fr_auto]">
        <div>
          <p className="hud-label">AI email agent for Gmail</p>
          <h1 className="hud-title mt-3 text-5xl font-bold text-snow sm:text-6xl" style={{ textShadow: "0 0 24px rgba(70,217,255,.45)" }}>
            {AGENT_NAME}
          </h1>
          <p className="mt-3 text-3xl font-semibold text-cy2">{TAGLINE}</p>
          <p className="mt-4 max-w-lg text-lg text-dim">
            Turn a hundred emails into a 30-second spoken briefing. Ask in English, Hindi or Hinglish and get answers in the same language.
          </p>

          {error && (
            <div role="alert" className="mt-6 max-w-lg border border-alert/50 bg-alert/10 px-4 py-3 text-alert">
              {error}
            </div>
          )}

          <a href="/api/auth/google" className="hud-btn hud-btn-solid mt-8 px-6 py-3 text-base">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white"><GoogleIcon /></span>
            Sign in with Google
          </a>

          <ul className="mt-8 max-w-lg space-y-2.5 text-[15px] text-dim">
            {[
              "Works inside Gmail. Nothing is sent, and nothing is deleted without your spoken confirmation.",
              "OTPs, ID numbers and card numbers are masked before AI sees them.",
              "Your tokens are encrypted. Delete all your data in one click.",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <ShieldIcon className="mt-0.5 shrink-0 text-cy" width={18} height={18} />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="hidden md:block">
          <Reactor size={380} sub="SYSTEM ONLINE" active />
        </div>
      </div>
    </main>
  );
}
