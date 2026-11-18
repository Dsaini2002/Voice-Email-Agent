/** Google Calendar + Google Tasks (used as "notes"), with the user's own token. */
import { authFetch } from "./auth";
import { CALENDAR_API, TASKS_API } from "./env";

export class GoogleApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const PROJECT_LINKS = {
  calendar: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com",
  tasks: "https://console.cloud.google.com/apis/library/tasks.googleapis.com",
};

async function call<T>(service: "calendar" | "tasks", url: string, init: RequestInit = {}): Promise<T> {
  const res = await authFetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (res.status === 204) return {} as T;
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string; details?: { reason?: string }[] } };
  if (!res.ok) {
    const msg = body.error?.message ?? "";
    const name = service === "calendar" ? "Google Calendar" : "Google Tasks";
    if (res.status === 403 && /insufficient|scope/i.test(msg + JSON.stringify(body.error?.details ?? "")))
      throw new GoogleApiError(403, `I need permission for ${name}. Open setup and press "Sign in with Google" once more.`);
    if (res.status === 403 && /has not been used|disabled|SERVICE_DISABLED/i.test(msg + JSON.stringify(body)))
      throw new GoogleApiError(403, `${name} is switched off in your Google Cloud project. Turn it on here, then try again: ${PROJECT_LINKS[service]}`);
    throw new GoogleApiError(res.status, `${name} error: ${msg || res.status}`);
  }
  return body as T;
}

// ---------------- Calendar ----------------
export interface CalEvent { id: string; title: string; start: string; end: string; allDay: boolean; link: string }
interface GEvent { id: string; summary?: string; htmlLink?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }

const toEvent = (e: GEvent): CalEvent => ({
  id: e.id, title: e.summary || "(no title)", link: e.htmlLink ?? "",
  start: e.start?.dateTime ?? e.start?.date ?? "", end: e.end?.dateTime ?? e.end?.date ?? "", allDay: !e.start?.dateTime,
});

export async function listEvents(from: Date, to: Date): Promise<CalEvent[]> {
  const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "20" });
  const r = await call<{ items?: GEvent[] }>("calendar", `${CALENDAR_API}/calendars/primary/events?${q}`);
  return (r.items ?? []).map(toEvent);
}

/** date: YYYY-MM-DD, time: HH:MM (local) or "" for an all-day event. */
export async function addEvent(o: { title: string; date: string; time: string; durationMin: number; details?: string }): Promise<CalEvent> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new GoogleApiError(400, "Which day should I put it on?");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let start: Record<string, string>, end: Record<string, string>;
  if (/^\d{1,2}:\d{2}$/.test(o.time)) {
    const [h, m] = o.time.split(":").map(Number);
    const s = new Date(`${o.date}T00:00:00`);
    s.setHours(h, m, 0, 0);
    const e = new Date(s.getTime() + Math.min(Math.max(o.durationMin || 60, 5), 24 * 60) * 60_000);
    const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
    start = { dateTime: local(s), timeZone: tz };
    end = { dateTime: local(e), timeZone: tz };
  } else {
    const next = new Date(`${o.date}T00:00:00`);
    next.setDate(next.getDate() + 1);
    start = { date: o.date };
    end = { date: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}` };
  }
  const body = { summary: o.title.slice(0, 200), description: (o.details ?? "").slice(0, 2000), start, end };
  return toEvent(await call<GEvent>("calendar", `${CALENDAR_API}/calendars/primary/events`, { method: "POST", body: JSON.stringify(body) }));
}

export async function deleteEvent(id: string): Promise<void> {
  await call("calendar", `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---------------- Tasks (notes) ----------------
export interface Note { id: string; title: string; notes: string; due: string; done: boolean }
interface GTask { id: string; title?: string; notes?: string; due?: string; status?: string }
const toNote = (t: GTask): Note => ({ id: t.id, title: t.title ?? "", notes: t.notes ?? "", due: (t.due ?? "").slice(0, 10), done: t.status === "completed" });

export async function addNote(o: { title: string; notes?: string; due?: string }): Promise<Note> {
  const body: Record<string, string> = { title: o.title.slice(0, 1000), notes: (o.notes ?? "").slice(0, 4000) };
  if (o.due && /^\d{4}-\d{2}-\d{2}$/.test(o.due)) body.due = `${o.due}T00:00:00.000Z`;
  return toNote(await call<GTask>("tasks", `${TASKS_API}/lists/@default/tasks`, { method: "POST", body: JSON.stringify(body) }));
}

export async function listNotes(): Promise<Note[]> {
  const r = await call<{ items?: GTask[] }>("tasks", `${TASKS_API}/lists/@default/tasks?showCompleted=false&maxResults=20`);
  return (r.items ?? []).map(toNote).filter((n) => n.title);
}

export async function deleteNote(id: string): Promise<void> {
  await call("tasks", `${TASKS_API}/lists/@default/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}
