/**
 * Google sign-in with the USER'S OWN OAuth Client ID (chrome.identity.launchWebAuthFlow).
 * Every user creates their own Google Cloud project once (guided wizard), so there is
 * no shared 100-user limit and nobody depends on the extension author's project.
 *
 * - Access tokens are kept only in chrome.storage.session (memory, cleared when the browser closes).
 * - When a token expires it is renewed silently (prompt=none) in the background.
 */
import { IS_TEST, REVOKE_API, USERINFO_API } from "./env";
import { BASE_SCOPES, buildAuthUrl, CLIENT_ID_RE, GMAIL_SCOPE, parseRedirect, SCOPES } from "./oauth";
import { db } from "./store";

export class AuthError extends Error {
  constructor(public code: "NOT_SIGNED_IN" | "NO_CLIENT_ID" | "AUTH_FAILED", message: string) {
    super(message);
  }
}

export interface Account {
  email: string;
  name: string;
  picture: string;
}

interface Session {
  token: string;
  expiresAt: number;
}

export const redirectUri = () => (IS_TEST ? "https://test.chromiumapp.org/" : chrome.identity.getRedirectURL());

export async function clientIdConfigured(): Promise<boolean> {
  if (IS_TEST) return Boolean(await db.get("clientId"));
  const id = await db.get("clientId");
  return Boolean(id && CLIENT_ID_RE.test(id));
}

async function getSession(): Promise<Session | null> {
  const r = await chrome.storage.session.get("google");
  return (r.google as Session | undefined) ?? null;
}
const setSession = (s: Session | null) => (s ? chrome.storage.session.set({ google: s }) : chrome.storage.session.remove("google"));

function randomState(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

let renewing: Promise<string> | null = null;

async function runFlow(interactive: boolean): Promise<string> {
  const clientId = await db.get("clientId");
  if (!clientId) throw new AuthError("NO_CLIENT_ID", "Add your Google Client ID first (setup step 1).");
  if (IS_TEST) {
    const s = { token: `test-token-${clientId}`, expiresAt: Date.now() + 3600_000 };
    if (interactive) await db.set("grantedScopes", SCOPES);
    await setSession(s);
    return s.token;
  }
  const account = await db.get("account");
  const state = randomState();
  // Silent renewals must not ask for permissions the user hasn't given yet (Google would refuse).
  const granted = (await db.get("grantedScopes")) ?? [];
  const scopes = interactive ? SCOPES : granted.length ? SCOPES.filter((s) => granted.includes(s) || BASE_SCOPES.includes(s)) : BASE_SCOPES;
  const url = buildAuthUrl({ clientId, redirectUri: redirectUri(), state, interactive, loginHint: account?.email, scopes });
  let redirect: string | undefined;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url, interactive });
  } catch (err) {
    if (!interactive) throw new AuthError("NOT_SIGNED_IN", "Sign in again.");
    const msg = (err as Error).message || "";
    throw new AuthError("AUTH_FAILED", /did not approve|closed/i.test(msg) ? "Sign-in was cancelled." : `Google sign-in failed: ${msg}`);
  }
  if (!redirect) throw new AuthError(interactive ? "AUTH_FAILED" : "NOT_SIGNED_IN", "Google sign-in did not complete.");
  const r = parseRedirect(redirect, state);
  if (!r.ok) {
    if (!interactive) throw new AuthError("NOT_SIGNED_IN", "Sign in again.");
    if (r.error === "access_denied") throw new AuthError("AUTH_FAILED", "Access denied. Add your Gmail as a Test user in your Google Cloud project (wizard step 4), then try again.");
    if (r.error === "redirect_uri_mismatch") throw new AuthError("AUTH_FAILED", `Redirect URI mismatch. In your OAuth client add exactly: ${redirectUri()}`);
    throw new AuthError("AUTH_FAILED", `Google sign-in failed (${r.error}).`);
  }
  if (r.scopes.length && !r.scopes.includes(GMAIL_SCOPE)) {
    throw new AuthError("AUTH_FAILED", "Gmail permission was not granted. Sign in again and tick the Gmail checkbox.");
  }
  if (interactive) await db.set("grantedScopes", r.scopes.length ? r.scopes : SCOPES);
  await setSession({ token: r.token, expiresAt: r.expiresAt });
  return r.token;
}

/** Returns a valid access token, renewing it silently when needed. */
export async function getToken(interactive = false): Promise<string> {
  const s = await getSession();
  if (!interactive && s && s.expiresAt - 60_000 > Date.now()) return s.token;
  if (!interactive && !(await db.get("account"))) throw new AuthError("NOT_SIGNED_IN", "Not signed in");
  if (interactive) return runFlow(true);
  renewing ??= runFlow(false).finally(() => (renewing = null));
  return renewing;
}

/** fetch() with the user's Google token; renews once on 401. */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const go = (t: string) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
  let res = await go(await getToken(false));
  if (res.status === 401 && !IS_TEST) {
    await setSession(null);
    res = await go(await getToken(false));
  }
  return res;
}

export async function signIn(): Promise<Account> {
  const token = await getToken(true);
  const res = await fetch(USERINFO_API, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new AuthError("AUTH_FAILED", "Could not read your Google account.");
  const u = (await res.json()) as { email?: string; name?: string; picture?: string };
  const account: Account = { email: u.email ?? "", name: u.name ?? u.email ?? "", picture: u.picture ?? "" };
  const previous = await db.get("account");
  if (previous && previous.email !== account.email) await db.clearUserData(); // different person
  await db.set("account", account);
  return account;
}

/** Signs out, revokes Google access and deletes everything Vaani stored (Client ID is kept). */
export async function signOutAndDelete(): Promise<void> {
  const s = await getSession();
  if (s) await fetch(`${REVOKE_API}?token=${encodeURIComponent(s.token)}`, { method: "POST" }).catch(() => undefined);
  await setSession(null);
  await db.clearUserData();
  await db.remove("account");
  await db.remove("geminiKey");
  await db.remove("grantedScopes");
}

export async function setClientId(raw: string): Promise<void> {
  await db.set("clientId", raw);
  await setSession(null);
}
