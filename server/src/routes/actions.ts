import { randomBytes } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { gmail_v1 } from "googleapis";
import { z } from "zod";
import { gmailForUser } from "../auth/google.js";
import { hashToken, requireAuth, requireSession } from "../auth/session.js";
import { actions, users } from "../db.js";

export const actionsRouter = Router();

// ---------------------------------------------------------------------------
// Chrome extension connection
// The dashboard (logged in with the session cookie) issues a random token and
// hands it to the extension. Only its SHA-256 hash is stored.
// ---------------------------------------------------------------------------
actionsRouter.post("/ext/connect", requireSession, async (req, res) => {
  const token = randomBytes(32).toString("base64url");
  await users().updateOne({ _id: req.userId }, { $set: { extTokenHash: hashToken(token), updatedAt: new Date() } });
  res.json({ token });
});

actionsRouter.delete("/ext/connect", requireAuth, async (req, res) => {
  await users().updateOne({ _id: req.userId }, { $set: { extTokenHash: null } });
  res.json({ ok: true });
});

actionsRouter.get("/ext/status", requireAuth, async (req, res) => {
  const u = await users().findOne({ _id: req.userId }, { projection: { email: 1, name: 1, canModify: 1, encGeminiKey: 1 } });
  res.json({
    email: u?.email ?? "",
    name: u?.name ?? "",
    canModify: u?.canModify !== false,
    hasGeminiKey: Boolean(u?.encGeminiKey),
  });
});

// ---------------------------------------------------------------------------
// Spam: count / list, move ALL to Trash in one go, undo
// ---------------------------------------------------------------------------
const MAX_BULK = 5000;
const actionLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

async function listSpamIds(gmail: gmail_v1.Gmail): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["SPAM"],
      includeSpamTrash: true,
      maxResults: 500,
      pageToken,
    });
    data.messages?.forEach((m) => m.id && ids.push(m.id));
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < MAX_BULK);
  return ids.slice(0, MAX_BULK);
}

function header(m: gmail_v1.Schema$Message, name: string) {
  return m.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function gmailError(err: unknown): { status: number; error: string } {
  const code = (err as { code?: number }).code;
  if (code === 403) {
    return { status: 403, error: "Gmail did not allow this change. Sign out and sign in again, and allow Gmail access (not just read)." };
  }
  return { status: 500, error: "Gmail request failed. Please try again." };
}

actionsRouter.get("/gmail/spam", requireAuth, async (req, res) => {
  try {
    const gmail = await gmailForUser(req.userId!);
    const ids = await listSpamIds(gmail);
    const preview = await Promise.all(
      ids.slice(0, 5).map(async (id) => {
        const { data } = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "Subject"] });
        return { id, from: header(data, "From").replace(/<.*>/, "").trim(), subject: header(data, "Subject") };
      }),
    );
    res.json({ count: ids.length, preview });
  } catch (err) {
    const e = gmailError(err);
    res.status(e.status).json({ error: e.error });
  }
});

const trashBody = z.object({
  /** The user must have confirmed (voice "confirm" or a click). */
  confirm: z.literal(true),
  /** Count the user saw; if spam changed a lot since, ask again. */
  expectedCount: z.number().int().min(0).optional(),
});

/** Moves ALL spam to Trash in one go (recoverable for 30 days in Gmail). */
actionsRouter.post("/gmail/spam/trash", requireAuth, actionLimiter, async (req, res) => {
  const b = trashBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: "Confirmation is required before deleting." });
    return;
  }
  try {
    const gmail = await gmailForUser(req.userId!);
    const ids = await listSpamIds(gmail);
    if (b.data.expectedCount !== undefined && ids.length > b.data.expectedCount + 20) {
      res.status(409).json({ error: `Spam changed: there are now ${ids.length} emails. Please confirm again.`, count: ids.length });
      return;
    }
    if (ids.length === 0) {
      res.json({ trashed: 0, actionId: null });
      return;
    }
    await mapLimit(ids, 10, (id) => gmail.users.messages.trash({ userId: "me", id }));
    const { insertedId } = await actions().insertOne({
      userId: req.userId!,
      type: "trash_spam",
      messageIds: ids,
      createdAt: new Date(),
      undoneAt: null,
    });
    res.json({ trashed: ids.length, actionId: insertedId.toHexString() });
  } catch (err) {
    const e = gmailError(err);
    res.status(e.status).json({ error: e.error });
  }
});

/** Undo the user's most recent action (restores the trashed emails). */
actionsRouter.post("/gmail/undo", requireAuth, actionLimiter, async (req, res) => {
  const last = await actions().find({ userId: req.userId!, undoneAt: null }).sort({ createdAt: -1 }).limit(1).toArray();
  const action = last[0];
  if (!action) {
    res.status(404).json({ error: "Nothing to undo." });
    return;
  }
  try {
    const gmail = await gmailForUser(req.userId!);
    await mapLimit(action.messageIds, 10, (id) => gmail.users.messages.untrash({ userId: "me", id }));
    await actions().updateOne({ _id: action._id }, { $set: { undoneAt: new Date() } });
    res.json({ restored: action.messageIds.length });
  } catch (err) {
    const e = gmailError(err);
    res.status(e.status).json({ error: e.error });
  }
});

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<unknown>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

