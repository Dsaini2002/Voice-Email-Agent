import { useState, type FormEvent } from "react";
import type { GeminiKeyStatus } from "../../../shared/types";
import { api } from "../api";
import { CheckIcon, CloseIcon, ExternalIcon, ShieldIcon } from "./icons";

interface Props {
  status: GeminiKeyStatus;
  onSaved: (s: GeminiKeyStatus) => void;
  /** Shown inside a popup (change/remove) instead of the first-time setup card. */
  onClose?: () => void;
}

/**
 * Bring-your-own-key: every user adds THEIR OWN free Gemini key, so the app
 * owner's key is never used (or billed) for other people.
 */
export function GeminiKeyCard({ status, onSaved, onClose }: Props) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveGeminiKey(key.trim());
      setKey("");
      setNote(res.warning ?? "Key save ho gayi. Ab aapke emails samjhe ja rahe hain.");
      onSaved(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Gemini key hata dein? Iske bina naye emails analyse nahi honge.")) return;
    setBusy(true);
    try {
      onSaved(await api.deleteGeminiKey());
      setNote("Key hata di gayi.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="relative overflow-hidden rounded-3xl border border-saffron/40 bg-card p-5 shadow-sm sm:p-6" aria-label="Gemini API key">
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Band karo" className="absolute right-3 top-3 rounded-full p-2 text-ink-soft hover:bg-paper">
          <CloseIcon width={16} height={16} />
        </button>
      )}

      <h2 className="text-lg font-semibold">
        {status.hasKey ? "Aapki Gemini API key" : "Ek last step: apni free Gemini API key jodo"}
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Emails samajhne ke liye AI aapki <b>apni</b> Gemini key se chalta hai, taaki aapka usage sirf aapke account mein gine. Key free milti hai.
      </p>

      {status.hasKey ? (
        <p className="mt-4 inline-flex items-center gap-2 rounded-xl bg-teal-soft px-3 py-2 text-sm text-teal">
          <CheckIcon width={16} height={16} /> Key judi hui hai: •••• {status.last4}
        </p>
      ) : (
        <ol className="mt-4 space-y-2 text-sm">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs text-paper">1</span>
            <span>
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium text-saffron underline-offset-2 hover:underline">
                Google AI Studio kholo <ExternalIcon width={13} height={13} />
              </a>{" "}
              aur apne Google account se login karo.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs text-paper">2</span>
            <span><b>"Create API key"</b> dabao aur key copy karo.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs text-paper">3</span>
            <span>Neeche paste karke <b>Save</b> dabao. Hum key ek baar check karke encrypted save karte hain.</span>
          </li>
        </ol>
      )}

      <form onSubmit={save} className="mt-4 flex flex-wrap gap-2">
        <label htmlFor="gemini-key" className="sr-only">Gemini API key</label>
        <input
          id="gemini-key"
          type={show ? "text" : "password"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={status.hasKey ? "Nayi key paste karo (badalne ke liye)" : "AIza… key yahan paste karo"}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-4 py-2.5 font-mono text-sm outline-none focus:border-saffron"
        />
        <button type="button" onClick={() => setShow((v) => !v)} className="rounded-xl border border-line px-3 text-sm text-ink-soft hover:bg-paper">
          {show ? "Chhupao" : "Dikhao"}
        </button>
        <button type="submit" disabled={!key.trim() || busy} className="rounded-xl bg-saffron px-5 py-2.5 font-medium text-white disabled:opacity-50">
          {busy ? "Check ho rahi hai…" : status.hasKey ? "Key badlo" : "Save"}
        </button>
        {status.hasKey && (
          <button type="button" onClick={remove} disabled={busy} className="rounded-xl px-3 text-sm text-danger hover:bg-danger-soft">
            Key hatao
          </button>
        )}
      </form>

      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      {note && !error && <p className="mt-3 text-sm text-teal">{note}</p>}

      <p className="mt-4 flex gap-2 text-xs text-ink-soft">
        <ShieldIcon width={14} height={14} className="mt-0.5 shrink-0" />
        Key encrypted (AES-256) save hoti hai aur browser ko kabhi wapas nahi bheji jaati. Sirf aakhri 4 akshar dikhte hain. "Delete my data" se key bhi hat jaati hai.
      </p>
    </section>
  );
}
