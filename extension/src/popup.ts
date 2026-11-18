import { api, getSettings, usefulVoices, voiceLabel, VOICE_SAMPLE, type Settings } from "./shared";
import { cleanName, nameProblem } from "./gmail/wake";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = (tag: string, cls: string, text: string) => Object.assign(document.createElement(tag), { className: cls, textContent: text });

interface Status {
  clientIdOk: boolean;
  signedIn: boolean;
  email: string;
  hasGeminiKey: boolean;
  keyLast4: string | null;
  sync: { state: string; message: string; total: number; analyzed: number };
}

async function render() {
  const s = await getSettings();
  $<HTMLInputElement>("micOn").checked = s.micOn;
  $<HTMLInputElement>("wakeWord").checked = s.wakeWord;
  $<HTMLInputElement>("subtitles").checked = s.subtitles !== false;
  $<HTMLSelectElement>("recLang").value = s.recLang;
  $<HTMLInputElement>("voiceRate").value = String(s.voiceRate);
  $<HTMLInputElement>("assistantName").value = s.assistantName;
  $("title").textContent = s.assistantName || "Vaani";
  $<HTMLInputElement>("voicePitch").value = String(s.voicePitch);
  fillVoices(s.voiceName);

  const res = await api<Status>("/ext/status");
  const status = $("status");
  const keybox = $("keybox");
  status.replaceChildren();
  keybox.replaceChildren();
  if (!res.ok) {
    status.append(el("div", "warn", res.error ?? "Error"));
    return;
  }
  const d = res.data;
  if (!d.clientIdOk) {
    status.append(el("div", "warn", "Step 1: connect your own Google Client ID."));
    status.append(el("div", "muted", "Open Gmail — the setup wizard guides you (about 5 minutes, one time). Or paste it here:"));
    const input = Object.assign(document.createElement("input"), { type: "text", placeholder: "…apps.googleusercontent.com" });
    const btn = el("button", "", "Save Client ID");
    const msg = el("div", "muted", "");
    btn.addEventListener("click", async () => {
      const r = await api("/settings/client", "PUT", { clientId: input.value.trim() });
      msg.textContent = r.ok ? "Saved." : r.error ?? "Failed";
      msg.className = r.ok ? "muted" : "warn";
      if (r.ok) setTimeout(render, 500);
    });
    status.append(input, btn, msg);
  } else if (d.signedIn) {
    status.innerHTML = '<span class="dot ok"></span>Signed in';
    status.append(el("div", "muted", d.email));
    status.append(el("div", "muted", d.sync.total ? `${d.sync.analyzed}/${d.sync.total} emails analysed ${d.sync.message ? "· " + d.sync.message : ""}` : d.sync.message || "Reading inbox…"));
  } else {
    status.innerHTML = '<span class="dot bad"></span>Not signed in';
  }
  $("signin").style.display = d.signedIn || !d.clientIdOk ? "none" : "block";
  $("signout").style.display = d.signedIn ? "block" : "none";

  if (d.hasGeminiKey) {
    keybox.append(el("div", "", `Connected · •••• ${d.keyLast4}`));
    const rm = el("button", "ghost", "Remove key");
    rm.addEventListener("click", async () => {
      await api("/settings/gemini", "DELETE");
      void render();
    });
    keybox.append(rm);
  } else {
    const p = el("div", "muted", "");
    p.innerHTML = 'Free key: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>';
    const input = Object.assign(document.createElement("input"), { type: "password", placeholder: "Paste Gemini API key" });
    const save = el("button", "", "Save key");
    const msg = el("div", "muted", "");
    save.addEventListener("click", async () => {
      msg.textContent = "Checking…";
      const r = await api<{ message: string }>("/settings/gemini", "PUT", { apiKey: input.value.trim() });
      msg.textContent = r.ok ? r.data.message : r.error ?? "Failed";
      msg.className = r.ok ? "muted" : "warn";
      if (r.ok) setTimeout(render, 800);
    });
    keybox.append(p, input, save, msg);
  }
}

async function save(patch: Partial<Settings>) {
  await chrome.storage.local.set(patch);
}

function fillVoices(selected: string) {
  const sel = $<HTMLSelectElement>("voiceName");
  const voices = usefulVoices(speechSynthesis.getVoices());
  sel.replaceChildren(new Option("Automatic (best available)", ""), ...voices.map((v) => new Option(voiceLabel(v), v.name)));
  sel.value = voices.some((v) => v.name === selected) ? selected : "";
}
speechSynthesis.addEventListener("voiceschanged", () => void getSettings().then((s) => fillVoices(s.voiceName)));

function testVoice() {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(VOICE_SAMPLE);
  const name = $<HTMLSelectElement>("voiceName").value;
  const v = speechSynthesis.getVoices().find((x) => x.name === name);
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  }
  u.rate = Number($<HTMLInputElement>("voiceRate").value);
  u.pitch = Number($<HTMLInputElement>("voicePitch").value);
  speechSynthesis.speak(u);
}
$<HTMLSelectElement>("voiceName").addEventListener("change", (e) => {
  void save({ voiceName: (e.target as HTMLSelectElement).value });
  testVoice();
});
$<HTMLInputElement>("voiceRate").addEventListener("change", (e) => {
  void save({ voiceRate: Number((e.target as HTMLInputElement).value) });
  testVoice();
});
$<HTMLInputElement>("voicePitch").addEventListener("change", (e) => {
  void save({ voicePitch: Number((e.target as HTMLInputElement).value) });
  testVoice();
});
$("testVoice").addEventListener("click", testVoice);

async function renderHistory() {
  const r = await api<{ emails: number; since: string | null; bytes: number }>("/history/info", "POST", {});
  $("hist").textContent = r.ok
    ? `${r.data.emails} emails saved on this computer${r.data.since ? ` since ${new Date(r.data.since).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""} · ${(r.data.bytes / 1024 / 1024).toFixed(1)} MB. Ask "how many interviews this month?" or "show my job tracker".`
    : "Sign in to start your history.";
}
$("clearHist").addEventListener("click", async () => {
  if (!confirm("Delete the saved email history from this computer? (Your Gmail is not touched.)")) return;
  await api("/history/clear", "POST", {});
  void renderHistory();
});
void renderHistory();
$("saveName").addEventListener("click", async () => {
  const raw = $<HTMLInputElement>("assistantName").value.trim();
  const name = cleanName(raw);
  const problem = nameProblem(name);
  const msg = $("saveName");
  if (problem) {
    alert(problem);
    return;
  }
  await save({ assistantName: name });
  $<HTMLInputElement>("assistantName").value = name;
  $("title").textContent = name;
  msg.textContent = "Saved ✓";
  setTimeout(() => (msg.textContent = "Save"), 1500);
});

$<HTMLInputElement>("micOn").addEventListener("change", (e) => save({ micOn: (e.target as HTMLInputElement).checked }));
$<HTMLInputElement>("wakeWord").addEventListener("change", (e) => save({ wakeWord: (e.target as HTMLInputElement).checked }));
$<HTMLInputElement>("subtitles").addEventListener("change", (e) => save({ subtitles: (e.target as HTMLInputElement).checked }));
$<HTMLSelectElement>("recLang").addEventListener("change", (e) => save({ recLang: (e.target as HTMLSelectElement).value as Settings["recLang"] }));
$("gmail").addEventListener("click", () => void chrome.tabs.create({ url: "https://mail.google.com/mail/u/0/#inbox" }));
$("signin").addEventListener("click", async () => {
  $("status").textContent = "Opening Google sign-in…";
  const r = await api("/auth/signin", "POST");
  if (!r.ok) $("status").textContent = r.error ?? "Sign-in failed";
  void render();
});
$("signout").addEventListener("click", async () => {
  if (!confirm("Sign out and delete everything Vaani stored in this browser?")) return;
  await api("/auth/signout", "POST");
  void render();
});

void render();
