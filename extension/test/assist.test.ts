import { describe, expect, it } from "vitest";
import { toAssistResult } from "../../server/src/ai/assistCore";
import { quotaInfo, friendlyGeminiError, GeminiError } from "../src/bg/ai";

const list = [{ gmailId: "m2", threadId: "t", subject: "Interview", date: new Date(), analysis: { entity: "TCS" } }] as never[];

describe("AI intent result is validated before anything runs", () => {
  it("keeps valid commands and maps sender names exactly", () => {
    const r = toAssistResult({ kind: "command", action: "focus", entity: "tcs", reply: "Opening TCS" }, list);
    expect(r).toMatchObject({ kind: "command", action: "focus", entity: "TCS" });
  });
  it("turns unknown actions / senders / folders into a plain chat reply", () => {
    expect(toAssistResult({ kind: "command", action: "deleteEverything", reply: "x" }, list).action).toBe("none");
    expect(toAssistResult({ kind: "command", action: "focus", entity: "Unknown Corp", reply: "x" }, list).kind).toBe("chat");
    expect(toAssistResult({ kind: "command", action: "folder", folder: "../../etc", reply: "x" }, list).kind).toBe("chat");
  });
  it("only keeps refIds that are real emails", () => {
    expect(toAssistResult({ kind: "answer", reply: "a", refIds: ["m2", "fake"] }, list).refIds).toEqual(["m2"]);
  });
});

describe("free-limit (quota) errors", () => {
  it("reads Google's retry delay and daily limit", () => {
    const body = { error: { details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" },
    ] } };
    expect(quotaInfo(body)).toEqual({ retryAfterMs: 37000, daily: true });
  });
  it("speaks a short friendly message instead of Google's long text", () => {
    expect(friendlyGeminiError(new GeminiError(429, "You exceeded your current quota, please check your plan and billing details…"))).toMatch(/free Gemini AI limit/);
  });
});
