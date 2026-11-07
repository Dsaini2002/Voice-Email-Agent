import { google } from "googleapis";
import type { ObjectId } from "mongodb";
import { config, GOOGLE_SCOPES } from "../config.js";
import { decrypt } from "../crypto.js";
import { users } from "../db.js";

export function newOAuthClient() {
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI,
  );
}

export function buildAuthUrl(state: string): string {
  return newOAuthClient().generateAuthUrl({
    access_type: "offline", // we need a refresh token for background sync
    prompt: "consent",
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  });
}

/** Returns an authenticated Gmail client for a stored user. */
export async function gmailForUser(userId: ObjectId) {
  const user = await users().findOne({ _id: userId });
  if (!user) throw new Error("User not found");
  const auth = newOAuthClient();
  auth.setCredentials({ refresh_token: decrypt(user.encRefreshToken, config.ENCRYPTION_KEY) });
  return google.gmail({ version: "v1", auth });
}

/** Revokes Google access for a user (used by "Delete my data"). */
export async function revokeUserToken(encRefreshToken: string): Promise<void> {
  const auth = newOAuthClient();
  try {
    await auth.revokeToken(decrypt(encRefreshToken, config.ENCRYPTION_KEY));
  } catch (err) {
    console.warn("Token revoke failed (may already be revoked):", (err as Error).message);
  }
}
