import { describe, expect, it } from "vitest";
import { b64urlDecode, extractBody, htmlToText, parseFrom } from "../src/bg/gmail";

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("browser email parsing (service worker safe)", () => {
  it("decodes base64url including UTF-8 (₹, Hindi)", () => {
    expect(b64urlDecode(b64("Stipend ₹45,000 — नमस्ते"))).toBe("Stipend ₹45,000 — नमस्ते");
  });
  it("prefers text/plain and skips attachments", () => {
    const body = extractBody({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: b64("Hello  plain\n\n\n\nworld") } },
        { mimeType: "text/html", body: { data: b64("<p>html</p>") } },
        { mimeType: "application/pdf", filename: "offer.pdf", body: { attachmentId: "x" } },
      ],
    });
    expect(body).toBe("Hello plain\n\nworld");
  });
  it("converts HTML to text without a DOM", () => {
    const t = htmlToText("<style>.x{}</style><p>Hi <b>Dinesh</b>&nbsp;&amp; team</p><script>alert(1)</script><br>Bye &#8377;10");
    expect(t).toContain("Hi Dinesh");
    expect(t).toContain("& team");
    expect(t).toContain("₹10");
    expect(t).not.toContain("alert");
    expect(t).not.toContain(".x{}");
  });
  it("parses From headers", () => {
    expect(parseFrom('"TCS Talent" <Talent@TCS.com>')).toEqual({ name: "TCS Talent", email: "talent@tcs.com" });
  });
});
