/**
 * Endpoints. Test builds (VAANI_TEST=1) point everything at a local mock server
 * so the whole extension can be tested without real Google accounts.
 */
declare const __TEST__: boolean;
const TEST = typeof __TEST__ !== "undefined" && __TEST__;
const MOCK = "http://localhost:5199";

export const IS_TEST = TEST;
export const GMAIL_API = TEST ? `${MOCK}/gmail/v1/users/me` : "https://gmail.googleapis.com/gmail/v1/users/me";
export const USERINFO_API = TEST ? `${MOCK}/oauth2/v3/userinfo` : "https://www.googleapis.com/oauth2/v3/userinfo";
export const REVOKE_API = TEST ? `${MOCK}/revoke` : "https://oauth2.googleapis.com/revoke";
export const GEMINI_API = TEST ? `${MOCK}/v1beta` : "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_MODEL = "gemini-flash-latest";

export const INITIAL_SYNC_DAYS = 7;
export const INITIAL_SYNC_MAX = 150;
export const RETENTION_DAYS = 30;
export const GEMINI_MIN_INTERVAL_MS = TEST ? 0 : 4000;
