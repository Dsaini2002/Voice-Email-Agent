/**
 * Wake word = the name the user gave their assistant ("Vaani", "Nova", "Jarvis"…).
 * Speech recognisers spell names in many ways, so names are compared by sound. Pure — unit tested.
 */
const VAANI_ALIASES = /^(vaani|vani|vaanee|baani|bani|waani|wani|vany|vaney|bunny|vanni|वाणी|वानी)$/i;
const GREETING = /^(hey|hi|ok|okay|hello|हे|ओके)$/i;
const FILLER = /^(arre|are|arey|please|so|acha|accha|achha|haan|han|yaar|um|uh|and|now|अरे)$/i;

/** A rough "sounds like" key: vaani/vani/waani → "vani", jarvis/jarviss → "jarvis". */
export function soundKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-zऀ-ॿ]/g, "")
    .replace(/ph/g, "f")
    .replace(/w/g, "v")
    .replace(/ee|ea|ie|y$/g, "i")
    .replace(/oo|ou/g, "u")
    .replace(/(.)\1+/g, "$1")
    .replace(/a(?=.)/g, (m, i, str) => (str[i + 1] === "a" ? "" : m))
    .replace(/h$/g, "");
}

function close(a: string, b: string): boolean {
  if (a === b) return true;
  const short = Math.min(a.length, b.length);
  if (short < 4) return false;
  if (short === 4 && a[0] !== b[0]) return false; // "nova" ≈ "noba", but not "lova"
  // one letter different / missing
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length] <= 1;
}

/** If the sentence starts with the assistant's name, returns what comes after it ("" if only the name). */
export function matchWake(text: string, name: string): string | null {
  const words = text.trim().split(/[\s,.!?।]+/).filter(Boolean);
  if (!words.length) return null;
  const target = soundKey(name);
  const nameWords = name.trim().split(/\s+/).length;
  // The name usually comes first, but people also say "hey Nova…", "arre Vaani…", "ok so Nova…".
  for (let i = 0; i < Math.min(3, words.length); i++) {
    if (i > 0 && !(GREETING.test(words[i - 1]) || FILLER.test(words[i - 1]))) break;
    for (const k of [nameWords, 1, 2]) {
      if (i + k > words.length) continue;
      const said = words.slice(i, i + k).join("");
      const isVaani = /^vaani$/i.test(name.trim()) && VAANI_ALIASES.test(said);
      if (isVaani || (target && close(soundKey(said), target))) {
        return words.slice(i + k).join(" ").trim();
      }
    }
  }
  return null;
}

/** Names that would make a bad wake word (too short, or words people say all the time). */
export function nameProblem(name: string): string | null {
  const n = name.trim();
  if (n.length < 2) return "That's a bit short. Try a name with at least 3 letters.";
  if (n.length > 20 || n.split(/\s+/).length > 2) return "Please pick a shorter name (one or two words).";
  if (!/^[\p{L} .'-]+$/u.test(n)) return "Please use letters only.";
  if (/^(ok|okay|hey|hi|stop|yes|no|the|email|mail|google|gmail|open|close|send|cancel|hello)$/i.test(n)) return "That word comes up in normal talk too often. Try a name instead.";
  return null;
}

export function cleanName(raw: string): string {
  const t = raw.trim()
    .replace(/^(?:(?:you can |please )?call (?:you|yourself)|your name (?:is|will be|should be)|i(?:'ll| will) call you|name (?:is|it)|let'?s (?:go with|call you)|tumhara naam|aapka naam|naam)\s+/i, "")
    .replace(/\s+(?:rakho|rakh do|hai|hoga|please)$/i, "")
    .replace(/[.!?"'“”]+/g, "")
    .trim();
  return t.split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
