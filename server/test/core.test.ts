import { describe, expect, it } from "vitest";
import type { EmailAnalysis } from "../../shared/types.js";
import { encrypt, decrypt } from "../src/crypto.js";
import { extractBody, parseFrom } from "../src/gmail/parse.js";
import { buildSections, dedupe, sectionFor, type AnalyzedEmail } from "../src/intel/briefingBuilder.js";
import { evidenceFound, verifyAnalysis } from "../src/intel/truth.js";
import { redactPII } from "../src/privacy/redact.js";
import { fallbackSpeech } from "../src/ai/speech.js";

const base: EmailAnalysis = {
  category: "job",
  status: "none",
  priority: "medium",
  entity: "Acme",
  groupKey: "acme:application",
  summary: "summary",
  actionRequired: false,
  actionText: "",
  deadline: "",
  isScam: false,
  scamReason: "",
  evidence: "",
  confidence: 0.9,
  verified: true,
};

const mk = (id: string, a: Partial<EmailAnalysis>, date = "2026-11-07T10:00:00Z"): AnalyzedEmail => ({
  gmailId: id,
  threadId: `t-${id}`,
  subject: `Subject ${id}`,
  date: new Date(date),
  analysis: { ...base, ...a },
});

describe("PII redaction", () => {
  it("masks OTPs in both word orders", () => {
    expect(redactPII("Your OTP is 482913. Do not share.")).toContain("[OTP]");
    expect(redactPII("Your OTP is 482913.")).not.toContain("482913");
    expect(redactPII("519203 is your verification code")).toBe("[OTP] is your verification code");
  });
  it("masks Aadhaar, PAN, card, phone, UPI, passwords", () => {
    const t = redactPII(
      "Aadhaar 1234 5678 9012, PAN ABCDE1234F, card 4111 1111 1111 1111, call +91 98765 43210, pay rahul@okaxis, Password: hunter2",
    );
    expect(t).toContain("[AADHAAR]");
    expect(t).toContain("[PAN]");
    expect(t).toContain("[CARD]");
    expect(t).toContain("[PHONE]");
    expect(t).toContain("[UPI]");
    expect(t).toContain("Password: [SECRET]");
    expect(t).not.toMatch(/9012|1234F|43210|hunter2/);
  });
  it("keeps normal text, dates and money", () => {
    const s = "Interview on 12 November 2026 at 11 AM. Stipend ₹45,000 per month.";
    expect(redactPII(s)).toBe(s);
  });
});

describe("Truth verification", () => {
  const body = "Dear Dinesh, We are pleased to inform you that you have been shortlisted for the next round.";
  it("accepts evidence that exists in the email", () => {
    expect(evidenceFound("you have been shortlisted for the next round", body)).toBe(true);
    expect(evidenceFound("We are pleased to inform you that you have been shortlisted", body)).toBe(true);
  });
  it("rejects hallucinated evidence and caps confidence", () => {
    const v = verifyAnalysis({ ...base, status: "offer", evidence: "We are happy to offer you the role", confidence: 0.95 }, body);
    expect(v.verified).toBe(false);
    expect(v.confidence).toBeLessThanOrEqual(0.4);
  });
  it("does not need evidence for plain emails", () => {
    expect(verifyAnalysis({ ...base, status: "none", verified: false }, body).verified).toBe(true);
  });
});

describe("Briefing builder", () => {
  it("routes emails to the right sections and hides promos/spam", () => {
    expect(sectionFor({ ...base, status: "shortlisted" })).toBe("shortlisted");
    expect(sectionFor({ ...base, status: "offer", verified: false })).toBe("other_important");
    expect(sectionFor({ ...base, category: "promotion", priority: "low" })).toBeNull();
    expect(sectionFor({ ...base, category: "spam" })).toBeNull();
    expect(sectionFor({ ...base, isScam: true, category: "scam" })).toBe("security");
    expect(sectionFor({ ...base, actionRequired: true, actionText: "Fill form" })).toBe("action");
  });

  it("merges reminders into the latest email (duplicate intelligence)", () => {
    const list = [
      mk("1", { status: "assessment", deadline: "2026-11-09" }, "2026-11-05T10:00:00Z"),
      mk("2", { status: "assessment", deadline: "" }, "2026-11-06T10:00:00Z"),
      mk("3", { status: "assessment", deadline: "2026-11-08" }, "2026-11-07T10:00:00Z"),
    ];
    const d = dedupe(list);
    expect(d).toHaveLength(1);
    expect(d[0].item.gmailId).toBe("3");
    expect(d[0].merged).toBe(3);
    expect(d[0].item.analysis.deadline).toBe("2026-11-08");
  });

  it("builds sections, stats and links", () => {
    const list = [
      mk("a", { entity: "A", groupKey: "a:application", status: "shortlisted", priority: "high" }),
      mk("b", { entity: "B", groupKey: "b:application", status: "shortlisted", priority: "high" }),
      mk("e", { entity: "E", groupKey: "e:application", status: "rejected" }),
      mk("p", { entity: "Shop", groupKey: "shop:promo", category: "promotion", priority: "low" }),
      mk("s", { entity: "FakeJobs", groupKey: "fakejobs:other", category: "scam", isScam: true, scamReason: "asks fee" }),
    ];
    const { sections, stats } = buildSections(list, "hinglish", "me@gmail.com");
    expect(sections.map((s) => s.key)).toEqual(["shortlisted", "rejected", "security"]);
    expect(sections[0].items.map((i) => i.entity).sort()).toEqual(["A", "B"]);
    expect(sections[0].items[0].gmailUrl).toContain("authuser=me%40gmail.com");
    expect(stats).toMatchObject({ totalEmails: 5, shownEmails: 4, hiddenSpamPromo: 1, scamCount: 1 });

    const speech = fallbackSpeech(sections, stats, "hinglish");
    expect(speech).toContain("A aur B ne aapko shortlist kiya hai.");
    expect(speech).toContain("E se rejection aaya hai.");
  });
});

describe("Gmail parsing", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
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
  it("falls back to html converted to text", () => {
    const body = extractBody({ mimeType: "text/html", body: { data: b64("<style>x{}</style><p>Hi <b>Dinesh</b></p>") } });
    expect(body).toContain("Hi Dinesh");
    expect(body).not.toContain("x{}");
  });
  it("parses From headers", () => {
    expect(parseFrom('"Infosys Careers" <Careers@Infosys.com>')).toEqual({ name: "Infosys Careers", email: "careers@infosys.com" });
    expect(parseFrom("alerts@bank.in")).toEqual({ name: "alerts@bank.in", email: "alerts@bank.in" });
  });
});

describe("Token encryption", () => {
  it("round-trips and detects tampering", () => {
    const key = "a".repeat(64);
    const enc = encrypt("1//refresh-token", key);
    expect(enc).not.toContain("refresh");
    expect(decrypt(enc, key)).toBe("1//refresh-token");
    const [iv, tag, data] = enc.split(".");
    const tampered = [iv, tag, Buffer.from("zzzz").toString("base64")].join(".");
    expect(() => decrypt(tampered, key)).toThrow();
    void data;
  });
});
