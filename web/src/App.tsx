import { useCallback, useEffect, useRef, useState } from "react";
import type { Briefing, BriefingItem, BriefingMode, GeminiKeyStatus, Lang, Me, SectionKey, SyncStatus } from "../../shared/types";
import { api, AuthError } from "./api";
import { BriefingView } from "./components/BriefingView";
import { EmailModal } from "./components/EmailModal";
import { GeminiKeyCard } from "./components/GeminiKeyCard";
import { Header } from "./components/Header";
import { Login } from "./components/Login";
import { MicDock } from "./components/MicDock";
import { StatusPopups, type Popup } from "./components/StatusPopups";
import { VoicePanel, type ChatMessage } from "./components/VoicePanel";
import { useSpeaker } from "./hooks/useSpeaker";
import { useBackgroundListening } from "./hooks/useSpeechRecognition";
import { themeFor } from "./statusTheme";

/** Sections that get their own animated popup. */
const POPUP_SECTIONS: SectionKey[] = ["offer", "interview", "shortlisted", "action", "assessment", "security", "personal", "finance", "other_important"];
const SEEN_KEY = "vm_seen_popups";

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}
function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-300)));
  } catch {
    /* ignore */
  }
}

/** Questions that mean "give me the daily briefing" are answered with the full briefing + cards. */
const BRIEFING_INTENT =
  /(briefing|aaj.{0,25}(important|zaroori|jaruri|kya aaya|kya hai)|today.{0,20}(important|inbox|mail)|आज.{0,25}(ज़रूरी|जरूरी|इम्पोर्टेंट|क्या आया)|इम्पोर्टेंट|ब्रीफिंग)/i;

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — preference just won't persist */
  }
}

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const error = new URLSearchParams(window.location.search).get("error");

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) {
    return <div className="flex min-h-screen items-center justify-center text-ink-soft">Load ho raha hai…</div>;
  }
  if (me === null) return <Login error={error} />;
  return <Dashboard me={me} onLoggedOut={() => setMe(null)} />;
}

function Dashboard({ me, onLoggedOut }: { me: Me; onLoggedOut: () => void }) {
  const [lang, setLang] = useState<Lang>(() => readPref("vm_lang", ["hinglish", "hi", "en"] as const, "hinglish"));
  const [mode, setMode] = useState<BriefingMode>(() => readPref("vm_mode", ["short", "detailed"] as const, "short"));
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [openItem, setOpenItem] = useState<BriefingItem | null>(null);
  const [keyStatus, setKeyStatus] = useState<GeminiKeyStatus | null>(null);
  const [keyModal, setKeyModal] = useState(false);
  const [micOn, setMicOn] = useState(() => readPref("vm_mic", ["on", "off"] as const, "on") === "on");
  const [wakeWord, setWakeWord] = useState(() => readPref("vm_wake", ["on", "off"] as const, "on") === "on");
  const msgId = useRef(0);
  const popupId = useRef(0);
  const seen = useRef(loadSeen());
  const prevPending = useRef<number | null>(null);

  const speaker = useSpeaker(lang);

  const push = useCallback((m: Omit<ChatMessage, "id">) => {
    setMessages((list) => [...list, { ...m, id: ++msgId.current }]);
  }, []);

  useEffect(() => {
    api.geminiKey().then(setKeyStatus).catch(() => undefined);
  }, []);

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof AuthError) return onLoggedOut();
      if ((err as { code?: string }).code === "NEEDS_GEMINI_KEY") {
        setKeyStatus((k) => (k ? { ...k, hasKey: false } : k));
      }
      push({ role: "agent", text: (err as Error).message || "Kuch gadbad ho gayi.", error: true });
    },
    [onLoggedOut, push],
  );

  /** Pops up important emails. Silent refresh: only NEW ones. Spoken briefing: top ones again. */
  const showPopups = useCallback((b: Briefing, all: boolean) => {
    const items = b.sections
      .filter((s) => POPUP_SECTIONS.includes(s.key))
      .flatMap((s) => s.items)
      .filter((i) => all || !seen.current.has(i.gmailId))
      .sort((x, y) => themeFor(x).priority - themeFor(y).priority)
      .slice(0, all ? 6 : 5);
    if (items.length === 0) return;
    items.forEach((i) => seen.current.add(i.gmailId));
    saveSeen(seen.current);
    setPopups((cur) => [...cur, ...items.map((item) => ({ key: ++popupId.current, item }))]);
  }, []);

  const loadBriefing = useCallback(
    async (speak: boolean) => {
      setBusy(true);
      try {
        const b = await api.briefing(lang, mode);
        setBriefing(b);
        showPopups(b, speak);
        if (speak) {
          push({ role: "agent", text: b.speech });
          speaker.speak(b.speech);
        }
      } catch (err) {
        if (speak) handleError(err);
      } finally {
        setBusy(false);
      }
    },
    [lang, mode, push, speaker, handleError, showPopups],
  );

  const ask = useCallback(
    async (question: string) => {
      speaker.stop();
      push({ role: "user", text: question });
      if (BRIEFING_INTENT.test(question) && !/rejection|reject|pending|kitne|how many/i.test(question)) {
        return loadBriefing(true);
      }
      setBusy(true);
      try {
        const res = await api.ask(question, lang);
        push({ role: "agent", text: res.answer, refs: res.refs });
        speaker.speak(res.answer);
      } catch (err) {
        handleError(err);
      } finally {
        setBusy(false);
      }
    },
    [lang, loadBriefing, push, speaker, handleError],
  );

  const mic = useBackgroundListening({
    lang,
    enabled: micOn,
    wakeWord,
    agentSpeaking: speaker.speaking,
    onCommand: (text) => void ask(text),
    onStop: () => speaker.stop(),
  });
  const loadRef = useRef(loadBriefing);
  loadRef.current = loadBriefing;

  const toggleMic = () => {
    if (mic.state === "blocked") return mic.retry();
    setMicOn((v) => {
      writePref("vm_mic", v ? "off" : "on");
      return !v;
    });
  };
  const changeWake = (v: boolean) => {
    setWakeWord(v);
    writePref("vm_wake", v ? "on" : "off");
  };

  // Esc = stop speaking
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !openItem) speaker.stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [speaker, openItem]);

  const listeningHint = !mic.supported
    ? "Voice ke liye Chrome ya Edge kholo, tab tak type karke poochho."
    : !micOn
      ? "Mic band hai. Upar left corner ke mic icon se on karo."
      : mic.state === "blocked"
        ? "Mic ki permission do (address bar ka 🔒 icon)."
        : wakeWord
          ? "Bolo: \"Vaani, aaj kya important aaya?\""
          : "Seedha bolo: \"Aaj kya important aaya?\"";

  // Poll sync status: fast while working, slow when idle. Refresh cards when analysis finishes.
  useEffect(() => {
    let timer: number;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await api.status();
        if (cancelled) return;
        setStatus(s);
        const finished = prevPending.current !== null && prevPending.current > 0 && s.pending === 0;
        const firstLoad = prevPending.current === null && s.analyzed > 0;
        if (finished || firstLoad) void loadRef.current(false);
        prevPending.current = s.pending;
        const working = s.state === "syncing" || s.state === "analyzing";
        timer = window.setTimeout(tick, working ? 4000 : 30000);
      } catch (err) {
        if (err instanceof AuthError) return onLoggedOut();
        timer = window.setTimeout(tick, 15000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch cards (silently) when language/mode changes.
  useEffect(() => {
    if (briefing) void loadRef.current(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, mode]);

  const changeLang = (l: Lang) => {
    setLang(l);
    writePref("vm_lang", l);
  };
  const changeMode = (m: BriefingMode) => {
    setMode(m);
    writePref("vm_mode", m);
  };

  const logout = async () => {
    speaker.stop();
    await api.logout().catch(() => undefined);
    onLoggedOut();
  };
  const deleteData = async () => {
    if (!window.confirm("Saara VaaniMail data delete ho jaayega aur Google access revoke hoga. Pakka?")) return;
    speaker.stop();
    await api.deleteAccount().catch(() => undefined);
    onLoggedOut();
  };
  const sync = () => {
    api.sync().catch(handleError);
    setStatus((s) => (s ? { ...s, state: "syncing", message: "Naye emails check kar raha hoon…" } : s));
    window.setTimeout(() => api.status().then(setStatus).catch(() => undefined), 1500);
  };

  const firstSync = status && status.analyzed === 0;

  return (
    <div className="min-h-screen">
      <Header
        micSlot={
          <MicDock
            state={mic.state}
            enabled={micOn}
            caption={mic.caption}
            awaiting={mic.awaiting}
            agentSpeaking={speaker.speaking}
            wakeWord={wakeWord}
            error={mic.error}
            onToggle={toggleMic}
            onWakeWord={changeWake}
          />
        }
        me={me}
        status={status}
        lang={lang}
        mode={mode}
        onLang={changeLang}
        onMode={changeMode}
        onSync={sync}
        onLogout={logout}
        onGeminiKey={() => setKeyModal(true)}
        onDelete={deleteData}
      />

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:py-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Namaste, {me.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-ink-soft">Bas bolo. Important emails apne aap popup mein aa jaayenge.</p>
        </div>

        {keyStatus && !keyStatus.hasKey && !keyStatus.serverKeyAllowed && (
          <GeminiKeyCard
            status={keyStatus}
            onSaved={(s) => {
              setKeyStatus(s);
              api.status().then(setStatus).catch(() => undefined);
            }}
          />
        )}

        <VoicePanel
          speaking={speaker.speaking}
          busy={busy}
          listeningHint={listeningHint}
          messages={messages}
          onOpen={setOpenItem}
          onStopSpeaking={speaker.stop}
          onBriefing={() => {
            speaker.stop();
            push({ role: "user", text: "Aaj ki briefing" });
            void loadBriefing(true);
          }}
          onAsk={ask}
          onReplay={speaker.speak}
        />

        {firstSync ? (
          <div className="rounded-2xl border border-dashed border-line bg-card p-8 text-center">
            {status.state === "needs_key" ? (
              <>
                <p className="font-medium">Emails download ho gaye, ab sirf Gemini key chahiye.</p>
                <p className="mt-1 text-sm text-ink-soft">Upar apni key jodte hi AI emails samajhna shuru kar dega aur cards yahan aa jaayenge.</p>
              </>
            ) : (
              <>
                <p className="font-medium">Aapka inbox pehli baar padh raha hoon…</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {status.message || "Isme 1–3 minute lag sakte hain."} Ye page khula rakho, cards apne aap aa jaayenge.
                </p>
              </>
            )}
          </div>
        ) : briefing ? (
          <div>
            <h2 className="mb-4 text-lg font-semibold">
              Pichhle {briefing.windowHours} ghante ki briefing
            </h2>
            <BriefingView briefing={briefing} onOpen={setOpenItem} />
          </div>
        ) : null}
      </main>

      <StatusPopups
        popups={popups}
        onDismiss={(key) => setPopups((cur) => cur.filter((p) => p.key !== key))}
        onOpen={setOpenItem}
      />
      {keyModal && keyStatus && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Gemini API key">
          <button type="button" aria-label="Band karo" onClick={() => setKeyModal(false)} className="backdrop-in absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="modal-in relative w-full max-w-xl">
            <GeminiKeyCard status={keyStatus} onSaved={setKeyStatus} onClose={() => setKeyModal(false)} />
          </div>
        </div>
      )}
      {openItem && <EmailModal item={openItem} onClose={() => setOpenItem(null)} onSpeak={speaker.speak} />}

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-ink-soft">
        VaaniMail AI · Phase 1 · Read-only Gmail access · Har card ka "Verified" tag original email se check hota hai.
      </footer>
    </div>
  );
}
