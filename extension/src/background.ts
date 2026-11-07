/**
 * Background service worker: the ONLY place that talks to the VaaniMail server.
 * The access token lives in chrome.storage.local (never in the Gmail page).
 */
import { getSettings, type ApiRequest, type ApiResponse } from "./shared";

async function callApi(req: ApiRequest): Promise<ApiResponse> {
  const { token } = (await chrome.storage.local.get("token")) as { token?: string };
  const { server } = await getSettings();
  if (!token) return { ok: false, status: 401, data: null, error: "NOT_CONNECTED" };
  if (!/^\/[\w\-/?=&.%]*$/.test(req.path)) return { ok: false, status: 400, data: null, error: "Bad path" };

  try {
    const res = await fetch(`${server}/api${req.path}`, {
      method: req.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, ...(req.body ? { "Content-Type": "application/json" } : {}) },
      body: req.body ? JSON.stringify(req.body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401) await chrome.storage.local.remove("token");
    return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : (data as { error?: string } | null)?.error };
  } catch {
    return { ok: false, status: 0, data: null, error: `Cannot reach the Vaani server at ${server}. Is it running?` };
  }
}

chrome.runtime.onMessage.addListener((msg: ApiRequest, _sender, send) => {
  if (msg?.type === "api") {
    void callApi(msg).then(send);
    return true; // async response
  }
  return false;
});
