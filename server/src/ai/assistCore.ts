/**
 * "Understand anything": one Gemini call decides whether the user is chatting,
 * asking about their emails, or wants a Gmail action — and the result is checked
 * against a fixed list of safe actions before anything happens.
 * Pure logic, shared with the Chrome extension.
 */
import type { AnalyzedEmail } from "../intel/briefingBuilder.js";

export const ACTIONS = [
  "summary", "filter", "focus", "folder", "search", "reply", "trashSpam", "full", "voice",
  "compose", "gmailAct", "readAll", "calendarAdd", "calendarList", "noteAdd", "notesList",
  "count", "tracker", "history", "stats", "intentList", "pending", "weekly", "funnel", "none",
] as const;
const INTENT_LIST = ["help_request", "question", "meeting", "task", "deadline", "payment", "order", "travel", "education", "security", "personal", "update"];
export const PERIODS = ["today", "week", "month", "last_month", "year", "all"] as const;
export const GMAIL_ACTS = ["archive", "read", "unread", "star", "unstar", "important", "trash"] as const;
export const FILTERS = ["interview", "shortlisted", "offer", "rejected", "assessment", "action", "personal", "finance", "security", "application_received"] as const;
export const FOLDERS = ["inbox", "spam", "sent", "drafts", "trash", "starred", "snoozed", "scheduled", "all", "promotions", "social", "updates"] as const;

export type AssistAction = (typeof ACTIONS)[number];

export interface AssistResult {
  kind: "chat" | "answer" | "command";
  reply: string;
  action: AssistAction;
  filter: string;
  folder: string;
  entity: string;
  query: string;
  intent: string;
  refIds: string[];
  /** compose */
  to: string;
  topic: string;
  /** gmailAct */
  act: string;
  /** calendarAdd / calendarList / noteAdd */
  title: string;
  date: string;
  time: string;
  durationMin: number;
  /** count / stats */
  period: string;
  /** intentList: help_request, question, meeting, task, deadline, payment, order, travel, education, security, personal, update */
  purpose: string;
}

export const ASSIST_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["chat", "answer", "command"] },
    reply: { type: "string" },
    action: { type: "string", enum: [...ACTIONS] },
    filter: { type: "string" },
    folder: { type: "string" },
    entity: { type: "string" },
    query: { type: "string" },
    intent: { type: "string" },
    refIds: { type: "array", items: { type: "string" } },
    to: { type: "string" },
    topic: { type: "string" },
    act: { type: "string" },
    title: { type: "string" },
    date: { type: "string" },
    time: { type: "string" },
    durationMin: { type: "number" },
    period: { type: "string" },
    purpose: { type: "string" },
  },
  required: ["kind", "reply", "action"],
};

export function buildAssistRequest(firstName: string, said: string, list: AnalyzedEmail[], todayLabel: string, assistantName = "Vaani", onScreen?: { subject: string; entity: string; summary: string; date: string; deadline: string }) {
  // Promotions / social / spam never matter for answers: leave them out (saves free AI quota).
  const useful = list.filter((e) => !["promotion", "social", "newsletter", "spam"].includes(e.analysis.category));
  const entities = [...new Set(useful.map((e) => e.analysis.entity).filter(Boolean))].slice(0, 80);
  const context = useful.slice(0, 80).map((e) => ({
    id: e.gmailId,
    date: e.date.toISOString().slice(0, 10),
    entity: e.analysis.entity,
    subject: e.subject.slice(0, 100),
    category: e.analysis.category,
    status: e.analysis.status,
    verified: e.analysis.verified,
    deadline: e.analysis.deadline || undefined,
    action: e.analysis.actionText || undefined,
    summary: e.analysis.summary,
  }));

  const system = `You are ${assistantName}, a warm, friendly voice assistant that lives inside ${firstName || "the user"}'s Gmail. The user just spoke to you (English, Hindi or Hinglish; speech recognition may have small mistakes — guess what they meant).
Decide what they want and return JSON:
- kind "command": they want something done in Gmail. Pick action:
  summary = today's briefing · filter = list emails of one type (filter: ${FILTERS.join(", ")}) · focus = open one sender's email (entity: EXACTLY one of the known senders) · folder = open a Gmail folder (folder: ${FOLDERS.join(", ")}) · search = find emails with a Gmail search — use this for dates, senders, unread, attachments, keywords (query in Gmail search syntax, e.g. "after:2026/10/25 before:2026/10/26", "from:naukri is:unread", "has:attachment offer letter"; resolve relative dates from Today) · reply = reply to an email (entity: known sender, or "" for the email on screen; intent: what to say, or "") · trashSpam = delete all spam (it will still ask the user to confirm) · full = full overview window · voice = change your voice · compose = write a NEW email (to: the person's name or email exactly as said; topic: what it should say, or "") · gmailAct = do something to the email on screen (act: ${GMAIL_ACTS.join(", ")}) · readAll = mark all inbox emails as read · calendarAdd = add an event to Google Calendar (title, date YYYY-MM-DD, time HH:MM 24h or "" for all-day, durationMin; resolve "kal"/"tomorrow"/"Friday" from Today; if they say "add this to my calendar", use the email on screen) · calendarList = what's on the calendar (date YYYY-MM-DD, default today) · noteAdd = save a note / to-do / reminder in Google Tasks (title; date YYYY-MM-DD if a day was given) · notesList = show saved notes · count = HOW MANY of something from the email history (filter = status like interview/offer/rejected/shortlisted/assessment/application_received, or "" for all emails; entity = sender if asked; period: ${PERIODS.join(", ")}) · tracker = job application tracker / where an application stands (entity = company or "" for all) · history = search the saved email history (query = keywords) · stats = inbox statistics / report (period). Prefer count/tracker/stats over "answer" for numbers, they read the full history. · intentList = list emails by purpose, e.g. "did anyone ask for my help", "any questions for me", "show my bills" (purpose: help_request, question, meeting, task, deadline, payment, order, travel, education, security, personal, update; period) · pending = who is still waiting for my reply · weekly = last week's report · funnel = how far my job applications get.
  reply: a short friendly line saying what you're doing ("Sure, opening your sent emails.").
- kind "answer": a question about their emails. Answer ONLY from the email list below (never invent emails); refIds = ids you used (max 6). If status verified=false, say it needs checking.
- kind "chat": small talk or anything else. Reply briefly and warmly like a kind friend (max 30 words). If they ask something you can't do, say so kindly and suggest what you can do with their email.
Reply in the same language style the user used (Hinglish in Roman script if they used Hinglish). Plain sentences for text-to-speech: no markdown, emojis, links or email addresses. Max 60 words.
Never be bossy: suggest, don't order. Never claim you did something — the app does the action after you.`;

  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const prompt = `Today: ${todayLabel} (${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}), time now ${pad(now.getHours())}:${pad(now.getMinutes())}
${onScreen ? `Email on screen: ${JSON.stringify(onScreen)}
` : ""}
Known senders: ${JSON.stringify(entities)}
Emails (last 7 days): ${JSON.stringify(context)}

The user said: "${said.replace(/"/g, "'").slice(0, 400)}"`;
  return { system, prompt, temperature: 0.3, jsonSchema: ASSIST_SCHEMA };
}

/** Validates the model output: unknown actions/folders/senders are dropped, never executed. */
export function toAssistResult(raw: Partial<Record<keyof AssistResult, unknown>>, list: AnalyzedEmail[]): AssistResult {
  const str = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);
  const entities = new Map(list.map((e) => [e.analysis.entity.toLowerCase(), e.analysis.entity]));
  const ids = new Set(list.map((e) => e.gmailId));
  let kind = (["chat", "answer", "command"] as const).find((k) => k === raw.kind) ?? "chat";
  let action = (ACTIONS as readonly string[]).includes(String(raw.action)) ? (raw.action as AssistAction) : "none";
  const filter = (FILTERS as readonly string[]).includes(String(raw.filter)) ? String(raw.filter) : "";
  const folder = (FOLDERS as readonly string[]).includes(String(raw.folder)) ? String(raw.folder) : "";
  // tracker / count may name an older company that isn't in this week's list
  const rawEntity = str(raw.entity, 60).replace(/[^\p{L}\p{N} .&-]/gu, "").trim();
  const entity = entities.get(rawEntity.toLowerCase()) ?? (["tracker", "count"].includes(String(raw.action)) ? rawEntity : "");
  const query = str(raw.query, 200).replace(/[\r\n]/g, " ");

  const act = (GMAIL_ACTS as readonly string[]).includes(String(raw.act)) ? String(raw.act) : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date ?? "")) ? String(raw.date) : "";
  const time = /^\d{1,2}:\d{2}$/.test(String(raw.time ?? "")) ? String(raw.time) : "";
  const title = str(raw.title, 200);
  if (kind === "command") {
    const ok =
      (action === "filter" && filter) || (action === "folder" && folder) || (action === "focus" && entity) ||
      (action === "search" && query) || (action === "gmailAct" && act) || (action === "calendarAdd" && title && date) ||
      (action === "noteAdd" && title) || (action === "history" && query) ||
      ["summary", "reply", "trashSpam", "full", "voice", "compose", "readAll", "calendarList", "notesList", "count", "tracker", "stats", "pending", "weekly", "funnel"].includes(action) ||
      (action === "intentList" && INTENT_LIST.includes(String(raw.purpose)));
    if (!ok) {
      kind = "chat";
      action = "none";
    }
  } else {
    action = "none";
  }
  const reply = str(raw.reply, 500) || (kind === "command" ? "Sure!" : "Sorry, I didn't quite get that. Could you say it again?");
  return {
    kind, reply, action, filter, folder, entity, query,
    intent: str(raw.intent, 400),
    to: str(raw.to, 120), topic: str(raw.topic, 600), act, title, date, time,
    period: (PERIODS as readonly string[]).includes(String(raw.period)) ? String(raw.period) : "",
    purpose: INTENT_LIST.includes(String(raw.purpose)) ? String(raw.purpose) : "",
    durationMin: Math.min(Math.max(Math.round(Number(raw.durationMin) || 60), 5), 24 * 60),
    refIds: (Array.isArray(raw.refIds) ? raw.refIds : []).map(String).filter((id) => ids.has(id)).slice(0, 6),
  };
}
