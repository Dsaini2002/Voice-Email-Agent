import "dotenv/config";
import { z } from "zod";

const hex64 = /^[0-9a-fA-F]{64}$/;

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  NODE_ENV: z.string().default("development"),

  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  GOOGLE_REDIRECT_URI: z.string().url(),

  // Each user brings their own Gemini key (saved encrypted from the dashboard).
  // GEMINI_API_KEY is only used when ALLOW_SERVER_GEMINI_KEY=true (personal / self-host use).
  GEMINI_API_KEY: z.string().optional().default(""),
  ALLOW_SERVER_GEMINI_KEY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  GEMINI_MODEL: z.string().default("gemini-flash-latest"),
  GEMINI_MIN_INTERVAL_MS: z.coerce.number().default(4000),

  MONGODB_URI: z.string().default("mongodb://localhost:27017"),
  MONGODB_DB: z.string().default("vaanimail"),

  ENCRYPTION_KEY: z.string().regex(hex64, "ENCRYPTION_KEY must be 64 hex characters"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),

  SYNC_MODE: z.enum(["poll", "pubsub"]).default("poll"),
  POLL_INTERVAL_SEC: z.coerce.number().min(15).default(60),
  INITIAL_SYNC_DAYS: z.coerce.number().min(1).max(30).default(7),
  INITIAL_SYNC_MAX: z.coerce.number().min(10).max(500).default(150),

  GMAIL_PUBSUB_TOPIC: z.string().optional().default(""),
  PUBSUB_VERIFICATION_TOKEN: z.string().optional().default(""),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("\n❌ .env configuration problem:\n");
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\nCopy server/.env.example to server/.env and fill the values (see README).\n");
  process.exit(1);
}

export const config = parsed.data;

if (config.ALLOW_SERVER_GEMINI_KEY && !config.GEMINI_API_KEY) {
  console.error("❌ ALLOW_SERVER_GEMINI_KEY=true needs GEMINI_API_KEY.");
  process.exit(1);
}

if (config.SYNC_MODE === "pubsub" && (!config.GMAIL_PUBSUB_TOPIC || !config.PUBSUB_VERIFICATION_TOKEN)) {
  console.error("❌ SYNC_MODE=pubsub needs GMAIL_PUBSUB_TOPIC and PUBSUB_VERIFICATION_TOKEN.");
  process.exit(1);
}

export const isProd = config.NODE_ENV === "production";

export const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";
export const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";

/**
 * gmail.modify = read + move to Trash / change labels. It can NOT permanently
 * delete or send email. Every change still needs the user's spoken/clicked confirmation.
 */
export const GOOGLE_SCOPES = ["openid", "email", "profile", GMAIL_MODIFY];
