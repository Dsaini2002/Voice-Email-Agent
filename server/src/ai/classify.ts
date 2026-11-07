import { z } from "zod";
import type { EmailAnalysis } from "../../../shared/types.js";
import { verifyAnalysis } from "../intel/truth.js";
import { generateJSON } from "./gemini.js";

const CATEGORIES = [
  "job", "education", "finance", "personal", "work", "travel", "shopping",
  "promotion", "newsletter", "social", "notification", "spam", "scam", "other",
] as const;
const STATUSES = [
  "none", "application_received", "assessment", "shortlisted", "interview", "offer", "rejected",
] as const;

export interface EmailForAI {
  id: string;
  from: string;
  subject: string;
  date: string;
  gmailLabels: string[];
  body: string;
}

const SYSTEM = `You are the email-understanding engine of VaaniMail AI, a personal email assistant for a user in India.
You receive a batch of emails (already PII-redacted: [OTP], [PHONE], [AADHAAR] etc. are placeholders).
For EACH email return one analysis object. Be precise and conservative — never guess.

STATUS rules (job/internship/admission applications) — choose the LOWEST status that the text explicitly supports:
- "application_received": only confirms the application was received / under review.
- "assessment": asks the user to take a test, coding round, assignment or fill a further form as part of selection.
- "shortlisted": explicitly says shortlisted / selected for next round / moved forward, but no interview scheduled in this email.
- "interview": invites to or schedules an interview (date/time/link or asks for availability).
- "offer": explicitly offers a job/internship/admission (offer letter, "pleased to offer").
- "rejected": explicitly declines ("not moving forward", "regret to inform").
- "none": anything else, including job alerts, recommended jobs, newsletters, marketing.
"Thank you for applying" is application_received, NOT shortlisted. An interview invite is NOT an offer.

EVIDENCE: if status is not "none" OR actionRequired is true, copy ONE sentence VERBATIM from the email (subject or body) that proves it, max 200 characters. Do not paraphrase. Otherwise "".

CATEGORY: pick the best of: ${CATEGORIES.join(", ")}.
- "promotion" = marketing/sales/offers/discounts. "newsletter" = digests, job alerts, content mailers.
- "spam" = unwanted junk. "scam" = phishing or fraud (see SCAM).
- "personal" = written by a real person to the user (family, friends, individuals).
Gmail labels like CATEGORY_PROMOTIONS / CATEGORY_SOCIAL are hints, not rules.

SCAM: isScam=true for fake job offers asking for payment/registration/security deposit, lottery/prize claims, requests for passwords/OTP/bank details, impersonation of banks/government, mismatched sender vs claimed company, urgent threats. Give a short scamReason. If isScam, category="scam".

PRIORITY:
- "high": offers, interviews, shortlists, assessments, deadlines within 3 days, payment due/failed, security alerts from real services, important personal messages, anything needing the user's action soon.
- "medium": rejections, application confirmations, bills/receipts, work updates, normal personal mail.
- "low": promotions, newsletters, social notifications, spam.

ACTION: actionRequired=true only if the user must DO something (reply, fill form, upload document, pay, attend, confirm). actionText = short imperative English, e.g. "Fill the application form". Else "".
DEADLINE: if a due date/time for the action or event is stated, give it as YYYY-MM-DD (resolve relative dates like "tomorrow" using the email date). Else "".
ENTITY: the organisation or person the email is about (e.g. "Infosys", "HDFC Bank", "Rahul Sharma"). Short.
GROUPKEY: lowercase "<entity-slug>:<topic>", topic one of application, bill, order, account, newsletter, promo, conversation, event, other. Reminders/follow-ups about the SAME matter from the same entity MUST share the same groupKey.
SUMMARY: one plain English line, max 20 words, factual.
CONFIDENCE: 0..1 how sure you are about status + category.`;

const responseSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: [...CATEGORIES] },
          status: { type: "string", enum: [...STATUSES] },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          entity: { type: "string" },
          groupKey: { type: "string" },
          summary: { type: "string" },
          actionRequired: { type: "boolean" },
          actionText: { type: "string" },
          deadline: { type: "string" },
          isScam: { type: "boolean" },
          scamReason: { type: "string" },
          evidence: { type: "string" },
          confidence: { type: "number" },
        },
        required: [
          "id", "category", "status", "priority", "entity", "groupKey", "summary",
          "actionRequired", "actionText", "deadline", "isScam", "scamReason", "evidence", "confidence",
        ],
      },
    },
  },
  required: ["results"],
};

const itemSchema = z.object({
  id: z.string(),
  category: z.enum(CATEGORIES).catch("other"),
  status: z.enum(STATUSES).catch("none"),
  priority: z.enum(["high", "medium", "low"]).catch("medium"),
  entity: z.string().catch(""),
  groupKey: z.string().catch(""),
  summary: z.string().catch(""),
  actionRequired: z.boolean().catch(false),
  actionText: z.string().catch(""),
  deadline: z
    .string()
    .catch("")
    .transform((d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "")),
  isScam: z.boolean().catch(false),
  scamReason: z.string().catch(""),
  evidence: z.string().catch(""),
  confidence: z.number().catch(0.5),
});

const BODY_CHARS_FOR_AI = 1500;

/** Classifies up to ~8 emails in ONE Gemini call (saves free-tier quota). */
export async function classifyBatch(batch: EmailForAI[]): Promise<Map<string, EmailAnalysis>> {
  const payload = batch.map((e) => ({
    id: e.id,
    from: e.from,
    date: e.date,
    gmailLabels: e.gmailLabels.filter((l) => l.startsWith("CATEGORY_") || l === "IMPORTANT"),
    subject: e.subject,
    body: e.body.slice(0, BODY_CHARS_FOR_AI),
  }));

  const raw = await generateJSON<{ results: unknown[] }>({
    system: SYSTEM,
    prompt: `Analyze these ${batch.length} emails. Return exactly one result per id.\n\n${JSON.stringify(payload, null, 1)}`,
    jsonSchema: responseSchema,
    temperature: 0.1,
  });

  const out = new Map<string, EmailAnalysis>();
  for (const r of raw.results ?? []) {
    const parsed = itemSchema.safeParse(r);
    if (!parsed.success) continue;
    const { id, ...a } = parsed.data;
    const src = batch.find((b) => b.id === id);
    if (!src) continue;
    const analysis: EmailAnalysis = {
      ...a,
      category: a.isScam ? "scam" : a.category,
      entity: a.entity || src.from,
      groupKey: (a.groupKey || `${slug(a.entity || src.from)}:other`).toLowerCase(),
      verified: false,
    };
    out.set(id, verifyAnalysis(analysis, `${src.subject}\n${src.body}`));
  }
  return out;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "unknown";
}
