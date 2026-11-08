# Vaani: voice AI agent for Gmail

> Multilingual voice AI agent that works **inside Gmail**: 30-second spoken briefings, smart filters, open folders and clean up spam by voice, in English, Hindi and Hinglish.

Vaani ek **Chrome extension** hai. Isme **koi server, koi database, koi `.env` file aur koi `npm` nahi** chahiye.
Har user ka data uske **apne browser** mein rehta hai, aur AI uski **apni free Gemini key** se chalta hai.

```
Gmail tab
 └─ Vaani overlay (transparent JARVIS HUD + mic box)
      └─ Extension background
           ├─ Google sign-in (chrome.identity)   → Gmail API (directly)
           ├─ User's own Gemini key              → Gemini API (directly)
           └─ chrome.storage (local database in this browser)
```

---

## 👤 Users ke liye: 2 minute ka setup

1. **Extension install karo**
   - Owner ne ZIP bheja ho: ZIP extract karo → Chrome mein `chrome://extensions` kholo → upar right mein **Developer mode** on karo → **Load unpacked** → `vaani-extension` folder chuno (wahi folder jisme `manifest.json` ho).
   - Chrome Web Store par aane ke baad: bas **Add to Chrome** dabana hoga.
2. **Gmail kholo.** Vaani apne aap setup panel dikhayega.
3. **Sign in with Google** dabao aur permission do.
4. **Apni free Gemini key daalo:** [aistudio.google.com/apikey](https://aistudio.google.com/apikey) kholo → **Create API key** → copy karke panel mein paste karo → **Save**.
5. Mic ki permission do aur bolo: **"Vaani, give me today's summary"**

### Commands (bolo, ya `Alt+V` dabake type karo)

| Bolo | Kya hota hai |
|---|---|
| "Vaani, give me today's summary" / "aaj ka summary batao" | Cards **ek-ek karke** aate hain aur Vaani har email bolti hai |
| "Vaani, show interview emails" / "interview wale message dikhao" | Sirf interview wale emails ki list |
| "Vaani, TCS ka interview message dikhao" | Us company ka detail card |
| "Vaani, open it in Gmail" | Wahi email **usi tab** mein Gmail mein khul jaata hai |
| "Vaani, open full window" | Poori screen par transparent overview |
| "Vaani, open spam" / "spam kholo" | Gmail ka Spam folder **usi tab** mein |
| "Vaani, delete all spam" / "spam ke saare message delete karo" | Saare spam ki ginti dikhti hai. "**confirm**" bolte hi **sab ek baar mein** Trash mein |
| "Vaani, undo" | Delete kiye gaye emails wapas |
| "Vaani, open inbox / sent / drafts / trash / starred / promotions" | Wahi folder usi tab mein |
| "Vaani, search internship stipend" | Gmail search |
| "Vaani, how many rejections this week?" | AI jawab deta hai, aur related cards dikhata hai |
| "stop" / "ruko" | Bolna band |
| "close" / "band karo" / Esc | Overlay band |
| "Vaani, sign in" / "setup" | Setup panel |

Settings ke liye Chrome toolbar mein Vaani icon par click karo. Wahan mic on/off, wake word, bolne ki bhasha (English / Hindi-Hinglish), Gemini key aur sign out milta hai.

---

## 🛠 Owner setup: sirf ek baar, extension share karne wala karega

Users ko Google Cloud ya `.env` kuch nahi karna padta. Ye sab **aap ek baar** karte ho, phir extension sabko de dete ho.

### 1. Google Cloud (10 minute)
1. [console.cloud.google.com](https://console.cloud.google.com) → **New Project**, naam `Vaani`.
2. **APIs & Services → Library** → **Gmail API** → **Enable**.
3. **Google Auth Platform → Branding:** App name `Vaani`, support email daalo.
   - **Audience:** External. Jab tak Google app verify nahi karta, ise *Testing* mein rakho, aur **Test users** mein un logon ke Gmail add karo jinhe extension doge (max 100).
   - **Data Access:** `.../auth/gmail.modify`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` add karo.
4. **Clients → Create client:**
   - Application type: **Chrome Extension**
   - Item ID: **`jfjfjfjflmnmnmijkahmekcfpclgmdpf`**
     *(Ye is extension ki fixed ID hai, `manifest.json` ki `key` se banti hai, aur har computer par same rehti hai.)*
   - **Create** dabao aur **Client ID** copy karo. Is type mein secret nahi hota.

### 2. Client ID extension mein daalo aur release banao
```bash
npm install
npm run set-client-id -- 1234567890-abc.apps.googleusercontent.com
npm run release
```
Isse `extension/release/vaani-extension` folder ban jaata hai. Use ZIP karke users ko bhejo, ya Chrome Web Store par upload karo.

> **Sabke liye public karna ho to:** Google ke *Testing* mode mein sirf 100 test users sign in kar sakte hain. Isse zyada logon ke liye app ko **Publish** karke Google **verification** karwana hoga. `gmail.modify` ek *restricted scope* hai, isliye Google ek security assessment (CASA) bhi maangta hai.
> Chrome Web Store par upload karne ke baad store ek nayi extension ID deta hai. Tab OAuth client ka **Item ID** wahi nayi ID kar dena.

---

## Kya-kya hai

| Feature | Code |
|---|---|
| Gmail ke andar transparent JARVIS overlay, mic box, live captions | `extension/src/gmail/` |
| Background mic + wake word "Vaani", voice "stop" | `extension/src/gmail/speech.ts` |
| English + Hinglish commands (spam ko "span" sun le to bhi samajhta hai) | `extension/src/gmail/commands.ts` |
| Google sign-in (chrome.identity), Gmail API, background sync har minute | `extension/src/bg/auth.ts`, `gmail.ts`, `sync.ts` |
| PII redaction: OTP, Aadhaar, PAN, card, phone, UPI AI tak nahi jaate | `server/src/privacy/redact.ts` (shared) |
| AI classification + Truth Verification + duplicate merge (user ki Gemini key) | `extension/src/bg/ai.ts` + shared `server/src/ai/*Core.ts`, `server/src/intel/` |
| Spam: ginti, saara spam ek baar mein Trash, Undo | `extension/src/bg/router.ts` |
| Local database (chrome.storage), 30 din purani copies apne aap hat jaati hain | `extension/src/bg/store.ts` |

## Privacy & security

- **Koi Vaani server nahi hai.** Emails sirf Google (Gmail) aur, analysis ke liye, user ki apni Gemini key ke through Google AI tak jaate hain.
- AI ko bhejne se **pehle** OTP, Aadhaar, PAN, card, phone aur UPI mask ho jaate hain.
- Data sirf us browser profile ke `chrome.storage` mein rehta hai. **Sign out** dabate hi Google access revoke ho jaata hai aur sab kuch delete ho jaata hai.
- Permission `gmail.modify` hai: padhna aur Trash mein bhejna. Vaani **email send nahi kar sakta** aur **permanently delete nahi kar sakta**. Har delete se pehle aapka "confirm" chahiye, aur Undo milta hai.
- Mic sirf tab chalta hai jab Gmail tab saamne ho. Awaaz save nahi hoti. Chrome ka speech recognition awaaz ko text banane ke liye Google ko bhejta hai.
- Details: [SECURITY.md](SECURITY.md)

## Developers

```bash
npm install
npm test             # server + extension tests
npm run release      # build extension → extension/release/vaani-extension
```
- `extension/`: Chrome extension (main product)
- `server/src/ai/*Core.ts`, `server/src/intel/`, `server/src/privacy/`: shared AI / verification / privacy logic, jo extension mein bundle hota hai
- `server/` + `web/`: **optional** purana web dashboard aur server, jo normal users ke liye zaroori nahi hai. Dekho [docs/server-dashboard.md](docs/server-dashboard.md)
- `design/`: editable HUD design file
