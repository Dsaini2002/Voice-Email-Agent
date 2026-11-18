/**
 * Background service worker. Vaani is fully self-contained: Google sign-in,
 * Gmail API, Gemini (with the user's own key) and storage all run here.
 * There is no Vaani server.
 */
import { handle } from "./bg/router";
import { runSync } from "./bg/sync";
import type { ApiRequest } from "./shared";

const ALARM = "vaani-sync";

function ensureAlarm() {
  void chrome.alarms.get(ALARM).then((a) => {
    if (!a) void chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  void runSync();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void runSync();
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void runSync();
});

// ---- Which Gmail tab listens while you're in another tab (only the one you used last) ----
const LAST_TAB = "lastGmailTab";
async function lastGmailTab(): Promise<number | null> {
  const r = await chrome.storage.session.get(LAST_TAB);
  return (r[LAST_TAB] as number | undefined) ?? null;
}

async function bringForward(tabId: number, windowId?: number) {
  await chrome.tabs.update(tabId, { active: true });
  if (windowId !== undefined) await chrome.windows.update(windowId, { focused: true });
}

chrome.runtime.onMessage.addListener((msg: ApiRequest | { type: "tab"; action: "visible" | "primary" | "front" }, sender, send) => {
  if (msg?.type === "api") {
    void handle(msg.path, msg.method ?? "GET", msg.body).then(send);
    return true; // async response
  }
  if (msg?.type === "tab" && sender.tab?.id !== undefined) {
    const id = sender.tab.id;
    if (msg.action === "visible") void chrome.storage.session.set({ [LAST_TAB]: id }).then(() => send({ ok: true }));
    else if (msg.action === "primary") void lastGmailTab().then((t) => send({ primary: t === null || t === id }));
    else if (msg.action === "front") void bringForward(id, sender.tab.windowId).then(() => send({ ok: true }), () => send({ ok: false }));
    return true;
  }
  return false;
});

// Ctrl+Shift+Space from any tab: jump to Gmail and open the assistant.
chrome.commands?.onCommand.addListener((command) => {
  if (command !== "open-assistant") return;
  void (async () => {
    const tabs = await chrome.tabs.query({ url: "https://mail.google.com/*" });
    const last = await lastGmailTab();
    const tab = tabs.find((t) => t.id === last) ?? tabs[0];
    if (tab?.id !== undefined) {
      await bringForward(tab.id, tab.windowId);
      await chrome.tabs.sendMessage(tab.id, { type: "open-assistant" }).catch(() => undefined);
    } else {
      await chrome.tabs.create({ url: "https://mail.google.com/mail/u/0/#inbox" });
    }
  })();
});

// Clicking an alert notification opens Gmail with that email.
chrome.notifications?.onClicked.addListener((nid) => {
  void (async () => {
    const id = nid.replace(/^vaani-/, "");
    const tabs = await chrome.tabs.query({ url: "https://mail.google.com/*" });
    const last = await lastGmailTab();
    const tab = tabs.find((t) => t.id === last) ?? tabs[0];
    if (tab?.id !== undefined) {
      await bringForward(tab.id, tab.windowId);
      await chrome.tabs.sendMessage(tab.id, { type: "open-mail", gmailId: id }).catch(() => undefined);
    } else await chrome.tabs.create({ url: "https://mail.google.com/mail/u/0/#inbox" });
    chrome.notifications.clear(nid);
  })();
});

ensureAlarm();
