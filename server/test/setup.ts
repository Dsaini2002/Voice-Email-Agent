// Dummy configuration so tests run without real credentials.
process.env.GOOGLE_CLIENT_ID ??= "test-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET ??= "test-secret";
process.env.GOOGLE_REDIRECT_URI ??= "http://localhost:5173/api/auth/google/callback";
process.env.ENCRYPTION_KEY ??= "0123456789abcdef".repeat(4);
process.env.SESSION_SECRET ??= "test-session-secret-which-is-long-enough-123";
process.env.GEMINI_MIN_INTERVAL_MS ??= "0";
