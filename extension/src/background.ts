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

chrome.runtime.onMessage.addListener((msg: ApiRequest, _sender, send) => {
  if (msg?.type === "api") {
    void handle(msg.path, msg.method ?? "GET", msg.body).then(send);
    return true; // async response
  }
  return false;
});

ensureAlarm();
