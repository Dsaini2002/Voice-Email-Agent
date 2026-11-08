# Vaani: voice AI agent for Gmail

> Multilingual voice AI agent that works **inside Gmail**: 30-second spoken briefings, smart filters, open folders and clean up spam by voice, in English, Hindi and Hinglish.

Vaani ek **Chrome extension** hai. Isme **koi server, koi database, koi `.env` file aur koi `npm` nahi** chahiye.
Har user apna **khud ka Google Client ID** (isliye koi user limit nahi) aur apni **free Gemini key** use karta hai. Data uske **apne browser** mein rehta hai.

```
Gmail tab
 └─ Vaani overlay (transparent JARVIS HUD + mic box)
      └─ Extension background
           ├─ Google sign-in (user's OWN Client ID) → Gmail API (directly)
           ├─ User's own Gemini key              → Gemini API (directly)
           └─ chrome.storage (local database in this browser)
```

---

## 👤 Kaise shuru karein (har user, ek baar ~7 minute)

Har user **apna khud ka Google Client ID** use karta hai, isliye **koi user limit nahi** hai aur kisi aur ke Google project ki zarurat nahi padti.

### 1. Extension install karo
ZIP extract karo → Chrome mein `chrome://extensions` kholo → **Developer mode** on karo → **Load unpacked** → `vaani-extension` folder chuno (wahi jisme `manifest.json` ho).

### 2. Gmail kholo
Vaani apne aap **"Connect Vaani"** wizard kholega. Har step ke saath **Open ↗** button hai, jo Google Cloud ka sahi page seedha kholta hai.

| Wizard step | Kya karna hai |
|---|---|
| **a** Create project | Name `Vaani` → **Create** (upar wahi project selected ho) |
| **b** Gmail API | **Enable** |
| **c** Consent screen | **Get started** → App name `Vaani`, apna email → **External** → apna email → agree → **Create** |
| **d** Test user | **Test users → Add users** → apna Gmail → **Save** |
| **e** Client ID | Type **Web application** → **Authorized redirect URIs → Add URI** → wizard ka URL paste karo (**Copy** button hai). Ye hamesha `https://jfjfjfjflmnmnmijkahmekcfpclgmdpf.chromiumapp.org/` hota hai → **Create** → **Client ID** copy karo |

Client ID wizard mein paste karke **Save** dabao. Ye ID secret nahi hai. **Client secret** kahin paste mat karna.

### 3. Sign in with Google
Agar *"Google hasn't verified this app"* dikhe, to **Continue** dabao. Ye **aapki apni** app hai.

### 4. Gemini key
[aistudio.google.com/apikey](https://aistudio.google.com/apikey) → **Create API key** → paste → **Save**.

### 5. Bolo: **"Vaani, give me today's summary"**

> Ye wizard har user ko sirf ek baar karna hai. Uske baad Vaani apne aap login rakhta hai aur background mein naye emails padhta rehta hai.

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

## Extension share karna (developer)
```bash
npm install
npm run release      # → extension/release/vaani-extension
```
Us folder ko ZIP karke share karo. Isme koi Client ID ya secret nahi hai, kyunki har user wizard mein apna khud ka daalta hai.

---

## Kya-kya hai

| Feature | Code |
|---|---|
| Gmail ke andar transparent JARVIS overlay, mic box, live captions | `extension/src/gmail/` |
| Background mic + wake word "Vaani", voice "stop" | `extension/src/gmail/speech.ts` |
| English + Hinglish commands (spam ko "span" sun le to bhi samajhta hai) | `extension/src/gmail/commands.ts` |
| Har user ka apna Google Client ID (setup wizard), Google sign-in, Gmail API, background sync har minute | `extension/src/bg/auth.ts`, `oauth.ts`, `gmail.ts`, `sync.ts` |
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
