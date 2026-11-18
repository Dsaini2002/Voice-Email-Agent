import { describe, expect, it } from "vitest";
import { smallTalk } from "../src/gmail/smalltalk";

describe("small talk", () => {
  it("answers how are you, in English and Hinglish", () => {
    expect(smallTalk("how are you")?.reply).toMatch(/great|good/i);
    expect(smallTalk("Vaani kaise ho")?.reply).toMatch(/great|good/i);
    expect(smallTalk("how are you", "Dinesh")?.reply).toContain("Dinesh");
  });
  it("greetings, thanks, identity, bye", () => {
    expect(smallTalk("hello")).not.toBeNull();
    expect(smallTalk("thank you so much")?.reply).toMatch(/welcome|anytime/i);
    expect(smallTalk("who are you")?.reply).toContain("Vaani");
    expect(smallTalk("i am fine")).not.toBeNull();
    expect(smallTalk("bye")).not.toBeNull();
  });
  it("leaves email requests alone", () => {
    expect(smallTalk("open inbox")).toBeNull();
    expect(smallTalk("show interview emails")).toBeNull();
    expect(smallTalk("how many rejections this week")).toBeNull();
    expect(smallTalk("reply to TCS saying thank you")).toBeNull();
  });
});
