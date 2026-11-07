import { convert } from "html-to-text";
import type { gmail_v1 } from "googleapis";

export interface ParsedMessage {
  gmailId: string;
  threadId: string;
  from: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  date: Date;
  snippet: string;
  labelIds: string[];
  bodyText: string;
}

const MAX_BODY_CHARS = 4000;

function header(msg: gmail_v1.Schema$Message, name: string): string {
  const h = msg.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** Walks MIME parts and returns the best plain-text body. Prefers text/plain, falls back to text/html. */
export function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  let plain = "";
  let html = "";

  const walk = (part: gmail_v1.Schema$MessagePart) => {
    const mime = part.mimeType ?? "";
    const data = part.body?.data;
    // Skip attachments (they have a filename). Attachments come in Phase 3.
    if (part.filename) return;
    if (data) {
      if (mime === "text/plain" && !plain) plain = decodeB64Url(data);
      else if (mime === "text/html" && !html) html = decodeB64Url(data);
    }
    part.parts?.forEach(walk);
  };
  walk(payload);

  let text = plain;
  if (!text.trim() && html) {
    text = convert(html, {
      wordwrap: false,
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "script", format: "skip" },
      ],
    });
  }
  return cleanText(text);
}

export function cleanText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_BODY_CHARS);
}

/** "Infosys Careers <careers@infosys.com>" -> { name, email } */
export function parseFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  return { name: from.trim(), email: from.trim().toLowerCase() };
}

export function parseMessage(msg: gmail_v1.Schema$Message): ParsedMessage {
  const from = header(msg, "From");
  const { name, email } = parseFrom(from);
  const internal = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(header(msg, "Date"));
  return {
    gmailId: msg.id ?? "",
    threadId: msg.threadId ?? "",
    from,
    fromName: name,
    fromEmail: email,
    subject: header(msg, "Subject") || "(no subject)",
    date: isNaN(internal.getTime()) ? new Date() : internal,
    snippet: msg.snippet ?? "",
    labelIds: msg.labelIds ?? [],
    bodyText: extractBody(msg.payload),
  };
}
