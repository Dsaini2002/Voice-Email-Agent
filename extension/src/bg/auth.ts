/**
 * Google sign-in with chrome.identity — no server, no .env.
 * The extension owner puts ONE OAuth client ID in manifest.json; every user just
 * clicks "Sign in with Google". Tokens are managed (and refreshed) by Chrome.
 */
import { IS_TEST, REVOKE_API, USERINFO_API } from "./env";
import { db } from "./store";

const PLACEHOLDER = /PASTE_YOUR_CLIENT_ID/;

export function clientIdConfigured(): boolean {
  if (IS_TEST) return true;
  const id = chrome.runtime.getManifest().oauth2?.client_id ?? "";
  return Boolean(id) && !PLACEHOLDER.test(id);
}

export class AuthError extends Error {
  constructor(public code: "NOT_SIGNED_IN" | "NO_CLIENT_ID" | "AUTH_FAILED", message: string) {
    super(message);
  }
}

async function getToken(interactive: boolean): Promise<string> {
  if (IS_TEST) {
    if (!interactive && !(await db.get("account"))) throw new AuthError("NOT_SIGNED_IN", "Not signed in");
    return "test-token";
  }
  if (!clientIdConfigured()) {
    throw new AuthError("NO_CLIENT_ID", "This copy of Vaani has no Google Client ID yet. The person who shared it must add one (see README → Owner setup).");
  }
  try {
    const r = (await chrome.identity.getAuthToken({ interactive })) as unknown as { token?: string } | string | undefined;
    const token = typeof r === "string" ? r : r?.token;
    if (!token) throw new Error("No token");
    return token;
  } catch (err) {
    if (!interactive) throw new AuthError("NOT_SIGNED_IN", "Not signed in");
    throw new AuthError("AUTH_FAILED", `Google sign-in did not complete: ${(err as Error).message}`);
  }
}

/** fetch() with the user's Google token; refreshes once on 401. */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let token = await getToken(false);
  const go = (t: string) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
  let res = await go(token);
  if (res.status === 401 && !IS_TEST) {
    await chrome.identity.removeCachedAuthToken({ token });
    token = await getToken(false);
    res = await go(token);
  }
  return res;
}

export interface Account {
  email: string;
  name: string;
  picture: string;
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

/** Signs out, revokes Google access and deletes everything Vaani stored. */
export async function signOutAndDelete(): Promise<void> {
  try {
    const token = await getToken(false);
    await fetch(`${REVOKE_API}?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
    if (!IS_TEST) await chrome.identity.removeCachedAuthToken({ token });
  } catch {
    /* not signed in */
  }
  await db.clearUserData();
  await db.remove("account");
  await db.remove("geminiKey");
}
