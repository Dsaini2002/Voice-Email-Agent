/** Pure helpers for the Google OAuth (implicit) flow — unit tested. */

export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];
export const GMAIL_SCOPE = SCOPES[0];

/** A Google OAuth client ID looks like 1234567890-abc123.apps.googleusercontent.com */
export const CLIENT_ID_RE = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

export function normalizeClientId(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "");
}

export function buildAuthUrl(opts: { clientId: string; redirectUri: string; state: string; interactive: boolean; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    response_type: "token",
    redirect_uri: opts.redirectUri,
    scope: SCOPES.join(" "),
    include_granted_scopes: "true",
    state: opts.state,
    prompt: opts.interactive ? "consent select_account" : "none",
  });
  if (opts.loginHint) q.set("login_hint", opts.loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export type AuthResult =
  | { ok: true; token: string; expiresAt: number; scopes: string[] }
  | { ok: false; error: string };

/** Reads the token (or error) from the redirect URL fragment and checks the CSRF state. */
export function parseRedirect(url: string, expectedState: string, now = Date.now()): AuthResult {
  const hash = url.includes("#") ? url.slice(url.indexOf("#") + 1) : url.slice(url.indexOf("?") + 1);
  const p = new URLSearchParams(hash);
  if (p.get("state") !== expectedState) return { ok: false, error: "state_mismatch" };
  const error = p.get("error");
  if (error) return { ok: false, error };
  const token = p.get("access_token");
  if (!token) return { ok: false, error: "no_token" };
  const expiresIn = Number(p.get("expires_in") ?? 3600);
  return { ok: true, token, expiresAt: now + expiresIn * 1000, scopes: (p.get("scope") ?? "").split(" ").filter(Boolean) };
}
