import { describe, expect, it } from "vitest";
import { buildAuthUrl, CLIENT_ID_RE, normalizeClientId, parseRedirect } from "../src/bg/oauth";

describe("per-user Google OAuth", () => {
  it("accepts real-looking client IDs and rejects secrets/garbage", () => {
    expect(CLIENT_ID_RE.test("1234567890-abc123def.apps.googleusercontent.com")).toBe(true);
    expect(CLIENT_ID_RE.test(normalizeClientId(' "1234567890-abc123def.apps.googleusercontent.com" '))).toBe(true);
    expect(CLIENT_ID_RE.test("GOCSPX-abcdefghijklmnop")).toBe(false);
    expect(CLIENT_ID_RE.test("hello")).toBe(false);
  });

  it("builds an implicit-flow URL with the user's own client and a state", () => {
    const u = new URL(buildAuthUrl({ clientId: "1-a.apps.googleusercontent.com", redirectUri: "https://abc.chromiumapp.org/", state: "s1", interactive: true }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe("1-a.apps.googleusercontent.com");
    expect(u.searchParams.get("response_type")).toBe("token");
    expect(u.searchParams.get("scope")).toContain("gmail.modify");
    expect(u.searchParams.get("state")).toBe("s1");
    const silent = new URL(buildAuthUrl({ clientId: "x", redirectUri: "r", state: "s", interactive: false, loginHint: "a@b.c" }));
    expect(silent.searchParams.get("prompt")).toBe("none");
    expect(silent.searchParams.get("login_hint")).toBe("a@b.c");
  });

  it("parses the token and rejects a forged state", () => {
    const ok = parseRedirect("https://abc.chromiumapp.org/#state=s1&access_token=ya29.x&expires_in=3599&scope=https://www.googleapis.com/auth/gmail.modify%20email", "s1", 1000);
    expect(ok).toMatchObject({ ok: true, token: "ya29.x", expiresAt: 1000 + 3599 * 1000 });
    expect(parseRedirect("https://abc.chromiumapp.org/#state=evil&access_token=x", "s1")).toEqual({ ok: false, error: "state_mismatch" });
    expect(parseRedirect("https://abc.chromiumapp.org/#state=s1&error=access_denied", "s1")).toEqual({ ok: false, error: "access_denied" });
  });
});

import { looksLikeGeminiKey } from "../src/bg/ai";
describe("Gemini key format", () => {
  it("accepts classic AIza keys and new AQ. auth keys", () => {
    expect(looksLikeGeminiKey("AI" + "za" + "x".repeat(35))).toBe(true);
    expect(looksLikeGeminiKey("AQ" + ".Ab8R" + "x".repeat(50) + "-_")).toBe(true);
    expect(looksLikeGeminiKey("not a key")).toBe(false);
    expect(looksLikeGeminiKey("short")).toBe(false);
  });
});
