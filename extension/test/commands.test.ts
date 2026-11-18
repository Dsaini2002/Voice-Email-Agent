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
    expect(p("sign in")).toEqual({ type: "setup" });
    expect(p("open settings")).toEqual({ type: "ask", text: "open settings" });
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
    expect(p("how many emails did I get from LinkedIn")).toEqual({ type: "count", status: "", category: "", period: "all", what: "email", from: "linkedin" });
  });

  it("entity matching is whole-word only", () => {
    expect(matchEntity("show tcs email", entities)).toBe("TCS");
    expect(matchEntity("statistics please", ["TCS"])).toBeNull();
  });
});

describe("Phase 2 commands", () => {
  const known = ["TCS", "Infosys", "Wipro"];
  it("understands replies with and without a message", () => {
    expect(parseCommand("reply to TCS saying I will attend on Monday", known)).toEqual({ type: "reply", entity: "TCS", intent: "I will attend on Monday" });
    expect(parseCommand("Infosys ko reply karo ki main kal aaunga", known)).toEqual({ type: "reply", entity: "Infosys", intent: "main kal aaunga" });
    expect(parseCommand("iska reply do", known)).toEqual({ type: "reply", entity: null, intent: "" });
    expect(parseCommand("reply to Wipro", known)).toEqual({ type: "reply", entity: "Wipro", intent: "" });
  });
  it("does not treat questions about replies as reply commands", () => {
    expect(parseCommand("did TCS reply to me", known).type).not.toBe("reply");
  });
  it("send / draft / voice", () => {
    expect(parseCommand("send it").type).toBe("send");
    expect(parseCommand("haan bhej do").type).toBe("send");
    expect(parseCommand("save it as a draft").type).toBe("saveDraft");
    expect(parseCommand("change your voice")).toEqual({ type: "voice", action: "open" });
    expect(parseCommand("awaaz badlo")).toEqual({ type: "voice", action: "open" });
    expect(parseCommand("next voice")).toEqual({ type: "voice", action: "next" });
  });
});

describe("dates and searches", () => {
  it("routes dates to a Gmail search, but keeps today's summary", () => {
    expect(parseCommand("25 oct ka message dikhao").type).toBe("find");
    expect(parseCommand("show unread emails").type).toBe("find");
    expect(parseCommand("give me today's summary").type).toBe("summary");
    expect(parseCommand("aaj ka summary batao").type).toBe("summary");
    expect(parseCommand("open starred").type).toBe("folder");
  });
});

describe("v2 commands", () => {
  it("rename + speed", () => {
    expect(parseCommand("change your name to nova")).toEqual({ type: "rename", name: "Nova" });
    expect(parseCommand("tumhara naam Zara rakho")).toEqual({ type: "rename", name: "Zara" });
    expect(parseCommand("speak faster")).toEqual({ type: "rate", delta: 0.1 });
    expect(parseCommand("thoda dheere bolo")).toEqual({ type: "rate", delta: -0.1 });
  });
  it("compose", () => {
    expect(parseCommand("compose kholo")).toEqual({ type: "compose", to: "", topic: "", gmail: true });
    expect(parseCommand("write an email to Rahul about the project deadline")).toEqual({ type: "compose", to: "Rahul", topic: "the project deadline", gmail: false });
    expect(parseCommand("Priya ko mail bhejo ki main kal late aaunga")).toEqual({ type: "compose", to: "Priya", topic: "main kal late aaunga", gmail: false });
    expect(parseCommand("new email").type).toBe("compose");
  });
  it("organise emails", () => {
    expect(parseCommand("archive it")).toEqual({ type: "gmailAct", act: "archive" });
    expect(parseCommand("mark as read")).toEqual({ type: "gmailAct", act: "read" });
    expect(parseCommand("mark it as unread")).toEqual({ type: "gmailAct", act: "unread" });
    expect(parseCommand("star this email")).toEqual({ type: "gmailAct", act: "star" });
    expect(parseCommand("delete this email")).toEqual({ type: "gmailAct", act: "trash" });
    expect(parseCommand("delete all spam").type).toBe("trashSpam");
    expect(parseCommand("mark all as read")).toEqual({ type: "readAll" });
  });
  it("calendar + notes", () => {
    expect(parseCommand("what's on my calendar today").type).toBe("calendar");
    expect((parseCommand("kal ka schedule batao") as { label: string }).label).toBe("tomorrow");
    expect(parseCommand("add a meeting with Rahul to my calendar tomorrow at 3").type).toBe("ask"); // AI works out the time
    expect(parseCommand("note: buy milk")).toEqual({ type: "noteAdd", text: "buy milk" });
    expect(parseCommand("resume update karna hai note kar lo")).toEqual({ type: "noteAdd", text: "resume update karna hai" });
    expect(parseCommand("show my notes")).toEqual({ type: "notesList" });
  });
});

describe("SQLite history commands", () => {
  it("counts", () => {
    expect(parseCommand("is mahine kitne interview aaye")).toEqual({ type: "count", status: "interview", category: "", period: "month", what: "interview", from: "" });
    expect(parseCommand("how many rejections last month")).toMatchObject({ type: "count", status: "rejected", period: "last_month" });
    expect(parseCommand("how many emails today")).toMatchObject({ type: "count", status: "", period: "today", what: "email" });
    expect(parseCommand("kitne offers aaye ab tak")).toMatchObject({ type: "count", status: "offer", period: "all" });
  });
  it("tracker + journey", () => {
    expect(parseCommand("show my job tracker")).toEqual({ type: "tracker", entity: "" });
    expect(parseCommand("TCS ka status kya hai", ["TCS"])).toEqual({ type: "tracker", entity: "TCS" });
    expect(parseCommand("what's the status of my Infosys application")).toEqual({ type: "tracker", entity: "Infosys" });
  });
  it("history search, stats, activity, export", () => {
    expect(parseCommand("search my history for offer letter")).toEqual({ type: "history", query: "offer letter" });
    expect(parseCommand("purane emails mein amazon dhundo")).toEqual({ type: "history", query: "amazon" });
    expect(parseCommand("show my stats")).toEqual({ type: "stats", period: "month" });
    expect(parseCommand("what did you do today")).toEqual({ type: "activity", days: 0 });
    expect(parseCommand("export my applications to csv")).toEqual({ type: "export" });
  });
  it("still leaves normal commands alone", () => {
    expect(parseCommand("show interview emails").type).toBe("filter");
    expect(parseCommand("give me today's summary").type).toBe("summary");
  });
});

describe("for everyone (v2.2)", () => {
  it("who asked me for help / questions / bills", () => {
    expect(parseCommand("kisi ne aaj help maangi hai")).toEqual({ type: "intentList", intents: ["help_request"], period: "today", label: "help requests" });
    expect(parseCommand("any questions for me this week")).toMatchObject({ type: "intentList", intents: ["question"], period: "week" });
    expect(parseCommand("show my bills")).toMatchObject({ type: "intentList", intents: ["payment"] });
    expect(parseCommand("koi order aaya")).toMatchObject({ type: "intentList", intents: ["order"] });
  });
  it("alerts", () => {
    expect(parseCommand("jab bhi koi help maange mujhe batana")).toMatchObject({ type: "watch", kind: "intent", value: "help_request" });
    expect(parseCommand("tell me whenever an interview email comes")).toMatchObject({ type: "watch", kind: "status", value: "interview" });
    expect(parseCommand("notify me when TCS emails", ["TCS"])).toMatchObject({ type: "watch", kind: "sender", value: "tcs" });
    expect(parseCommand("show my alerts")).toEqual({ type: "watchList" });
    expect(parseCommand("stop all alerts")).toEqual({ type: "unwatch" });
  });
  it("reports, pending, follow-up, import", () => {
    expect(parseCommand("what's pending")).toEqual({ type: "pending", minDays: 0 });
    expect(parseCommand("jinka reply nahi diya woh dikhao")).toMatchObject({ type: "pending" });
    expect(parseCommand("show my job funnel")).toEqual({ type: "funnel" });
    expect(parseCommand("which companies ghosted me")).toEqual({ type: "ghosting" });
    expect(parseCommand("follow up with TCS", ["TCS"])).toEqual({ type: "followUp", entity: "TCS" });
    expect(parseCommand("kaunsi company kitne din mein reply karti hai")).toEqual({ type: "responseTime" });
    expect(parseCommand("give me the weekly report")).toEqual({ type: "weekly" });
    expect(parseCommand("upcoming deadlines")).toEqual({ type: "deadlines" });
    expect(parseCommand("show my contacts")).toEqual({ type: "contacts" });
    expect(parseCommand("import my old emails from last 3 months")).toEqual({ type: "import", months: 3 });
    expect(parseCommand("purane emails import karo")).toEqual({ type: "import", months: 6 });
  });
  it("doesn't steal older commands", () => {
    expect(parseCommand("show my notes").type).toBe("notesList");
    expect(parseCommand("show interview emails").type).toBe("filter");
    expect(parseCommand("show my stats").type).toBe("stats");
    expect(parseCommand("delete all spam").type).toBe("trashSpam");
    expect(parseCommand("is mahine kitne interview aaye").type).toBe("count");
  });
});

describe("names don't hijack other commands", () => {
  const known = ["Rahul Verma", "TCS"];
  it("calendar with a known person goes to the AI, opening still works", () => {
    expect(parseCommand("add a meeting with Rahul to my calendar tomorrow at 3 pm", known).type).toBe("ask");
    expect(parseCommand("open Rahul's email", known)).toEqual({ type: "focus", entity: "Rahul Verma" });
    expect(parseCommand("TCS ka interview message dikhao", known)).toEqual({ type: "focus", entity: "TCS" });
    expect(parseCommand("TCS", known)).toEqual({ type: "focus", entity: "TCS" });
  });
});

describe("everything in Gmail's left sidebar + labels", () => {
  const f = (s: string) => parseCommand(s);
  it("every sidebar item opens", () => {
    for (const [said, folder] of [
      ["open promotions", "promotions"], ["promotions kholo", "promotions"], ["open important", "important"], ["purchases dikhao", "purchases"],
      ["open scheduled", "scheduled"], ["all mail kholo", "all"], ["open snoozed", "snoozed"], ["open forums", "forums"], ["open social", "social"],
      ["open updates", "updates"], ["manage subscriptions", "subscriptions"], ["open manage labels", "labels"], ["open gmail settings", "settings"],
      ["open starred", "starred"], ["open drafts", "drafts"], ["open sent", "sent"], ["open trash", "trash"], ["open chats", "chats"],
    ] as const) expect(f(said)).toEqual({ type: "folder", folder });
  });
  it("labels: open, create, apply", () => {
    expect(parseCommand("IMPORTANT MAIL label kholo", [], ["IMPORTANT MAIL"])).toEqual({ type: "label", name: "IMPORTANT MAIL" });
    expect(parseCommand("open important mail", [], ["IMPORTANT MAIL"])).toEqual({ type: "label", name: "IMPORTANT MAIL" });
    expect(f("open label Projects")).toEqual({ type: "label", name: "Projects" });
    expect(f("create a new label called Jobs")).toEqual({ type: "createLabel", name: "Jobs" });
    expect(f("create new label")).toEqual({ type: "createLabel", name: "" });
    expect(f("label this as Jobs")).toEqual({ type: "applyLabel", name: "Jobs" });
    expect(f("move this to Projects")).toEqual({ type: "applyLabel", name: "Projects" });
    expect(f("isko Jobs label mein daalo")).toEqual({ type: "applyLabel", name: "Jobs" });
  });
  it("older commands still win", () => {
    expect(f("mark as important")).toEqual({ type: "gmailAct", act: "important" });
    expect(f("delete all spam").type).toBe("trashSpam");
    expect(f("settings").type).toBe("setup");
  });
});

describe("subtitles on / off", () => {
  it("by voice", () => {
    expect(parseCommand("subtitles off")).toEqual({ type: "subtitles", on: false });
    expect(parseCommand("subtitle band karo")).toEqual({ type: "subtitles", on: false });
    expect(parseCommand("stop subtitles")).toEqual({ type: "subtitles", on: false });
    expect(parseCommand("captions on")).toEqual({ type: "subtitles", on: true });
    expect(parseCommand("subtitle dikhao")).toEqual({ type: "subtitles", on: true });
    expect(parseCommand("stop").type).toBe("stop");
  });
});

describe("open Gmail's own compose", () => {
  it("any way you say it", () => {
    for (const s of ["open the gmail compose", "open gmail compose", "gmail compose kholo", "compose kholo", "open compose", "compose window open karo", "Open the compose window"])
      expect(parseCommand(s)).toEqual({ type: "compose", to: "", topic: "", gmail: true });
  });
});
