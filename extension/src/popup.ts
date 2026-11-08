import { api, getSettings, type Settings } from "./shared";

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
  $<HTMLSelectElement>("recLang").value = s.recLang;

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
    status.append(el("div", "warn", "No Google Client ID in this copy. The owner must add it (README → Owner setup)."));
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

$<HTMLInputElement>("micOn").addEventListener("change", (e) => save({ micOn: (e.target as HTMLInputElement).checked }));
$<HTMLInputElement>("wakeWord").addEventListener("change", (e) => save({ wakeWord: (e.target as HTMLInputElement).checked }));
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
