import { describe, expect, it } from "vitest";
import { cleanName, matchWake, nameProblem } from "../src/gmail/wake";

describe("wake word follows the chosen name", () => {
  it("Vaani and the ways recognisers spell it", () => {
    expect(matchWake("Vaani open inbox", "Vaani")).toBe("open inbox");
    expect(matchWake("hey vani, give me today's summary", "Vaani")).toBe("give me today's summary");
    expect(matchWake("bunny open spam", "Vaani")).toBe("open spam");
    expect(matchWake("open inbox", "Vaani")).toBeNull();
  });
  it("custom names, matched by sound", () => {
    expect(matchWake("Nova open inbox", "Nova")).toBe("open inbox");
    expect(matchWake("jarviss what's new", "Jarvis")).toBe("what's new");
    expect(matchWake("Aria", "Aria")).toBe("");
    expect(matchWake("Mary open inbox", "Nova")).toBeNull();
    expect(matchWake("Captain Max show unread emails", "Captain Max")).toBe("show unread emails");
  });
  it("understands how people say the name", () => {
    expect(cleanName("call you Nova")).toBe("Nova");
    expect(cleanName("your name is aria.")).toBe("Aria");
    expect(cleanName("tumhara naam Zara rakho")).toBe("Zara");
    expect(nameProblem("ok")).not.toBeNull();
    expect(nameProblem("Nova")).toBeNull();
  });
});

describe("wake word, said naturally", () => {
  it("name after a filler word", () => {
    expect(matchWake("arre Vaani inbox kholo", "Vaani")).toBe("inbox kholo");
    expect(matchWake("ok so Nova open spam", "Nova")).toBe("open spam");
    expect(matchWake("please Nova show my notes", "Nova")).toBe("show my notes");
  });
  it("small mishearing of a 4-letter name", () => {
    expect(matchWake("noba open inbox", "Nova")).toBe("open inbox");
    expect(matchWake("lova open inbox", "Nova")).toBeNull();
    expect(matchWake("now open inbox", "Nova")).toBeNull();
  });
  it("name in the middle of normal talk is not a wake word", () => {
    expect(matchWake("I told Nova about it", "Nova")).toBeNull();
  });
});
