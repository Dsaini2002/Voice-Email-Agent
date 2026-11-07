import { api, getSettings, type Settings } from "./shared";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function render() {
  const s = await getSettings();
  $<HTMLInputElement>("micOn").checked = s.micOn;
  $<HTMLInputElement>("wakeWord").checked = s.wakeWord;
  $<HTMLSelectElement>("recLang").value = s.recLang;
  $<HTMLInputElement>("server").value = s.server;

  const status = $("status");
  const res = await api<{ email: string; hasGeminiKey: boolean; canModify: boolean }>("/ext/status");
  if (res.ok) {
    const d = res.data;
    status.innerHTML = "";
    const line = document.createElement("div");
    line.innerHTML = '<span class="dot ok"></span>Connected';
    const who = document.createElement("div");
    who.className = "muted";
    who.textContent = d.email;
    status.append(line, who);
    if (!d.hasGeminiKey) status.append(Object.assign(document.createElement("div"), { className: "muted", textContent: "⚠ Add your Gemini key in the dashboard." }));
    if (!d.canModify) status.append(Object.assign(document.createElement("div"), { className: "muted", textContent: "⚠ Sign in again to allow spam cleanup." }));
    $("dashboard").textContent = "Open dashboard";
  } else {
    status.innerHTML = '<span class="dot bad"></span>Not connected';
    status.append(Object.assign(document.createElement("div"), {
      className: "muted",
      textContent: res.error === "NOT_CONNECTED" ? "Open the dashboard and sign in once. It connects automatically." : res.error ?? "",
    }));
  }
}

async function save(patch: Partial<Settings>) {
  await chrome.storage.local.set(patch);
}

$<HTMLInputElement>("micOn").addEventListener("change", (e) => save({ micOn: (e.target as HTMLInputElement).checked }));
$<HTMLInputElement>("wakeWord").addEventListener("change", (e) => save({ wakeWord: (e.target as HTMLInputElement).checked }));
$<HTMLSelectElement>("recLang").addEventListener("change", (e) => save({ recLang: (e.target as HTMLSelectElement).value as Settings["recLang"] }));
$<HTMLInputElement>("server").addEventListener("change", (e) => {
  const v = (e.target as HTMLInputElement).value.trim().replace(/\/+$/, "");
  if (/^https?:\/\/[\w.-]+(:\d+)?$/.test(v)) void save({ server: v }).then(render);
});
$("dashboard").addEventListener("click", async () => {
  const { server } = await getSettings();
  void chrome.tabs.create({ url: server });
});
$("disconnect").addEventListener("click", async () => {
  await api("/ext/connect", "DELETE");
  await chrome.storage.local.remove("token");
  void render();
});

void render();
