import { describe, expect, it } from "vitest";
import { matchEntity, parseCommand } from "../src/gmail/commands";

const entities = ["TCS", "Infosys", "HDFC Bank", "Amazon", "Mom", "Global Jobs"];
const p = (s: string) => parseCommand(s, entities);

describe("voice command parser", () => {
  it("opens Gmail folders in the same tab (English + Hinglish, mis-heard 'span')", () => {
    expect(p("open spam")).toEqual({ type: "folder", folder: "spam" });
    expect(p("Vaani span open karo")).toEqual({ type: "folder", folder: "spam" });
    expect(p("spam kholo")).toEqual({ type: "folder", folder: "spam" });
    expect(p("go to sent")).toEqual({ type: "folder", folder: "sent" });
    expect(p("inbox")).toEqual({ type: "folder", folder: "inbox" });
    expect(p("show promotions")).toEqual({ type: "folder", folder: "promotions" });
  });

  it("deletes all spam with one command", () => {
    expect(p("delete all spam")).toEqual({ type: "trashSpam" });
    expect(p("spam ke saare message delete karo")).toEqual({ type: "trashSpam" });
    expect(p("span ke sare message delete karo")).toEqual({ type: "trashSpam" });
    expect(p("clear my spam folder")).toEqual({ type: "trashSpam" });
    expect(p("spam saaf karo")).toEqual({ type: "trashSpam" });
  });

  it("handles confirm / cancel / undo / stop / close", () => {
    expect(p("confirm")).toEqual({ type: "confirm" });
    expect(p("haan")).toEqual({ type: "confirm" });
    expect(p("yes do it")).toEqual({ type: "confirm" });
    expect(p("cancel")).toEqual({ type: "cancel" });
    expect(p("nahi")).toEqual({ type: "cancel" });
    expect(p("undo")).toEqual({ type: "undo" });
    expect(p("stop")).toEqual({ type: "stop" });
    expect(p("ruko")).toEqual({ type: "stop" });
    expect(p("close")).toEqual({ type: "close" });
    expect(p("band karo")).toEqual({ type: "close" });
    expect(p("back to list")).toEqual({ type: "summary" });
  });

  it("summary, full window, filters", () => {
    expect(p("give me today's summary")).toEqual({ type: "summary" });
    expect(p("what's important today")).toEqual({ type: "summary" });
    expect(p("aaj ka summary batao")).toEqual({ type: "summary" });
    expect(p("open full window")).toEqual({ type: "full" });
    expect(p("show interview emails")).toEqual({ type: "filter", key: "interview" });
    expect(p("interview wale message dikhao")).toEqual({ type: "filter", key: "interview" });
    expect(p("show rejections")).toEqual({ type: "filter", key: "rejected" });
    expect(p("which emails need my action")).toEqual({ type: "filter", key: "action" });
    expect(p("show scam emails")).toEqual({ type: "filter", key: "security" });
  });

  it("a company name opens that email (beats the generic filter)", () => {
    expect(p("show the TCS interview email")).toEqual({ type: "focus", entity: "TCS" });
    expect(p("TCS ka interview message dikhao")).toEqual({ type: "focus", entity: "TCS" });
    expect(p("open the hdfc email")).toEqual({ type: "focus", entity: "HDFC Bank" });
    expect(p("open it in gmail")).toEqual({ type: "openCurrent" });
  });

  it("search and free questions", () => {
    expect(p("search internship stipend")).toEqual({ type: "search", query: "internship stipend" });
    expect(p("how many emails did I get from LinkedIn")).toEqual({ type: "ask", text: "how many emails did I get from LinkedIn" });
  });

  it("entity matching is whole-word only", () => {
    expect(matchEntity("show tcs email", entities)).toBe("TCS");
    expect(matchEntity("statistics please", ["TCS"])).toBeNull();
  });
});
