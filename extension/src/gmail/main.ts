/**
 * Vaani overlay for Gmail.
 * Everything happens inside the Gmail tab: a transparent JARVIS-style layer on
 * top of the inbox, a mic box in the bottom-left corner, and voice commands that
 * open Gmail folders in the same tab or act on Gmail (e.g. delete all spam).
 */
import type { Briefing, BriefingItem } from "../../../shared/types";
import { api, getSettings } from "../shared";
import { FOLDER_HASH, FOLDER_LABEL, parseCommand, type Command, type FilterKey } from "./commands";
import { Listener, Speaker } from "./speech";
import { CSS } from "./styles";

const AGENT = "VAANI";
const WAKE = "Vaani";

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
};
function themeKey(i: BriefingItem): string {
  if (i.category === "scam") return "security";
  if (i.status !== "none") return i.verified ? i.status : "unverified";
  if (i.actionText) return "action";
  if (i.category === "personal") return "personal";
  if (i.category === "finance") return "finance";
  return "important";
}
const theme = (i: BriefingItem) => THEME[themeKey(i)];

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
type View = "none" | "briefing" | "list" | "focus" | "full" | "confirm" | "thinking" | "setup";

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
  confirm: null as { count: number; preview: { from: string; subject: string }[] } | null,
  hints: [] as string[],
  menu: false,
  connected: true,
  setup: null as SetupStatus | null,
  setupMsg: "",
  setupErr: false,
  setupBusy: false,
  toast: null as { text: string; label: string; err?: boolean; undo?: boolean } | null,
};
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
    f("VaaniOrbitron", "orbitron-latin-500-normal.woff2", 500),
    f("VaaniOrbitron", "orbitron-latin-700-normal.woff2", 700),
    f("VaaniRajdhani", "rajdhani-latin-500-normal.woff2", 500),
    f("VaaniRajdhani", "rajdhani-latin-600-normal.woff2", 600),
    f("VaaniRajdhani", "rajdhani-latin-700-normal.woff2", 700),
    f("VaaniMono", "jetbrains-mono-latin-500-normal.woff2", 500),
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
    if (t?.tagName === "INPUT") e.stopPropagation();
  });
}

const speaker = new Speaker(() => renderMic());
const listener = new Listener(
  () => renderMic(),
  (text) => void run(text),
  () => {
    speaker.stop();
    runId++;
    if (st.view === "briefing") {
      st.subtitle = "Stopped.";
      render();
    }
  },
);
listener.agentSpeaking = () => speaker.speaking;

async function say(text: string): Promise<boolean> {
  const ok = await speaker.say(text);
  listener.agentStopped();
  return ok;
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
const reactorSvg = `
  <svg viewBox="-210 -210 420 420"><defs><radialGradient id="g" r="1"><stop offset="0" stop-color="#bff4ff" stop-opacity=".95"/><stop offset=".35" stop-color="#46d9ff" stop-opacity=".55"/><stop offset="1" stop-color="#0a3a7a" stop-opacity="0"/></radialGradient></defs>
    <circle r="205" fill="none" stroke="rgba(70,217,255,.15)"/>
    <circle r="160" fill="none" stroke="rgba(155,236,255,.5)" stroke-width="10" stroke-dasharray="1 7"/>
    <circle r="120" fill="rgba(10,40,90,.35)" stroke="rgba(70,217,255,.45)"/>
    <g stroke="#9becff" stroke-width="2" opacity=".75">${Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="-104" x2="0" y2="-92" transform="rotate(${i * 30})"/>`).join("")}</g>
    <circle r="96" fill="url(#g)" opacity=".6"/><circle r="96" fill="none" stroke="#46d9ff" stroke-width="1.5"/></svg>
  <svg viewBox="-210 -210 420 420" class="spin"><circle r="196" fill="none" stroke="rgba(70,217,255,.55)" stroke-dasharray="2 6"/>
    <circle r="180" fill="none" stroke="#46d9ff" stroke-width="3" stroke-dasharray="160 40 60 40 220 70" style="filter:drop-shadow(0 0 4px #46d9ff)"/>
    <path d="M -180 0 A 180 180 0 0 1 -127 -127" fill="none" stroke="#fff" stroke-width="4" style="filter:drop-shadow(0 0 4px #fff)"/></svg>
  <svg viewBox="-210 -210 420 420" class="spinr"><circle r="138" fill="none" stroke="#2a7bff" stroke-width="2" stroke-dasharray="300 60 120 60"/>
    <path d="M 127 127 A 180 180 0 0 1 0 180" fill="none" stroke="#fff" stroke-width="4" style="filter:drop-shadow(0 0 4px #fff)"/></svg>`;

const eq = (on: boolean) => `<span class="eqs ${on ? "on" : ""}"><i></i><i></i><i></i><i></i><i></i></span>`;

function card(i: BriefingItem, idx: number | null, cls = "") {
  const t = theme(i);
  const dl = deadline(i.deadline);
  const meta = [
    i.actionText && themeKey(i) !== "security" ? `<span class="chip">${esc(i.actionText)}</span>` : "",
    dl ? `<span class="chip ${dl.hot ? "hot" : ""}">${dl.label}</span>` : "",
    i.mergedCount > 1 ? `<span class="chip">${i.mergedCount} MERGED</span>` : "",
    themeKey(i) === "security" ? "" : i.verified ? `<span class="chip">✓ VERIFIED</span>` : `<span class="chip hot">⚠ CHECK MANUALLY</span>`,
  ].join("");
  const right = cls.includes("now") ? `<span class="speaking mono">${eq(true)} SPEAKING</span>` : `<span class="time mono">${esc(time(i.date))}</span>`;
  return `<button class="hc pa ${cls}" data-focus="${esc(i.gmailId)}">
    <div class="top">${idx !== null ? `<span class="idx mono">${String(idx + 1).padStart(2, "0")}</span>` : ""}<span class="tag ${t.cls}">${t.label}</span>${right}</div>
    <div class="co">${esc(i.entity)}</div><div class="sum">${esc(i.summary)}</div>
    ${meta ? `<div class="meta">${meta}</div>` : ""}</button>`;
}

function hintsHtml() {
  if (!st.hints.length) return "";
  return `<div class="hints"><span class="k mono">SAY ›</span>${st.hints
    .map((h) => `<button class="hint pa" data-cmd="${esc(h)}">"${WAKE}, <b>${esc(h)}</b>"</button>`)
    .join("")}</div>`;
}

function commandBar() {
  return `<div class="cmd pa"><span class="dot"></span><span class="lbl mono">COMMAND</span><span class="q">"${esc(st.command)}"</span>${
    st.count ? `<span class="count mono">${esc(st.count)}</span>` : ""
  }</div><button class="closeX pa" data-cmd="close" title="Close (Esc)">✕</button>`;
}

function coreHtml(sub: string) {
  const busy = st.view === "thinking" || speaker.speaking;
  return `<div class="core ${busy ? "busy" : ""}">${reactorSvg}<div class="name"><div><b>${AGENT}</b><small>${esc(sub)}</small></div></div></div>`;
}

function subtitleHtml() {
  if (!st.subtitle) return "";
  // highlight company names that appear in the spoken line
  let html = esc(st.subtitle);
  const names = [...new Set(st.items.map((i) => i.entity).concat(st.focus ? [st.focus.entity] : []))].filter((n) => n.length > 1);
  for (const n of names.sort((a, b) => b.length - a.length)) {
    const e = esc(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(`\\b${e}\\b`, "g"), `<mark>${esc(n)}</mark>`);
  }
  html = html.replace(/(₹[\d,]+)/g, "<mark>$1</mark>");
  return `<div class="subtitle"><div class="who mono">${AGENT} ›</div><p>"${html}"</p></div>`;
}

function readouts(b: Briefing | null) {
  if (!b) return "";
  const s = b.stats;
  return `<div class="readouts">
    <div class="ro"><div class="k mono">EMAILS SCANNED</div><div class="v">${s.totalEmails}</div></div>
    <div class="ro"><div class="k mono">IMPORTANT</div><div class="v">${s.shownEmails}</div></div>
    <div class="ro"><div class="k mono">PROMO HIDDEN</div><div class="v">${s.hiddenSpamPromo}</div></div>
    <div class="ro"><div class="k mono">SCAM BLOCKED</div><div class="v" style="color:${s.scamCount ? "#ff9a9a" : "inherit"}">${s.scamCount}</div></div></div>`;
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
  el.querySelectorAll("input[type=text], input[type=password]").forEach((n) => {
    const i = n as HTMLInputElement;
    const key = i.getAttribute("aria-label") ?? "";
    inputs.set(key, { value: i.value, focused: root.activeElement === i, start: i.selectionStart, end: i.selectionEnd });
  });
  const scrolls = new Map<string, number>();
  el.querySelectorAll(".setup, .stack, .cols").forEach((n) => scrolls.set(n.className.split(" ").find((c) => ["setup", "stack", "cols"].includes(c))!, n.scrollTop));

  el.innerHTML = html;
  lastHtml.set(el, html);

  el.querySelectorAll("input[type=text], input[type=password]").forEach((n) => {
    const i = n as HTMLInputElement;
    const prev = inputs.get(i.getAttribute("aria-label") ?? "");
    if (!prev) return;
    i.value = prev.value;
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
      <div class="stack pa"><div class="stack-h mono"><span>${esc(st.listTitle)}</span><b>${st.items.length} ITEMS</b></div><div class="timeline"></div>${
        cards || `<div class="stack-h mono" style="margin-top:8px"><span>NOTHING FOUND</span></div>`
      }</div>
      ${coreHtml(st.modeLabel)}${st.view === "briefing" ? readouts(st.day) : ""}${subtitleHtml()}${hintsHtml()}`;
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
          ${i.actionText && !security ? `<div class="cell"><div class="k mono">YOUR ACTION</div><div class="v">${esc(i.actionText)}</div></div>` : ""}
          ${dl ? `<div class="cell ${dl.hot ? "hot" : ""}"><div class="k mono">DEADLINE</div><div class="v">${dl.label.replace("DUE · ", "")}</div></div>` : ""}
          ${i.mergedCount > 1 ? `<div class="cell"><div class="k mono">REMINDERS</div><div class="v">${i.mergedCount} merged</div></div>` : ""}
        </div>
        ${security ? `<div class="cell hot" style="margin-top:14px;color:#ffb3b3">Do not open links in this email or share payments, OTPs or passwords.</div>` : `
        <div class="conf mono"><span>${i.verified ? "✓ VERIFIED" : "⚠ NOT VERIFIED"}</span><div class="bar"><i style="width:${conf}%"></i></div><span>AI CONFIDENCE ${conf}%</span></div>`}
        <div class="acts"><button class="btn solid" data-cmd="open it in gmail">Open in Gmail</button><button class="btn" data-speak="${esc(i.gmailId)}">Read aloud</button><button class="btn ghost" data-cmd="back">Back</button></div>
      </div>
      ${coreHtml("READING")}${subtitleHtml()}${hintsHtml()}`;
  } else if (st.view === "full") {
    const b = st.day;
    const secs = b?.sections ?? [];
    const pick = (keys: string[]) => secs.filter((s) => keys.includes(s.key)).flatMap((s) => s.items);
    const cols: [string, BriefingItem[], boolean][] = [
      ["Action pending", pick(["action", "assessment"]), false],
      ["Interviews · offers", pick(["interview", "offer"]), false],
      ["Shortlisted · personal · bank", pick(["shortlisted", "personal", "finance", "other_important"]), false],
      ["Applied · rejected · security", pick(["application_received", "rejected", "security"]), true],
    ];
    const s = b?.stats;
    body = `${commandBar()}
      <div class="fullhead">${
        s
          ? [["EMAILS SCANNED", s.totalEmails], ["IMPORTANT", s.shownEmails], ["PROMO HIDDEN", s.hiddenSpamPromo], ["DUPLICATES MERGED", s.duplicatesMerged], ["SCAM BLOCKED", s.scamCount]]
              .map(([k, v]) => `<div class="stat"><div class="k mono">${k}</div><div class="v">${v}</div></div>`)
              .join("")
          : ""
      }</div>
      <div class="cols pa">${cols
        .map(
          ([title, items, alert]) =>
            `<div class="col"><h3 class="${alert && items.some((x) => themeKey(x) === "security") ? "alert" : ""}"><span>${title}</span><span>${String(items.length).padStart(2, "0")}</span></h3>${items
              .map((x) => card(x, null))
              .join("")}</div>`,
        )
        .join("")}</div>${hintsHtml()}`;
  } else if (st.view === "setup") {
    body = `<button class="closeX pa" data-cmd="close" title="Close (Esc)">✕</button>${setupPanel()}${coreHtml(isReady() ? "ONLINE" : "SETUP")}`;
  } else if (st.view === "confirm" && st.confirm) {
    const c = st.confirm;
    body = `${commandBar()}
      <div class="confirm pa">
        <span class="tag t-white">CONFIRM ACTION</span>
        <div class="big">Delete all spam</div>
        <div class="sumbig" style="font-size:20px;margin-top:8px">Move <b>${c.count}</b> spam email${c.count === 1 ? "" : "s"} to Trash in one go. You can undo.</div>
        <ul>${c.preview.map((p) => `<li><b>${esc(p.from || "Unknown")}</b> · ${esc(p.subject || "(no subject)")}</li>`).join("")}${
          c.count > c.preview.length ? `<li class="mono" style="font-size:11px;color:var(--dim)">+ ${c.count - c.preview.length} MORE</li>` : ""
        }</ul>
        <div class="say">Say <b>"confirm"</b> or <b>"cancel"</b></div>
        <div class="acts"><button class="btn alert" data-cmd="confirm">Delete ${c.count} spam</button><button class="btn ghost" data-cmd="cancel">Cancel</button></div>
      </div>${coreHtml("AWAITING CONFIRMATION")}${subtitleHtml()}`;
  }
  $ov.className = `overlay open ${st.view === "full" ? "full" : ""}`;
  patch($ov, frame + body);
  renderMic();
}

const isReady = () => Boolean(st.setup?.clientIdOk && st.setup.signedIn && st.setup.hasGeminiKey);

const CONSOLE = {
  project: "https://console.cloud.google.com/projectcreate",
  gmailApi: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
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
    ${sub("b", "Turn on the Gmail API", "Press <b>Enable</b>.", open(CONSOLE.gmailApi, "Open"))}
    ${sub("c", "Set up the consent screen", "<b>Get started</b> → App name <b>Vaani</b>, your email → Audience <b>External</b> → your email → agree → <b>Create</b>.", open(CONSOLE.consent, "Open"))}
    ${sub("d", "Add yourself as a test user", "<b>Test users</b> → <b>Add users</b> → your Gmail address → <b>Save</b>.", open(CONSOLE.audience, "Open"))}
    ${sub("e", "Create the Client ID", `Application type <b>Web application</b> → under <b>Authorized redirect URIs</b> press <b>Add URI</b> and paste:<br><code>${esc(s.redirectUri)}</code><br>→ <b>Create</b> → copy the <b>Client ID</b>.`, `${copy(s.redirectUri)}${open(CONSOLE.client, "Open")}`)}
  </ol>
  <form data-act="clientform" class="keyform"><input type="text" placeholder="Paste your Client ID (…apps.googleusercontent.com)" autocomplete="off" spellcheck="false" aria-label="Google Client ID"/><button class="btn solid" type="submit" ${st.setupBusy ? "disabled" : ""}>Save</button></form>
  <p class="tiny">The Client ID is not a secret. Never paste the <b>Client secret</b> anywhere.</p>`;
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
    : s.signedIn
      ? `<p>Signed in as <b>${esc(s.email)}</b></p>`
      : `<p>Vaani reads your Gmail directly from this browser. Nothing goes to any Vaani server. If Google says "app isn't verified", press <b>Continue</b> — it is your own app.</p><div class="acts"><button class="btn solid" data-act="signin" ${st.setupBusy ? "disabled" : ""}>Sign in with Google</button></div>`;
  const key = s.hasGeminiKey
    ? `<p>Key connected · •••• ${esc(s.keyLast4 ?? "")} <button class="lnk" data-act="replacekey">Replace</button></p>`
    : `<p>The AI runs on <b>your own free</b> Gemini key. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Get a key from Google AI Studio ↗</a> → "Create API key" → paste it here.</p>
       <form data-act="keyform" class="keyform"><input type="password" placeholder="Paste your Gemini API key (AIza…)" autocomplete="off" spellcheck="false" aria-label="Gemini API key" ${!s.signedIn ? "disabled" : ""}/><button class="btn solid" type="submit" ${!s.signedIn || st.setupBusy ? "disabled" : ""}>Save</button></form>`;
  const sy = s.sync;
  const progress = !s.signedIn
    ? "<p>Waiting for sign-in.</p>"
    : sy.total === 0
      ? `<p>${esc(sy.message || "Reading your inbox…")}</p>`
      : `<p>${sy.analyzed} of ${sy.total} emails analysed. ${esc(sy.message)}</p><div class="bar" style="margin-top:8px"><i style="width:${Math.round((sy.analyzed / Math.max(1, sy.total)) * 100)}%"></i></div>`;
  return `<div class="confirm setup pa">
    <span class="tag t-cy">${isReady() ? "ONLINE" : "SETUP"}</span>
    <div class="big">${isReady() ? "Vaani is ready" : "Connect Vaani"}</div>
    ${st.setupMsg ? `<p class="${st.setupErr ? "warn" : "ok"}">${esc(st.setupMsg)}</p>` : ""}
    ${step(1, s.clientIdOk && !editClient, "Your Google connection", client)}
    ${step(2, s.signedIn, "Sign in with Google", signIn)}
    ${step(3, s.hasGeminiKey, "Add your Gemini API key", key)}
    ${step(4, isReady() && sy.total > 0 && sy.analyzed === sy.total, "Inbox analysis", progress)}
    ${isReady() ? `<div class="acts"><button class="btn solid" data-cmd="give me today's summary">Give me today's summary</button></div><p class="hint2">Next time just say: <b>"${WAKE}, give me today's summary"</b></p>` : ""}
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
  const blocked = l.state === "blocked" || l.state === "unsupported";
  const live = l.enabled && l.state === "listening";
  const stateText = !isReady()
    ? "SETUP NEEDED"
    : l.state === "unsupported"
      ? "NO VOICE SUPPORT"
      : l.state === "blocked"
        ? "MIC BLOCKED"
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
      <div class="k mono">${AGENT} · CONTROL</div>
      ${
        isReady()
          ? `<p>${l.wakeWord ? `Say "${WAKE}, …" — for example "${WAKE}, give me today's summary".` : "Just speak a command."}</p>`
          : `<p>One-time setup: connect your own Google Client ID, sign in, and add your free Gemini key.</p>
             <div class="row"><button class="btn solid" data-act="setup">Open setup</button></div>`
      }
      ${l.error ? `<p style="color:#ff9a9a">${esc(l.error)}</p>` : ""}
      <label>Microphone on <input type="checkbox" data-act="mic" ${l.enabled ? "checked" : ""}></label>
      <label>Wake word "${WAKE}" <input type="checkbox" data-act="wake" ${l.wakeWord ? "checked" : ""}></label>
      <form data-act="form"><input type="text" placeholder="Type a command…" aria-label="Type a command" /><button class="btn" type="submit">Go</button></form>
      <div class="row"><button class="btn" data-cmd="give me today's summary">Briefing</button><button class="btn" data-cmd="open spam">Spam</button><button class="btn" data-cmd="open full window">Full</button></div>
    </div>`;
  } else if (hearing || l.awaiting) {
    pop = `<div class="caption"><small>${hearing ? "HEARING" : AGENT}</small>${hearing ? `"${esc(l.caption)}"` : "Go ahead, I'm listening…"}</div>`;
  }

  patch($mic, `${pop}<button class="micbox ${blocked || !isReady() ? "bad" : ""}" data-act="menu" aria-label="Vaani microphone: ${stateText}">
      <span class="r"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" fill="none" stroke="rgba(70,217,255,.35)" stroke-width="1.5"/><circle cx="26" cy="26" r="18" fill="rgba(20,90,170,.55)" stroke="#9becff"/></svg>
        <svg viewBox="0 0 52 52" class="spin"><circle cx="26" cy="26" r="24" fill="none" stroke="#46d9ff" stroke-width="2.5" stroke-dasharray="20 9"/></svg>
        <span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${l.enabled && !blocked ? "#fff" : "#ff9a9a"}" stroke-width="2" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/>${l.enabled && !blocked ? "" : '<path d="M3 3l18 18"/>'}</svg></span></span>
      <span class="t"><b>${AGENT}</b><small><i class="${live && isReady() ? "live" : blocked || !isReady() ? "bad" : ""}"></i>${stateText}</small></span>
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
    openSetup("Please sign in with Google first.", true);
  } else if (error === "NEEDS_GEMINI_KEY") {
    openSetup("Add your Gemini API key to use the AI.", true);
  } else {
    showToast("ERROR", error || "Something went wrong.", { err: true });
  }
  renderMic();
  return false;
}

const allItems = (b: Briefing | null) => (b?.sections ?? []).flatMap((s) => s.items);
const entities = () => [...new Set([...allItems(st.week), ...allItems(st.day)].map((i) => i.entity))];

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
  const cmd: Command = parseCommand(text, entities());

  // While a delete is waiting for confirmation, yes/no go to it.
  if (st.view === "confirm" && st.confirm && cmd.type === "confirm") return void doTrashSpam(text);
  if (cmd.type === "cancel") {
    if (st.view === "confirm") {
      st.confirm = null;
      showToast("CANCELLED", "Nothing was deleted.");
    }
    return closeOverlay();
  }

  if (cmd.type === "setup") return openSetup();
  // Not set up yet: every command leads to the setup panel.
  if (!isReady() && !["stop", "close", "cancel"].includes(cmd.type)) {
    await refreshStatus();
    if (!isReady()) return openSetup("Finish setup first, then try again.", true);
  }

  switch (cmd.type) {
    case "stop":
      return speaker.stop();
    case "close":
      return closeOverlay();
    case "confirm":
      return void say("There is nothing waiting for confirmation.");
    case "undo":
      return void doUndo();
    case "folder": {
      closeOverlay();
      goGmail(FOLDER_HASH[cmd.folder]);
      showToast("OPENED", `${FOLDER_LABEL[cmd.folder]} — in this tab`, { ms: 3000 });
      return void say(`Opening ${FOLDER_LABEL[cmd.folder]}.`);
    }
    case "search": {
      closeOverlay();
      goGmail(`#search/${encodeURIComponent(cmd.query)}`);
      showToast("SEARCH", cmd.query, { ms: 3000 });
      return void say(`Searching for ${cmd.query}.`);
    }
    case "openCurrent": {
      const it = st.focus ?? (st.current >= 0 ? st.items[st.current] : null);
      if (!it) return void say("Tell me which email to open, for example: open the TCS email.");
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
      st.hints = ["Only the important ones", "Show interview emails", "Delete all spam", "Close"];
      st.count = "OVERVIEW · TODAY";
      openView("full", text);
      return void say(`Here is everything from today. ${st.day.stats.shownEmails} important emails, ${st.day.stats.hiddenSpamPromo} promotions hidden.`);
    }
    case "focus":
      return void doFocus(text, cmd.entity);
    case "filter":
      return void doFilter(text, cmd.key);
    case "ask":
      return void doAsk(text, myRun);
  }
}

async function doBriefing(command: string, myRun: number) {
  if (!st.day) return;
  const all = allItems(st.day).filter((i) => themeKey(i) !== "security");
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
  const intro = items.length
    ? `You have ${s.shownEmails} important email${s.shownEmails === 1 ? "" : "s"} today.`
    : "Nothing important came in today.";
  st.subtitle = intro;
  render();
  if (!(await say(intro)) || myRun !== runId) return;

  for (let i = 0; i < items.length; i++) {
    if (myRun !== runId) return;
    const it = items[i];
    st.current = i;
    st.count = `BRIEFING · ${String(i + 1).padStart(2, "0")} / ${String(items.length).padStart(2, "0")}`;
    st.subtitle = `${ORD[i] ?? "Next"}: ${it.entity}. ${it.summary}${spokenDeadline(it.deadline)}`;
    render();
    if (!(await say(st.subtitle)) || myRun !== runId) return;
  }
  if (myRun !== runId) return;
  const outro = `That's all. I hid ${s.hiddenSpamPromo} promotional emails${s.scamCount ? ` and blocked ${s.scamCount} scam email${s.scamCount === 1 ? "" : "s"}` : ""}.`;
  st.current = items.length;
  st.view = "list";
  st.current = -1;
  st.subtitle = outro;
  render();
  await say(outro);
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
    ? `You have ${items.length} ${FILTER_LABEL[key]} email${items.length === 1 ? "" : "s"} this week: ${joinNames(names.slice(0, 5))}.${items.length > 1 ? " Which one should I open?" : ""}`
    : `No ${FILTER_LABEL[key]} emails this week.`;
  openView("list", command);
  await say(st.subtitle);
}

async function doFocus(command: string, entity: string) {
  const pool = [...allItems(st.week), ...allItems(st.day)].filter((i) => i.entity === entity);
  // prefer the newest, most important one
  const it = pool.sort((a, b) => (a.priority === b.priority ? b.date.localeCompare(a.date) : a.priority === "high" ? -1 : 1))[0];
  if (!it) return void say(`I could not find an email from ${entity}.`);
  st.focus = it;
  st.items = [it];
  st.count = "OPEN · 1 MESSAGE";
  st.hints = ["Open it in Gmail", "Back to summary", "Close"];
  st.subtitle = `${it.entity}: ${it.summary}${it.actionText ? ` Your action: ${it.actionText}.` : ""}${spokenDeadline(it.deadline)}`;
  openView("focus", command);
  await say(st.subtitle);
}

async function doAsk(command: string, myRun: number) {
  st.subtitle = "";
  st.count = "THINKING";
  openView("thinking", command);
  const res = await api<{ answer: string; refs: BriefingItem[] }>("/ask", "POST", { question: command, lang: "en" });
  if (myRun !== runId) return;
  if (!res.ok) {
    closeOverlay();
    return void handleApiError(res.error, res.status);
  }
  st.items = res.data.refs ?? [];
  st.current = -1;
  st.focus = null;
  st.listTitle = "RELATED EMAILS";
  st.modeLabel = "ANSWER";
  st.count = `${st.items.length} RELATED`;
  st.subtitle = res.data.answer;
  st.hints = ["Give me today's summary", "Close"];
  openView("list", command);
  await say(res.data.answer);
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
    return void say("Your spam folder is already empty.");
  }
  st.confirm = res.data;
  st.count = `SPAM · ${res.data.count} EMAILS`;
  st.subtitle = `You have ${res.data.count} spam email${res.data.count === 1 ? "" : "s"}. Say confirm to move all of them to Trash, or cancel.`;
  openView("confirm", command);
  await say(st.subtitle);
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
  await say(`Done. ${res.data.trashed} spam emails moved to Trash. Say undo to restore them.`);
}

async function doUndo() {
  const res = await api<{ restored: number }>("/gmail/undo", "POST");
  if (!res.ok) {
    showToast("UNDO", res.error || "Nothing to undo.", { err: true });
    return void say(res.error || "Nothing to undo.");
  }
  goGmail(location.hash || "#inbox");
  showToast("RESTORED", `${res.data.restored} emails restored.`);
  await say(`Restored ${res.data.restored} emails.`);
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
  const el = (e.target as HTMLElement).closest("[data-cmd],[data-act],[data-focus],[data-speak]") as HTMLElement | null;
  if (!el) return;
  const cmd = el.dataset.cmd;
  if (cmd === "back") {
    if (st.view === "focus" && st.items.length) return void run("give me today's summary");
    return closeOverlay();
  }
  if (cmd) return void run(cmd);
  if (el.dataset.focus) {
    const it = [...allItems(st.week), ...allItems(st.day), ...st.items].find((i) => i.gmailId === el.dataset.focus);
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
  const act = el.dataset.act;
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
  } else if (el.dataset.act === "wake") {
    listener.wakeWord = el.checked;
    void chrome.storage.local.set({ wakeWord: el.checked });
    renderMic();
  }
});

root.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target as HTMLElement;
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
        if (r.ok && isReady()) void say(`Vaani is ready. Say: ${WAKE}, give me today's summary.`);
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
  const status = await refreshStatus();
  listener.setEnabled(s.micOn);
  if (!status || !isReady()) {
    openSetup(); // first run: show the 2-step setup right inside Gmail
    return;
  }
  // Warm the cache so the first command is instant.
  void loadBriefings().catch(() => undefined);
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
      document.documentElement.dataset.vaaniDump = JSON.stringify({ value: i?.value ?? null, focused: root.activeElement === i, scroll: box?.scrollTop ?? null, renders: renderCount });
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
