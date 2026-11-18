/** Builds a threaded plain-text reply (RFC 2822) for the Gmail API. Pure — unit tested. */

const utf8b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

export const b64url = (s: string) => utf8b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Header value safe for any language; strips CR/LF so nothing can inject extra headers. */
export function encodeHeader(v: string): string {
  const clean = v.replace(/[\r\n]+/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${utf8b64(clean)}?=`;
}

export const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

export function buildReplyMime(o: {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  if (!EMAIL_RE.test(o.to)) throw new Error("Invalid recipient address");
  const refs = [o.references, o.inReplyTo].filter(Boolean).join(" ").replace(/[\r\n]+/g, " ").trim();
  const msgId = (o.inReplyTo ?? "").replace(/[\r\n]+/g, "").trim();
  const headers = [
    `From: ${encodeHeader(o.from)}`,
    `To: ${o.to}`,
    `Subject: ${encodeHeader(o.subject)}`,
    ...(msgId ? [`In-Reply-To: ${msgId}`] : []),
    ...(refs ? [`References: ${refs}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const body = utf8b64(o.body.replace(/\r?\n/g, "\r\n")).replace(/.{76}/g, "$&\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}
