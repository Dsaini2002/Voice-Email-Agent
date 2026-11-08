/** Gmail REST API (direct from the extension) + browser-safe email parsing. */
import { authFetch } from "./auth";
import { GMAIL_API } from "./env";

export class GmailError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authFetch(`${GMAIL_API}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GmailError(res.status, body.error?.message ?? `Gmail error ${res.status}`);
  }
  return (await res.json().catch(() => ({}))) as T;
}

export interface GmailHeader { name?: string; value?: string }
export interface GmailPart { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string }; parts?: GmailPart[]; headers?: GmailHeader[] }
export interface GmailMessage { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GmailPart }

export const gmail = {
  profile: () => call<{ emailAddress: string; historyId: string }>("/profile"),
  list: (params: Record<string, string | number | boolean | string[]>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
      else q.set(k, String(v));
    }
    return call<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${q}`);
  },
  get: (id: string, format: "full" | "metadata" = "full", headers: string[] = []) =>
    call<GmailMessage>(`/messages/${id}?format=${format}${headers.map((h) => `&metadataHeaders=${h}`).join("")}`),
  history: (startHistoryId: string, pageToken?: string) =>
    call<{ history?: { messagesAdded?: { message?: { id?: string } }[] }[]; historyId?: string; nextPageToken?: string }>(
      `/history?startHistoryId=${startHistoryId}&historyTypes=messageAdded&labelId=INBOX${pageToken ? `&pageToken=${pageToken}` : ""}`,
    ),
  trash: (id: string) => call(`/messages/${id}/trash`, { method: "POST" }),
  untrash: (id: string) => call(`/messages/${id}/untrash`, { method: "POST" }),
};

// ---------------- parsing (no Node APIs: works in the service worker) ----------------
const MAX_BODY = 4000;

export function b64urlDecode(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", ndash: "–", mdash: "—", rupee: "₹" };
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n")
    .replace(/<\/?(b|i|u|em|strong|span|a|font|small|sup|sub|mark)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function cleanText(t: string): string {
  return t.replace(/\r/g, "").replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_BODY);
}

export function extractBody(payload?: GmailPart): string {
  if (!payload) return "";
  let plain = "";
  let html = "";
  const walk = (p: GmailPart) => {
    if (p.filename) return; // attachments: later phase
    const data = p.body?.data;
    if (data) {
      if (p.mimeType === "text/plain" && !plain) plain = b64urlDecode(data);
      else if (p.mimeType === "text/html" && !html) html = b64urlDecode(data);
    }
    p.parts?.forEach(walk);
  };
  walk(payload);
  return cleanText(plain.trim() ? plain : htmlToText(html));
}

export function header(m: GmailMessage, name: string): string {
  return m.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function parseFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  return { name: from.trim(), email: from.trim().toLowerCase() };
}
