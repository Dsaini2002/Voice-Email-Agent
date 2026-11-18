/**
 * Vaani overlay for Gmail.
 * Everything happens inside the Gmail tab: a transparent JARVIS-style layer on
 * top of the inbox, a mic box in the bottom-left corner, and voice commands that
 * open Gmail folders in the same tab or act on Gmail (e.g. delete all spam).
 */
import { findCompose, addRecipient, setSubject, replaceBody, bodyText, spokenToText, writeBody, parseWriteHere, parseBoxChange, recipientNames, isReplyBox, openedMessageId, press, composeButton, replyButton, type ComposeBox } from "./gmailCompose";
import { placeholders } from "../../../server/src/ai/replyCore";
import type { Briefing, BriefingItem } from "../../../shared/types";
import { api, getSettings, usefulVoices, voiceLabel, VOICE_SAMPLE } from "../shared";
import { FOLDER_HASH, FOLDER_LABEL, FOLDER_SIDEBAR, parseCommand, type Command, type FilterKey, type Folder, type Period } from "./commands";
import { smallTalk } from "./smalltalk";
import { cleanName, nameProblem } from "./wake";
import { Listener, Speaker } from "./speech";
import { CSS } from "./styles";

/** The assistant's name — the user picks it on first run. It is also the wake word. */
let NAME = "Vaani";
let named = false;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Theme = { label: string; cls: string };
const THEME: Record<string, Theme> = {
  offer: { label: "Offer", cls: "t-white" },
  interview: { label: "Interview", cls: "t-blue" },
  shortlisted: { label: "Shortlisted", cls: "t-cy" },
  assessment: { label: "Test", cls: "t-cy2" },
  application_received: { label: "Applied", cls: "t-dim" },
  rejected: { label: "Rejected", cls: "t-dim" },
  action: { label: "Action", cls: "t-white" },
  personal: { label: "Personal", cls: "t-cy2" },
  finance: { label: "Bank", cls: "t-blue" },
  security: { label: "Scam alert", cls: "t-alert" },
  unverified: { label: "Verify", cls: "t-white" },
  important: { label: "Important", cls: "t-cy" },
  fresh: { label: "New", cls: "t-dim" },
  event: { label: "Event", cls: "t-blue" },
  log: { label: "Done", cls: "t-dim" },
  i_help_request: { label: "Help", cls: "t-white" }, i_question: { label: "Question", cls: "t-cy" }, i_meeting: { label: "Meeting", cls: "t-blue" },
  i_task: { label: "To do", cls: "t-white" }, i_deadline: { label: "Deadline", cls: "t-white" }, i_payment: { label: "Bill", cls: "t-blue" },
  i_order: { label: "Order", cls: "t-cy2" }, i_travel: { label: "Travel", cls: "t-cy2" }, i_education: { label: "College", cls: "t-cy" },
  i_security: { label: "Security", cls: "t-alert" }, i_personal: { label: "Personal", cls: "t-cy2" }, i_update: { label: "Update", cls: "t-dim" },
  note: { label: "Note", cls: "t-cy2" },
};
function themeKey(i: BriefingItem): string {
  if (i.kind) return i.kind;
  if (i.basic) return "fresh";
  if (i.category !== "scam" && i.status === "none" && i.intent && INTENT_THEME[i.intent]) return `i_${i.intent}`;
  if (i.category === "scam") return "security";
  if (i.status !== "none") return i.verified ? i.status : "unverified";
  if (i.actionText) return "action";
  if (i.category === "personal") return "personal";
  if (i.category === "finance") return "finance";
  return "important";
}
const theme = (i: BriefingItem) => THEME[themeKey(i)] ?? THEME.important;

// ---------------------------------------------------------------------------
// Boxes built from what's actually in YOUR inbox (not job-only): help requests, questions, bills…
// ---------------------------------------------------------------------------
const INTENT_THEME: Record<string, true> = { help_request: true, question: true, meeting: true, task: true, deadline: true, payment: true, order: true, travel: true, education: true, security: true, personal: true, update: true };
const BUCKET: Record<string, { label: string; one: string; many: string }> = {
  help_request: { label: "Help requests", one: "1 help request", many: "# help requests" },
  question: { label: "Questions for you", one: "1 question for you", many: "# questions for you" },
  task: { label: "To do", one: "1 thing to do", many: "# things to do" },
  deadline: { label: "Deadlines", one: "1 deadline", many: "# deadlines" },
  meeting: { label: "Meetings & invites", one: "1 meeting invite", many: "# meeting invites" },
  job: { label: "Job updates", one: "1 job update", many: "# job updates" },
  payment: { label: "Bills & payments", one: "1 bill or payment", many: "# bills and payments" },
  education: { label: "School & college", one: "1 school or college notice", many: "# school and college notices" },
  personal: { label: "Personal", one: "1 personal message", many: "# personal messages" },
  order: { label: "Orders & deliveries", one: "1 order update", many: "# order updates" },
  travel: { label: "Travel", one: "1 travel update", many: "# travel updates" },
  update: { label: "Updates", one: "1 update", many: "# updates" },
  security: { label: "Security", one: "1 security alert", many: "# security alerts" },
};
const BASE_ORDER = ["help_request", "question", "task", "deadline", "meeting", "job", "payment", "education", "personal", "order", "travel", "update", "security"];
/** Your answer to "What do you use email for?" moves those boxes up. */
const BOOST: Record<string, string[]> = {
  job: ["job"], study: ["education", "deadline"], work: ["meeting", "task", "question"], business: ["payment", "order", "question"], personal: ["personal", "help_request"],
};
let useFor: string[] = [];
function itemIntent(i: BriefingItem): string {
  if (i.category === "scam") return "security";
  if (i.status !== "none") return "job";
  if (i.intent && BUCKET[i.intent]) return i.intent;
  if (i.category === "job") return "job";
  if (i.category === "finance") return "payment";
  if (i.category === "education") return "education";
  if (i.category === "personal") return "personal";
  if (i.category === "travel") return "travel";
  if (i.category === "shopping") return "order";
  return i.actionText ? "task" : "update";
}
function bucketOrder(): string[] {
  const boosted = useFor.flatMap((u) => BOOST[u] ?? []);
  return [...new Set([...boosted.filter((b) => BASE_ORDER.indexOf(b) <= 2 || true), ...BASE_ORDER])].sort((a, b) => {
    // "someone is waiting for you" stays on top; then your chosen uses; then the rest
    const top = (k: string) => (["help_request", "question"].includes(k) ? 0 : boosted.includes(k) ? 1 : 2);
    return top(a) - top(b) || BASE_ORDER.indexOf(a) - BASE_ORDER.indexOf(b);
  });
}
function buckets(items: BriefingItem[]) {
  const order = bucketOrder();
  const map = new Map<string, BriefingItem[]>();
  for (const i of items) {
    const k = itemIntent(i);
    map.set(k, [...(map.get(k) ?? []), i]);
  }
  return order.filter((k) => map.has(k)).map((k) => ({ key: k, label: BUCKET[k].label, items: map.get(k)! }));
}
const bucketPhrase = (key: string, n: number) => (n === 1 ? BUCKET[key].one : BUCKET[key].many.replace("#", String(n)));

const FILTER_LABEL: Record<FilterKey, string> = {
  interview: "interview", shortlisted: "shortlisted", offer: "offer", rejected: "rejection", assessment: "test",
  action: "action-needed", personal: "personal", finance: "bank and payment", security: "scam", application_received: "application",
};

function deadline(iso: string): { label: string; hot: boolean } | null {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso}T00:00:00`);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const pretty = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }).toUpperCase();
  if (days < 0) return { label: `OVERDUE · ${pretty}`, hot: true };
  if (days === 0) return { label: "DUE · TODAY", hot: true };
  if (days === 1) return { label: "DUE · TOMORROW", hot: true };
  return { label: `DUE · ${pretty}`, hot: days <= 3 };
}
const spokenDeadline = (iso: string) => {
  const d = deadline(iso);
  if (!d) return "";
  return d.label.includes("TODAY") ? " It is due today." : d.label.includes("TOMORROW") ? " It is due tomorrow." : "";
};
const time = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }).toUpperCase();
};
const ORD = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth"];
const joinNames = (n: string[]) => (n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`);

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
type View = "none" | "briefing" | "list" | "focus" | "full" | "confirm" | "thinking" | "setup" | "replyask" | "draft" | "voice" | "compose" | "stats" | "report";
/** A small report panel (funnel, weekly report, response times, import, alerts). */
interface Report { tag: string; title: string; cells: [string, string | number][]; lists: { title: string; rows: string[] }[]; acts: [string, string][] }

/** Answers that come straight from the SQLite history. */
interface HistItem { id: string; threadId: string; entity: string; subject: string; summary: string; date: string; status: BriefingItem["status"]; category: BriefingItem["category"]; verified: boolean; actionText: string; deadline: string }
interface Journey { entity: string; current: BriefingItem["status"]; firstDate: string; lastDate: string; steps: { status: BriefingItem["status"]; date: string; id: string }[]; latestId: string; threadId: string }
interface StatsData { total: number; byStatus: Record<string, number>; byCategory: { category: string; n: number }[]; topSenders: { sender: string; n: number }[]; perMonth: { month: string; n: number; jobs: number }[]; label: string }

interface ReplyInfo { item: BriefingItem; to: string; toName: string; subject: string; noReply: boolean; asks: string[]; options: string[] }
/** New email being put together by voice: who → what → draft. */
interface ComposeInfo { step: "to" | "topic"; to: string; email: string; topic: string; msg: string }
interface DraftInfo { mode: "reply" | "compose"; item: BriefingItem | null; to: string; toName: string; subject: string; noReply: boolean; body: string; hints: string[]; spoken: string; intent: string; countdown: number | null; sending: boolean }

interface SetupStatus {
  clientIdOk: boolean;
  clientIdShort: string | null;
  redirectUri: string;
  signedIn: boolean;
  email: string;
  name: string;
  hasGeminiKey: boolean;
  keyLast4: string | null;
  sync: { state: string; message: string; total: number; analyzed: number; lastSyncAt: string | null };
  /** Signed in before Calendar & Notes existed: sign in once more to allow them. */
  needsReauth?: boolean;
}
const st = {
  view: "none" as View,
  command: "",
  modeLabel: "",
  count: "",
  subtitle: "",
  items: [] as BriefingItem[],
  current: -1,
  listTitle: "",
  focus: null as BriefingItem | null,
  day: null as Briefing | null,
  week: null as Briefing | null,
  loadedAt: 0,
  confirm: null as { kind?: "spam" | "readall"; count: number; preview: { from: string; subject: string }[] } | null,
  compose: null as ComposeInfo | null,
  stats: null as StatsData | null,
  report: null as Report | null,
  /** Waiting for the user to say what they'd like to call the assistant. */
  naming: false,
  hints: [] as string[],
  menu: false,
  connected: true,
  setup: null as SetupStatus | null,
  setupMsg: "",
  setupErr: false,
  setupBusy: false,
  toast: null as { text: string; label: string; err?: boolean; undo?: boolean } | null,
  reply: null as ReplyInfo | null,
  draft: null as DraftInfo | null,
  /** Small chat bubble above the mic (small talk / quick answers) — no big window. */
  chat: null as { you: string; text: string; until: number; thinking?: boolean } | null,
};
let engagedUntil = 0; // for a short while after Vaani talks with you, clear commands work without "Vaani"
const firstName = () => (st.setup?.name ?? "").split(" ")[0];
const hi = () => (firstName() ? `Hi ${firstName()}! ` : "Hi! ");
const blanks = (body: string) => [...new Set(body.match(/\[[^\]\n]{1,60}\]/g) ?? [])];
let toastTimer = 0;
let runId = 0; // increases on every new command so old briefings stop

// ---------------------------------------------------------------------------
// DOM: shadow root so Gmail's CSS/JS can't touch the overlay
// ---------------------------------------------------------------------------
function injectFonts() {
  if (document.getElementById("vaani-fonts")) return;
  const f = (name: string, file: string, weight: number) =>
    `@font-face{font-family:${name};src:url(${chrome.runtime.getURL(`fonts/${file}`)}) format("woff2");font-weight:${weight};font-display:swap}`;
  const style = document.createElement("style");
  style.id = "vaani-fonts";
  style.textContent = [
    f("VSora", "sora-latin-600-normal.woff2", 600),
    f("VSora", "sora-latin-700-normal.woff2", 700),
    f("VGrotesk", "space-grotesk-latin-400-normal.woff2", 400),
    f("VGrotesk", "space-grotesk-latin-500-normal.woff2", 500),
    f("VGrotesk", "space-grotesk-latin-600-normal.woff2", 600),
    f("VGrotesk", "space-grotesk-latin-700-normal.woff2", 700),
    f("VMono", "jetbrains-mono-latin-500-normal.woff2", 500),
  ].join("");
  document.head.appendChild(style);
}

const host = document.createElement("div");
host.id = "vaani-overlay-host";
host.setAttribute("style", "all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;");
const root = host.attachShadow({ mode: "closed" });
root.innerHTML = `<style>${CSS}</style><div class="overlay" id="ov"></div><div id="toast"></div><div class="micwrap" id="mic"></div>`;
const $ov = root.getElementById("ov")!;
const $mic = root.getElementById("mic")!;
const $toast = root.getElementById("toast")!;

// Keys typed into our input must not trigger Gmail shortcuts (c = compose, # = delete…).
for (const ev of ["keydown", "keypress", "keyup"]) {
  root.addEventListener(ev, (e) => {
    const t = e.target as HTMLElement;
    if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") e.stopPropagation();
  });
}

const speaker = new Speaker(() => {
  renderMic();
  if (st.view === "voice") render(); // voices load a moment after the page
});
const listener = new Listener(
  () => renderMic(),
  (text, wake) => onHeard(text, wake),
  () => {
    speaker.stop();
    runId++;
    if (st.view === "briefing") {
      st.subtitle = "Okay, I'll stop here.";
      render();
    }
  },
);
listener.agentSpeaking = () => speaker.speaking;
// You talk over the assistant → it stops talking immediately (your command then runs as usual).
listener.onBargeIn = () => {
  if (!speaker.speaking) return;
  speaker.stop();
  runId++; // a briefing in progress stops here
};
listener.agentText = () => `${speaker.lastText} ${speaker.recentText()}`;
listener.onAwake = () => {
  if (document.hidden) void chrome.runtime.sendMessage({ type: "tab", action: "front" }).catch(() => undefined);
  st.chat = { you: NAME, text: "Yes? I'm listening.", until: Date.now() + 8000 };
  renderMic();
  void say("Yes?");
};
/** Act on a sentence before Chrome "finalises" it — only for short, unambiguous commands (never dictation). */
listener.quickOk = (text) => {
  if (st.view === "replyask" || st.view === "draft") return false; // the user may still be dictating
  const cmd = parseCommand(text, entities(), labelNames);
  if (cmd.type === "reply" || cmd.type === "ask") return Boolean(smallTalk(text));
  // These usually go on ("write an email… to Rahul… about…"): wait for the user's pause instead.
  if (NEEDS_MORE.has(cmd.type)) return false;
  return text.split(/\s+/).length <= 8;
};

const NEEDS_MORE = new Set(["compose", "calendar", "noteAdd", "find", "rename", "focus", "history", "watch", "count", "tracker", "intentList", "label", "createLabel", "applyLabel"]);
/** Commands clear enough to run even without saying "Vaani" first. */
const CLEAR = new Set(["folder", "summary", "full", "filter", "trashSpam", "reply", "voice", "openCurrent", "undo"]);
const IN_FLOW = new Set<View>(["replyask", "draft", "confirm", "compose"]);
const CLEAR_V2 = ["compose", "gmailAct", "readAll", "calendar", "noteAdd", "notesList", "find", "rename", "rate"];
CLEAR_V2.forEach((c) => CLEAR.add(c));

/**
 * Decides what to do with a sentence heard WITHOUT the wake word, so Vaani "gets" what you mean:
 * clear Gmail commands just work; small talk works while you're chatting; random room talk is ignored
 * (and never spends your AI quota).
 */
function onHeard(text: string, wake: boolean) {
  if (document.hidden) {
    // You're in another tab: only your assistant's name wakes it up (then Gmail comes to the front).
    if (!wake) return;
    void chrome.runtime.sendMessage({ type: "tab", action: "front" }).catch(() => undefined);
    return void run(text);
  }
  if (wake || st.naming) return void run(text);
  const words = text.trim().split(/\s+/).length;
  const cmd = parseCommand(text, entities(), labelNames);
  const engaged = st.view !== "none" || Date.now() < engagedUntil;
  if (IN_FLOW.has(st.view)) return void run(text); // answering Vaani's question (yes / no / what to say)
  if (findCompose() && (parseWriteHere(text) || (parseBoxChange(text) && gbox) || Date.now() < gboxAskUntil || (cmd.type === "send" && gbox))) return void run(text);
  if (CLEAR.has(cmd.type) && words <= 8) return void run(text);
  if (engaged && ["stop", "close", "cancel", "confirm", "send", "saveDraft", "readAgain", "focus"].includes(cmd.type)) return void run(text);
  if (engaged && smallTalk(text)) return void run(text);
  if (engaged && cmd.type === "ask" && words >= 3) return void run(text);
  // Heard you, but it didn't sound meant for me: say so quietly (on screen only) instead of ignoring you.
  if (words >= 3 && Date.now() - lastNameHint > 20000) {
    lastNameHint = Date.now();
    st.chat = { you: text, text: `I heard you! If that was for me, start with "${NAME}", like "${NAME}, ${text.slice(0, 40)}".`, until: Date.now() + 6000 };
    renderMic();
    window.setTimeout(renderMic, 6100);
  }
}
let lastNameHint = 0;

async function say(text: string): Promise<boolean> {
  const ok = await speaker.say(text);
  listener.agentStopped();
  return ok;
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
/** A periodic voice wave (it scrolls forever without a seam). */
function wavePaths(w: number, h: number, lines: number, cycles: number, seed = 0): string {
  let out = "";
  const mid = Math.floor(lines / 2);
  for (let k = 0; k < lines; k++) {
    const amp = h * 0.44 * (0.35 + 0.65 * Math.abs(Math.cos(k * 0.55 + seed)));
    let d = `M0 ${h / 2}`;
    for (let x = 0; x <= 2 * w; x += w / 90) {
      const env = 0.55 + 0.45 * Math.sin((x / w) * 2 * Math.PI + k + seed);
      d += ` L${x.toFixed(1)} ${(h / 2 + Math.sin((x / w) * cycles * 2 * Math.PI + k * 0.8 + seed) * amp * env).toFixed(1)}`;
    }
    const color = k === mid ? "#ffffff" : k % 2 ? "#2a6bff" : "#9fe3ff";
    out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${k === mid ? 2.6 : 1.5}" stroke-linecap="round" opacity="${(0.45 + 0.5 * (k / lines)).toFixed(2)}" vector-effect="non-scaling-stroke"/>`;
  }
  return out;
}
const RIBBON = `<svg viewBox="0 0 1600 200" preserveAspectRatio="none"><g class="amp">${wavePaths(800, 200, 7, 3)}</g></svg><svg viewBox="0 0 1600 200" preserveAspectRatio="none"><g class="amp">${wavePaths(800, 200, 4, 2, 1.3)}</g></svg>`;
const MINI_WAVE = `<svg viewBox="0 0 112 30" preserveAspectRatio="none"><g class="amp">${wavePaths(56, 30, 3, 2)}</g></svg>`;

const eq = (on: boolean) => `<span class="eqs ${on ? "on" : ""}"><i></i><i></i><i></i><i></i><i></i></span>`;

function card(i: BriefingItem, idx: number | null, cls = "") {
  const t = theme(i);
  const dl = deadline(i.deadline);
  const meta = [
    i.actionText && themeKey(i) !== "security" ? `<span class="chip">${esc(i.actionText)}</span>` : "",
    dl ? `<span class="chip ${dl.hot ? "hot" : ""}">${dl.label}</span>` : "",
    i.mergedCount > 1 ? `<span class="chip">${i.mergedCount} MERGED</span>` : "",
    i.basic ? "" : themeKey(i) === "security" ? "" : i.verified ? `<span class="chip">✓ VERIFIED</span>` : `<span class="chip hot">⚠ CHECK MANUALLY</span>`,
  ].join("");
  const right = cls.includes("now") ? `<span class="speaking mono">${eq(true)} SPEAKING</span>` : i.kind === "note" ? "" : `<span class="time mono">${esc(time(i.date))}</span>`;
  return `<button class="hc pa ${cls}" data-focus="${esc(i.gmailId)}">
    <div class="top">${idx !== null ? `<span class="idx mono">${String(idx + 1).padStart(2, "0")}</span>` : ""}<span class="tag ${t.cls}">${t.label}</span>${right}</div>
    <div class="co">${esc(i.entity)}</div><div class="sum">${esc(i.ask || i.summary)}</div>
    ${meta ? `<div class="meta">${meta}</div>` : ""}</button>`;
}

function hintsHtml() {
  if (!st.hints.length) return "";
  return `<div class="hints"><span class="k mono">SAY ›</span>${st.hints
    .map((h) => `<button class="hint pa" data-cmd="${esc(h)}">"${esc(NAME)}, <b>${esc(h)}</b>"</button>`)
    .join("")}</div>`;
}

function commandBar() {
  return `<div class="cmd pa"><span class="dot"></span><span class="lbl mono">COMMAND</span><span class="q">"${esc(st.command)}"</span>${
    st.count ? `<span class="count mono">${esc(st.count)}</span>` : ""
  }</div>${ccButton()}<button class="closeX pa" data-cmd="close" title="Close (Esc)">✕</button>`;
}

function coreHtml(sub: string) {
  const busy = st.view === "thinking" || speaker.speaking;
  return `<div class="core ${busy ? "busy" : ""}"><div class="nm"><b>${esc(NAME)}</b><small>${esc(sub)}</small></div><div class="ribbon">${RIBBON}</div></div>`;
}

/** Subtitles on/off (CC button, menu, popup, or "subtitles off"). */
let subtitlesOn = true;
const flatText = (t: string) => t.replace(/\s+/g, " ").trim();

function highlight(text: string) {
  let html = esc(text);
  const names = [...new Set(st.items.map((i) => i.entity).concat(st.focus ? [st.focus.entity] : []))].filter((n) => n.length > 1);
  for (const n of names.sort((a, b) => b.length - a.length)) {
    const e = esc(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(`\\b${e}\\b`, "g"), `<mark>${esc(n)}</mark>`);
  }
  return html.replace(/(₹[\d,]+)/g, "<mark>$1</mark>");
}

/** Spoken part bright, the rest dim — the words light up as the assistant says them. */
const ccButton = () =>
  `<button class="ccbtn pa ${subtitlesOn ? "on" : ""}" data-act="cc" title="Subtitles ${subtitlesOn ? "on" : "off"} (say: subtitles ${subtitlesOn ? "off" : "on"})" aria-pressed="${subtitlesOn}">CC <b>${subtitlesOn ? "ON" : "OFF"}</b></button>`;

function subtitleInner(spoken: number | null) {
  const text = st.subtitle;
  const said = flatText(speaker.lastText);
  const flat = flatText(text);
  const k = said.indexOf(flat); // the subtitle is (part of) what's being spoken
  if (spoken === null || k < 0 || !speaker.speaking) return `"${highlight(text)}"`;
  const upto = Math.max(0, Math.min(flat.length, spoken - k));
  return `"<span class="said">${highlight(flat.slice(0, upto))}</span><span class="rest">${highlight(flat.slice(upto))}</span>"`;
}

function subtitleHtml() {
  if (!st.subtitle || !subtitlesOn) return "";
  return `<div class="subtitle"><div class="who mono">${esc(NAME)} ›</div><p>${subtitleInner(speaker.speaking ? spokenChars : null)}</p></div>`;
}
let spokenChars = 0;
speaker.onProgress = (n) => {
  spokenChars = n;
  // update only the subtitle line (re-rendering the whole layer would restart the animations)
  const p = root.querySelector(".subtitle p");
  if (p) p.innerHTML = subtitleInner(n);
};

function readouts(b: Briefing | null) {
  if (!b) return "";
  const s = b.stats;
  // a compact row above the cards — never on top of the assistant's name
  return `<div class="readouts">
    <div class="ro"><div class="v">${s.shownEmails}</div><div class="k mono">important</div></div>
    <div class="ro"><div class="v">${s.hiddenSpamPromo}</div><div class="k mono">promo hidden</div></div>
    <div class="ro ${s.scamCount ? "alert" : ""}"><div class="v">${s.scamCount}</div><div class="k mono">scam</div></div></div>`;
}

/**
 * Updates a part of the overlay WITHOUT the "restart" effect:
 * - skips the update when nothing changed (animations keep running),
 * - keeps what the user is typing, the cursor position and the scroll position.
 */
const lastHtml = new WeakMap<Element, string>();
let renderCount = 0;
function patch(el: HTMLElement, html: string) {
  if (lastHtml.get(el) === html) return;
  renderCount++;
  const inputs = new Map<string, { value: string; focused: boolean; start: number | null; end: number | null }>();
  el.querySelectorAll("input[type=text], input[type=password], textarea").forEach((n) => {
    const i = n as HTMLInputElement;
    const key = i.getAttribute("aria-label") ?? "";
    inputs.set(key, { value: i.value, focused: root.activeElement === i, start: i.selectionStart, end: i.selectionEnd });
  });
  const scrolls = new Map<string, number>();
  const SCROLLERS = ["setup", "stack", "cols", "vlist"];
  el.querySelectorAll(".setup, .stack, .cols, .vlist").forEach((n) => scrolls.set(n.className.split(" ").find((c) => SCROLLERS.includes(c))!, n.scrollTop));

  el.innerHTML = html;
  lastHtml.set(el, html);

  el.querySelectorAll("input[type=text], input[type=password], textarea").forEach((n) => {
    const i = n as HTMLInputElement;
    const prev = inputs.get(i.getAttribute("aria-label") ?? "");
    if (!prev) return;
    if (i.tagName !== "TEXTAREA") i.value = prev.value; // the reply text always comes from state
    if (prev.focused) {
      i.focus();
      if (prev.start !== null) i.setSelectionRange(prev.start, prev.end ?? prev.start);
    }
  });
  scrolls.forEach((top, cls) => {
    const n = el.querySelector(`.${cls}`);
    if (n) n.scrollTop = top;
  });
}

function render() {
  if (st.view === "none") {
    $ov.className = "overlay";
    window.setTimeout(() => st.view === "none" && ($ov.innerHTML = ""), 260);
    renderMic();
    return;
  }
  const frame = `<div class="bg"></div><div class="edge tl"></div><div class="edge tr"></div><div class="edge bl"></div><div class="edge br"></div>`;
  let body = "";

  if (st.view === "thinking") {
    body = `${commandBar()}${coreHtml("PROCESSING")}${subtitleHtml()}`;
  } else if (st.view === "briefing" || st.view === "list") {
    const cards = st.items
      .map((it, i) => {
        if (st.view === "list") return card(it, i, i === st.current ? "now" : "");
        if (i < st.current) return card(it, i, "done");
        if (i === st.current) return card(it, i, "now");
        if (i === st.current + 1) return card(it, i, "incoming");
        return "";
      })
      .join("");
    body = `${commandBar()}
      <div class="stack pa">${st.view === "briefing" ? readouts(st.day) : ""}<div class="stack-h mono"><span>${esc(st.listTitle)}</span><b>${st.items.length} ITEM${st.items.length === 1 ? "" : "S"}</b></div><div class="timeline"></div>${
        cards || `<div class="stack-h mono" style="margin-top:8px"><span>NOTHING FOUND</span></div>`
      }</div>
      ${coreHtml(st.modeLabel)}${subtitleHtml()}${hintsHtml()}`;
  } else if (st.view === "focus" && st.focus) {
    const i = st.focus;
    const t = theme(i);
    const dl = deadline(i.deadline);
    const conf = Math.round(i.confidence * 100);
    const security = themeKey(i) === "security";
    body = `${commandBar()}
      <div class="focus pa">
        <div style="display:flex;align-items:center;gap:14px"><span class="tag ${t.cls}">${t.label}</span><span class="mono" style="font-size:11px;color:var(--dim)">${esc(time(i.date))}</span></div>
        <div class="big">${esc(i.entity)}</div><div class="subj">${esc(i.subject)}</div>
        <div class="sumbig">${esc(i.summary)}</div>
        <div class="grid2">
          ${i.ask && !security ? `<div class="cell" style="grid-column:1/-1"><div class="k mono">THEY WANT</div><div class="v">${esc(i.ask)}</div></div>` : ""}
          ${i.actionText && !security ? `<div class="cell"><div class="k mono">TO DO</div><div class="v">${esc(i.actionText)}</div></div>` : ""}
          ${dl ? `<div class="cell ${dl.hot ? "hot" : ""}"><div class="k mono">DEADLINE</div><div class="v">${dl.label.replace("DUE · ", "")}</div></div>` : ""}
          ${i.mergedCount > 1 ? `<div class="cell"><div class="k mono">REMINDERS</div><div class="v">${i.mergedCount} merged</div></div>` : ""}
        </div>
        ${security ? `<div class="cell hot" style="margin-top:14px;color:#ffb3b3">Do not open links in this email or share payments, OTPs or passwords.</div>` : `
        <div class="conf mono"><span>${i.verified ? "✓ VERIFIED" : "⚠ NOT VERIFIED"}</span><div class="bar"><i style="width:${conf}%"></i></div><span>AI CONFIDENCE ${conf}%</span></div>`}
        <div class="acts">${security ? "" : `<button class="btn solid" data-cmd="reply to this">Reply</button><button class="btn" data-cmd="archive it">Archive</button><button class="btn" data-cmd="add this to my calendar">Add to calendar</button>`}<button class="btn ${security ? "solid" : ""}" data-cmd="open it in gmail">Open in Gmail</button><button class="btn" data-speak="${esc(i.gmailId)}">Read aloud</button><button class="btn ghost" data-cmd="back">Back</button></div>
      </div>
      ${coreHtml("READING")}${subtitleHtml()}${hintsHtml()}`;
  } else if (st.view === "full") {
    const b = st.day;
    // The boxes come from what's in YOUR inbox today: help requests, questions, bills, job updates…
    const bs = buckets(allItems(b));
    const cols: [string, BriefingItem[], boolean][] = (bs.length > 4
      ? [...bs.slice(0, 3).map((x) => [x.label, x.items] as const), ["More", bs.slice(3).flatMap((x) => x.items)] as const]
      : bs.map((x) => [x.label, x.items] as const)
    ).map(([l, items]) => [l, items, items.some((x) => themeKey(x) === "security")]);
    const s = b?.stats;
    body = `${commandBar()}
      <div class="fullhead">${
        s
          ? [["IMPORTANT", s.shownEmails], ["PROMO HIDDEN", s.hiddenSpamPromo], ["DUPLICATES MERGED", s.duplicatesMerged], ["SCAM BLOCKED", s.scamCount]]
              .map(([k, v]) => `<div class="stat"><div class="k mono">${k}</div><div class="v">${v}</div></div>`)
              .join("")
          : ""
      }</div>
      ${typeof __TEST__ !== "undefined" && __TEST__ ? ((document.documentElement.dataset.vaaniCols = cols.map((c) => `${c[0]} (${c[1].length})`).join(" | ")), "") : ""}
      <div class="cols pa">${cols
        .map(
          ([title, items, alert]) =>
            `<div class="col"><h3 class="${alert && items.some((x) => themeKey(x) === "security") ? "alert" : ""}"><span>${title}</span><span>${String(items.length).padStart(2, "0")}</span></h3>${items
              .map((x) => card(x, null))
              .join("")}</div>`,
        )
        .join("")}</div>${hintsHtml()}`;
  } else if (st.view === "setup") {
    body = `${ccButton()}<button class="closeX pa" data-cmd="close" title="Close (Esc)">✕</button>${setupPanel()}${coreHtml(isReady() ? "ONLINE" : "SETUP")}`;
  } else if (st.view === "replyask" && st.reply) {
    const r = st.reply;
    body = `${commandBar()}
      <div class="confirm reply pa">
        <span class="tag t-cy">REPLY</span>
        <div class="big">${esc(r.item.entity)}</div>
        <div class="rto"><span class="k mono">TO</span>${esc(r.toName || r.to)} <span class="dim">&lt;${esc(r.to)}&gt;</span></div>
        <div class="rto"><span class="k mono">RE</span>${esc(r.subject)}</div>
        ${r.asks.length ? `<div class="k mono" style="margin-top:14px">THEY'RE ASKING</div><ul>${r.asks.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
        <div class="k mono" style="margin-top:14px">IDEAS · TAP ONE OR SAY YOUR OWN</div>
        <div class="ideas">${r.options.map((o, n) => `<button class="btn" data-cmd="${esc(o)}"><span class="mono">${n + 1}</span> ${esc(o)}</button>`).join("")}</div>
        <form data-act="intentform" class="keyform"><input type="text" placeholder="…or type what you want to say" autocomplete="off" aria-label="What to say"/><button class="btn solid" type="submit">Write it</button></form>
        ${r.noReply ? `<p class="warn">Heads up: this came from a no-reply address, so nobody will read a reply.</p>` : ""}
      </div>${coreHtml("LISTENING")}${subtitleHtml()}`;
  } else if (st.view === "draft" && st.draft) {
    const d = st.draft;
    const missing = blanks(d.body);
    const status = d.sending
      ? `<div class="say">Sending…</div>`
      : d.countdown !== null
        ? `<div class="say big2">Sending in <b>${d.countdown}</b>… say <b>"stop"</b> if you change your mind</div>`
        : missing.length
          ? `<div class="say warn">Please fill in ${missing.map((m) => `<b>${esc(m)}</b>`).join(", ")} in the text above, then say <b>"send"</b>.</div>`
          : `<div class="say">Say <b>"send"</b> · ask me to change something · or <b>"cancel"</b></div>`;
    const acts = d.countdown !== null || d.sending
      ? `<button class="btn alert" data-act="stopsend">Don't send</button>`
      : `<button class="btn solid" data-cmd="send it" ${missing.length || d.noReply || (d.mode === "compose" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.to)) ? "disabled" : ""}>Send</button><button class="btn" data-cmd="save as draft">Save as draft</button><button class="btn" data-cmd="read it again">Read again</button><button class="btn ghost" data-cmd="cancel">Discard</button>`;
    body = `${commandBar()}
      <div class="confirm draft pa">
        <span class="tag t-cy">${d.mode === "compose" ? "NEW EMAIL" : "YOUR REPLY"} · NOT SENT YET</span>
        ${d.mode === "compose"
          ? `<div class="field"><span class="k mono">TO</span><input type="text" aria-label="To" value="${esc(d.to)}" placeholder="name@example.com" ${d.countdown !== null || d.sending ? "readonly" : ""}/></div>
             <div class="field"><span class="k mono">SUBJECT</span><input type="text" aria-label="Subject" value="${esc(d.subject)}" ${d.countdown !== null || d.sending ? "readonly" : ""}/></div>`
          : `<div class="rto"><span class="k mono">TO</span>${esc(d.toName || d.to)} <span class="dim">&lt;${esc(d.to)}&gt;</span></div>
             <div class="rto"><span class="k mono">RE</span>${esc(d.subject)}</div>`}
        <textarea aria-label="Reply text" spellcheck="true" ${d.countdown !== null || d.sending ? "readonly" : ""}>${esc(d.body)}</textarea>
        ${d.hints.length ? `<div class="k mono" style="margin-top:12px">BEFORE YOU SEND</div><ul>${d.hints.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
        ${status}
        <div class="acts">${acts}</div>
      </div>${coreHtml(d.countdown !== null ? "SENDING" : "DRAFT READY")}${subtitleHtml()}${d.countdown === null ? hintsHtml() : ""}`;
  } else if (st.view === "stats" && st.stats) {
    const d = st.stats;
    const big = (k: string, v: number | string) => `<div class="cell"><div class="k mono">${k}</div><div class="v">${v}</div></div>`;
    const max = Math.max(1, ...d.perMonth.map((m) => m.n));
    body = `${commandBar()}
      <div class="confirm statsp pa">
        <span class="tag t-cy">FROM YOUR HISTORY · NO AI USED</span>
        <div class="big">Your inbox, ${esc(d.label)}</div>
        <div class="grid3">${big("EMAILS", d.total)}${big("INTERVIEWS", d.byStatus.interview ?? 0)}${big("SHORTLISTS", d.byStatus.shortlisted ?? 0)}${big("OFFERS", d.byStatus.offer ?? 0)}${big("TESTS", d.byStatus.assessment ?? 0)}${big("REJECTIONS", d.byStatus.rejected ?? 0)}</div>
        ${d.topSenders.length ? `<div class="k mono" style="margin-top:18px">MOST EMAILS FROM</div><ul>${d.topSenders.map((t) => `<li><b>${esc(t.sender)}</b> · ${t.n}</li>`).join("")}</ul>` : ""}
        ${d.perMonth.length ? `<div class="k mono" style="margin-top:18px">EMAILS PER MONTH · JOB UPDATES IN BLUE</div>
        <div class="months">${d.perMonth.map((m) => `<div class="mo"><div class="col"><i style="height:${Math.round((m.n / max) * 100)}%"></i><b style="height:${Math.round((m.jobs / max) * 100)}%"></b></div><span class="mono">${esc(new Date(`${m.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" }))}</span></div>`).join("")}</div>` : ""}
        <div class="acts"><button class="btn solid" data-cmd="show my job tracker">Job tracker</button><button class="btn" data-cmd="export my applications">Export CSV</button><button class="btn ghost" data-cmd="close">Close</button></div>
      </div>${coreHtml("STATS")}${subtitleHtml()}`;
  } else if (st.view === "report" && st.report) {
    const r = st.report;
    body = `${commandBar()}
      <div class="confirm statsp pa">
        <span class="tag t-cy">${esc(r.tag)}</span>
        <div class="big">${esc(r.title)}</div>
        ${r.cells.length ? `<div class="grid3">${r.cells.map(([k, v]) => `<div class="cell"><div class="k mono">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("")}</div>` : ""}
        ${r.lists.filter((l) => l.rows.length).map((l) => `<div class="k mono" style="margin-top:18px">${esc(l.title)}</div><ul>${l.rows.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("")}
        <div class="acts">${r.acts.map(([label, cmd], n) => `<button class="btn ${n === 0 ? "solid" : ""}" data-cmd="${esc(cmd)}">${esc(label)}</button>`).join("")}<button class="btn ghost" data-cmd="close">Close</button></div>
      </div>${coreHtml("REPORT")}${subtitleHtml()}`;
  } else if (st.view === "compose" && st.compose) {
    const c = st.compose;
    body = `${commandBar()}
      <div class="confirm compose pa">
        <span class="tag t-cy">NEW EMAIL</span>
        <div class="big">${c.step === "to" ? "Who's it for?" : "What should it say?"}</div>
        <form data-act="composeform">
          <div class="field"><span class="k mono">TO</span><input type="text" aria-label="Compose to" value="${esc(c.email || c.to)}" placeholder="Say a name, or type an email address"/></div>
          <div class="field"><span class="k mono">ABOUT</span><input type="text" aria-label="Compose about" value="${esc(c.topic)}" placeholder="e.g. I'll join the meeting at 4 pm"/></div>
          ${c.msg ? `<p class="warn">${esc(c.msg)}</p>` : ""}
          <div class="acts"><button class="btn solid" type="submit">Write it</button><button class="btn" type="button" data-act="gmailcompose">Open Gmail compose</button><button class="btn ghost" type="button" data-cmd="cancel">Cancel</button></div>
        </form>
      </div>${coreHtml("LISTENING")}${subtitleHtml()}`;
  } else if (st.view === "voice") {
    const voices = usefulVoices(speaker.voices);
    const cur = speaker.voice()?.name ?? "";
    body = `${commandBar()}
      <div class="confirm setup voice pa">
        <span class="tag t-cy">VOICE</span>
        <div class="big">Choose my voice</div>
        <p>Tap a voice to hear it. Your choice is saved for next time.</p>
        <div class="vlist">${
          voices.length
            ? voices.map((v) => `<button class="vopt ${v.name === cur ? "on" : ""}" data-voice="${esc(v.name)}"><span>${esc(voiceLabel(v))}</span><span class="mono">${v.name === cur ? "✓ IN USE" : "▶ TRY"}</span></button>`).join("")
            : `<p>No voices found yet. If this stays empty, add a voice in your computer's speech settings (see below).</p>`
        }</div>
        <label class="rng">Speed <input type="range" data-act="vrate" min="0.7" max="1.4" step="0.05" value="${speaker.rate}"><span class="mono">${speaker.rate.toFixed(2)}×</span></label>
        <label class="rng">Pitch <input type="range" data-act="vpitch" min="0.6" max="1.5" step="0.05" value="${speaker.pitch}"><span class="mono">${speaker.pitch.toFixed(2)}</span></label>
        <p class="tiny">Want more voices? Windows: Settings → Time &amp; language → Speech → Add voices, then restart Chrome. Voices with "natural" sound the most human.</p>
        <div class="acts"><button class="btn solid" data-act="vtest">▶ Test</button><button class="btn" data-act="vauto">Automatic</button><button class="btn ghost" data-cmd="close">Done</button></div>
      </div>${coreHtml("VOICE")}${subtitleHtml()}`;
  } else if (st.view === "confirm" && st.confirm) {
    const c = st.confirm;
    body = `${commandBar()}
      <div class="confirm pa">
        <span class="tag t-white">PLEASE CONFIRM</span>
        <div class="big">${c.kind === "readall" ? "Mark all as read" : "Delete all spam"}</div>
        <div class="sumbig" style="font-size:20px;margin-top:8px">${c.kind === "readall" ? `Mark <b>${c.count}</b> unread inbox email${c.count === 1 ? "" : "s"} as read. You can undo.` : `Move <b>${c.count}</b> spam email${c.count === 1 ? "" : "s"} to Trash in one go. You can undo.`}</div>
        <ul>${c.preview.map((p) => `<li><b>${esc(p.from || "Unknown")}</b> · ${esc(p.subject || "(no subject)")}</li>`).join("")}${
          c.count > c.preview.length ? `<li class="mono" style="font-size:11px;color:var(--dim)">+ ${c.count - c.preview.length} MORE</li>` : ""
        }</ul>
        <div class="say">Say <b>"yes"</b> or <b>"no"</b></div>
        <div class="acts"><button class="btn ${c.kind === "readall" ? "solid" : "alert"}" data-cmd="confirm">${c.kind === "readall" ? `Mark ${c.count} as read` : `Delete ${c.count} spam`}</button><button class="btn ghost" data-cmd="cancel">Cancel</button></div>
      </div>${coreHtml("AWAITING CONFIRMATION")}${subtitleHtml()}`;
  }
  const wide = ["focus", "confirm", "setup", "draft", "replyask", "compose", "voice", "stats", "report"].includes(st.view);
  $ov.className = `overlay open ${st.view === "full" ? "full" : ""} ${wide ? "wide" : ""}`;
  patch($ov, frame + body);
  renderMic();
}

const isReady = () => Boolean(st.setup?.clientIdOk && st.setup.signedIn && st.setup.hasGeminiKey);

const CONSOLE = {
  project: "https://console.cloud.google.com/projectcreate",
  gmailApi: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
  calendarApi: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com",
  tasksApi: "https://console.cloud.google.com/apis/library/tasks.googleapis.com",
  consent: "https://console.cloud.google.com/auth/overview",
  audience: "https://console.cloud.google.com/auth/audience",
  client: "https://console.cloud.google.com/auth/clients/create",
};
let editClient = false;

function wizard(s: SetupStatus) {
  const open = (url: string, label: string) => `<a class="btn sm" href="${url}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`;
  const copy = (text: string) => `<button class="btn sm ghost" data-copy="${esc(text)}">Copy</button>`;
  const sub = (n: string, title: string, body: string, action: string) =>
    `<li><span class="sn">${n}</span><div><b>${title}</b><p>${body}</p><div class="acts">${action}</div></div></li>`;
  return `<ol class="wiz">
    ${sub("a", "Create a Google Cloud project", "Name it <b>Vaani</b> → <b>Create</b>. Make sure it is selected in the top bar.", open(CONSOLE.project, "Open"))}
    ${sub("b", "Turn on 3 Google APIs", "Open each one and press <b>Enable</b>: Gmail (email), Google Calendar (events) and Google Tasks (notes).", `${open(CONSOLE.gmailApi, "Gmail")}${open(CONSOLE.calendarApi, "Calendar")}${open(CONSOLE.tasksApi, "Tasks")}`)}
    ${sub("c", "Set up the consent screen", "<b>Get started</b> → App name <b>Vaani</b>, your email → Audience <b>External</b> → your email → agree → <b>Create</b>.", open(CONSOLE.consent, "Open"))}
    ${sub("d", "Add yourself as a test user", "<b>Test users</b> → <b>Add users</b> → your Gmail address → <b>Save</b>.", open(CONSOLE.audience, "Open"))}
    ${sub("e", "Create the Client ID", `Application type <b>Web application</b> → under <b>Authorized redirect URIs</b> press <b>Add URI</b> and paste:<br><code>${esc(s.redirectUri)}</code><br>→ <b>Create</b> → copy the <b>Client ID</b>.`, `${copy(s.redirectUri)}${open(CONSOLE.client, "Open")}`)}
  </ol>
  <form data-act="clientform" class="keyform"><input type="text" placeholder="Paste your Client ID (…apps.googleusercontent.com)" autocomplete="off" spellcheck="false" aria-label="Google Client ID"/><button class="btn solid" type="submit" ${st.setupBusy ? "disabled" : ""}>Save</button></form>
  <p class="tiny">The Client ID is not a secret. Never paste the <b>Client secret</b> anywhere.</p>`;
}

let editName = false;
const NAME_IDEAS = ["Vaani", "Nova", "Aria", "Echo", "Zara", "Orion"];
function nameStep() {
  if (named && !editName) return `<p>I'm <b>${esc(NAME)}</b>. Say "${esc(NAME)}" whenever you need me. <button class="lnk" data-act="changename">Change</button></p>`;
  return `<p>What would you like to call me? This name is also how you wake me up.</p>
    <form data-act="nameform" class="keyform"><input type="text" placeholder="Type a name, or just say it" autocomplete="off" spellcheck="false" aria-label="Assistant name"/><button class="btn solid" type="submit">Save</button></form>
    <div class="names">${NAME_IDEAS.map((n) => `<button class="btn sm" data-name="${n}">${n}</button>`).join("")}</div>`;
}

function setupPanel() {
  const s = st.setup;
  if (!s) return `<div class="confirm setup pa"><div class="big">Loading…</div></div>`;
  const step = (n: number, done: boolean, title: string, body: string) =>
    `<div class="step ${done ? "done" : ""}"><span class="num">${done ? "✓" : n}</span><div style="min-width:0;flex:1"><div class="st">${title}</div>${body}</div></div>`;
  const client =
    s.clientIdOk && !editClient
      ? `<p>Your own Client ID is connected <b>${esc(s.clientIdShort ?? "")}</b> <button class="lnk" data-act="changeclient">Change</button></p>`
      : `<p>One time, about 5 minutes. You get your own Google connection, so there is <b>no user limit</b> and no one else's project is involved.</p>${wizard(s)}`;
  const signIn = !s.clientIdOk
    ? `<p>Finish step 1 first.</p>`
    : s.signedIn && s.needsReauth
      ? `<p>Signed in as <b>${esc(s.email)}</b>. <b>New:</b> I can now use your Google Calendar and Notes (Google Tasks). Sign in once more to allow them.</p><div class="acts"><button class="btn solid" data-act="signin" ${st.setupBusy ? "disabled" : ""}>Allow Calendar &amp; Notes</button></div>`
      : s.signedIn
      ? `<p>Signed in as <b>${esc(s.email)}</b></p>`
      : `<p>Vaani reads your Gmail directly from this browser. Nothing goes to any Vaani server. If Google says "app isn't verified", press <b>Continue</b> — it is your own app.</p><div class="acts"><button class="btn solid" data-act="signin" ${st.setupBusy ? "disabled" : ""}>Sign in with Google</button></div>`;
  const key = s.hasGeminiKey
    ? `<p>Key connected · •••• ${esc(s.keyLast4 ?? "")} <button class="lnk" data-act="replacekey">Replace</button></p>`
    : `<p>The AI runs on <b>your own free</b> Gemini key. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Get a key from Google AI Studio ↗</a> → "Create API key" → paste it here.</p>
       <form data-act="keyform" class="keyform"><input type="password" placeholder="Paste your Gemini API key (AQ.… or AIza…)" autocomplete="off" spellcheck="false" aria-label="Gemini API key" ${!s.signedIn ? "disabled" : ""}/><button class="btn solid" type="submit" ${!s.signedIn || st.setupBusy ? "disabled" : ""}>Save</button></form>`;
  const sy = s.sync;
  const progress = !s.signedIn
    ? "<p>Waiting for sign-in.</p>"
    : sy.total === 0
      ? `<p>${esc(sy.message || "Reading your inbox…")}</p>`
      : `<p>${sy.analyzed} of ${sy.total} emails analysed. ${esc(sy.message)}</p><div class="bar" style="margin-top:8px"><i style="width:${Math.round((sy.analyzed / Math.max(1, sy.total)) * 100)}%"></i></div>`;
  return `<div class="confirm setup pa">
    <span class="tag t-cy">${isReady() ? "ONLINE" : "SETUP"}</span>
    <div class="big">${isReady() ? `${esc(NAME)} is ready` : `Connect ${esc(NAME)}`}</div>
    ${st.setupMsg ? `<p class="${st.setupErr ? "warn" : "ok"}">${esc(st.setupMsg)}</p>` : ""}
    ${step(0, named && !editName, "Name your assistant", nameStep())}
    <div class="step ${useFor.length ? "done" : ""}"><span class="num">${useFor.length ? "✓" : "★"}</span><div style="min-width:0;flex:1"><div class="st">What do you use email for?</div>
      <p>Pick any. I'll put those emails first (you can change this any time).</p>
      <div class="names">${[["job", "Job search"], ["study", "Study"], ["work", "Work"], ["business", "Business"], ["personal", "Personal"]]
        .map(([k, l]) => `<button class="btn sm ${useFor.includes(k) ? "solid" : ""}" data-usefor="${k}">${useFor.includes(k) ? "✓ " : ""}${l}</button>`).join("")}</div></div></div>
    ${step(1, s.clientIdOk && !editClient, "Your Google connection", client)}
    ${step(2, s.signedIn && !s.needsReauth, "Sign in with Google", signIn)}
    ${step(3, s.hasGeminiKey, "Add your Gemini API key", key)}
    ${step(4, isReady() && sy.total > 0 && sy.analyzed === sy.total, "Inbox analysis", progress)}
    ${isReady() ? `<div class="acts"><button class="btn solid" data-cmd="give me today's summary">Give me today's summary</button></div><p class="hint2">Next time just say: <b>"${esc(NAME)}, give me today's summary"</b></p>` : ""}
  </div>`;
}

let statusQueued = 0;
/** Refresh at most once per second, only when stored data actually changed. */
function scheduleStatus() {
  if (statusQueued) return;
  statusQueued = window.setTimeout(() => {
    statusQueued = 0;
    void refreshStatus();
  }, 1000);
}

async function refreshStatus(): Promise<SetupStatus | null> {
  const r = await api<SetupStatus>("/ext/status");
  if (r.ok) {
    st.setup = r.data;
    st.connected = r.data.signedIn && r.data.clientIdOk;
  }
  if (st.view === "setup") render();
  else renderMic();
  return st.setup;
}

function openSetup(msg = "", err = false) {
  runId++;
  speaker.stop();
  st.setupMsg = msg;
  st.setupErr = err;
  st.view = "setup";
  st.menu = false;
  render();
  void refreshStatus();
}

function renderMic() {
  const l = listener;
  const blocked = l.state === "blocked" || l.state === "unsupported" || l.state === "unavailable";
  const live = l.enabled && l.state === "listening";
  const stateText = !isReady()
    ? "SETUP NEEDED"
    : l.state === "unsupported"
      ? "NO VOICE SUPPORT"
      : l.state === "blocked"
        ? "MIC BLOCKED"
        : l.state === "unavailable"
          ? "VOICE UNAVAILABLE · TYPE"
        : !l.enabled
          ? "MIC OFF"
          : speaker.speaking
            ? 'SPEAKING · SAY "STOP"'
            : l.awaiting
              ? "GO AHEAD…"
              : "LISTENING";
  const hearing = live && l.caption && !speaker.speaking;

  let pop = "";
  if (st.menu) {
    pop = `<div class="menu">
      <div class="k mono">${esc(NAME)} · CONTROL</div>
      ${
        isReady()
          ? `<p>${l.wakeWord ? `Say "${esc(NAME)}, …" — for example "${esc(NAME)}, give me today's summary".` : "Just speak a command."}</p>`
          : `<p>One-time setup: connect your own Google Client ID, sign in, and add your free Gemini key.</p>
             <div class="row"><button class="btn solid" data-act="setup">Open setup</button></div>`
      }
      ${l.error ? `<p style="color:#ff9a9a">${esc(l.error)}</p>` : ""}
      <label>Microphone on <input type="checkbox" data-act="mic" ${l.enabled ? "checked" : ""}></label>
      <label>Wake word "${esc(NAME)}" <input type="checkbox" data-act="wake" ${l.wakeWord ? "checked" : ""}></label>
      <label>Subtitles (show what I say) <input type="checkbox" data-act="subs" ${subtitlesOn ? "checked" : ""}></label>
      <form data-act="form"><input type="text" placeholder="Type a command…" aria-label="Type a command" /><button class="btn" type="submit">Go</button></form>
      <div class="row"><button class="btn" data-cmd="give me today's summary">Briefing</button><button class="btn" data-cmd="open spam">Spam</button><button class="btn" data-cmd="open full window">Full</button><button class="btn" data-cmd="change voice">Voice</button></div>
    </div>`;
  } else if (hearing) {
    pop = `<div class="caption"><small>HEARING</small>"${esc(l.caption)}"</div>`;
  } else if (st.chat && Date.now() < st.chat.until && (subtitlesOn || st.chat.thinking)) {
    pop = `<div class="caption chat"><div class="you">YOU › "${esc(st.chat.you)}"</div><small>${esc(NAME)}</small>${st.chat.thinking ? `<span class="dots">Thinking<i>.</i><i>.</i><i>.</i></span>` : esc(st.chat.text)}</div>`;
  } else if (l.awaiting) {
    pop = `<div class="caption"><small>${hearing ? "HEARING" : esc(NAME)}</small>${hearing ? `"${esc(l.caption)}"` : "Go ahead, I'm listening…"}</div>`;
  }

  patch($mic, `${pop}<button class="micbox ${blocked || !isReady() ? "bad" : ""} ${hearing || speaker.speaking ? "live" : ""} ${!l.enabled ? "off" : ""}" data-act="menu" aria-label="${esc(NAME)}: ${stateText}">
      <span class="wv">${MINI_WAVE}</span>
      <span class="t"><b>${esc(NAME)}</b><small><i class="${live && isReady() ? "live" : blocked || !isReady() ? "bad" : ""}"></i>${stateText}</small></span>
      ${eq(Boolean(hearing) || speaker.speaking)}
    </button>`);
}

function showToast(label: string, text: string, opts: { err?: boolean; undo?: boolean; ms?: number } = {}) {
  st.toast = { label, text, err: opts.err, undo: opts.undo };
  $toast.innerHTML = `<div class="toast ${opts.err ? "err" : ""}"><div><div class="k mono">${esc(label)}</div>${esc(text)}</div>${
    opts.undo ? `<button class="btn" data-cmd="undo">Undo</button>` : ""
  }</div>`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    $toast.innerHTML = "";
    st.toast = null;
  }, opts.ms ?? 7000);
}

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------
async function loadBriefings(force = false): Promise<boolean> {
  if (!force && st.day && Date.now() - st.loadedAt < 5 * 60_000) return true;
  const [d, w] = await Promise.all([
    api<Briefing>("/briefing?lang=en&mode=short&hours=24"),
    api<Briefing>("/briefing?lang=en&mode=short&hours=168"),
  ]);
  if (!d.ok) return handleApiError(d.error, d.status);
  st.day = d.data;
  st.week = w.ok ? w.data : d.data;
  st.loadedAt = Date.now();
  return true;
}

function handleApiError(error: string | undefined, status: number): false {
  if (error === "NOT_SIGNED_IN" || status === 401) {
    st.connected = false;
    openSetup("Let's sign in with Google first.", true);
  } else if (error === "NEEDS_GEMINI_KEY") {
    openSetup("Let's add your Gemini key first, so I can think.", true);
  } else {
    showToast("OOPS", error || "Something went wrong. Please try again.", { err: true });
  }
  renderMic();
  return false;
}

const allItems = (b: Briefing | null) => (b?.sections ?? []).flatMap((s) => s.items);
const entities = () => [...new Set([...allItems(st.week), ...allItems(st.day), ...st.items].map((i) => i.entity))];

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------
function openView(view: View, command: string) {
  st.view = view;
  st.command = command;
  st.menu = false;
  render();
}

function closeOverlay() {
  runId++;
  speaker.stop();
  st.view = "none";
  st.confirm = null;
  st.reply = null;
  st.draft = null;
  st.compose = null;
  engagedUntil = Date.now() + 15_000;
  render();
}

function goGmail(hash: string) {
  // Same tab, no new window: Gmail is a single-page app driven by the URL fragment.
  if (location.hash === hash) {
    location.hash = "#inbox";
    window.setTimeout(() => (location.hash = hash), 60);
  } else {
    location.hash = hash;
  }
}

async function run(text: string) {
  const myRun = ++runId;
  speaker.stop();
  // First command: wait for the data. Later: answer instantly and refresh in the background.
  if (isReady()) {
    if (!st.day) await loadBriefings().catch(() => false);
    else void loadBriefings().catch(() => false);
  }
  const cmd: Command = parseCommand(text, entities(), labelNames);

  // "What should the new label be called?"
  if (awaitingLabelName && !["stop", "close", "cancel"].includes(cmd.type)) {
    awaitingLabelName = false;
    return void createLabel(text, text.replace(/^(call it|name it|label)\s+/i, "").trim());
  }
  awaitingLabelName = false;

  // First run: the answer to "What would you like to call me?"
  if (st.naming && !["stop", "close", "cancel"].includes(cmd.type)) return void setName(cmd.type === "rename" && cmd.name ? cmd.name : text);

  // Putting a new email together: the next sentence is the recipient, then what it should say.
  if (st.view === "compose" && st.compose && !["stop", "close", "cancel", "setup"].includes(cmd.type)) {
    if (st.compose.step === "to") return void composeTo(text, cmd.type === "compose" && cmd.to ? cmd.to : text, myRun);
    st.compose.topic = cmd.type === "compose" && cmd.topic ? cmd.topic : text;
    return void makeCompose(text, myRun);
  }

  // While a reply is being written, most sentences are about the reply.
  const free = ["ask", "filter", "search", "focus"].includes(cmd.type);
  if (st.view === "replyask" && st.reply) {
    const pick = text.toLowerCase().match(/^(?:option |number )?(first|one|1|pehla|pehli|second|two|2|doosra|dusra|third|three|3|teesra)\b/);
    if (pick) {
      const n = /first|one|1|pehl/.test(pick[1]) ? 0 : /second|two|2|doosra|dusra/.test(pick[1]) ? 1 : 2;
      return void makeDraft(text, st.reply.options[n] ?? text, myRun);
    }
    if (free || cmd.type === "reply") return void makeDraft(text, cmd.type === "reply" && cmd.intent ? cmd.intent : text, myRun);
    if (cmd.type === "confirm" || cmd.type === "send") return void say("Tell me what you'd like to say, and I'll write it for you.").then(() => listener.expectAnswer());
  }
  if (st.view === "draft" && st.draft) {
    // During the 5-second countdown, "cancel"/"stop" only cancel the send (the countdown sees the new runId).
    if (st.draft.countdown !== null && ["cancel", "stop", "close"].includes(cmd.type)) return;
    if (cmd.type === "send" || cmd.type === "confirm") return void sendDraft(text, myRun);
    if (cmd.type === "saveDraft") return void saveDraft();
    if (cmd.type === "readAgain") return void readDraft(myRun);
    if (cmd.type === "cancel") {
      closeOverlay();
      showToast("DISCARDED", "Okay, I threw that draft away. Nothing was sent.");
      return void say("Okay, I threw that draft away. Nothing was sent.");
    }
    if (free || cmd.type === "summary") return void changeDraft(text, myRun);
  }

  // While a delete is waiting for confirmation, yes/no go to it.
  if (st.view === "confirm" && st.confirm && cmd.type === "confirm") return void (st.confirm.kind === "readall" ? doReadAll(text) : doTrashSpam(text));
  if (cmd.type === "cancel") {
    if (st.view === "confirm") {
      st.confirm = null;
      showToast("CANCELLED", "No problem, I didn't change anything.");
    }
    return closeOverlay();
  }

  if (cmd.type === "ask") {
    const chatty = smallTalk(text, firstName(), new Date().getHours(), NAME);
    if (chatty) return void chat(text, chatty.reply, chatty.followUp);
  }
  if (cmd.type === "rename") {
    if (cmd.name) return void setName(cmd.name);
    return void askName();
  }
  if (cmd.type === "rate") return void setRate(cmd.delta);

  if (cmd.type === "setup") return openSetup();
  // Not set up yet: every command leads to the setup panel.
  if (!isReady() && !["stop", "close", "cancel"].includes(cmd.type)) {
    await refreshStatus();
    if (!isReady()) return openSetup("Let's finish the quick setup first, then I'm all yours.", true);
  }

  if (!IN_FLOW.has(st.view) && routeToBox(text, cmd.type, myRun)) return;
  switch (cmd.type) {
    case "stop":
      return speaker.stop();
    case "close":
      return closeOverlay();
    case "confirm":
      return void say("There's nothing waiting for a yes right now.");
    case "send":
      return void say("There's no reply ready yet. Say, for example: reply to TCS.");
    case "saveDraft":
    case "readAgain":
      return void say("There's no reply open right now.");
    case "reply":
      return void gmailReply(text, cmd.entity, cmd.intent, myRun);
    case "voice":
      return cmd.action === "next" ? void nextVoice(text) : void openVoice(text);
    case "undo":
      return void doUndo();
    case "folder": {
      closeOverlay();
      void openFolder(cmd.folder);
      showToast("OPENED", `${FOLDER_LABEL[cmd.folder]} — in this tab`, { ms: 3000 });
      return void say(`Sure, opening ${FOLDER_LABEL[cmd.folder]}.`);
    }
    case "label": {
      closeOverlay();
      const real = labelNames.find((l) => l.toLowerCase() === cmd.name.toLowerCase()) ?? labelNames.find((l) => l.toLowerCase().includes(cmd.name.toLowerCase())) ?? cmd.name;
      goGmail(`#label/${encodeURIComponent(real).replace(/%20/g, "+")}`);
      showToast("OPENED", `Label: ${real}`, { ms: 3000 });
      return void say(`Opening your ${real} label.`);
    }
    case "subtitles":
      return void setSubtitles(cmd.on, true);
    case "createLabel":
      if (!cmd.name) {
        awaitingLabelName = true;
        return void chat(text, "Sure! What should the new label be called?", true);
      }
      return void createLabel(text, cmd.name);
    case "applyLabel":
      return void applyLabel(text, cmd.name);
    case "search":
      return void doFind(text, cmd.query, cmd.query.toUpperCase(), `for ${cmd.query}`, myRun);
    case "find":
      return void doFind(text, cmd.query, cmd.label, cmd.spoken, myRun);
    case "openCurrent": {
      const it = st.focus ?? (st.current >= 0 ? st.items[st.current] : null);
      if (!it) return void say("Which email should I open? You can say, for example: open the TCS email.");
      closeOverlay();
      goGmail(`#all/${it.threadId}`);
      return;
    }
    case "trashSpam":
      return void askTrashSpam(text);
    case "summary":
      return void doBriefing(text, myRun);
    case "full": {
      if (!st.day) return;
      st.items = allItems(st.day);
      st.hints = ["What's pending", "Kisi ne help maangi hai", "Show my stats", "Close"];
      st.count = "OVERVIEW · TODAY";
      openView("full", text);
      {
        const bs = buckets(st.items);
        const parts = bs.slice(0, 4).map((x) => bucketPhrase(x.key, x.items.length));
        return void say(parts.length ? `Here's everything from today: ${joinNames(parts)}. I tucked away ${st.day.stats.hiddenSpamPromo} promotions.` : "Nothing important today. You're all caught up!");
      }
    }
    case "focus":
      return void doFocus(text, cmd.entity);
    case "filter":
      return void doFilter(text, cmd.key);
    case "ask":
      return void doAssist(text, myRun);
    case "compose":
      return void gmailCompose(text, cmd.to, cmd.topic, myRun);
    case "gmailAct":
      return void doGmailAct(text, cmd.act);
    case "readAll":
      return void askReadAll(text);
    case "calendar":
      return void doCalendar(text, cmd.date, cmd.days, cmd.label, myRun);
    case "noteAdd":
      return void addNote(text, cmd.text);
    case "notesList":
      return void listNotes(text, myRun);
    case "count":
      return void doCount(text, cmd, myRun);
    case "tracker":
      return void doTracker(text, cmd.entity, myRun);
    case "history":
      return void doHistory(text, cmd.query, myRun);
    case "stats":
      return void doStats(text, cmd.period, myRun);
    case "activity":
      return void doActivity(text, cmd.days, myRun);
    case "export":
      return void doExport(text);
    case "intentList":
      return void doIntentList(text, cmd.intents, cmd.period, cmd.label, myRun);
    case "pending":
      return void doPending(text, cmd.minDays, myRun);
    case "funnel":
      return void doFunnel(text, myRun);
    case "ghosting":
      return void doGhosting(text, myRun);
    case "followUp":
      return void startReply(text, cmd.entity, "Write a short, polite follow-up asking about the status of my application and saying I'm still very interested.", myRun);
    case "responseTime":
      return void doResponse(text, myRun);
    case "weekly":
      return void doWeekly(text, myRun);
    case "deadlines":
      return void doDeadlines(text, myRun);
    case "contacts":
      return void doContacts(text, myRun);
    case "import":
      return void doImport(text, cmd.months);
    case "importStatus":
      return void doImportStatus(text, myRun);
    case "watch":
      return void doWatch(text, cmd.kind, cmd.value, cmd.label);
    case "watchList":
      return void doWatchList(text, myRun);
    case "unwatch":
      return void doUnwatch(text);
  }
}

/** Runs a command the AI picked (already checked against the safe action list). */
function runAiCommand(text: string, r: AssistReply, myRun: number) {
  const map: Record<string, () => void> = {
    summary: () => void doBriefing(text, myRun),
    filter: () => void doFilter(text, r.filter as FilterKey),
    focus: () => void doFocus(text, r.entity),
    folder: () => {
      closeOverlay();
      goGmail(FOLDER_HASH[r.folder as keyof typeof FOLDER_HASH]);
      showToast("OPENED", `${FOLDER_LABEL[r.folder as keyof typeof FOLDER_LABEL]} — in this tab`, { ms: 3000 });
      void say(r.reply || `Sure, opening ${FOLDER_LABEL[r.folder as keyof typeof FOLDER_LABEL]}.`);
    },
    search: () => void doFind(text, r.query, r.query.toUpperCase().slice(0, 40), "", myRun),
    reply: () => void startReply(text, r.entity || null, r.intent, myRun),
    trashSpam: () => void askTrashSpam(text),
    full: () => void run("open full window"),
    voice: () => void openVoice(text),
    compose: () => void startCompose(text, r.to, r.topic, false, myRun),
    gmailAct: () => void doGmailAct(text, r.act),
    readAll: () => void askReadAll(text),
    calendarAdd: () => void addCalendar(text, { title: r.title, date: r.date, time: r.time, durationMin: r.durationMin, details: st.focus ? `From email: ${st.focus.subject}` : "" }),
    calendarList: () => {
      const d = r.date || new Date().toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      void doCalendar(text, d, 1, d === today ? "today" : new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }), myRun);
    },
    noteAdd: () => void addNote(text, r.title, r.date),
    notesList: () => void listNotes(text, myRun),
    count: () => void doCount(text, { status: r.filter, category: "", period: (r.period || "all") as Period, what: r.filter ? (FILTER_LABEL[r.filter as FilterKey] ?? "email") : "email", from: r.entity || "" }, myRun),
    tracker: () => void doTracker(text, r.entity, myRun),
    history: () => void doHistory(text, r.query, myRun),
    stats: () => void doStats(text, (r.period || "month") as Period, myRun),
    intentList: () => void doIntentList(text, [r.purpose], (r.period || "week") as Period, BUCKET[r.purpose]?.label.toLowerCase() ?? "emails", myRun),
    pending: () => void doPending(text, 0, myRun),
    weekly: () => void doWeekly(text, myRun),
    funnel: () => void doFunnel(text, myRun),
  };
  (map[r.action] ?? (() => void chat(text, r.reply)))();
}

interface AssistReply {
  kind: "chat" | "answer" | "command"; reply: string; action: string; filter: string; folder: string; entity: string; query: string; intent: string; refs: BriefingItem[];
  to: string; topic: string; act: string; title: string; date: string; time: string; durationMin: number; period: string; purpose: string;
}

/** Anything the quick parser didn't understand: let the AI figure out what you meant. */
async function doAssist(text: string, myRun: number) {
  st.chat = { you: text, text: "Thinking…", until: Date.now() + 60_000, thinking: true };
  renderMic();
  const onScreen = st.focus ?? (st.current >= 0 ? st.items[st.current] : null);
  const r = await api<AssistReply>("/assist", "POST", { text, name: NAME, focusId: onScreen && !onScreen.kind ? onScreen.gmailId : "" });
  if (myRun !== runId) return;
  if (!r.ok) {
    if (r.error === "NOT_SIGNED_IN" || r.error === "NEEDS_GEMINI_KEY") {
      st.chat = null;
      return void handleApiError(r.error, r.status);
    }
    return void chat(text, r.status === 429 ? "My free AI limit is used up for now, so I can't think that one through. Simple commands like open inbox or today's summary still work!" : r.error || "Sorry, something went wrong. Could you try again?");
  }
  const a = r.data;
  if (a.kind === "command") {
    st.chat = null;
    renderMic();
    return runAiCommand(text, a, myRun);
  }
  if (a.kind === "answer" && a.refs.length) {
    st.chat = null;
    st.items = a.refs;
    st.current = -1;
    st.focus = null;
    st.listTitle = "RELATED EMAILS";
    st.modeLabel = "ANSWER";
    st.count = `${a.refs.length} RELATED`;
    st.subtitle = a.reply;
    st.hints = a.refs.slice(0, 1).map((i) => `Reply to ${i.entity}`).concat(["Give me today's summary", "Close"]);
    openView("list", text);
    if (await say(a.reply)) engagedUntil = Date.now() + 30_000;
    return;
  }
  return void chat(text, a.reply, true);
}

let chatTimer = 0;
/** Friendly conversation: a small bubble above the mic (or the subtitle if a window is open) + voice. */
async function chat(you: string, text: string, followUp = false) {
  if (st.view !== "none" && st.view !== "setup") {
    st.chat = null;
    st.command = you;
    st.subtitle = text;
    render();
  } else {
    st.chat = { you, text, until: Date.now() + Math.max(6000, text.length * 90) };
    renderMic();
    window.clearTimeout(chatTimer);
    chatTimer = window.setTimeout(() => {
      if (st.chat && Date.now() >= st.chat.until) {
        st.chat = null;
        renderMic();
      }
    }, st.chat.until - Date.now() + 50);
  }
  engagedUntil = Date.now() + 30_000;
  if ((await say(text)) && followUp) listener.expectAnswer();
}

async function doBriefing(command: string, myRun: number) {
  if (!st.day) return;
  const all = buckets(allItems(st.day).filter((i) => themeKey(i) !== "security")).flatMap((b) => b.items);
  const items = all.slice(0, 7);
  st.items = items;
  st.focus = null;
  st.listTitle = "TODAY · LIVE FEED";
  st.modeLabel = "BRIEFING MODE";
  st.hints = ["Show interview emails", "Open full window", "Open spam", "Stop"];
  st.current = -1;
  st.subtitle = "";
  st.count = `BRIEFING · 00 / ${String(items.length).padStart(2, "0")}`;
  openView("briefing", command);

  const s = st.day.stats;
  const bs = buckets(all);
  let intro = items.length
    ? `${hi()}Today you have ${joinNames(bs.slice(0, 3).map((x) => bucketPhrase(x.key, x.items.length)))}. Let's go through them.`
    : `${hi()}Good news, nothing important came in today. You're all caught up!`;
  const basicCount = items.filter((i) => i.basic).length;
  if (basicCount) {
    intro += basicCount === items.length
      ? " My AI hasn't read them yet, so I'll just tell you who they're from."
      : ` ${basicCount} of them I haven't read yet, so for those I'll just tell you who they're from.`;
  }
  if (!items.length) {
    // Don't claim "nothing" while the AI is still reading the inbox or is paused.
    const sync = (await refreshStatus())?.sync;
    if (sync?.state === "error" || sync?.state === "quota") intro = `Sorry, I can't read your new emails just yet. ${sync.message}`;
    else if (sync && sync.total > 0 && sync.analyzed < sync.total)
      intro = `I'm still going through your inbox, ${sync.analyzed} of ${sync.total} emails done. Give me a minute and ask again!`;
  }
  st.subtitle = intro;
  render();
  if (!(await say(intro)) || myRun !== runId) return;
  if (!items.length) {
    st.loadedAt = 0; // fetch fresh results next time
    return;
  }

  for (let i = 0; i < items.length; i++) {
    if (myRun !== runId) return;
    const it = items[i];
    st.current = i;
    st.count = `BRIEFING · ${String(i + 1).padStart(2, "0")} / ${String(items.length).padStart(2, "0")}`;
    st.subtitle = it.basic
      ? `${ORD[i] ?? "Next"}: an email from ${it.entity}: ${it.subject}.`
      : `${ORD[i] ?? "Next"}: ${it.entity}. ${it.ask || it.summary}${spokenDeadline(it.deadline)}`;
    render();
    if (!(await say(st.subtitle)) || myRun !== runId) return;
  }
  if (myRun !== runId) return;
  const owed = await api<{ items: { entity: string; daysWaiting: number }[] }>("/history/pending", "POST", { minDays: 3 });
  const reminder = owed.ok && owed.data.items.length
    ? ` Also, a reminder: ${joinNames(owed.data.items.slice(0, 3).map((p) => `${p.entity} has been waiting ${p.daysWaiting} days for your reply`))}.`
    : "";
  const outro = `That's everything for now!${reminder}${s.hiddenSpamPromo ? ` I tucked away ${s.hiddenSpamPromo} promotional email${s.hiddenSpamPromo === 1 ? "" : "s"} so ${s.hiddenSpamPromo === 1 ? "it doesn't" : "they don't"} distract you.` : ""}${s.scamCount ? ` I also spotted ${s.scamCount} scam email${s.scamCount === 1 ? "" : "s"}, so please don't open ${s.scamCount === 1 ? "it" : "them"}.` : ""} Want me to reply to any of them?`;
  st.current = items.length;
  st.view = "list";
  st.current = -1;
  st.subtitle = outro;
  st.hints = items.slice(0, 2).map((i) => `Reply to ${i.entity}`).concat(["Show interview emails", "Close"]);
  render();
  if (await say(outro)) listener.expectAnswer();
}

async function doFilter(command: string, key: FilterKey) {
  const pool = allItems(st.week);
  const items = pool.filter((i) => {
    const k = themeKey(i);
    if (key === "action") return Boolean(i.actionText) && k !== "security";
    if (key === "security") return k === "security";
    return k === key || i.status === key;
  });
  st.items = items;
  st.focus = null;
  st.current = items.length ? 0 : -1;
  st.listTitle = `FILTER › ${FILTER_LABEL[key].toUpperCase()}`;
  st.modeLabel = "FILTER MODE";
  st.count = `FILTER · ${items.length} FOUND`;
  const names = items.map((i) => i.entity);
  st.hints = items.slice(0, 2).map((i) => `Open the ${i.entity} email`).concat(["Back to summary", "Close"]);
  st.subtitle = items.length
    ? `You've got ${items.length} ${FILTER_LABEL[key]} email${items.length === 1 ? "" : "s"} this week: ${joinNames(names.slice(0, 5))}.${items.length > 1 ? " Want me to open one?" : ""}`
    : `I didn't find any ${FILTER_LABEL[key]} emails this week.`;
  openView("list", command);
  if ((await say(st.subtitle)) && items.length > 1) listener.expectAnswer();
}

async function doFocus(command: string, entity: string) {
  const pool = [...allItems(st.week), ...allItems(st.day), ...st.items].filter((i) => i.entity === entity);
  // prefer the newest, most important one
  const it = pool.sort((a, b) => (a.priority === b.priority ? b.date.localeCompare(a.date) : a.priority === "high" ? -1 : 1))[0];
  if (!it) return void say(`Hmm, I couldn't find an email from ${entity}.`);
  st.focus = it;
  st.items = [it];
  st.count = "OPEN · 1 MESSAGE";
  st.hints = themeKey(it) === "security" ? ["Back to summary", "Close"] : ["Reply to this", "Archive it", "Add this to my calendar", "Close"];
  st.subtitle = `${it.entity}: ${it.summary}${it.actionText && themeKey(it) !== "security" ? ` You might want to: ${it.actionText}.` : ""}${spokenDeadline(it.deadline)}`;
  openView("focus", command);
  await say(st.subtitle);
}

async function askTrashSpam(command: string) {
  st.subtitle = "";
  st.count = "CHECKING SPAM";
  openView("thinking", command);
  goGmail("#spam"); // show the Spam folder behind the transparent layer
  const res = await api<{ count: number; preview: { from: string; subject: string }[] }>("/gmail/spam");
  if (!res.ok) {
    closeOverlay();
    return void handleApiError(res.error, res.status);
  }
  if (res.data.count === 0) {
    closeOverlay();
    showToast("SPAM", "Your spam folder is already empty.");
    return void say("Good news, your spam folder is already empty!");
  }
  st.confirm = res.data;
  st.count = `SPAM · ${res.data.count} EMAILS`;
  st.subtitle = `You've got ${res.data.count} spam email${res.data.count === 1 ? "" : "s"}. Want me to move ${res.data.count === 1 ? "it" : "them all"} to Trash? Just say yes or no.`;
  openView("confirm", command);
  if (await say(st.subtitle)) listener.expectAnswer();
}

async function doTrashSpam(command: string) {
  if (!st.confirm) return;
  const expected = st.confirm.count;
  st.command = command;
  st.count = "DELETING…";
  st.view = "thinking";
  st.subtitle = `Moving ${expected} spam emails to Trash…`;
  render();
  const res = await api<{ trashed: number }>("/gmail/spam/trash", "POST", { confirm: true, expectedCount: expected });
  st.confirm = null;
  closeOverlay();
  if (!res.ok) return void handleApiError(res.error, res.status);
  goGmail("#spam"); // refresh the Spam view
  showToast("DONE", `${res.data.trashed} spam email${res.data.trashed === 1 ? "" : "s"} moved to Trash.`, { undo: true, ms: 12000 });
  await say(`Done! I moved ${res.data.trashed} spam emails to Trash. If that was a mistake, just say undo.`);
}

/**
 * Finds emails with a real Gmail search (any date, not only the synced week), shows them as cards,
 * and opens the same search in Gmail behind the transparent layer.
 */
async function doFind(command: string, query: string, label: string, spoken: string, myRun: number) {
  st.subtitle = "";
  st.count = "SEARCHING";
  openView("thinking", command);
  goGmail(`#search/${encodeURIComponent(query)}`);
  const r = await api<{ items: BriefingItem[]; more: boolean }>("/gmail/find", "POST", { query });
  if (myRun !== runId) return;
  if (!r.ok) {
    closeOverlay();
    return void handleApiError(r.error, r.status);
  }
  const items = r.data.items;
  const what = spoken ? `emails ${spoken}` : "matching emails";
  st.items = items;
  st.focus = null;
  st.current = -1;
  st.listTitle = `SEARCH › ${label}`;
  st.modeLabel = "SEARCH";
  st.count = `${items.length}${r.data.more ? "+" : ""} FOUND`;
  const names = [...new Set(items.map((i) => i.entity))];
  st.subtitle = items.length
    ? `I found ${items.length}${r.data.more ? " or more" : ""} ${what}${names.length ? `, from ${joinNames(names.slice(0, 4))}${names.length > 4 ? " and others" : ""}` : ""}. Tap one to open it, or ask me to read it.`
    : `I couldn't find any ${what}. They're also shown in Gmail behind me, in case you want to look.`;
  st.hints = items.slice(0, 2).map((i) => `Open the ${i.entity} email`).concat(["Close"]);
  openView("list", command);
  if (await say(st.subtitle)) engagedUntil = Date.now() + 30_000;
}

// ---------------------------------------------------------------------------
// Phase 2: replies — Vaani writes, reads it out, and only sends when you say so
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

function replyTarget(entity: string | null): BriefingItem | null {
  if (entity) {
    return [...allItems(st.week), ...allItems(st.day)]
      .filter((i) => i.entity === entity)
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  }
  return st.focus ?? (st.current >= 0 ? st.items[st.current] : null) ?? (st.items.length === 1 ? st.items[0] : null);
}

async function startReply(command: string, entity: string | null, intent: string, myRun: number) {
  const it = replyTarget(entity);
  if (!it) {
    await say(entity ? `Hmm, I couldn't find a recent email from ${entity}.` : "Sure! Which email should I reply to? You can say, for example: reply to TCS.");
    return listener.expectAnswer();
  }
  if (themeKey(it) === "security") return void say("That one looks like a scam, so I'd rather not reply to it. It's safest to just ignore it.");
  st.focus = it;
  st.items = [it];
  st.draft = null;
  if (intent) {
    st.reply = null;
    return void makeDraft(command, intent, myRun, it);
  }
  st.subtitle = "";
  st.count = "REPLY · READING THE EMAIL";
  openView("thinking", command);
  const r = await api<Omit<ReplyInfo, "item">>("/reply/suggest", "POST", { gmailId: it.gmailId });
  if (myRun !== runId) return;
  if (!r.ok) {
    closeOverlay();
    return void handleApiError(r.error, r.status);
  }
  st.reply = { item: it, ...r.data };
  st.count = `REPLY · ${it.entity.toUpperCase()}`;
  st.hints = [];
  const asks = r.data.asks.length ? ` They're asking: ${r.data.asks[0].replace(/\.$/, "")}.` : "";
  st.subtitle = `Sure! What would you like to say to ${it.entity}?${asks} Pick one of the ideas, or just tell me in your own words.`;
  openView("replyask", command);
  if (await say(st.subtitle)) listener.expectAnswer(20000);
}

async function makeDraft(command: string, intent: string, myRun: number, item?: BriefingItem) {
  const it = item ?? st.reply?.item ?? st.draft?.item;
  if (!it) return;
  st.subtitle = "Okay, writing that for you…";
  st.count = "REPLY · WRITING";
  openView("thinking", command);
  const r = await api<Omit<DraftInfo, "mode" | "item" | "intent" | "countdown" | "sending">>("/reply/draft", "POST", { gmailId: it.gmailId, intent });
  if (myRun !== runId) return;
  if (!r.ok) {
    if (r.status === 400 && r.error && !/NEEDS_GEMINI_KEY|NOT_SIGNED_IN/.test(r.error)) {
      closeOverlay();
      showToast("REPLY", r.error, { err: true });
      return void say(r.error);
    }
    closeOverlay();
    return void handleApiError(r.error, r.status);
  }
  st.reply = null;
  st.draft = { mode: "reply", item: it, intent, countdown: null, sending: false, ...r.data };
  await showDraft(command, myRun);
}

async function changeDraft(change: string, myRun: number) {
  const d = st.draft;
  if (!d) return;
  st.subtitle = "Sure, let me change that…";
  st.count = d.mode === "compose" ? "EMAIL · REWRITING" : "REPLY · REWRITING";
  openView("thinking", change);
  const r = d.mode === "compose"
    ? await api<Partial<DraftInfo>>("/compose/draft", "POST", { to: d.to, toName: d.toName, topic: d.intent, previous: { subject: d.subject, body: d.body }, change })
    : await api<Partial<DraftInfo>>("/reply/draft", "POST", { gmailId: d.item!.gmailId, intent: d.intent, previous: d.body, change });
  if (myRun !== runId) return;
  if (!r.ok) {
    st.view = "draft";
    st.subtitle = `Sorry, I couldn't change it. ${r.error ?? ""}`;
    render();
    return void say(st.subtitle);
  }
  st.draft = { ...d, ...r.data, to: d.mode === "compose" ? d.to : r.data.to ?? d.to, countdown: null, sending: false } as DraftInfo;
  await showDraft(change, myRun, true);
}

async function showDraft(command: string, myRun: number, changed = false) {
  const d = st.draft!;
  st.count = "DRAFT · NOT SENT";
  st.hints = ["Send it", "Make it shorter", "Make it more formal", "Save as draft"];
  st.subtitle = d.spoken || (changed ? "Done, I've updated it." : "Here's your reply.");
  openView("draft", command);
  await readDraft(myRun, changed ? "Done, here's the new version." : "");
}

async function readDraft(myRun: number, lead = "") {
  const d = st.draft;
  if (!d) return;
  const intro = lead || d.spoken || "Here's what I wrote.";
  st.subtitle = intro;
  render();
  if (!(await say(`${intro} It says: ${d.body}`)) || myRun !== runId) return;
  const missing = blanks(d.body);
  const ask = d.noReply
    ? "This came from a no-reply address, so I'd suggest not sending it. You can save it as a draft instead."
    : missing.length
      ? `I left ${missing.length === 1 ? "a blank" : "some blanks"} for ${missing.map((m) => m.slice(1, -1)).join(" and ")}. Please fill ${missing.length === 1 ? "it" : "them"} in on the screen, then say send.`
      : "Shall I send it? You can also ask me to change anything.";
  st.subtitle = ask;
  render();
  if ((await say(ask)) && myRun === runId) listener.expectAnswer(20000);
}

async function sendDraft(command: string, myRun: number) {
  const d = st.draft;
  if (!d) return;
  st.command = command;
  const missing = blanks(d.body);
  if (d.noReply) return void say("This email came from a no-reply address, so nobody would read it. You can save it as a draft instead.");
  if (d.mode === "compose" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.to)) {
    st.subtitle = "I need an email address first. Please type it in the To box.";
    render();
    return void say(st.subtitle);
  }
  if (missing.length) {
    st.subtitle = `Almost there! Please fill in ${missing.join(", ")} first.`;
    render();
    return void say(st.subtitle);
  }
  // 5-second safety window: "stop", "cancel" or the button cancels the send.
  st.view = "draft";
  st.subtitle = "Sending in 5 seconds. Say stop if you change your mind.";
  // (spoken without the word "stop", so the assistant's own voice can never cancel it)
  void say("Okay! Sending in 5 seconds. If you change your mind, just tell me.");
  for (let n = 5; n > 0; n--) {
    d.countdown = n;
    render();
    await sleep(1000);
    if (myRun !== runId || st.draft !== d) {
      d.countdown = null;
      if (st.draft === d) {
        st.view = "draft";
        st.subtitle = "No problem, I didn't send it. You can still change it, save it, or send it later.";
        render();
        void say("No problem, I didn't send it.");
      }
      return;
    }
  }
  d.countdown = null;
  d.sending = true;
  render();
  const r = d.mode === "compose"
    ? await api<{ id: string; to: string }>("/compose/send", "POST", { to: d.to, subject: d.subject, body: d.body, confirm: true })
    : await api<{ id: string; to: string }>("/reply/send", "POST", { gmailId: d.item!.gmailId, body: d.body, confirm: true });
  d.sending = false;
  if (!r.ok) {
    st.subtitle = `Sorry, it didn't go through. ${r.error ?? ""}`;
    render();
    return void say(st.subtitle);
  }
  const who = d.item?.entity || d.toName || d.to;
  closeOverlay();
  showToast("SENT ✓", `Your ${d.mode === "compose" ? "email" : "reply"} to ${who} is on its way (${r.data.to}).`, { ms: 8000 });
  await say(`Done! Your ${d.mode === "compose" ? "email" : "reply"} to ${who} is on its way.`);
}

async function saveDraft() {
  const d = st.draft;
  if (!d) return;
  const r = d.mode === "compose"
    ? await api<{ id: string }>("/compose/save", "POST", { to: d.to, subject: d.subject, body: d.body })
    : await api<{ id: string }>("/reply/save", "POST", { gmailId: d.item!.gmailId, body: d.body });
  if (!r.ok) return void say(`Sorry, I couldn't save it. ${r.error ?? ""}`);
  closeOverlay();
  showToast("SAVED", `Your ${d.mode === "compose" ? "email" : "reply"} is in Drafts. Finish it any time.`, { ms: 6000 });
  await say("Saved it in your Drafts. You can finish it whenever you like.");
}

// ---------------------------------------------------------------------------
// New emails by voice: who → what → draft (read aloud) → "send"
// ---------------------------------------------------------------------------
async function startCompose(command: string, to: string, topic: string, gmailOnly: boolean, myRun: number) {
  st.draft = null;
  st.reply = null;
  st.compose = { step: "to", to: "", email: "", topic, msg: "" };
  st.count = "NEW EMAIL";
  st.hints = [];
  if (gmailOnly) goGmail("#inbox?compose=new"); // Gmail's own compose window opens behind the layer too
  if (to) return void composeTo(command, to, myRun);
  st.subtitle = "Sure! Who's it for? Say a name, or spell the email address.";
  openView("compose", command);
  if (await say(st.subtitle)) listener.expectAnswer(20000);
}

async function composeTo(command: string, said: string, myRun: number) {
  const c = st.compose;
  if (!c) return;
  c.to = said;
  c.msg = "";
  st.subtitle = `Looking up ${said}…`;
  openView("compose", command);
  const r = await api<{ email: string; name: string }>("/compose/who", "POST", { to: said });
  if (myRun !== runId || st.compose !== c) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  if (!r.data.email) {
    c.msg = `I couldn't find ${said}'s email address. Type it in the To box, or spell it out, like "rahul dot sharma at gmail dot com".`;
    st.subtitle = `Hmm, I couldn't find an email address for ${said}. Could you type it, or spell it out for me?`;
    render();
    if (await say(st.subtitle)) listener.expectAnswer(20000);
    return;
  }
  c.email = r.data.email;
  c.to = r.data.name || said;
  c.step = "topic";
  if (c.topic) return void makeCompose(command, myRun);
  st.subtitle = `Got it, ${c.to}${r.data.name ? "" : ` at ${c.email}`}. What should the email say?`;
  render();
  if (await say(st.subtitle)) listener.expectAnswer(25000);
}

async function makeCompose(command: string, myRun: number) {
  const c = st.compose;
  if (!c) return;
  if (!c.email) return void composeTo(command, c.to, myRun);
  if (!c.topic) {
    c.step = "topic";
    st.subtitle = "What should the email say?";
    openView("compose", command);
    if (await say(st.subtitle)) listener.expectAnswer(25000);
    return;
  }
  st.subtitle = "Okay, writing it for you…";
  st.count = "NEW EMAIL · WRITING";
  openView("thinking", command);
  const r = await api<{ subject: string; body: string; hints: string[]; spoken: string }>("/compose/draft", "POST", { to: c.email, toName: c.to, topic: c.topic });
  if (myRun !== runId) return;
  if (!r.ok) {
    if (r.error === "NEEDS_GEMINI_KEY" || r.error === "NOT_SIGNED_IN") return void handleApiError(r.error, r.status);
    st.view = "compose";
    c.msg = r.error ?? "Sorry, I couldn't write it.";
    render();
    return void say(c.msg);
  }
  st.compose = null;
  st.draft = { mode: "compose", item: null, to: c.email, toName: c.to, subject: r.data.subject, noReply: false, body: r.data.body, hints: r.data.hints, spoken: r.data.spoken, intent: c.topic, countdown: null, sending: false };
  await showDraft(command, myRun);
}


// ---------------------------------------------------------------------------
// Writing INSIDE Gmail's own compose / reply box (no separate Vaani window)
// ---------------------------------------------------------------------------
/** What we last wrote into a Gmail box, so "make it shorter" / "send it" know what to work on. */
let gbox: { kind: "compose" | "reply"; gmailId: string; topic: string } | null = null;
/** Vaani just asked "what should I write?" — the next sentence is the answer. */
let gboxAskUntil = 0;
/** Hides Vaani's window but keeps the current task going (closeOverlay alone would cancel it). */
const quietClose = () => {
  closeOverlay();
  return runId;
};
const sleepMs = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

async function waitForBox(ms = 4000): Promise<ComposeBox | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const b = findCompose();
    if (b) return b;
    await sleepMs(120);
  }
  return null;
}

async function openGmailCompose(): Promise<ComposeBox | null> {
  const btn = composeButton();
  if (btn) press(btn);
  else goGmail("#inbox?compose=new");
  return waitForBox(3000);
}

/** "open gmail compose", "write an email to Rahul about…", "compose kholo" → Gmail's real compose window. */
async function gmailCompose(command: string, to: string, topic: string, myRun: number) {
  myRun = quietClose();
  const existing = findCompose();
  const b = existing && !isReplyBox(existing) && !bodyText(existing) ? existing : await openGmailCompose();
  if (myRun !== runId) return;
  if (!b) return void startCompose(command, to, topic, false, myRun); // Gmail changed its page: use Vaani's own window
  gbox = { kind: "compose", gmailId: "", topic: "" };
  if (to) {
    const r = await api<{ email: string; name: string }>("/compose/who", "POST", { to });
    if (myRun !== runId) return;
    if (r.ok && r.data.email) addRecipient(b, r.data.email);
    else showToast("TO", `I couldn't find ${to}'s address — please type it in the To box.`, { ms: 8000 });
  }
  if (topic) return void writeInBox(command, { topic, subject: "", dictate: false }, myRun);
  gboxAskUntil = Date.now() + 25_000;
  if (await say("Gmail compose is open. What should I write? For example: write that I need 10 days leave.")) listener.expectAnswer(25_000);
}

/** "reply to this" on an open conversation, or "reply to TCS" → Gmail's own reply box. Returns false if it couldn't. */
async function gmailReply(command: string, entity: string | null, intent: string, myRun: number): Promise<void> {
  // Gmail's reply box can't be found (Gmail changed its page): Vaani's own reply window instead.
  const fallback = () => (myRun === runId ? startReply(command, entity, intent, myRun) : undefined);
  let gmailId = "";
  if (entity) {
    const it = replyTarget(entity);
    if (!it || themeKey(it) === "security") return void startReply(command, entity, intent, myRun);
    gmailId = it.gmailId;
    myRun = quietClose();
    goGmail(`#all/${it.threadId}`);
    const end = Date.now() + 3000;
    while (Date.now() < end && !replyButton()) await sleepMs(150);
  } else {
    const onScreen = st.focus ?? (st.current >= 0 ? st.items[st.current] : null);
    if (!openedMessageId() && !replyButton() && onScreen) {
      gmailId = onScreen.gmailId;
      myRun = quietClose();
      goGmail(`#all/${onScreen.threadId}`);
      const end = Date.now() + 5000;
      while (Date.now() < end && !replyButton()) await sleepMs(150);
    }
  }
  if (myRun !== runId) return;
  const open = findCompose();
  let b = open && isReplyBox(open) ? open : null;
  if (!b) {
    const btn = replyButton();
    if (!btn) return void fallback();
    press(btn);
    b = await waitForBox(3000);
  }
  if (myRun !== runId) return;
  if (!b) return void fallback();
  myRun = quietClose();
  gbox = { kind: "reply", gmailId: gmailId || openedMessageId(), topic: "" };
  if (intent) {
    return void writeInBox(command, { topic: intent, subject: "", dictate: false }, myRun);
  }
  gboxAskUntil = Date.now() + 25_000;
  if (await say("The reply box is open. What would you like to say?")) listener.expectAnswer(25_000);
}

/** AI writes the email (or your exact words) straight into the open Gmail box. */
async function writeInBox(command: string, w: { topic: string; subject: string; dictate: boolean }, myRun: number, change?: string) {
  const b = findCompose();
  if (!b) return void say("I can't see a Gmail compose box. Say: open Gmail compose.");
  gboxAskUntil = 0;
  myRun = quietClose();
  st.command = command;
  if (w.dictate) {
    writeBody(b, spokenToText(w.topic));
    showToast("TYPED", "Added to the email.", { ms: 3000 });
    return;
  }
  const reply = isReplyBox(b);
  const state = gbox && gbox.kind === (reply ? "reply" : "compose") ? gbox : (gbox = { kind: reply ? "reply" : "compose", gmailId: reply ? openedMessageId() : "", topic: "" });
  const previous = change ? bodyText(b) : "";
  if (!change) state.topic = w.subject ? `${w.topic} (subject: ${w.subject})` : w.topic;
  st.chat = { you: command, text: "", thinking: true, until: Date.now() + 30_000 };
  renderMic();
  const subject = b.subject?.value?.trim() ?? "";
  const r = reply && state.gmailId
    ? await api<{ body: string; hints: string[]; spoken: string }>("/reply/draft", "POST", { gmailId: state.gmailId, intent: state.topic || change, previous: previous || undefined, change })
    : await api<{ subject?: string; body: string; hints: string[]; spoken: string }>("/compose/draft", "POST", {
        to: "", toName: recipientNames(b), topic: state.topic || change,
        previous: previous ? { subject, body: previous } : undefined, change,
      });
  st.chat = null;
  renderMic();
  if (myRun !== runId) return;
  if (!r.ok) {
    if (r.error === "NEEDS_GEMINI_KEY" || r.error === "NOT_SIGNED_IN") return void handleApiError(r.error, r.status);
    showToast("WRITE", r.error ?? "Sorry, I couldn't write that.", { err: true });
    return void say(r.error ?? "Sorry, I couldn't write that. Could you say it a little differently?");
  }
  const live = findCompose() ?? b; // the box may have been re-rendered while the AI was writing
  const newSubject = (r.data as { subject?: string }).subject;
  if (!reply && live.subject && !live.subject.value.trim() && newSubject) setSubject(live, newSubject);
  replaceBody(live, r.data.body);
  const blanks = placeholders(r.data.body);
  const hint = blanks.length ? `Please fill in ${blanks.join(", ")} before sending.` : r.data.hints[0] ?? "";
  if (hint) showToast("CHECK", hint, { ms: 10_000 });
  const line = `${r.data.spoken || (change ? "Done, I've changed it." : "Done, it's written.")} It's in the Gmail box. Read it, then say send, or tell me what to change.`;
  if (await say(line)) listener.expectAnswer(20_000);
}

/** "send it" while a Gmail box is open: 5 seconds to say stop, then Gmail's own Send button. */
async function sendFromBox(command: string, myRun: number) {
  const b = findCompose();
  if (!b) return;
  const text = bodyText(b);
  if (!text) return void say("The email is still empty. Tell me what to write first.");
  const blanks = placeholders(text);
  if (blanks.length) return void say(`Before sending, please fill in ${blanks.join(", ")}.`);
  if (!isReplyBox(b) && !recipientNames(b)) return void say("Who should it go to? Please add an address in the To box first.");
  if (!b.send) return void say("I can't find Gmail's Send button. Please click Send yourself.");
  st.command = command;
  showToast("SENDING", "Sending in 5 seconds. Say stop to cancel.", { ms: 5500 });
  void say("Okay! Sending in 5 seconds. If you change your mind, just tell me."); // the 5 s start now, not after it finishes talking
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (myRun !== runId) return void showToast("CANCELLED", "Not sent. The email is still open.", { ms: 4000 });
    await sleepMs(100);
  }
  const live = findCompose();
  if (!live?.send || myRun !== runId) return;
  press(live.send);
  gbox = null;
  showToast("SENT", "Sent with Gmail.", { ms: 4000 });
  void say("Sent!");
}

/** Sentences that belong to the open Gmail box. Returns true if handled. */
function routeToBox(text: string, cmdType: string, myRun: number): boolean {
  const b = findCompose();
  if (!b) return false;
  if ((cmdType === "send" || (cmdType === "confirm" && gbox)) && bodyText(b)) return void sendFromBox(text, myRun), true;
  const change = parseBoxChange(text);
  if (change && bodyText(b)) return void writeInBox(text, { topic: "", subject: "", dictate: false }, myRun, change), true;
  const w = parseWriteHere(text);
  if (w) return void writeInBox(text, w, myRun), true;
  if (Date.now() < gboxAskUntil && ["ask", "compose", "reply"].includes(cmdType)) return void writeInBox(text, { topic: text, subject: "", dictate: false }, myRun), true;
  return false;
}

// ---------------------------------------------------------------------------
// Organise emails: archive, read / unread, star, important, trash (all undoable)
// ---------------------------------------------------------------------------
const ACT_DONE: Record<string, string> = {
  archive: "Archived", read: "Marked as read", unread: "Marked as unread", star: "Starred", unstar: "Star removed",
  important: "Marked as important", trash: "Moved to Trash",
};
async function doGmailAct(command: string, act: string) {
  const it = st.focus ?? (st.current >= 0 ? st.items[st.current] : null) ?? (st.items.length === 1 ? st.items[0] : null);
  if (!it || it.kind) return void say("Which email? Open one first, for example: open the TCS email. Then ask me again.");
  const r = await api<{ done: number }>("/gmail/act", "POST", { ids: [it.gmailId], action: act });
  if (!r.ok) return void handleApiError(r.error, r.status);
  st.command = command;
  const text = `${ACT_DONE[act] ?? "Done"}: ${it.entity}.`;
  showToast("DONE", text, { undo: true, ms: 9000 });
  if (act === "archive" || act === "trash") {
    st.items = st.items.filter((x) => x.gmailId !== it.gmailId);
    if (st.focus?.gmailId === it.gmailId) closeOverlay();
    else render();
  }
  await say(`${text} Say undo if you need it back.`);
}

async function askReadAll(command: string) {
  st.subtitle = "";
  st.count = "CHECKING";
  openView("thinking", command);
  const r = await api<{ count: number; more: boolean }>("/gmail/unread");
  if (!r.ok) {
    closeOverlay();
    return void handleApiError(r.error, r.status);
  }
  if (!r.data.count) {
    closeOverlay();
    return void chat(command, "You're all caught up, there are no unread emails in your inbox!");
  }
  st.confirm = { kind: "readall", count: r.data.count, preview: [] };
  st.count = `UNREAD · ${r.data.count}${r.data.more ? "+" : ""}`;
  st.subtitle = `You have ${r.data.count}${r.data.more ? " or more" : ""} unread emails. Should I mark them all as read? Just say yes or no.`;
  openView("confirm", command);
  if (await say(st.subtitle)) listener.expectAnswer();
}

async function doReadAll(command: string) {
  st.command = command;
  st.view = "thinking";
  st.subtitle = "Marking them as read…";
  render();
  const r = await api<{ done: number }>("/gmail/readall", "POST", { confirm: true });
  st.confirm = null;
  closeOverlay();
  if (!r.ok) return void handleApiError(r.error, r.status);
  showToast("DONE", `${r.data.done} emails marked as read.`, { undo: true, ms: 10000 });
  await say(`Done! ${r.data.done} emails marked as read. Say undo if you change your mind.`);
}

// ---------------------------------------------------------------------------
// Google Calendar + notes (Google Tasks)
// ---------------------------------------------------------------------------
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });

async function doCalendar(command: string, date: string, days: number, label: string, myRun: number) {
  st.subtitle = "";
  st.count = "CALENDAR";
  openView("thinking", command);
  const r = await api<{ events: { id: string; title: string; start: string; end: string; allDay: boolean; link: string }[] }>("/calendar/list", "POST", { date, days });
  if (myRun !== runId) return;
  if (!r.ok) {
    closeOverlay();
    if (r.status === 403 || r.status === 400) return void chat(command, r.error ?? "I couldn't open your calendar.");
    return void handleApiError(r.error, r.status);
  }
  const ev = r.data.events;
  st.items = ev.map((e) => ({
    gmailId: e.id, threadId: "", entity: e.title, subject: e.title, kind: "event" as const,
    summary: e.allDay ? "All day" : `${clock(e.start)} – ${clock(e.end)}${days > 1 ? ` · ${new Date(e.start).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}` : ""}`,
    date: e.start, status: "none" as const, category: "other" as const, priority: "medium" as const, deadline: "", actionText: "",
    confidence: 1, verified: true, mergedCount: 1, gmailUrl: e.link, basic: true,
  }));
  st.focus = null;
  st.current = -1;
  st.listTitle = `CALENDAR › ${label.toUpperCase()}`;
  st.modeLabel = "CALENDAR";
  st.count = `${ev.length} EVENT${ev.length === 1 ? "" : "S"}`;
  st.hints = ["Add a meeting tomorrow at 4", "Show my notes", "Close"];
  st.subtitle = ev.length
    ? `You have ${ev.length} thing${ev.length === 1 ? "" : "s"} ${label}: ${joinNames(ev.slice(0, 4).map((e) => (e.allDay ? e.title : `${e.title} at ${clock(e.start)}`)))}${ev.length > 4 ? ", and more" : ""}.`
    : `Your calendar is free ${label}. Enjoy!`;
  openView("list", command);
  if (await say(st.subtitle)) engagedUntil = Date.now() + 30_000;
}

async function addCalendar(command: string, o: { title: string; date: string; time: string; durationMin: number; details?: string }) {
  const r = await api<{ id: string; title: string; start: string; allDay: boolean }>("/calendar/add", "POST", o);
  if (!r.ok) {
    if (r.error === "NOT_SIGNED_IN") return void handleApiError(r.error, r.status);
    return void chat(command, r.error ?? "I couldn't add it to your calendar.");
  }
  const when = r.data.allDay
    ? new Date(`${o.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })
    : `${new Date(r.data.start).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })} at ${clock(r.data.start)}`;
  showToast("CALENDAR ✓", `${r.data.title} · ${when}`, { undo: true, ms: 9000 });
  await chat(command, `Done! I added ${r.data.title} to your calendar on ${when}.`);
}

async function addNote(command: string, title: string, due = "") {
  const r = await api<{ id: string; title: string }>("/notes/add", "POST", { title, due });
  if (!r.ok) {
    if (r.error === "NOT_SIGNED_IN") return void handleApiError(r.error, r.status);
    return void chat(command, r.error ?? "I couldn't save that note.");
  }
  showToast("NOTED ✓", r.data.title, { undo: true, ms: 8000 });
  await chat(command, `Noted! I saved "${r.data.title}" in your Google Tasks.`);
}

async function listNotes(command: string, myRun: number) {
  st.subtitle = "";
  st.count = "NOTES";
  openView("thinking", command);
  const r = await api<{ notes: { id: string; title: string; notes: string; due: string }[] }>("/notes/list", "POST", {});
  if (myRun !== runId) return;
  if (!r.ok) {
    closeOverlay();
    return void chat(command, r.error ?? "I couldn't open your notes.");
  }
  const notes = r.data.notes;
  st.items = notes.map((n) => ({
    gmailId: n.id, threadId: "", entity: n.title, subject: n.title, summary: n.notes || (n.due ? `Due ${new Date(`${n.due}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "Google Tasks"), kind: "note" as const,
    date: n.due ? `${n.due}T00:00:00` : new Date().toISOString(), status: "none" as const, category: "other" as const, priority: "medium" as const,
    deadline: n.due, actionText: "", confidence: 1, verified: true, mergedCount: 1, gmailUrl: "", basic: true,
  }));
  st.focus = null;
  st.current = -1;
  st.listTitle = "MY NOTES · GOOGLE TASKS";
  st.modeLabel = "NOTES";
  st.count = `${notes.length} NOTE${notes.length === 1 ? "" : "S"}`;
  st.hints = ["Note: call the bank tomorrow", "What's on my calendar today", "Close"];
  st.subtitle = notes.length ? `You have ${notes.length} note${notes.length === 1 ? "" : "s"}: ${joinNames(notes.slice(0, 5).map((n) => n.title))}${notes.length > 5 ? ", and more" : ""}.` : "You don't have any notes yet. Just say: note, and what to remember.";
  openView("list", command);
  if (await say(st.subtitle)) engagedUntil = Date.now() + 30_000;
}

// ---------------------------------------------------------------------------
// SQLite history: answers in milliseconds, offline, without AI quota
// ---------------------------------------------------------------------------
const PERIOD_SAY: Record<Period, string> = { today: "today", week: "this week", month: "this month", last_month: "last month", year: "this year", all: "so far" };
const STAGE_WORD: Record<string, string> = { application_received: "applied", assessment: "test", shortlisted: "shortlisted", interview: "interview", offer: "offer", rejected: "rejected" };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const STAGE_PHRASE: Record<string, string> = { application_received: "got your application", assessment: "sent you a test", shortlisted: "shortlisted you", interview: "is at the interview stage", offer: "made you an offer", rejected: "said no" };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function histToItem(h: HistItem): BriefingItem {
  return { gmailId: h.id, threadId: h.threadId, entity: h.entity, subject: h.subject, summary: h.summary, date: h.date, status: h.status, category: h.category,
    priority: "medium", deadline: h.deadline, actionText: h.actionText, confidence: 1, verified: h.verified, mergedCount: 1, gmailUrl: "" };
}

function showList(command: string, items: BriefingItem[], title: string, mode: string, count: string, subtitle: string, hints: string[]) {
  st.items = items;
  st.focus = null;
  st.current = -1;
  st.listTitle = title;
  st.modeLabel = mode;
  st.count = count;
  st.subtitle = subtitle;
  st.hints = hints;
  openView("list", command);
}

async function doCount(command: string, c: { status: string; category: string; period: Period; what: string; from: string }, myRun: number) {
  const r = await api<{ emails: number; companies: string[]; items: HistItem[] }>("/history/count", "POST", { status: c.status, category: c.category, period: c.period, from: c.from });
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const { emails, companies, items } = r.data;
  const when = PERIOD_SAY[c.period];
  const from = c.from ? ` from ${c.from}` : "";
  let line: string;
  if (c.status) {
    line = companies.length
      ? `You got ${plural(companies.length, c.what)} ${when}${from}: ${joinNames(companies.slice(0, 5))}${companies.length > 5 ? ", and more" : ""}.${emails > companies.length ? ` That's ${plural(emails, "email")} including reminders.` : ""}`
      : `No ${c.what}s ${when}${from} yet. Fingers crossed, they're coming!`;
  } else {
    line = emails ? `You got ${plural(emails, c.what)} ${when}${from}.` : `I don't see any ${c.what}s ${when}${from}.`;
  }
  showList(command, items.map(histToItem), `HISTORY › ${(c.what + "s").toUpperCase()} · ${when.toUpperCase()}`, "FROM HISTORY", `${c.status ? companies.length : emails} FOUND`, line,
    ["Show my job tracker", "Show my stats", "Close"]);
  if (await say(line)) engagedUntil = Date.now() + 30_000;
}

async function doTracker(command: string, entity: string, myRun: number) {
  const r = await api<{ journeys: Journey[] }>("/history/tracker", "POST", { entity });
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const js = r.data.journeys;
  const items: BriefingItem[] = js.map((j) => ({
    gmailId: j.latestId, threadId: j.threadId, entity: j.entity, subject: j.entity, date: j.lastDate, status: j.current, category: "job", priority: "high",
    summary: j.steps.map((s) => `${STAGE_WORD[s.status] ?? s.status} ${shortDate(s.date)}`).join(" → "),
    deadline: "", actionText: "", confidence: 1, verified: true, mergedCount: j.steps.length, gmailUrl: "",
  }));
  let line: string;
  if (entity) {
    const j = js[0];
    line = j
      ? `${j.entity}: ${j.steps.map((s) => `${STAGE_WORD[s.status] ?? s.status} on ${shortDate(s.date)}`).join(", ")}. ${j.current === "rejected" ? "Sadly they said no this time. Their loss!" : j.current === "offer" ? "You got the offer. Congratulations!" : `You're at the ${STAGE_WORD[j.current] ?? j.current} stage.`}`
      : `I couldn't find any application updates from ${entity}.`;
  } else {
    const active = js.filter((j) => j.current !== "rejected");
    line = js.length
      ? `You're tracking ${plural(js.length, "application")}. ${joinNames(active.slice(0, 4).map((j) => `${j.entity} ${STAGE_PHRASE[j.current] ?? j.current}`))}${active.length ? "." : ""}${js.length - active.length ? ` ${js.length - active.length} said no.` : ""}`
      : "No job applications in your history yet. As soon as companies reply, I'll track them here.";
  }
  showList(command, items, entity ? `JOURNEY › ${entity.toUpperCase()}` : "JOB TRACKER · ALL APPLICATIONS", "TRACKER", `${js.length} APPLICATION${js.length === 1 ? "" : "S"}`, line,
    ["Export my applications", "Show my stats", "Close"]);
  if (await say(line)) engagedUntil = Date.now() + 30_000;
}

async function doHistory(command: string, query: string, myRun: number) {
  const r = await api<{ items: HistItem[] }>("/history/search", "POST", { query });
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const items = r.data.items.map(histToItem);
  const names = [...new Set(items.map((i) => i.entity))];
  const line = items.length
    ? `I found ${plural(items.length, "email")} about ${query} in your history${names.length ? `, from ${joinNames(names.slice(0, 4))}` : ""}.`
    : `Nothing about ${query} in your history. Want me to search all of Gmail instead? Say: search ${query}.`;
  showList(command, items, `HISTORY › "${query.toUpperCase()}"`, "HISTORY SEARCH", `${items.length} FOUND`, line, items.length ? ["Close"] : [`Search ${query}`, "Close"]);
  if (await say(line)) engagedUntil = Date.now() + 30_000;
}

async function doStats(command: string, period: Period, myRun: number) {
  const r = await api<Omit<StatsData, "label">>("/history/stats", "POST", { period });
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const d = { ...r.data, label: PERIOD_SAY[period] };
  st.stats = d;
  const s = d.byStatus;
  const parts = [["interview", s.interview], ["shortlist", s.shortlisted], ["offer", s.offer], ["test", s.assessment], ["rejection", s.rejected]]
    .filter(([, n]) => n).map(([w, n]) => plural(Number(n), String(w)));
  st.subtitle = `${period === "all" ? "So far" : `${PERIOD_SAY[period][0].toUpperCase()}${PERIOD_SAY[period].slice(1)}`} you got ${plural(d.total, "email")}${parts.length ? `, with ${joinNames(parts)}` : ""}.${d.topSenders[0] ? ` Most of them came from ${d.topSenders[0].sender}.` : ""}`;
  st.count = "STATS";
  openView("stats", command);
  if (await say(st.subtitle)) engagedUntil = Date.now() + 30_000;
}

async function doActivity(command: string, days: number, myRun: number) {
  const r = await api<{ actions: { at: string; kind: string; detail: string }[] }>("/history/actions", "POST", { days });
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const acts = r.data.actions;
  const when = days === 0 ? "today" : days === 1 ? "since yesterday" : "this week";
  const items: BriefingItem[] = acts.map((a, i) => ({
    gmailId: `log${i}`, threadId: "", entity: a.detail, subject: a.detail, summary: new Date(a.at).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" }),
    date: a.at, status: "none", category: "other", priority: "low", deadline: "", actionText: "", confidence: 1, verified: true, mergedCount: 1, gmailUrl: "", kind: "log",
  }));
  const line = acts.length ? `Here's what I did for you ${when}: ${joinNames(acts.slice(0, 4).map((a) => a.detail.charAt(0).toLowerCase() + a.detail.slice(1)))}${acts.length > 4 ? ", and more" : ""}.` : `I haven't done anything for you ${when} yet. Just ask!`;
  showList(command, items, `ACTIVITY · ${when.toUpperCase()}`, "ACTIVITY", plural(acts.length, "ACTION").toUpperCase(), line, ["Show my stats", "Close"]);
  if (await say(line)) engagedUntil = Date.now() + 30_000;
}

// ---------------------------------------------------------------------------
// For everyone: "who asked me for help?", pending replies, reports, alerts, old-email import
// ---------------------------------------------------------------------------
interface IntentItem extends HistItem { intent: string; ask: string; needsReply: boolean; daysWaiting: number }
const intentToItem = (h: IntentItem): BriefingItem => ({ ...histToItem(h), intent: h.intent as BriefingItem["intent"], ask: h.ask, needsReply: h.needsReply });

function showReport(command: string, r: Report, subtitle: string) {
  st.report = r;
  st.subtitle = subtitle;
  st.count = r.tag.split(" · ")[0];
  openView("report", command);
}

async function doIntentList(command: string, intents: string[], period: Period, label: string, myRun: number) {
  const r = await api<{ items: IntentItem[] }>("/history/intent", "POST", { intents, period });
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const items = r.data.items;
  const when = PERIOD_SAY[period];
  const people = [...new Set(items.map((i) => i.entity))];
  let line: string;
  if (!items.length) line = `No ${label} ${when}. ${intents[0] === "help_request" ? "Nobody needs you right now, enjoy!" : "All clear."}`;
  else if (intents[0] === "help_request")
    line = `Yes, ${plural(people.length, "person")} asked for your help ${when}: ${joinNames(items.slice(0, 3).map((i) => i.ask || `${i.entity}: ${i.summary}`))}.`;
  else line = `You have ${bucketPhrase(intents[0], items.length)} ${when}: ${joinNames(items.slice(0, 3).map((i) => i.ask || `${i.entity}, ${i.summary}`))}.`;
  line = line.replace("1 persons", "1 person").replace(/(\d+) persons/, "$1 people");
  showList(command, items.map(intentToItem), `${label.toUpperCase()} · ${when.toUpperCase()}`, "FOR YOU", `${items.length} FOUND`, line,
    items[0] ? [`Reply to ${items[0].entity}`, "What's pending", "Close"] : ["What's pending", "Close"]);
  if (await say(line)) engagedUntil = Date.now() + 30_000;
}

async function doPending(command: string, minDays: number, myRun: number) {
  const r = await api<{ items: IntentItem[] }>("/history/pending", "POST", { minDays });
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const items = r.data.items;
  const line = items.length
    ? `${plural(items.length, "person")} ${items.length === 1 ? "is" : "are"} waiting for your reply: ${joinNames(items.slice(0, 3).map((i) => `${i.entity}${i.daysWaiting ? `, ${plural(i.daysWaiting, "day")}` : ", today"}`))}. Want me to reply to the first one?`
    : "You're all caught up! Nobody is waiting for a reply from you.";
  showList(command, items.map(intentToItem).map((i, n) => ({ ...i, summary: `${items[n].ask || i.summary} · waiting ${items[n].daysWaiting ? plural(items[n].daysWaiting, "day") : "since today"}` })),
    "WAITING FOR YOUR REPLY", "PENDING", `${items.length} PENDING`, line.replace(/(\d+) persons/, "$1 people"), items[0] ? [`Reply to ${items[0].entity}`, "Close"] : ["Close"]);
  if ((await say(line.replace(/(\d+) persons/, "$1 people"))) && items.length) listener.expectAnswer();
}

async function doFunnel(command: string, myRun: number) {
  const r = await api<{ total: number; shortlisted: number; interview: number; offer: number; rejected: number; rates: { shortlisted: number; interview: number; offer: number } }>("/history/funnel", "POST", {});
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const f = r.data;
  const line = f.total
    ? `Out of ${plural(f.total, "application")}, ${f.shortlisted} got shortlisted, ${f.interview} reached interviews and ${f.offer} became ${f.offer === 1 ? "an offer" : "offers"}. That's a ${f.rates.interview}% interview rate.${f.rates.interview >= 25 ? " Nice going!" : " Keep going, it adds up!"}`
    : "No job applications in your history yet. Want me to import your old emails? Say: import my old emails.";
  showReport(command, {
    tag: "JOB FUNNEL · FROM YOUR HISTORY", title: "How far your applications get",
    cells: [["APPLICATIONS", f.total], ["SHORTLISTED", `${f.shortlisted} · ${f.rates.shortlisted}%`], ["INTERVIEWS", `${f.interview} · ${f.rates.interview}%`], ["OFFERS", `${f.offer} · ${f.rates.offer}%`], ["REJECTED", f.rejected], ["STILL OPEN", f.total - f.offer - f.rejected]],
    lists: [], acts: [["Job tracker", "show my job tracker"], ["Who went quiet?", "which companies ghosted me"]],
  }, line);
  if (await say(line)) engagedUntil = Date.now() + 30_000;
}

async function doGhosting(command: string, myRun: number) {
  const r = await api<{ items: (Journey & { silentDays: number })[] }>("/history/ghosting", "POST", { days: 14 });
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const g = r.data.items;
  const line = g.length
    ? `${plural(g.length, "company")} went quiet: ${joinNames(g.slice(0, 3).map((j) => `${j.entity}, ${j.silentDays} days`))}. Want me to write a polite follow-up to ${g[0].entity}?`
    : "Nobody has gone quiet on you. Every company replied within two weeks.";
  showList(command, g.map((j) => ({
    gmailId: j.latestId, threadId: j.threadId, entity: j.entity, subject: j.entity, date: j.lastDate, status: j.current, category: "job", priority: "medium",
    summary: `No news for ${j.silentDays} days · last: ${STAGE_WORD[j.current] ?? j.current}`, deadline: "", actionText: "", confidence: 1, verified: true, mergedCount: 1, gmailUrl: "",
  })), "NO NEWS FOR 2+ WEEKS", "FOLLOW UP", `${g.length} QUIET`, line.replace("1 companys", "1 company").replace(/companys/, "companies"), g[0] ? [`Follow up with ${g[0].entity}`, "Close"] : ["Close"]);
  if ((await say(line.replace(/companys/, "companies"))) && g.length) listener.expectAnswer();
}

async function doResponse(command: string, myRun: number) {
  const r = await api<{ companies: { entity: string; avgDays: number; samples: number }[]; overall: number | null }>("/history/response", "POST", {});
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const c = r.data.companies;
  const line = c.length
    ? `Companies take about ${r.data.overall} days to reply. Fastest: ${c[0].entity}, ${c[0].avgDays} days.${c.length > 1 ? ` Slowest: ${c[c.length - 1].entity}, ${c[c.length - 1].avgDays} days.` : ""}`
    : "I need at least two updates from a company to measure its reply time. As your history grows, this gets better.";
  showReport(command, {
    tag: "RESPONSE TIME · FROM YOUR HISTORY", title: "How fast companies reply",
    cells: r.data.overall !== null ? [["AVERAGE", `${r.data.overall} days`], ["FASTEST", c[0]?.entity ?? "-"], ["SLOWEST", c[c.length - 1]?.entity ?? "-"]] : [],
    lists: [{ title: "DAYS BETWEEN UPDATES", rows: c.slice(0, 8).map((x) => `${x.entity} · ${x.avgDays} days`) }], acts: [["Job tracker", "show my job tracker"]],
  }, line);
  if (await say(line)) engagedUntil = Date.now() + 30_000;
}

async function doWeekly(command: string, myRun: number, auto = false) {
  const r = await api<{ total: number; intents: Record<string, number>; jobMoves: { entity: string; status: string }[]; topSenders: { sender: string; n: number }[]; pending: number; deadlines: IntentItem[] }>("/history/weekly", "POST", {});
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const w = r.data;
  const parts = bucketOrder().filter((k) => w.intents[k]).slice(0, 4).map((k) => bucketPhrase(k, w.intents[k]));
  const line = `${auto ? `Happy ${new Date().toLocaleDateString("en-IN", { weekday: "long" })}! Here's your last week. ` : "Here's your last week. "}You got ${plural(w.total, "email")}${parts.length ? `, including ${joinNames(parts)}` : ""}.${w.jobMoves.length ? ` Job news: ${joinNames(w.jobMoves.slice(0, 3).map((j) => `${j.entity} ${STAGE_PHRASE[j.status] ?? j.status}`))}.` : ""}${w.pending ? ` ${plural(w.pending, "reply")} still pending.` : ""}${w.deadlines[0] ? ` Next deadline: ${w.deadlines[0].entity} on ${shortDate(`${w.deadlines[0].deadline}T00:00:00`)}.` : ""}`;
  showReport(command, {
    tag: "WEEKLY REPORT · LAST 7 DAYS", title: "Your week in email",
    cells: [["EMAILS", w.total], ["HELP / QUESTIONS", (w.intents.help_request ?? 0) + (w.intents.question ?? 0)], ["PENDING REPLIES", w.pending]],
    lists: [
      { title: "JOB NEWS", rows: w.jobMoves.slice(0, 6).map((j) => `${j.entity} · ${STAGE_WORD[j.status] ?? j.status}`) },
      { title: "COMING UP", rows: w.deadlines.map((d) => `${d.entity} · due ${shortDate(`${d.deadline}T00:00:00`)}`) },
      { title: "MOST EMAILS FROM", rows: w.topSenders.map((t) => `${t.sender} · ${t.n}`) },
    ],
    acts: [["What's pending", "what's pending"], ["Stats", "show my stats"]],
  }, line);
  if (await say(line)) engagedUntil = Date.now() + 30_000;
}

async function doDeadlines(command: string, myRun: number) {
  const r = await api<{ items: IntentItem[] }>("/history/deadlines", "POST", {});
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const d = r.data.items;
  const line = d.length ? `Coming up: ${joinNames(d.slice(0, 3).map((x) => `${x.entity} on ${shortDate(`${x.deadline}T00:00:00`)}`))}.` : "No deadlines coming up. Relax!";
  showList(command, d.map(intentToItem), "UPCOMING DEADLINES", "DEADLINES", `${d.length} COMING UP`, line, ["Add this to my calendar", "Close"]);
  if (await say(line)) engagedUntil = Date.now() + 30_000;
}

async function doContacts(command: string, myRun: number) {
  const r = await api<{ contacts: { name: string; email: string; n: number; last: string }[] }>("/history/contacts", "POST", {});
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const c = r.data.contacts;
  const line = c.length ? `You talk most with ${joinNames(c.slice(0, 3).map((x) => x.name))}. Say: write an email to, and their name.` : "No contacts yet. I add real people as they write to you.";
  showList(command, c.map((x, i) => ({
    gmailId: `c${i}`, threadId: "", entity: x.name, subject: x.email, summary: `${x.email} · ${plural(x.n, "email")} · last ${shortDate(x.last)}`, date: x.last,
    status: "none", category: "personal", priority: "medium", deadline: "", actionText: "", confidence: 1, verified: true, mergedCount: 1, gmailUrl: "", kind: "note",
  })), "YOUR CONTACTS", "CONTACTS", `${c.length} PEOPLE`, line, c[0] ? [`Write an email to ${c[0].name}`, "Close"] : ["Close"]);
  if (await say(line)) engagedUntil = Date.now() + 30_000;
}

async function doImport(command: string, months: number) {
  const r = await api<{ months: number }>("/history/import", "POST", { months });
  if (!r.ok) return void handleApiError(r.error, r.status);
  await chat(command, `Okay! I'm importing ${plural(r.data.months, "month")} of old emails in the background. I'll go gently to stay inside your free AI limit, so it can take a day or two. Ask "import status" any time.`);
}

async function doImportStatus(command: string, myRun: number) {
  const r = await api<{ status: string; months: number; imported: number; analysed: number; message: string; fetchDone: boolean }>("/history/import-status", "POST", {});
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const s = r.data;
  const line = s.status === "idle" ? "No import running. Say: import my old emails." : s.status === "done"
    ? `Import finished: ${plural(s.imported, "old email")} are in your history now.`
    : `Importing ${plural(s.months, "month")}: ${s.imported} emails downloaded${s.fetchDone ? "" : " so far"}, ${s.analysed} understood.${s.message ? ` ${s.message}` : ""}`;
  showReport(command, { tag: "OLD-EMAIL IMPORT", title: s.status === "done" ? "Import finished" : "Importing old emails",
    cells: [["DOWNLOADED", s.imported], ["UNDERSTOOD", s.analysed], ["STATUS", s.status]], lists: [], acts: [["Job tracker", "show my job tracker"], ["Stats", "show my stats"]] }, line);
  await say(line);
}

async function doWatch(command: string, kind: string, value: string, label: string) {
  const r = await api<{ watches: unknown[] }>("/history/watch", "POST", { kind, value, label });
  if (!r.ok) return void handleApiError(r.error, r.status);
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
  } catch { /* the extension shows its own notifications anyway */ }
  await chat(command, `Got it! I'll tell you whenever ${label}, even if Gmail is in another tab.`);
}

async function doWatchList(command: string, myRun: number) {
  const r = await api<{ watches: { label: string }[] }>("/history/watches", "POST", {});
  if (myRun !== runId) return;
  if (!r.ok) return void handleApiError(r.error, r.status);
  const w = r.data.watches;
  const line = w.length ? `I'm watching for: ${joinNames(w.map((x) => x.label))}.` : "No alerts yet. Say, for example: tell me whenever someone asks for help.";
  showReport(command, { tag: "ALERTS", title: "What I'm watching for", cells: [], lists: [{ title: "I'LL TELL YOU WHEN", rows: w.map((x) => x.label) }], acts: w.length ? [["Stop all alerts", "stop all alerts"]] : [] }, line);
  await say(line);
}

async function doUnwatch(command: string) {
  const r = await api("/history/unwatch", "POST", {});
  if (!r.ok) return void handleApiError(r.error, r.status);
  await chat(command, "Okay, I've stopped all alerts.");
}

// ---------------------------------------------------------------------------
// Everything in Gmail's left sidebar + your labels
// ---------------------------------------------------------------------------
let labelNames: string[] = [];
let awaitingLabelName = false;
async function loadLabels() {
  const r = await api<{ labels: { id: string; name: string }[] }>("/gmail/labels");
  if (r.ok) labelNames = r.data.labels.map((l) => l.name);
}

/** Clicks Gmail's own sidebar link (opening "More" first if it's hidden); falls back to the URL. */
async function openFolder(folder: Folder) {
  const re = FOLDER_SIDEBAR[folder];
  if (re) {
    const find = () =>
      [...document.querySelectorAll<HTMLElement>('div[role="navigation"] a, div[role="navigation"] [role="link"]')].find((a) => {
        const label = (a.getAttribute("aria-label") ?? a.textContent ?? "").trim();
        return re.test(label) && a.getClientRects().length > 0;
      });
    let link = find();
    if (!link) {
      const more = [...document.querySelectorAll<HTMLElement>('div[role="navigation"] [role="button"], div[role="navigation"] span')].find((b) => /^more$/i.test((b.textContent ?? "").trim()));
      more?.click();
      await new Promise((r) => window.setTimeout(r, 350));
      link = find();
    }
    if (link) return link.click();
  }
  goGmail(FOLDER_HASH[folder]);
}

const onScreenItem = () => st.focus ?? (st.current >= 0 ? st.items[st.current] : null) ?? (st.items.length === 1 ? st.items[0] : null);

async function createLabel(command: string, name: string) {
  const r = await api<{ name: string; existed: boolean }>("/gmail/label/create", "POST", { name });
  if (!r.ok) return void handleApiError(r.error, r.status);
  void loadLabels();
  showToast("LABEL", r.data.existed ? `"${r.data.name}" already exists` : `Created "${r.data.name}"`, { ms: 5000 });
  await chat(command, r.data.existed ? `You already have a label called ${r.data.name}.` : `Done! I created the label ${r.data.name}. Say: label this as ${r.data.name}, on any email.`);
}

async function applyLabel(command: string, name: string) {
  const it = onScreenItem();
  if (!it || it.kind) return void chat(command, "Which email? Open one first, then say: label this as, and the label name.");
  const r = await api<{ name: string; created: boolean }>("/gmail/label/apply", "POST", { ids: [it.gmailId], name });
  if (!r.ok) return void handleApiError(r.error, r.status);
  if (r.data.created) void loadLabels();
  showToast("LABELLED ✓", `${it.entity} → ${r.data.name}`, { undo: true, ms: 8000 });
  await chat(command, `Done! ${it.entity} is now in ${r.data.name}${r.data.created ? ", a new label I just created" : ""}. Say undo if that was a mistake.`);
}

async function setSubtitles(on: boolean, spoken: boolean) {
  subtitlesOn = on;
  await chrome.storage.local.set({ subtitles: on });
  render();
  renderMic();
  showToast("SUBTITLES", on ? "On — I'll show what I say" : "Off — voice only", { ms: 2500 });
  if (spoken) await say(on ? "Okay, subtitles are on." : "Okay, subtitles are off. I'll just talk.");
}

async function doExport(command: string) {
  const r = await api<{ csv: string }>("/history/export", "POST", {});
  if (!r.ok) return void handleApiError(r.error, r.status);
  // A normal file download (no new tab): Excel / Google Sheets open it directly.
  const url = URL.createObjectURL(new Blob(["\ufeff" + r.data.csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${NAME.toLowerCase()}-job-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast("EXPORTED ✓", `${a.download} is in your Downloads.`, { ms: 7000 });
  await chat(command, "Done! Your job tracker is downloaded as a CSV file. You can open it in Excel or Google Sheets.");
}

// ---------------------------------------------------------------------------
// Your assistant's name + speaking speed
// ---------------------------------------------------------------------------
async function askName() {
  st.naming = true;
  editName = true;
  openSetup();
  st.subtitle = "";
  if (await say("Hi! I'm your new email assistant. What would you like to call me?")) listener.expectAnswer(25000);
  else listener.expectAnswer(25000);
}

async function setName(raw: string, spoken = true) {
  const name = cleanName(raw);
  const problem = nameProblem(name);
  if (problem) {
    st.setupMsg = problem;
    st.setupErr = true;
    if (st.view === "setup") render();
    if (spoken && (await say(problem))) listener.expectAnswer(20000);
    return;
  }
  NAME = name;
  named = true;
  editName = false;
  st.naming = false;
  listener.name = name;
  await chrome.storage.local.set({ assistantName: name });
  st.setupMsg = `Nice to meet you! I'm ${name} now.`;
  st.setupErr = false;
  render();
  renderMic();
  if (spoken) await say(`I love it! From now on I'm ${name}. Just say ${name} whenever you need me.`);
}

async function setRate(delta: number) {
  speaker.rate = Math.round(Math.min(1.6, Math.max(0.7, speaker.rate + delta)) * 100) / 100;
  await chrome.storage.local.set({ voiceRate: speaker.rate });
  await say(delta > 0 ? "Okay, I'll talk a bit faster. How's this?" : "Sure, I'll slow down a little. Is this better?");
}

// ---------------------------------------------------------------------------
// Voice picker — the user chooses how Vaani sounds
// ---------------------------------------------------------------------------
async function openVoice(command: string) {
  st.count = `VOICE · ${usefulVoices(speaker.voices).length} AVAILABLE`;
  st.hints = ["Next voice", "Close"];
  st.subtitle = "Pick any voice you like. Tap one to hear it, or say: next voice.";
  openView("voice", command);
  await say(st.subtitle);
}

async function chooseVoice(name: string) {
  speaker.voiceName = name;
  await chrome.storage.local.set({ voiceName: name });
  const v = speaker.voice();
  st.subtitle = v ? `Now using ${voiceLabel(v).split(" · ")[0]}. ${VOICE_SAMPLE}` : VOICE_SAMPLE;
  if (st.view === "voice") render();
  await say(VOICE_SAMPLE);
}

async function nextVoice(command: string) {
  const voices = usefulVoices(speaker.voices);
  if (!voices.length) return void say("I couldn't find any other voices on this computer.");
  const cur = speaker.voice()?.name;
  const next = voices[(voices.findIndex((v) => v.name === cur) + 1) % voices.length];
  if (st.view !== "voice") await openVoice(command).catch(() => undefined);
  await chooseVoice(next.name);
}

async function doUndo() {
  const res = await api<{ restored: number }>("/gmail/undo", "POST");
  if (!res.ok) {
    showToast("UNDO", res.error || "Nothing to undo.", { err: true });
    return void say(res.error || "Nothing to undo.");
  }
  goGmail(location.hash || "#inbox");
  showToast("RESTORED", `${res.data.restored} emails restored.`);
  await say(`All right, I brought back ${res.data.restored} emails.`);
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------
root.addEventListener("click", (e) => {
  const cp = (e.target as HTMLElement).closest("[data-copy]") as HTMLElement | null;
  if (cp) {
    void navigator.clipboard.writeText(cp.dataset.copy ?? "").then(() => {
      cp.textContent = "Copied ✓";
      window.setTimeout(() => (cp.textContent = "Copy"), 1500);
    });
    return;
  }
  // every clickable thing in the overlay must be listed here (names, "use email for" chips, voices…)
  const el = (e.target as HTMLElement).closest("[data-cmd],[data-act],[data-focus],[data-speak],[data-name],[data-usefor],[data-voice]") as HTMLElement | null;
  if (!el) return;
  const cmd = el.dataset.cmd;
  if (cmd === "back") {
    if (st.view === "focus" && st.items.length) return void run("give me today's summary");
    return closeOverlay();
  }
  if (cmd) return void run(cmd);
  if (el.dataset.focus) {
    const it = [...allItems(st.week), ...allItems(st.day), ...st.items].find((i) => i.gmailId === el.dataset.focus);
    if (it?.kind) {
      // a calendar event or a note: just read it out
      void say(`${it.entity}. ${it.summary}`);
      return;
    }
    if (it) {
      runId++;
      speaker.stop();
      st.focus = it;
      st.count = "OPEN · 1 MESSAGE";
      st.hints = ["Open it in Gmail", "Close"];
      st.subtitle = `${it.entity}: ${it.summary}`;
      openView("focus", `Open ${it.entity}`);
    }
    return;
  }
  if (el.dataset.speak && st.focus) return void say(`${st.focus.entity}. ${st.focus.summary}`);
  if (el.dataset.voice !== undefined) return void chooseVoice(el.dataset.voice);
  if (el.dataset.name) return void setName(el.dataset.name);
  if (el.dataset.usefor) {
    const k = el.dataset.usefor;
    useFor = useFor.includes(k) ? useFor.filter((x) => x !== k) : [...useFor, k];
    void chrome.storage.local.set({ useFor });
    return render();
  }
  const act = el.dataset.act;
  if (act === "stopsend") {
    runId++;
    speaker.stop();
    return;
  }
  if (act === "vtest") return void say(VOICE_SAMPLE);
  if (act === "cc") return void setSubtitles(!subtitlesOn, false);
  if (act === "changename") {
    editName = true;
    return render();
  }
  if (act === "gmailcompose") {
    const c = st.compose;
    st.compose = null;
    return void gmailCompose("open gmail compose", c?.email ?? "", c?.topic ?? "", ++runId);
  }
  if (act === "vauto") {
    speaker.voiceName = "";
    void chrome.storage.local.set({ voiceName: "" });
    render();
    return void say(VOICE_SAMPLE);
  }
  if (act === "menu") {
    st.menu = !st.menu;
    renderMic();
    if (st.menu) (root.querySelector(".menu input[type=text]") as HTMLInputElement | null)?.focus();
  } else if (act === "setup") {
    openSetup();
  } else if (act === "signin") {
    st.setupBusy = true;
    st.setupMsg = "Opening Google sign-in…";
    st.setupErr = false;
    render();
    void api<{ email: string }>("/auth/signin", "POST").then((r) => {
      st.setupBusy = false;
      st.setupMsg = r.ok ? `Signed in as ${r.data.email}. Reading your inbox…` : r.error || "Sign-in failed.";
      st.setupErr = !r.ok;
      void refreshStatus();
    });
  } else if (act === "changeclient") {
    editClient = true;
    render();
  } else if (act === "replacekey") {
    if (st.setup) st.setup = { ...st.setup, hasGeminiKey: false };
    render();
  }
});

root.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.act === "mic") {
    listener.setEnabled(el.checked);
    void chrome.storage.local.set({ micOn: el.checked });
  } else if (el.dataset.act === "vrate" || el.dataset.act === "vpitch") {
    const v = Number(el.value);
    if (el.dataset.act === "vrate") speaker.rate = v;
    else speaker.pitch = v;
    void chrome.storage.local.set({ [el.dataset.act === "vrate" ? "voiceRate" : "voicePitch"]: v });
    render();
    void say(VOICE_SAMPLE);
  } else if (el.dataset.act === "subs") {
    void setSubtitles(el.checked, false);
  } else if (el.dataset.act === "wake") {
    listener.wakeWord = el.checked;
    void chrome.storage.local.set({ wakeWord: el.checked });
    renderMic();
  }
});

root.addEventListener("input", (e) => {
  const t = e.target as HTMLTextAreaElement;
  if (t.tagName === "TEXTAREA" && st.draft) st.draft.body = t.value; // the user can edit the reply by hand
  const label = t.getAttribute?.("aria-label");
  if (st.draft && label === "To") st.draft.to = t.value.trim();
  if (st.draft && label === "Subject") st.draft.subject = t.value;
  if (st.compose && label === "Compose to") {
    st.compose.to = t.value;
    st.compose.email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.value.trim()) ? t.value.trim() : "";
  }
  if (st.compose && label === "Compose about") st.compose.topic = t.value;
});

root.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target as HTMLElement;
  if (form.dataset.act === "nameform") {
    const v = (form.querySelector("input") as HTMLInputElement).value.trim();
    if (v) void setName(v);
    return;
  }
  if (form.dataset.act === "composeform") {
    const c = st.compose;
    if (!c) return;
    const myRun = ++runId;
    if (!c.email && c.to.trim()) return void composeTo(c.to, c.to.trim(), myRun);
    return void makeCompose(c.topic || "", myRun);
  }
  if (form.dataset.act === "intentform") {
    const v = (form.querySelector("input") as HTMLInputElement).value.trim();
    if (v) void makeDraft(v, v, ++runId);
    return;
  }
  if (form.dataset.act === "clientform") {
    const input = form.querySelector("input") as HTMLInputElement;
    const id = input.value.trim();
    if (!id) return;
    st.setupBusy = true;
    render();
    void api("/settings/client", "PUT", { clientId: id }).then((r) => {
      st.setupBusy = false;
      st.setupMsg = r.ok ? "Client ID saved. Now sign in with Google (step 2)." : r.error || "Could not save the Client ID.";
      st.setupErr = !r.ok;
      if (r.ok) editClient = false;
      void refreshStatus();
    });
    return;
  }
  if (form.dataset.act === "keyform") {
    const input = form.querySelector("input") as HTMLInputElement;
    const key = input.value.trim();
    if (!key) return;
    st.setupBusy = true;
    st.setupMsg = "Checking your key…";
    st.setupErr = false;
    render();
    void api<{ message: string }>("/settings/gemini", "PUT", { apiKey: key }).then((r) => {
      st.setupBusy = false;
      st.setupMsg = r.ok ? r.data.message : r.error || "Could not save the key.";
      st.setupErr = !r.ok;
      void refreshStatus().then(() => {
        // (never speak the wake word itself: the mic could hear it and start a command on its own)
        if (r.ok && isReady()) void say(`All set${firstName() ? `, ${firstName()}` : ""}! Whenever you're ready, just ask me for today's summary.`);
      });
    });
    return;
  }
  const input = (e.target as HTMLElement).querySelector("input[type=text]") as HTMLInputElement | null;
  const text = input?.value.trim();
  if (!text) return;
  input!.value = "";
  st.menu = false;
  void run(text);
});

window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && (st.view !== "none" || st.menu)) {
      e.stopPropagation();
      st.menu = false;
      closeOverlay();
    }
    // Alt+V: open the command box
    if (e.altKey && (e.key === "v" || e.key === "V")) {
      e.preventDefault();
      st.menu = true;
      renderMic();
      (root.querySelector(".menu input[type=text]") as HTMLInputElement | null)?.focus();
    }
  },
  true,
);

chrome.storage.onChanged.addListener((changes) => {
  if (changes.micOn) listener.setEnabled(Boolean(changes.micOn.newValue));
  if (changes.wakeWord) {
    listener.wakeWord = Boolean(changes.wakeWord.newValue);
    renderMic();
  }
  if (changes.voiceName) speaker.voiceName = String(changes.voiceName.newValue ?? "");
  if (changes.useFor) useFor = (changes.useFor.newValue as string[] | undefined) ?? [];
  if (changes.subtitles) {
    subtitlesOn = changes.subtitles.newValue !== false;
    if (st.view !== "none") render();
    renderMic();
  }
  // "tell me whenever …" → a new alert arrived: speak it if you're looking at Gmail
  if (changes.alerts && !document.hidden) {
    const newest = ((changes.alerts.newValue as { at: string; label: string; text: string }[] | undefined) ?? [])[0];
    const prevNewest = ((changes.alerts.oldValue as { at: string }[] | undefined) ?? [])[0];
    if (newest && newest.at !== prevNewest?.at) {
      showToast("HEADS UP", newest.text, { ms: 10000 });
      void say(`Heads up! ${newest.text}`);
    }
  }
  if (changes.assistantName && changes.assistantName.newValue) {
    NAME = String(changes.assistantName.newValue);
    named = true;
    listener.name = NAME;
    renderMic();
    if (st.view !== "none") render();
  }
  if (changes.voiceRate) speaker.rate = Number(changes.voiceRate.newValue ?? 1);
  if (changes.voicePitch) speaker.pitch = Number(changes.voicePitch.newValue ?? 1);
  if (changes.recLang) {
    listener.lang = String(changes.recLang.newValue);
    listener.restart();
  }
  if (changes.account || changes.geminiKey || changes.sync || changes.emails || changes.clientId) {
    st.loadedAt = 0;
    scheduleStatus();
  }
});

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
async function boot() {
  if (window.top !== window) return; // never inside Gmail's own iframes
  injectFonts();
  document.documentElement.appendChild(host);
  const s = await getSettings();
  listener.wakeWord = s.wakeWord;
  listener.lang = s.recLang;
  speaker.voiceName = s.voiceName;
  NAME = s.assistantName || "Vaani";
  useFor = s.useFor ?? [];
  subtitlesOn = s.subtitles !== false;
  named = Boolean(s.assistantName);
  listener.name = NAME;
  void chrome.runtime.sendMessage({ type: "tab", action: "visible" }).catch(() => undefined);
  // Ctrl+Shift+Space from any tab → the background brings Gmail forward and asks us to open the command box
  chrome.runtime.onMessage.addListener((m: { type?: string }) => {
    if (m?.type === "open-mail") {
      // clicked an alert notification: open that email's thread
      void chrome.storage.local.get("alerts").then((r) => {
        const a = ((r.alerts as { gmailId: string; threadId: string }[] | undefined) ?? []).find((x) => x.gmailId === (m as { gmailId?: string }).gmailId);
        goGmail(a?.threadId ? `#all/${a.threadId}` : "#inbox");
      });
      return;
    }
    if (m?.type !== "open-assistant") return;
    st.menu = true;
    renderMic();
    (root.querySelector(".menu input[type=text]") as HTMLInputElement | null)?.focus();
    void say("Yes? How can I help?");
  });
  speaker.rate = s.voiceRate;
  speaker.pitch = s.voicePitch;
  const status = await refreshStatus();
  listener.setEnabled(s.micOn);
  // First time after install: ask what to call the assistant (by voice and in the setup panel).
  if (!named) {
    void askName();
    return;
  }
  if (!status || !isReady() || status.needsReauth) {
    openSetup(); // first run: show the setup right inside Gmail
    return;
  }
  // Warm the cache so the first command is instant.
  void loadBriefings().catch(() => undefined);
  void loadLabels();
  // Monday (or the first visit of a new week): the weekly report, once.
  window.setTimeout(() => {
    void api<{ due: boolean }>("/history/weekly-due").then((r) => {
      if (!r.ok || !r.data.due || st.view !== "none" || document.hidden) return;
      void api("/history/weekly-due", "POST", {});
      void doWeekly("Weekly report", ++runId, true);
    });
  }, 4000);
}

void boot();

// ---------------------------------------------------------------------------
// Test-only hook (removed from normal builds): lets the automated browser test
// press buttons inside the closed shadow root.
// ---------------------------------------------------------------------------
declare const __TEST__: boolean;
if (typeof __TEST__ !== "undefined" && __TEST__) {
  document.addEventListener("vaani-test", (e) => {
    const d = JSON.parse(String((e as CustomEvent).detail)) as { act?: string; key?: string; cmd?: string };
    if (d.act) (root.querySelector(`[data-act="${d.act}"]`) as HTMLElement | null)?.click();
    if (d.key) {
      const f = root.querySelector('form[data-act="keyform"]') as HTMLFormElement | null;
      if (f) {
        (f.querySelector("input") as HTMLInputElement).value = d.key;
        f.requestSubmit();
      }
    }
    if (d.cmd) void run(d.cmd);
    // a real click on an element inside the (closed) overlay, like a person would do
    const sel = (d as { click?: string }).click;
    if (sel) (root.querySelector(sel) as HTMLElement | null)?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    if ((d as { toggleMic?: boolean }).toggleMic) {
      listener.setEnabled(false);
      listener.setEnabled(true);
    }
    const dd = d as { type?: string; dump?: boolean };
    if (dd.type !== undefined) {
      const i = root.querySelector('form[data-act="clientform"] input') as HTMLInputElement | null;
      if (i) {
        i.focus();
        i.value = dd.type;
      }
      const box = root.querySelector(".setup") as HTMLElement | null;
      if (box) box.scrollTop = 300;
    }
    if (dd.dump) {
      const i = root.querySelector('form[data-act="clientform"] input') as HTMLInputElement | null;
      const box = root.querySelector(".setup") as HTMLElement | null;
      document.documentElement.dataset.vaaniDump = JSON.stringify({ value: i?.value ?? null, focused: root.activeElement === i, scroll: box?.scrollTop ?? null, renders: renderCount, view: st.view, command: st.command, mic: listener.state, runs: runId, chat: st.chat?.text ?? null, sub: st.subtitle, speaking: speaker.speaking, hash: location.hash, said: speaker.lastText, name: NAME, named, useFor, voice: speaker.voiceName, subs: subtitlesOn, subVisible: Boolean(root.querySelector(".subtitle")), spoken: spokenChars });
    }
    if ((d as { client?: string }).client) {
      const f = root.querySelector('form[data-act="clientform"]') as HTMLFormElement | null;
      if (f) {
        (f.querySelector("input") as HTMLInputElement).value = (d as { client?: string }).client!;
        f.requestSubmit();
      }
    }
  });
}
