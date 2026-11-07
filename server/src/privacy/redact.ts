/**
 * PII Redaction: runs BEFORE any email text is stored for AI or sent to Gemini.
 * Masks OTPs, Aadhaar, PAN, card numbers, bank account numbers, IFSC, UPI IDs,
 * phone numbers and password lines. Keeps the text readable for the AI
 * ("[OTP]", "[AADHAAR]") so it still understands what the email is about.
 */

interface Rule {
  name: string;
  pattern: RegExp;
  replace: string | ((match: string, ...groups: string[]) => string);
}

const RULES: Rule[] = [
  // Password / PIN lines: "Password: abc@123", "PIN - 4455"
  {
    name: "password",
    pattern: /\b(password|passcode|pin|mpin|cvv)\b(\s*(?:is|:|-|=)\s*)(\S+)/gi,
    replace: (_m, label: string, sep: string) => `${label}${sep}[SECRET]`,
  },
  // OTP / verification codes: "OTP is 482913", "verification code: 5521", "123456 is your OTP"
  {
    name: "otp-after",
    pattern:
      /\b(otp|one[- ]time password|verification code|security code|login code|auth(?:entication)? code|code)\b([^0-9\n]{0,20})(\d{4,8})\b/gi,
    replace: (_m, label: string, mid: string) => `${label}${mid}[OTP]`,
  },
  {
    name: "otp-before",
    pattern: /\b(\d{4,8})(\s+is\s+(?:your|the)\s+(?:otp|one[- ]time password|verification code|code))/gi,
    replace: (_m, _code: string, rest: string) => `[OTP]${rest}`,
  },
  // Card numbers: 13–19 digits, optionally grouped by space/dash
  {
    name: "card",
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    replace: (m: string) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length === 12) return "[AADHAAR]";
      if (digits.length >= 13 && digits.length <= 19) return "[CARD]";
      return m;
    },
  },
  // Aadhaar: 12 digits, often "1234 5678 9012"
  { name: "aadhaar", pattern: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, replace: "[AADHAAR]" },
  // PAN: ABCDE1234F
  { name: "pan", pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g, replace: "[PAN]" },
  // IFSC: SBIN0001234
  { name: "ifsc", pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, replace: "[IFSC]" },
  // Bank account numbers mentioned with a label
  {
    name: "account",
    pattern: /\b(a\/c|acct|account(?:\s+(?:no|number))?)(\.?\s*(?:no\.?|number)?\s*[:#-]?\s*)([Xx*\d]{6,18})\b/gi,
    replace: (_m, label: string, sep: string) => `${label}${sep}[ACCOUNT]`,
  },
  // UPI IDs: name@okaxis, 98xxxx@ybl
  {
    name: "upi",
    pattern: /\b[\w.-]{2,}@(?:ok\w+|ybl|ibl|axl|upi|paytm|apl|ptyes|ptsbi|pthdfc|ptaxis|fbl|yapl|jupiteraxis|slc|kotak|icici|sbi|hdfcbank|axisbank|airtel|freecharge|waicici|wahdfcbank)\b/gi,
    replace: "[UPI]",
  },
  // Indian mobile numbers: +91 98765 43210, 09876543210, 9876543210
  { name: "phone", pattern: /(?<!\d)(?:\+?91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g, replace: "[PHONE]" },
];

export function redactPII(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, rule.replace as never);
  }
  return out;
}
