import { describe, expect, it } from "vitest";
import { parseDateRange, parseFind } from "../src/gmail/dates";

const today = new Date(2026, 10, 17); // 17 Nov 2026

describe("spoken dates → Gmail search", () => {
  it("25 oct ka message dikhao", () => {
    expect(parseFind("25 oct ka message dikhao", today)?.query).toBe("after:2026/10/25 before:2026/10/26");
  });
  it("other date styles", () => {
    expect(parseFind("show emails from October 25th", today)?.query).toBe("after:2026/10/25 before:2026/10/26");
    expect(parseFind("25/10 ke mail", today)?.query).toBe("after:2026/10/25 before:2026/10/26");
    expect(parseFind("emails on 3rd of january 2025", today)?.query).toBe("after:2025/01/03 before:2025/01/04");
  });
  it("a date later this year means last year", () => {
    expect(parseDateRange("20 dec ka mail", today)?.from.getFullYear()).toBe(2025);
  });
  it("yesterday / today / last week", () => {
    expect(parseFind("yesterday ke emails", today)?.query).toBe("after:2026/11/16 before:2026/11/17");
    expect(parseFind("aaj ke mail dikhao", today)?.query).toBe("after:2026/11/17 before:2026/11/18");
    expect(parseFind("last week ke emails", today)?.query).toBe("after:2026/11/10 before:2026/11/18");
  });
  it("unread, attachments, from", () => {
    expect(parseFind("show unread emails", today)?.query).toBe("is:unread");
    expect(parseFind("emails with attachments from yesterday", today)?.query).toBe("after:2026/11/16 before:2026/11/17 has:attachment");
    expect(parseFind("25 oct emails from naukri", today)?.query).toBe("after:2026/10/25 before:2026/10/26 from:naukri");
  });
  it("ignores sentences without a date or filter", () => {
    expect(parseFind("open inbox", today)).toBeNull();
    expect(parseFind("give me today's summary".replace("today's", "the"), today)).toBeNull();
  });
});
