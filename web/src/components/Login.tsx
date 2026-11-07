import { GoogleIcon, LogoMark, ShieldIcon } from "./icons";

export function Login({ error }: { error: string | null }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <LogoMark />
          <span className="text-xl font-semibold tracking-tight">VaaniMail AI</span>
        </div>

        <h1 className="text-4xl font-bold leading-tight tracking-tight">
          Aapka inbox,
          <br />
          <span className="text-saffron">aapki awaaz mein.</span>
        </h1>
        <p className="mt-4 text-ink-soft text-lg">
          100 emails ko 30 second ki briefing mein suno. Hindi, English ya Hinglish mein poochho, jawab wahi milega.
        </p>

        {error && (
          <div role="alert" className="mt-6 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <a
          href="/api/auth/google"
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl bg-ink px-5 py-3.5 font-medium text-paper shadow-sm transition hover:opacity-90"
        >
          <span className="rounded-full bg-white p-1"><GoogleIcon /></span>
          Google se login karo
        </a>

        <ul className="mt-8 space-y-3 text-sm text-ink-soft">
          {[
            "Sirf read-only Gmail access. Phase 1 mein koi email delete ya send nahi hota.",
            "OTP, Aadhaar, PAN aur card numbers AI ko bhejne se pehle mask ho jaate hain.",
            "Google token encrypted save hota hai. 'Delete my data' se sab kuch ek click mein hat jaata hai.",
          ].map((t) => (
            <li key={t} className="flex gap-2.5">
              <ShieldIcon className="mt-0.5 shrink-0 text-teal" width={18} height={18} />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
