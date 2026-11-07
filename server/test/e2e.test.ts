/**
 * End-to-end pipeline test with fake Gmail, fake Gemini and an in-memory DB:
 * login redirect → initial sync → PII redaction → AI analysis → truth verification
 * → duplicate merging → briefing API → ask API → delete my data.
 */
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AskResponse, Briefing, SyncStatus } from "../../shared/types.js";
import { fake } from "./fakeDb.js";

vi.mock("../src/db.js", () => ({
  users: () => fake.users,
  emails: () => fake.emails,
  connectDb: async () => undefined,
  closeDb: async () => undefined,
}));

// ---------- Fake Gmail inbox ----------
const now = Date.now();
const H = 3600_000;
const b64 = (s: string) => Buffer.from(s).toString("base64url");
function msg(id: string, from: string, subject: string, body: string, hoursAgo: number, labels = ["INBOX"]) {
  return {
    id,
    threadId: `th-${id}`,
    labelIds: labels,
    snippet: body.slice(0, 80),
    internalDate: String(now - hoursAgo * H),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: from },
        { name: "Subject", value: subject },
      ],
      body: { data: b64(body) },
    },
  };
}
const INBOX = [
  msg("m1", "Infosys Careers <careers@infosys.com>", "Application update", "Dear Dinesh, Congratulations! You have been shortlisted for the next round of the Systems Engineer hiring.", 2),
  msg("m2", "TCS Talent <talent@tcs.com>", "Interview invitation", "We would like to invite you for a technical interview on 12 November at 11 AM. Please confirm your availability.", 3),
  msg("m3", "Wipro HR <hr@wipro.com>", "Your application", "Thank you for your interest. We regret to inform you that we will not be moving forward with your application.", 5),
  msg("m4", "Accenture <jobs@accenture.com>", "Complete your assessment", "Please complete the online assessment before 9 November.", 30),
  msg("m5", "Accenture <jobs@accenture.com>", "Reminder: assessment pending", "Reminder: please complete the online assessment before 8 November.", 4),
  msg("m6", "Flipkart <offers@flipkart.com>", "Big Billion Sale!", "Up to 80% off on mobiles. Shop now!", 6, ["INBOX", "CATEGORY_PROMOTIONS"]),
  msg("m7", "Global Jobs <hr.globaljobs@gmail.com>", "Job offer - pay registration fee", "You are selected for a work-from-home job. Pay registration fee of Rs 2000 to confirm.", 7),
  msg("m8", "Mummy <mummy@gmail.com>", "Ghar kab aa rahe ho?", "Beta, Diwali pe ghar kab aa rahe ho? Call karna.", 8),
  msg("m9", "HDFC Bank <alerts@hdfcbank.net>", "OTP for transaction", "Your OTP is 482913 for the transaction of Rs 1,500. Card 4111 1111 1111 1111.", 1),
  msg("m10", "Zoho Recruit <careers@zoho.com>", "Application received", "Thank you for applying to Zoho. Our team will review your profile.", 9),
  msg("m11", "Spammer <x@spam.biz>", "spam", "should be skipped", 1, ["SPAM"]),
];

const gmailFake = {
  users: {
    getProfile: async () => ({ data: { historyId: "1000", emailAddress: "dinesh@gmail.com" } }),
    messages: {
      list: async () => ({ data: { messages: INBOX.map((m) => ({ id: m.id })) } }),
      get: async ({ id }: { id: string }) => ({ data: structuredClone(INBOX.find((m) => m.id === id)) }),
    },
    history: { list: async () => ({ data: { historyId: "1001" } }) },
    watch: async () => ({ data: {} }),
    stop: async () => ({ data: {} }),
  },
};

vi.mock("../src/auth/google.js", async (orig) => ({
  ...(await orig<typeof import("../src/auth/google.js")>()),
  gmailForUser: async () => gmailFake,
  revokeUserToken: async () => undefined,
}));

// ---------- Fake Gemini (acts like the model, keyword-based) ----------
const prompts: string[] = [];
function fakeClassify(e: { id: string; from: string; subject: string; body: string }) {
  const t = `${e.subject} ${e.body}`;
  const base = {
    id: e.id, category: "other", status: "none", priority: "medium", entity: e.from.split(" <")[0],
    groupKey: "", summary: e.subject, actionRequired: false, actionText: "", deadline: "",
    isScam: false, scamReason: "", evidence: "", confidence: 0.9,
  };
  const ent = (n: string, topic = "application") => ({ entity: n, groupKey: `${n.toLowerCase()}:${topic}` });
  if (/shortlisted/.test(t)) return { ...base, ...ent("Infosys"), category: "job", status: "shortlisted", priority: "high", evidence: "You have been shortlisted for the next round" };
  if (/interview/.test(t)) return { ...base, ...ent("TCS"), category: "job", status: "interview", priority: "high", actionRequired: true, actionText: "Confirm availability", deadline: "2026-11-12", evidence: "Please confirm your availability." };
  if (/regret/.test(t)) return { ...base, ...ent("Wipro"), category: "job", status: "rejected", evidence: "We regret to inform you that we will not be moving forward with your application." };
  if (/assessment/.test(t)) return { ...base, ...ent("Accenture"), category: "job", status: "assessment", priority: "high", actionRequired: true, actionText: "Complete online assessment", deadline: /8 November/.test(t) ? "2026-11-08" : "2026-11-09", evidence: e.body.split(".")[0] };
  if (/Sale/.test(t)) return { ...base, ...ent("Flipkart", "promo"), category: "promotion", priority: "low" };
  if (/registration fee/.test(t)) return { ...base, ...ent("Global Jobs", "other"), category: "scam", isScam: true, priority: "high", scamReason: "Asks for a registration fee" };
  if (/Diwali/.test(t)) return { ...base, ...ent("Mummy", "conversation"), category: "personal", priority: "high" };
  if (/OTP/.test(t)) return { ...base, ...ent("HDFC Bank", "account"), category: "finance", priority: "medium" };
  // Simulated hallucination: model wrongly claims an OFFER with a made-up quote.
  if (/Zoho/.test(t)) return { ...base, ...ent("Zoho"), category: "job", status: "offer", priority: "high", evidence: "We are delighted to offer you the position", confidence: 0.95 };
  return base;
}

vi.mock("../src/ai/gemini.js", () => ({
  generateJSON: vi.fn(async ({ prompt }: { prompt: string }) => {
    prompts.push(prompt);
    if (prompt.includes("Analyze these")) {
      const emails = JSON.parse(prompt.slice(prompt.indexOf("\n\n") + 2));
      return { results: emails.map(fakeClassify) };
    }
    if (prompt.includes("User question")) {
      return { answer: "Is hafte Wipro se 1 rejection aaya hai.", refIds: ["m3", "not-a-real-id"] };
    }
    throw new Error("unexpected prompt");
  }),
  generateText: vi.fn(async ({ prompt }: { prompt: string }) => {
    prompts.push(prompt);
    return "Namaste Dinesh! Infosys ne shortlist kiya hai. TCS ka interview hai.";
  }),
}));

// ---------- Test ----------
let base = "";
let cookie = "";
let close: () => void;
const userId = new ObjectId();

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { encrypt } = await import("../src/crypto.js");
  await fake.users.updateOne(
    { googleId: "g-1" },
    {
      $setOnInsert: {
        _id: userId, googleId: "g-1", email: "dinesh@gmail.com", name: "Dinesh Saini", picture: "",
        encRefreshToken: encrypt("refresh-token", process.env.ENCRYPTION_KEY!),
        historyId: null, lastSyncAt: null, watchExpiration: null, createdAt: new Date(), updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  close = () => server.close();
  cookie = `vm_session=${jwt.sign({ sub: userId.toHexString() }, process.env.SESSION_SECRET!)}`;
});
afterAll(() => close?.());

const get = (p: string, auth = true) => fetch(base + p, { headers: auth ? { cookie } : {}, redirect: "manual" });

describe("VaaniMail Phase 1 end-to-end", () => {
  it("blocks unauthenticated API calls", async () => {
    expect((await get("/me", false)).status).toBe(401);
    expect((await get("/briefing", false)).status).toBe(401);
  });

  it("starts Google login with read-only Gmail scope and a CSRF state cookie", async () => {
    const res = await get("/auth/google", false);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.hostname).toBe("accounts.google.com");
    expect(loc.searchParams.get("scope")).toContain("gmail.readonly");
    expect(loc.searchParams.get("access_type")).toBe("offline");
    expect(res.headers.get("set-cookie")).toMatch(/vm_oauth_state=.*HttpOnly/i);
  });

  it("rejects an OAuth callback with a forged state", async () => {
    const res = await get("/auth/google/callback?code=x&state=forged", false);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=");
  });

  it("syncs the inbox, redacts PII and analyzes every email", async () => {
    const { startInitialSync } = await import("../src/gmail/sync.js");
    await startInitialSync(userId);

    const status = (await (await get("/status")).json()) as SyncStatus;
    expect(status.totalStored).toBe(10); // spam message skipped
    expect(status.pending).toBe(0);
    expect(status.state).toBe("idle");

    const otp = fake.emails.docs.find((d) => d.gmailId === "m9")!;
    expect(otp.bodyRedacted).toContain("[OTP]");
    expect(otp.bodyRedacted).toContain("[CARD]");
    expect(otp.bodyRedacted).not.toContain("482913");
    // Nothing sensitive ever reached the AI.
    expect(prompts.join("\n")).not.toMatch(/482913|4111 1111/);
  });

  it("builds a truthful, de-duplicated briefing", async () => {
    const res = await get("/briefing?lang=hinglish&mode=short");
    expect(res.status).toBe(200);
    const b = (await res.json()) as Briefing;
    const sec = (k: string) => b.sections.find((s) => s.key === k);

    expect(b.speech).toContain("Infosys");
    expect(sec("shortlisted")?.items.map((i) => i.entity)).toEqual(["Infosys"]);
    expect(sec("interview")?.items[0].entity).toBe("TCS");
    expect(sec("rejected")?.items[0].entity).toBe("Wipro");
    expect(sec("personal")?.items[0].entity).toBe("Mummy");
    expect(sec("security")?.items[0].entity).toBe("Global Jobs");

    // Duplicate intelligence: two Accenture reminders → one card, latest deadline.
    const acc = sec("assessment")!.items;
    expect(acc).toHaveLength(1);
    expect(acc[0].mergedCount).toBe(2);
    expect(acc[0].deadline).toBe("2026-11-08");

    // Truth verification: fake "offer" from Zoho is NOT shown as an offer.
    expect(sec("offer")).toBeUndefined();
    const zoho = sec("other_important")!.items.find((i) => i.entity === "Zoho")!;
    expect(zoho.verified).toBe(false);
    expect(zoho.confidence).toBeLessThanOrEqual(0.4);

    // Promotions hidden.
    expect(JSON.stringify(b.sections)).not.toContain("Flipkart");
    expect(b.stats.hiddenSpamPromo).toBeGreaterThanOrEqual(1);
    expect(b.stats.duplicatesMerged).toBe(1);
    expect(b.stats.scamCount).toBe(1);
  });

  it("answers voice questions with real email references only", async () => {
    const res = await fetch(`${base}/ask`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Is hafte kitne rejection aaye?", lang: "hinglish" }),
    });
    const a = (await res.json()) as AskResponse;
    expect(a.answer).toContain("Wipro");
    expect(a.refs.map((r) => r.gmailId)).toEqual(["m3"]); // invented id dropped
    expect(a.refs[0].gmailUrl).toContain("mail.google.com");
  });

  it("validates input", async () => {
    const res = await fetch(`${base}/ask`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ question: "" }),
    });
    expect(res.status).toBe(400);
    expect((await get("/briefing?lang=fr")).status).toBe(400);
  });

  it("deletes all user data on request", async () => {
    const res = await fetch(`${base}/account`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(200);
    expect(fake.users.docs).toHaveLength(0);
    expect(fake.emails.docs).toHaveLength(0);
  });
});
