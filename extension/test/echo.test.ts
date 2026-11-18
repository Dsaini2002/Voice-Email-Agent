import { describe, expect, it } from "vitest";
import { echoShare } from "../src/gmail/speech";

describe("own voice through the speakers", () => {
  const said = "Here's your summary for today. You have 3 interview emails. Shall I send it? Say send or cancel.";
  it("recognises its own words even when the mic changes them a bit", () => {
    expect(echoShare("here's your sammary for today", said)).toBeGreaterThanOrEqual(0.5);
    expect(echoShare("you have three interview email", said)).toBeGreaterThanOrEqual(0.5);
    expect(echoShare("send", said)).toBe(1);
  });
  it("different words are the user", () => {
    expect(echoShare("open my spam folder please", said)).toBeLessThan(0.35);
    expect(echoShare("reply to rahul", said)).toBeLessThan(0.5);
  });
});

describe("word order matters", () => {
  it("a new command made of words it once said is still the user", () => {
    const said = "You have 3 new emails in your inbox. Want me to open the first one?";
    expect(echoShare("open inbox", said)).toBeLessThan(0.5);
    expect(echoShare("open spam", said)).toBeLessThan(0.35);
    expect(echoShare("new emails in your inbox", said)).toBe(1);
    expect(echoShare("new email in your inbox", said)).toBeGreaterThanOrEqual(0.5);
  });
});
