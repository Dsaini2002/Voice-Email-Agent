import { describe, expect, it } from "vitest";
import { buildReplyMime, encodeHeader } from "../src/bg/mime";
import { placeholders, replySubject, toDraft, NO_REPLY } from "../../server/src/ai/replyCore";

const decodeBody = (mime: string) => {
  const b = mime.split("\r\n\r\n")[1].replace(/\r\n/g, "");
  return new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
};

describe("reply MIME", () => {
  it("threads the reply and keeps unicode intact", () => {
    const m = buildReplyMime({ from: "Dinesh Saini <d@x.com>", to: "hr@tcs.com", subject: "Re: Interview — नमस्ते", body: "Hi Priya,\nThanks! 🙏\nDinesh", inReplyTo: "<abc@mail>", references: "<root@mail>" });
    expect(m).toContain("To: hr@tcs.com");
    expect(m).toContain("In-Reply-To: <abc@mail>");
    expect(m).toContain("References: <root@mail> <abc@mail>");
    expect(m).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(decodeBody(m)).toBe("Hi Priya,\r\nThanks! 🙏\r\nDinesh");
  });
  it("blocks header injection and bad recipients", () => {
    expect(encodeHeader("Hello\r\nBcc: evil@x.com")).toBe("Hello Bcc: evil@x.com");
    expect(() => buildReplyMime({ from: "a@b.co", to: "x@y.com\nBcc: z@q.com", subject: "s", body: "b" })).toThrow();
  });
});

describe("reply core", () => {
  it("finds blanks and adds a hint for each", () => {
    const d = toDraft({ body: "Hi,\nI am free at [your available time].\nThanks", hints: [], spoken: "ok" });
    expect(placeholders(d.body)).toEqual(["[your available time]"]);
    expect(d.hints[0]).toContain("[your available time]");
  });
  it("subjects and no-reply senders", () => {
    expect(replySubject("Interview")).toBe("Re: Interview");
    expect(replySubject("RE: Interview")).toBe("RE: Interview");
    expect(NO_REPLY.test("noreply@naukri.com")).toBe(true);
    expect(NO_REPLY.test("no-reply@accounts.google.com")).toBe(true);
    expect(NO_REPLY.test("priya.hr@tcs.com")).toBe(false);
  });
});
