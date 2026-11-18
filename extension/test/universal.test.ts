import { describe, expect, it } from "vitest";
import { guessIntent, toAnalyses } from "../../server/src/ai/classifyCore";

const batch = [
  { id: "a", from: "Rahul <r@x.com>", subject: "Need a favour", date: "2026-11-18", gmailLabels: [], body: "Hi, could you please review my resume before Friday? Thanks" },
  { id: "b", from: "Spammy <s@x.com>", subject: "Hello", date: "2026-11-18", gmailLabels: [], body: "Our newsletter for November." },
];
const r = (o: Record<string, unknown>) => ({ category: "personal", status: "none", priority: "high", entity: "Rahul", groupKey: "", summary: "s", actionRequired: false, actionText: "", deadline: "", isScam: false, scamReason: "", confidence: 0.9, ask: "", tags: [], needsReply: true, fromPerson: true, ...o });

describe("universal understanding (for everyone)", () => {
  it("a proven help request stays a help request", () => {
    const a = toAnalyses({ results: [r({ id: "a", intent: "help_request", evidence: "could you please review my resume before Friday?", ask: "Rahul wants you to review his resume by Friday" })] }, batch).get("a")!;
    expect(a).toMatchObject({ intent: "help_request", verified: true, needsReply: true, ask: "Rahul wants you to review his resume by Friday" });
  });
  it("an unproven 'help request' is downgraded (no made-up favours)", () => {
    const a = toAnalyses({ results: [r({ id: "b", intent: "help_request", evidence: "please help me urgently", ask: "Wants help" })] }, batch).get("b")!;
    expect(a).toMatchObject({ intent: "update", verified: false, needsReply: false, ask: "" });
  });
  it("older analyses without an intent get a sensible one", () => {
    expect(guessIntent({ category: "finance", status: "none", isScam: false, actionRequired: false })).toBe("payment");
    expect(guessIntent({ category: "other", status: "interview", isScam: false, actionRequired: false })).toBe("job");
    expect(guessIntent({ category: "other", status: "none", isScam: true, actionRequired: false })).toBe("security");
  });
});
