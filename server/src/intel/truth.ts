import type { AppStatus, EmailAnalysis } from "../../../shared/types.js";

/**
 * Truth Verification Engine.
 * The AI must quote an exact sentence ("evidence") from the email for every
 * status claim. We check that the quote really exists in the email. If it
 * doesn't, the claim is marked unverified and its confidence is capped, so the
 * agent never confidently says "you are selected" based on a hallucination.
 */

const STRONG_CLAIMS: AppStatus[] = ["offer", "interview", "shortlisted", "rejected", "assessment"];

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[“”"'‘’`]/g, "")
    .replace(/[^\p{L}\p{N}\[\]]+/gu, " ")
    .trim();
}

/** True if the evidence appears in the source (exact after normalisation, or ≥90% of its words in order-insensitive match for long quotes). */
export function evidenceFound(evidence: string, source: string): boolean {
  const ev = normalize(evidence);
  if (!ev) return false;
  const src = normalize(source);
  if (src.includes(ev)) return true;

  const evWords = ev.split(" ").filter((w) => w.length > 2);
  if (evWords.length < 5) return false; // short quotes must match exactly
  const srcWords = new Set(src.split(" "));
  const hit = evWords.filter((w) => srcWords.has(w)).length;
  return hit / evWords.length >= 0.9;
}

const ASKING = new Set(["help_request", "question", "meeting", "task", "deadline", "payment"]);

export function verifyAnalysis(a: EmailAnalysis, sourceText: string): EmailAnalysis {
  const asks = ASKING.has(a.intent ?? "") || Boolean(a.needsReply);
  const needsEvidence = STRONG_CLAIMS.includes(a.status) || a.actionRequired || asks;
  if (!needsEvidence) {
    return { ...a, verified: true, confidence: clamp(a.confidence) };
  }
  const ok = evidenceFound(a.evidence, sourceText);
  return {
    ...a,
    // "Someone asked you for help" must be provable too — otherwise it's just an update.
    ...(ok || !asks ? {} : { intent: a.intent === "help_request" || a.intent === "question" ? "update" : a.intent, needsReply: false, ask: "" }),
    verified: ok,
    confidence: ok ? clamp(a.confidence) : Math.min(clamp(a.confidence), 0.4),
  };
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
