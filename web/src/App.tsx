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
import { WAKE_WORD } from "./brand";
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
  /(briefing|summary|summarise|summarize|brief me|what('?s| is) (new|important)|anything important|aaj.{0,25}(summary|important|zaroori|jaruri|kya aaya|kya hai)|aaj.{0,25}(important|zaroori|jaruri|kya aaya|kya hai)|today.{0,20}(important|inbox|mail)|आज.{0,25}(ज़रूरी|जरूरी|इम्पोर्टेंट|क्या आया)|इम्पोर्टेंट|ब्रीफिंग)/i;

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
    return <div className="hud-label flex min-h-screen items-center justify-center">Initialising…</div>;
  }
  if (me === null) return <Login error={error} />;
  return <Dashboard me={me} onLoggedOut={() => setMe(null)} />;
}

function Dashboard({ me, onLoggedOut }: { me: Me; onLoggedOut: () => void }) {
  const [lang, setLang] = useState<Lang>(() => readPref("vm_lang", ["hinglish", "hi", "en"] as const, "en"));
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

  // Chrome extension handshake: if the Vaani extension is installed but not yet
  // connected, give it a personal access token (only via this same window).
  const [ext, setExt] = useState<"absent" | "connecting" | "connected">("absent");
  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      if (e.source !== window || e.origin !== location.origin) return;
      const m = e.data as { source?: string; type?: string; connected?: boolean };
      if (m?.source !== "vaani-ext") return;
      if (m.type === "connected" || (m.type === "hello" && m.connected)) return setExt("connected");
      if (m.type === "hello" && !m.connected) {
        setExt("connecting");
        try {
          const { token } = await api.connectExtension();
          window.postMessage({ source: "vaani-web", type: "token", token }, location.origin);
        } catch {
          setExt("absent");
        }
      }
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: "vaani-web", type: "ping" }, location.origin);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof AuthError) return onLoggedOut();
      if ((err as { code?: string }).code === "NEEDS_GEMINI_KEY") {
        setKeyStatus((k) => (k ? { ...k, hasKey: false } : k));
      }
      push({ role: "agent", text: (err as Error).message || "Something went wrong.", error: true });
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
    ? "Voice needs Chrome or Edge. You can type commands below."
    : !micOn
      ? "Mic is off. Turn it on from the mic in the top-left corner."
      : mic.state === "blocked"
        ? "Allow microphone access (lock icon in the address bar)."
        : wakeWord
          ? `Say: "${WAKE_WORD}, what's important today?"`
          : `Say: "What's important today?"`;

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
    if (!window.confirm("This deletes all your data here and revokes Google access. Continue?")) return;
    speaker.stop();
    await api.deleteAccount().catch(() => undefined);
    onLoggedOut();
  };
  const sync = () => {
    api.sync().catch(handleError);
    setStatus((s) => (s ? { ...s, state: "syncing", message: "Checking for new email…" } : s));
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

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:py-8">
        <div>
          <p className="hud-label">Session active</p>
          <h1 className="hud-title mt-1 text-3xl font-bold text-snow sm:text-4xl">
            Welcome back, {me.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-lg text-dim">Just speak. Important emails appear as alerts on their own.</p>
        </div>

        <div className={`hud-panel flex flex-wrap items-center gap-4 px-5 py-4 ${ext === "connected" ? "hud-panel-glow" : ""}`}>
          <div className="min-w-0 flex-1">
            <p className="hud-label">Gmail overlay · Chrome extension</p>
            {ext === "connected" ? (
              <p className="mt-1 text-xl font-semibold">Connected. Open Gmail and say "{WAKE_WORD}, give me today's summary".</p>
            ) : ext === "connecting" ? (
              <p className="mt-1 text-xl font-semibold">Connecting the extension…</p>
            ) : (
              <p className="mt-1 text-lg text-dim">
                Tip: the <b className="text-snow">Vaani Chrome extension</b> works on its own inside Gmail — no server or dashboard needed.
                Install it from the <code className="font-mono text-cy2">extension</code> folder (see README).
              </p>
            )}
          </div>
          {ext === "connected" && (
            <a href="https://mail.google.com/mail/u/0/#inbox" className="hud-btn hud-btn-solid">Open Gmail</a>
          )}
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
            push({ role: "user", text: "Today's briefing" });
            void loadBriefing(true);
          }}
          onAsk={ask}
          onReplay={speaker.speak}
        />

        {firstSync ? (
          <div className="hud-panel p-8 text-center">
            {status.state === "needs_key" ? (
              <>
                <p className="hud-label">Awaiting AI key</p>
                <p className="mt-2 text-xl font-semibold">Your emails are downloaded. Add your Gemini key to start the analysis.</p>
                <p className="mt-1 text-dim">Cards will appear here as soon as the key is saved.</p>
              </>
            ) : (
              <>
                <p className="hud-label">Initial scan</p>
                <p className="mt-2 text-xl font-semibold">Reading your inbox for the first time…</p>
                <p className="mt-1 text-dim">
                  {status.message || "This can take 1–3 minutes."} Keep this page open; cards will appear automatically.
                </p>
              </>
            )}
          </div>
        ) : briefing ? (
          <div>
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <p className="hud-label">Intelligence report</p>
                <h2 className="mt-1 text-2xl font-bold text-snow">Last {briefing.windowHours} hours</h2>
              </div>
              <p className="font-mono text-[11px] tracking-[0.12em] text-dim">
                GENERATED {new Date(briefing.generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
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
          <button type="button" aria-label="Close" onClick={() => setKeyModal(false)} className="backdrop-in absolute inset-0 bg-[rgba(2,8,20,.72)] backdrop-blur-[3px]" />
          <div className="modal-in relative w-full max-w-xl">
            <GeminiKeyCard status={keyStatus} onSaved={setKeyStatus} onClose={() => setKeyModal(false)} />
          </div>
        </div>
      )}
      {openItem && <EmailModal item={openItem} onClose={() => setOpenItem(null)} onSpeak={speaker.speak} />}

      <footer className="mx-auto max-w-7xl px-4 pb-8 font-mono text-[10.5px] uppercase tracking-[0.14em] text-dim">
        Gmail changes only after your confirmation · "Verified" = status proven by the original email
      </footer>
    </div>
  );
}
