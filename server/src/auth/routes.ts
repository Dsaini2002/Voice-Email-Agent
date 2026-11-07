import { randomBytes } from "node:crypto";
import { Router } from "express";
import { config, GMAIL_MODIFY, GMAIL_READONLY, isProd } from "../config.js";
import { encrypt } from "../crypto.js";
import { actions, emails, users } from "../db.js";
import { startInitialSync } from "../gmail/sync.js";
import { stopWatch } from "../gmail/watch.js";
import { buildAuthUrl, newOAuthClient, revokeUserToken } from "./google.js";
import { clearSession, requireAuth, requireSession, setSession } from "./session.js";

const STATE_COOKIE = "vm_oauth_state";

export const authRouter = Router();

/** Step 1: send the user to Google's consent screen. */
authRouter.get("/auth/google", (_req, res) => {
  const state = randomBytes(24).toString("hex"); // CSRF protection for the OAuth flow
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
  res.redirect(buildAuthUrl(state));
});

/** Step 2: Google redirects back here with a one-time code. */
authRouter.get("/auth/google/callback", async (req, res) => {
  const fail = (reason: string) => res.redirect(`${config.WEB_ORIGIN}/?error=${encodeURIComponent(reason)}`);
  try {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) return fail(error === "access_denied" ? "You cancelled the Google permission screen." : error);
    if (!code || !state || state !== req.cookies?.[STATE_COOKIE]) return fail("Sign-in could not be verified. Please try again.");
    res.clearCookie(STATE_COOKIE, { path: "/" });

    const oauth = newOAuthClient();
    const { tokens } = await oauth.getToken(code);

    // Google lets users untick individual permissions. Without Gmail access nothing works.
    const granted = tokens.scope?.split(" ") ?? [];
    const canModify = granted.includes(GMAIL_MODIFY);
    if (!canModify && !granted.includes(GMAIL_READONLY)) {
      return fail("Gmail permission is required. Tick the Gmail checkbox when signing in.");
    }
    if (!tokens.id_token) return fail("Google did not return an identity token.");

    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: config.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) return fail("Could not read your Google account details.");

    const existing = await users().findOne({ googleId: p.sub });
    const refreshToken = tokens.refresh_token;
    if (!refreshToken && !existing) return fail("Google did not return a refresh token. Remove this app under Google Account → Security → Third-party access, then sign in again.");

    const now = new Date();
    const result = await users().findOneAndUpdate(
      { googleId: p.sub },
      {
        $set: {
          email: p.email,
          name: p.name ?? p.email,
          picture: p.picture ?? "",
          canModify,
          updatedAt: now,
          ...(refreshToken ? { encRefreshToken: encrypt(refreshToken, config.ENCRYPTION_KEY) } : {}),
        },
        $setOnInsert: {
          googleId: p.sub,
          historyId: null,
          lastSyncAt: null,
          watchExpiration: null,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!result) return fail("Could not save your account.");

    setSession(res, result._id);
    // Start reading the inbox in the background — the user doesn't wait for it.
    void startInitialSync(result._id);
    res.redirect(`${config.WEB_ORIGIN}/`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    fail("Sign-in failed. Please try again.");
  }
});

authRouter.post("/auth/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await users().findOne({ _id: req.userId });
  if (!user) {
    clearSession(res);
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json({ email: user.email, name: user.name, picture: user.picture });
});

/** "Delete my data": revoke Google access and remove everything we stored. */
authRouter.delete("/account", requireSession, async (req, res) => {
  const user = await users().findOne({ _id: req.userId });
  if (user) {
    await stopWatch(user._id!).catch(() => undefined);
    await revokeUserToken(user.encRefreshToken);
    await emails().deleteMany({ userId: user._id });
    await actions().deleteMany({ userId: user._id });
    await users().deleteOne({ _id: user._id });
  }
  clearSession(res);
  res.json({ ok: true });
});
