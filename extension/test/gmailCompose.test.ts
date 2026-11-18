import { describe, expect, it } from "vitest";
import { spokenToText } from "../src/gmail/gmailCompose";

describe("dictation punctuation", () => {
  it("turns spoken punctuation into text", () => {
    expect(spokenToText("hi rahul comma thanks for the invite full stop i will join new line regards")).toBe("Hi rahul, thanks for the invite. I will join\nRegards");
    expect(spokenToText("can we meet tomorrow question mark")).toBe("Can we meet tomorrow?");
  });
});

import { parseWriteHere, parseBoxChange } from "../src/gmail/gmailCompose";
describe("writing in Gmail's own box — what the user means", () => {
  it("subject + what to say", () => {
    expect(parseWriteHere("vocations ke upar likho mereee ko 10 din ki chutti chahiye")).toEqual({ subject: "vocations", topic: "mereee ko 10 din ki chutti chahiye", dictate: false });
    expect(parseWriteHere("leave ke baare mein mail likho ki main 2 din nahi aaunga")).toEqual({ subject: "leave", topic: "main 2 din nahi aaunga", dictate: false });
    expect(parseWriteHere("write a mail about the project saying it is on track")).toEqual({ subject: "the project", topic: "it is on track", dictate: false });
  });
  it("just what to say", () => {
    expect(parseWriteHere("isme likho ki main kal office nahi aaunga")?.topic).toBe("main kal office nahi aaunga");
    expect(parseWriteHere("write that I need 10 days leave")?.topic).toBe("I need 10 days leave");
    expect(parseWriteHere("likho mujhe 10 din ki chutti chahiye")?.topic).toBe("mujhe 10 din ki chutti chahiye");
    expect(parseWriteHere("write a leave application for 10 days")?.topic).toBe("a leave application for 10 days");
    expect(parseWriteHere("mujhe 10 din ki chutti chahiye ye likho")?.topic).toBe("mujhe 10 din ki chutti chahiye");
  });
  it("exact words", () => {
    expect(parseWriteHere("type: see you tomorrow")).toEqual({ subject: "", topic: "see you tomorrow", dictate: true });
  });
  it("not a write request", () => {
    expect(parseWriteHere("open spam")).toBeNull();
    expect(parseWriteHere("how are you")).toBeNull();
    expect(parseWriteHere("send it")).toBeNull();
  });
  it("changes", () => {
    expect(parseBoxChange("make it shorter")).toBeTruthy();
    expect(parseBoxChange("thoda formal karo")).toBeTruthy();
    expect(parseBoxChange("also mention I'll call tomorrow")).toBeTruthy();
    expect(parseBoxChange("open inbox")).toBeNull();
  });
});
