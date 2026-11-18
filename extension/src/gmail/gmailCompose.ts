/**
 * Writing INSIDE Gmail's own compose / reply box by voice.
 * Gmail has no public API for its UI, so we find the fields by stable attributes
 * (name="subjectbox", g_editable, role="textbox", the To recipients input …) with fallbacks,
 * and type with execCommand("insertText") so Gmail's own handlers see real typing.
 */
export interface ComposeBox { root: HTMLElement; body: HTMLElement; subject: HTMLInputElement | null; to: HTMLInputElement | null; send: HTMLElement | null }

const visible = (el: Element | null): el is HTMLElement => Boolean(el && (el as HTMLElement).offsetParent !== null && (el as HTMLElement).getClientRects().length);

/** The compose or reply box that's open (the focused one, else the newest). */
export function findCompose(doc: Document = document): ComposeBox | null {
  const bodies = [...doc.querySelectorAll<HTMLElement>('div[contenteditable="true"][g_editable="true"], div[contenteditable="true"][role="textbox"][aria-label]')].filter(visible);
  if (!bodies.length) return null;
  const active = doc.activeElement;
  const body = bodies.find((b) => b === active || b.contains(active)) ?? bodies[bodies.length - 1];
  // climb to the compose container: the nearest ancestor that also holds a Send button
  let root: HTMLElement = body;
  for (let p = body.parentElement; p && p !== doc.body; p = p.parentElement) {
    root = p;
    if (sendButton(p)) break;
  }
  const subject = root.querySelector<HTMLInputElement>('input[name="subjectbox"]');
  const to =
    root.querySelector<HTMLInputElement>('input[aria-label="To recipients"]') ??
    root.querySelector<HTMLInputElement>('input[peoplekit-id], div[name="to"] input, textarea[name="to"]') ??
    [...root.querySelectorAll<HTMLInputElement>("input[aria-label]")].find((i) => /^(to|recipients|प्रति|को)\b/i.test(i.getAttribute("aria-label") ?? "")) ?? null;
  return { root, body, subject: visible(subject) ? subject : subject, to, send: sendButton(root) };
}

function sendButton(root: Element): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>('div[role="button"][data-tooltip^="Send"], div[role="button"][aria-label^="Send"]') ??
    [...root.querySelectorAll<HTMLElement>('div[role="button"]')].find((b) => /^send\b/i.test((b.getAttribute("data-tooltip") ?? b.getAttribute("aria-label") ?? b.textContent ?? "").trim())) ??
    null
  );
}

function typeInto(el: HTMLElement, text: string, atEnd = true) {
  el.focus();
  if (atEnd && el.isContentEditable) {
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(r);
  }
  // execCommand keeps Gmail's undo history and triggers its listeners (autosave, recipient chips…)
  const ok = document.execCommand("insertText", false, text);
  if (!ok) {
    if (el instanceof HTMLInputElement) el.value += text;
    else el.append(document.createTextNode(text));
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
  }
}

export function addRecipient(box: ComposeBox, email: string): boolean {
  if (!box.to) return false;
  typeInto(box.to, `${email},`);
  box.to.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return true;
}

export function setSubject(box: ComposeBox, text: string): boolean {
  if (!box.subject) return false;
  box.subject.focus();
  box.subject.select();
  typeInto(box.subject, text, false);
  return true;
}

/** Spoken punctuation → characters: "comma", "full stop", "new line", "question mark"… */
export function spokenToText(raw: string): string {
  let t = ` ${raw.trim()} `;
  const rules: [RegExp, string][] = [
    [/\s+(new paragraph|naya paragraph)\s+/gi, "\n\n"], [/\s+(new line|next line|nayi line|agli line)\s+/gi, "\n"],
    [/\s+(full stop|period|poorn viraam)\s*/gi, ". "], [/\s+comma\s*/gi, ", "], [/\s+question mark\s*/gi, "? "],
    [/\s+exclamation (mark|point)\s*/gi, "! "], [/\s+colon\s*/gi, ": "], [/\s+(dash|hyphen)\s*/gi, " - "],
  ];
  for (const [re, s] of rules) t = t.replace(re, s);
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/^\s+|\s+$/g, "");
  // capitalise the start of sentences
  return t.replace(/(^|[.!?]\s+|\n)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

/** Appends dictated / generated text to the body (adds a space or new line as needed). */
export function writeBody(box: ComposeBox, text: string) {
  const current = (box.body.innerText ?? "").replace(/\s+$/, "");
  const sep = !current ? "" : /\n$/.test(box.body.innerText ?? "") || text.startsWith("\n") ? "" : " ";
  const parts = (sep + text).split("\n");
  box.body.focus();
  parts.forEach((p, i) => {
    if (i > 0) document.execCommand("insertLineBreak") || document.execCommand("insertParagraph");
    if (p) typeInto(box.body, p);
  });
}

/** Replaces the whole body (AI-written email). */
export function replaceBody(box: ComposeBox, text: string) {
  box.body.focus();
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(box.body);
  sel?.removeAllRanges();
  sel?.addRange(r);
  document.execCommand("delete");
  writeBody(box, text);
}

export const bodyText = (box: ComposeBox) => (box.body.innerText ?? "").trim();

// ---------------------------------------------------------------------------
// Understanding "write this in the box" (pure — unit tested)
// ---------------------------------------------------------------------------
export interface WriteHere {
  /** What the email should say, in the user's words (AI turns it into a proper email). */
  topic: string;
  /** "vacation ke upar likho…" → "vacation" */
  subject: string;
  /** "type: …" → put the words in exactly as spoken, no AI. */
  dictate: boolean;
}

const WRITE = String.raw`(?:likho|likh do|likh de|likhiye|likhna|write|type|draft|bana do|banao)`;

/**
 * "vocations ke upar likho mujhe 10 din ki chutti chahiye", "isme likho ki main kal aaunga",
 * "write that I need 10 days leave", "write a leave application for 10 days", "type: see you tomorrow".
 */
export function parseWriteHere(raw: string): WriteHere | null {
  const t = raw.trim().replace(/^(please|plz|ab|okay|ok)\s+/i, "").replace(/[.!?।]+$/, "");
  if (!t) return null;
  let m: RegExpMatchArray | null;
  // exact words, no AI
  if ((m = t.match(/^(?:type|dictate|exactly likho|jaisa bolu waisa likho)\s*[:,-]?\s+(.+)$/i))) return { topic: m[1], subject: "", dictate: true };
  // "<subject> ke upar / ke baare mein / par likho (ki) <topic>"
  if ((m = t.match(new RegExp(String.raw`^(.{2,60}?)\s+(?:ke upar|ke uper|ke bare me|ke bare mein|ke baare mein|ke baare me|par|pe|ke liye)\s+(?:ek\s+)?(?:(?:formal\s+)?(?:mail|email|message|application|letter)\s+)?${WRITE}\s*(?:ki|that|:)?\s*(.*)$`, "i"))))
    return { subject: clean(m[1]), topic: m[2].trim() || clean(m[1]), dictate: false };
  // "write (a mail) on/about <subject> saying/that <topic>"
  if ((m = t.match(new RegExp(String.raw`^${WRITE}\s+(?:(?:a|an|the|ek)\s+)?(?:formal\s+)?(?:mail|email|message|letter|application|reply)?\s*(?:on|about|regarding|for)\s+(.{2,60}?)\s+(?:saying|that|ki|:)\s+(.+)$`, "i"))))
    return { subject: clean(m[1]), topic: m[2].trim(), dictate: false };
  // "isme likho (ki) …", "write that …", "likho ki …", "write a leave application for 10 days"
  if ((m = t.match(new RegExp(String.raw`^(?:isme|is me|ismein|yahan|yaha|here|in it|in this|in the box|box me|box mein)?\s*${WRITE}\s+(?:it\s+)?(?:here\s+|isme\s+)?(?:ki|that|saying|:)?\s*(.{3,})$`, "i"))))
    return { subject: "", topic: m[1].trim(), dictate: false };
  // "… likho" / "… likh do" at the end: "mujhe 10 din ki chutti chahiye ye likho"
  if ((m = t.match(/^(.{6,}?)\s+(?:ye|yeh|aisa|ise|isko)?\s*(?:isme\s+)?(?:likho|likh do|likh de)$/i))) return { subject: "", topic: m[1].trim(), dictate: false };
  return null;
}
const clean = (s: string) => s.replace(/^(?:isme|is mail|mail|email|message|subject)\s+/i, "").trim();

/** "make it shorter", "thoda formal karo", "add that I'll call tomorrow" — a change to what's already written. */
export function parseBoxChange(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (/^(make it|make this|isko|ise|ye|yeh|thoda|thora|aur)\b.*\b(short|shorter|chhota|chota|long|longer|bada|formal|polite|friendly|simple|professional|casual|better|acha|accha)\b/.test(t)) return raw.trim();
  if (/\b(shorter|more formal|more polite|less formal|chhota karo|chota karo|formal karo|formal banao|polite karo|professional banao)\b/.test(t)) return raw.trim();
  if (/^(also (say|mention|add)|add (that|a line)|ye bhi (add|likho|daalo)|yeh bhi (add|likho|daalo)|remove|hata do|change|badlo|rewrite|dobara likho|phir se likho)\b/.test(t)) return raw.trim();
  return null;
}

/** Names / addresses already in the To field (chips). */
export function recipientNames(box: ComposeBox): string {
  const chips = [...box.root.querySelectorAll<HTMLElement>("[email]")].map((c) => c.getAttribute("name") || c.textContent?.trim() || c.getAttribute("email") || "");
  const typed = box.to?.value?.replace(/,\s*$/, "").trim() ?? "";
  return [...new Set([...chips, typed].filter(Boolean))].join(", ").slice(0, 120);
}

/** A reply box sits inside an open conversation and has no visible subject field. */
export const isReplyBox = (box: ComposeBox) => !visible(box.subject);

/** API id of the newest message in the conversation open on screen (Gmail puts it in data-legacy-message-id). */
export function openedMessageId(doc: Document = document): string {
  const ids = [...doc.querySelectorAll<HTMLElement>("[data-legacy-message-id]")].filter(visible).map((e) => e.getAttribute("data-legacy-message-id") ?? "");
  const id = ids.filter((x) => /^[\w-]{1,64}$/.test(x)).pop();
  return id ?? "";
}

/** Gmail's buttons react to mouse down/up rather than a plain click. */
export function press(el: HTMLElement) {
  for (const type of ["mousedown", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
}

export function composeButton(doc: Document = document): HTMLElement | null {
  return (
    doc.querySelector<HTMLElement>('div[gh="cm"]') ??
    [...doc.querySelectorAll<HTMLElement>('[role="button"]')].filter(visible).find((b) => /^(compose|लिखें)$/i.test((b.textContent ?? "").trim())) ??
    null
  );
}

export function replyButton(doc: Document = document): HTMLElement | null {
  const all = [...doc.querySelectorAll<HTMLElement>('[role="button"][data-tooltip="Reply"], [role="button"][aria-label="Reply"], span[role="link"]')]
    .filter(visible)
    .filter((b) => /^reply$/i.test((b.getAttribute("data-tooltip") ?? b.getAttribute("aria-label") ?? b.textContent ?? "").trim()));
  return all.pop() ?? null;
}
