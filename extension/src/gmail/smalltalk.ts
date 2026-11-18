/**
 * Friendly small talk that needs no AI (instant, works even when the free AI limit is used up).
 * Pure function — unit tested.
 */
export interface SmallTalk { reply: string; followUp?: boolean }

const n = (s: string) => s.toLowerCase().replace(/[“”"'‘’`.,!?।]/g, " ").replace(/\s+/g, " ").trim();
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export function smallTalk(raw: string, firstName = "", hour = new Date().getHours(), assistant = "Vaani"): SmallTalk | null {
  const t = n(raw);
  if (!t || t.split(" ").length > 9) return null;
  const name = firstName ? `, ${firstName}` : "";

  if (/\b(how are you|how r u|how are u|how is it going|how s it going|how do you do|kaise ho|kaisi ho|kya haal|kya hal|sab theek|sab badhiya|how have you been)\b/.test(t))
    return { reply: pick([`I'm doing great${name}, thanks for asking! How about you?`, `I'm good${name}! Always happy when you talk to me. How are you doing?`]), followUp: true };

  if (/^(i m|i am|im|main|me|mai)? ?(fine|good|great|ok|okay|alright|theek|thik|badhiya|mast|accha|achha)( hoon| hu| hun| too| also| bhi)?( thanks| thank you)?$/.test(t))
    return { reply: pick(["Glad to hear that! Want me to check what's new in your inbox?", "Nice! Shall I tell you what's new in your inbox today?"]), followUp: true };

  if (/^(not (so )?(good|great|well)|bad|sad|tired|thaka hua|thak gaya|mood off|bura)/.test(t))
    return { reply: "Oh, I'm sorry to hear that. Take it easy. I can handle your emails, so you don't have to worry about them right now." };

  if (/^(thank you|thanks|thank u|thanks a lot|thx|shukriya|dhanyavad|dhanyawad)\b/.test(t))
    return { reply: pick(["You're welcome! Happy to help.", "Anytime! That's what I'm here for."]) };

  if (/^(good morning|morning|suprabhat)\b/.test(t)) return { reply: `Good morning${name}! Want to hear what's new today?`, followUp: true };
  if (/^(good afternoon)\b/.test(t)) return { reply: `Good afternoon${name}! How can I help with your emails?`, followUp: true };
  if (/^(good evening)\b/.test(t)) return { reply: `Good evening${name}! Shall I give you a quick summary?`, followUp: true };
  if (/^(good night|gn|shubh ratri)\b/.test(t)) return { reply: `Good night${name}! Sleep well. I'll keep an eye on your inbox.` };

  if (/^(hi|hello|hey|hii+|helo|namaste|namaskar|hola|yo)( there| vaani| buddy)?$/.test(t)) {
    const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    return { reply: pick([`Hi${name}! How can I help with your emails?`, `${greet}${name}! What would you like to do?`]), followUp: true };
  }

  if (/\b(who are you|what are you|your name|tumhara naam|aapka naam|tum kaun ho|aap kaun ho|introduce yourself)\b/.test(t))
    return { reply: `I'm ${assistant}, your friendly email buddy. I read your Gmail, tell you what matters, and help you reply, all by voice.` };

  if (/\b(what can you do|what do you do|help me|how can you help|kya kar sakte ho|kya kar sakti ho|tum kya karte ho|commands|help)$/.test(t))
    return { reply: "I can give you today's summary, show interview or offer emails, open any folder, clear your spam, and write replies for you. Just ask me." , followUp: true };

  if (/\b(you are|you re|ur|tum|aap)( so| very| bahut| really)? (good|great|awesome|amazing|smart|nice|cool|best|helpful|acchi|achhi|mast)\b/.test(t) || /^(good job|well done|nice|awesome|great|shabash)$/.test(t))
    return { reply: pick(["Aww, thank you! You just made my day.", "Thank you! I'm happy I could help."]) };

  if (/^(bye|goodbye|see you|see ya|tata|alvida|chalo bye|ok bye)\b/.test(t))
    return { reply: `Bye${name}! I'll be right here whenever you need me.` };

  if (/\b(tell me a joke|joke sunao|make me laugh|ek joke)\b/.test(t))
    return { reply: pick([
      "Why did the email go to therapy? It had too many unresolved threads!",
      "My favourite exercise? Inbox zero. I do it every day, so you don't have to.",
    ]) };

  if (/\b(i love you|love you)\b/.test(t)) return { reply: "That's so sweet! I'm always here for you, and your inbox." };
  if (/\b(sorry|my bad|maaf)\b/.test(t) && t.split(" ").length <= 4) return { reply: "No worries at all!" };
  return null;
}
