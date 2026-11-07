/**
 * Runs only on the Vaani dashboard (localhost). Receives the extension token
 * from the logged-in dashboard and stores it. Messages are accepted only from
 * this same window and origin.
 */
const ORIGIN = location.origin;

async function hello() {
  const { token } = (await chrome.storage.local.get("token")) as { token?: string };
  window.postMessage({ source: "vaani-ext", type: "hello", connected: Boolean(token) }, ORIGIN);
}

window.addEventListener("message", async (e: MessageEvent) => {
  if (e.source !== window || e.origin !== ORIGIN) return;
  const m = e.data as { source?: string; type?: string; token?: string };
  if (m?.source !== "vaani-web") return;

  if (m.type === "ping") return void hello();
  if (m.type === "token" && typeof m.token === "string" && /^[A-Za-z0-9_-]{30,200}$/.test(m.token)) {
    await chrome.storage.local.set({ token: m.token, server: ORIGIN });
    window.postMessage({ source: "vaani-ext", type: "connected" }, ORIGIN);
  }
  if (m.type === "disconnect") {
    await chrome.storage.local.remove("token");
    void hello();
  }
});

void hello();
