import { useState, type FormEvent } from "react";
import type { GeminiKeyStatus } from "../../../shared/types";
import { api } from "../api";
import { CloseIcon, ExternalIcon, ShieldIcon } from "./icons";

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
      setNote(res.warning ?? "Key saved. Your emails are being analysed now.");
      onSaved(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove your Gemini key? New emails will not be analysed without it.")) return;
    setBusy(true);
    try {
      onSaved(await api.deleteGeminiKey());
      setNote("Key removed.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    <>
      Open{" "}
      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-bold text-cy hover:text-cy2">
        Google AI Studio <ExternalIcon width={13} height={13} />
      </a>{" "}
      and sign in.
    </>,
    <>Click <b>Create API key</b> and copy it.</>,
    <>Paste it below and press <b>Save</b>. We test it once, then store it encrypted.</>,
  ];

  return (
    <section className="hud-panel hud-panel-glow hud-corners p-5 sm:p-6" aria-label="Gemini API key">
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-8 top-4 p-2 text-dim hover:text-snow">
          <CloseIcon width={16} height={16} />
        </button>
      )}

      <p className="hud-label">{status.hasKey ? "AI engine" : "Setup · final step"}</p>
      <h2 className="mt-1 text-2xl font-bold text-snow">
        {status.hasKey ? "Your Gemini API key" : "Connect your own free Gemini API key"}
      </h2>
      <p className="mt-1 text-[16px] text-dim">
        The AI runs on <b className="text-snow">your own</b> Gemini key, so your usage counts only on your account. The key is free.
      </p>

      {status.hasKey ? (
        <p className="hud-chip mt-4 inline-block text-[12px]">✓ KEY CONNECTED · •••• {status.last4}</p>
      ) : (
        <ol className="mt-4 space-y-2 text-[16px]">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="hud-title grid h-6 w-6 shrink-0 place-items-center border border-cy/60 text-[11px] text-cy">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={save} className="mt-4 flex flex-wrap gap-2">
        <label htmlFor="gemini-key" className="sr-only">Gemini API key</label>
        <input
          id="gemini-key"
          type={show ? "text" : "password"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={status.hasKey ? "Paste a new key to replace it" : "Paste your key (AQ.… or AIza…)"}
          autoComplete="off"
          spellCheck={false}
          className="hud-input min-w-0 flex-1 font-mono !text-sm"
        />
        <button type="button" onClick={() => setShow((v) => !v)} className="hud-btn hud-btn-ghost">
          {show ? "Hide" : "Show"}
        </button>
        <button type="submit" disabled={!key.trim() || busy} className="hud-btn hud-btn-solid">
          {busy ? "Checking…" : status.hasKey ? "Replace" : "Save"}
        </button>
        {status.hasKey && (
          <button type="button" onClick={remove} disabled={busy} className="hud-btn hud-btn-alert">
            Remove
          </button>
        )}
      </form>

      {error && <p className="mt-3 text-alert" role="alert">{error}</p>}
      {note && !error && <p className="mt-3 text-cy2">{note}</p>}

      <p className="mt-4 flex gap-2 text-[13px] text-dim">
        <ShieldIcon width={14} height={14} className="mt-0.5 shrink-0 text-cy" />
        Stored encrypted (AES-256) and never sent back to your browser. Only the last 4 characters are shown. "Delete my data" removes it too.
      </p>
    </section>
  );
}
