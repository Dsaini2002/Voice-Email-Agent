# voice-email-agent: Phase 1 (MVP)

> Multilingual voice AI agent for Gmail: 30-second briefings in Hindi, English & Hinglish.

**Aapka inbox, aapki awaaz mein.** Ek multilingual voice email agent jo Gmail padhta hai, emails ko group karta hai, spam/promo chhupata hai, aur Hindi / English / Hinglish mein 30 second ki briefing deta hai.

Is phase ka goal: **"Aaj kya important aaya?" ka sahi jawab, 30 seconds mein.**

---

## Phase 1 mein kya bana hai

| Feature | Kahan hai code |
|---|---|
| Google login (OAuth 2.0, read-only Gmail) | `server/src/auth/` |
| Silent Background Intelligence: naye mail aate hi fetch + AI analysis | `server/src/gmail/sync.ts`, `scheduler.ts`, `ai/analyzer.ts` |
| Gmail Push (Pub/Sub) support + localhost ke liye polling | `server/src/gmail/watch.ts`, `routes/api.ts` (`/api/gmail/push`) |
| PII Redaction: OTP, Aadhaar, PAN, card, phone, UPI, passwords AI tak nahi jaate | `server/src/privacy/redact.ts` |
| AI classification (Gemini): category, status, priority, deadline, action | `server/src/ai/classify.ts` |
| Truth Verification: har status ka saboot original email se check hota hai | `server/src/intel/truth.ts` |
| Duplicate Intelligence: reminders ek card mein, latest deadline ke saath | `server/src/intel/briefingBuilder.ts` |
| Spam/Promo hiding + Scam emails alag "Security" section mein | `server/src/intel/briefingBuilder.ts` |
| Group Summarization + 30-sec / detailed voice briefing | `server/src/ai/briefing.ts`, `ai/speech.ts` |
| Voice Q&A ("Kitne rejection aaye?") | `server/src/ai/ask.ts` |
| Always-on background mic (wake word "Vaani", voice "Stop"), top-left mic icon | `web/src/hooks/useSpeechRecognition.ts`, `components/MicDock.tsx` |
| Status popups (Shortlisted / Interview / Offer…) + detail window | `web/src/components/StatusPopups.tsx`, `EmailModal.tsx`, `statusTheme.ts` |
| Voice output (browser built-in, Hindi/English/Hinglish) | `web/src/hooks/useSpeaker.ts` |
| Dashboard: briefing cards, Verified tag, Gmail links, Stop button, Esc | `web/src/` |
| **Bring-your-own Gemini key**: har user apni key daalta hai (encrypted save) | `server/src/ai/keys.ts`, `web/src/components/GeminiKeyCard.tsx` |
| **Secret protection**: commit se pehle API keys / .env automatically block | `scripts/check-secrets.mjs`, `.githooks/pre-commit` |
| "Delete my data": Google access revoke + sab data delete | `server/src/auth/routes.ts` |

**Tech:** TypeScript everywhere. Backend: Node.js + Express. Frontend: React + Vite + Tailwind. Database: MongoDB. AI: Google Gemini.

```
voice-email-agent/
├── shared/types.ts        ← server aur web dono ke common types
├── server/                ← Express API + background sync + AI
│   ├── src/
│   │   ├── auth/          Google OAuth, session cookie
│   │   ├── gmail/         sync, parse, Pub/Sub watch, scheduler
│   │   ├── ai/            Gemini client, classify, briefing, ask
│   │   ├── intel/         truth verification, grouping/dedupe
│   │   ├── privacy/       PII redaction
│   │   └── routes/        /api endpoints
│   └── test/              unit + end-to-end tests (credentials ki zarurat nahi)
├── web/                   React dashboard (voice UI)
├── design/                Phase 2 ka JARVIS-style HUD design file
├── scripts/               secret scanner + git hook setup
├── .githooks/pre-commit   har commit se pehle secret check
└── SECURITY.md            secrets ke rules + leak ho jaaye to kya karein
```

---

## Ye sabke liye hai: kaun kya deta hai?

| Cheez | Kaun deta hai | Kyun |
|---|---|---|
| Google OAuth Client ID/Secret | **App chalane wala (server owner)**, ek baar | Isse "Google se login" ka button chalta hai. Har user apne Google account se login karta hai. Iska koi kharcha nahi hai. |
| **Gemini API key** | **Har user khud** (dashboard mein) | AI ka usage har user ki apni free key par chalta hai. Owner ki key kisi aur ke liye use nahi hoti. |
| MongoDB, ENCRYPTION_KEY, SESSION_SECRET | Server owner | Server ka data aur security |

Pehli baar login karne par dashboard par **"Apni free Gemini API key jodo"** card dikhta hai, jisme 3 steps hain:
1. aistudio.google.com/apikey kholo.
2. **Create API key** dabao aur key copy karo.
3. Key paste karke **Save** dabao.

Key ek baar check hoti hai, phir encrypted save hoti hai, aur browser ko kabhi wapas nahi bheji jaati. Baad mein key badalni ya hatani ho to account menu mein **"Gemini API key"** option hai.

> **Sirf apne personal use ke liye?** `server/.env` mein `ALLOW_SERVER_GEMINI_KEY=true` aur `GEMINI_API_KEY=...` daal do. Tab dashboard mein key daalne ki zarurat nahi padegi. Agar doosre log bhi tumhare server par login karte hain, to isse **`false`** hi rakhna, warna sabka usage tumhari key par jaayega.

### Doosre log kaise use karenge?

- **Option A: Tum server host karo** (Render / Railway / VPS par). Log bas tumhari website kholenge, Google se login karenge aur apni Gemini key daalenge.
  - ⚠️ Google ke **Testing mode** mein sirf 100 "test users" login kar sakte hain, aur unke email Cloud Console mein add karne padte hain.
  - Sabke liye kholne ke liye Google **app verification** karna padega. `gmail.readonly` ek *restricted scope* hai, isliye ek security assessment (CASA) bhi lag sakta hai.
- **Option B: Har koi khud chalaye (self-host).** Log ye repository clone karenge aur neeche ke setup steps follow karenge. Unke apne Google Cloud credentials aur apni Gemini key hogi.

---

## Setup (pehli baar, ~20 minute)

### 0. Zaroori cheezein

- **Node.js 20.19 ya usse naya** (22 LTS recommended): https://nodejs.org
- **Google Chrome ya Microsoft Edge** (voice ke liye)
- Ek **Google account** (jiska Gmail use karna hai)

### 1. Google Cloud: Gmail API + OAuth client

1. https://console.cloud.google.com par jao. Upar project dropdown → **New Project** → naam `VaaniMail` → Create.
2. **APIs & Services → Library** → "Gmail API" search karo → **Enable**.
3. **Google Auth Platform → Branding** (purane UI mein *OAuth consent screen*):
   - App name: `VaaniMail AI`, support email: apna email → Save.
   - **Audience**: User type **External**, Publishing status **Testing** rehne do.
   - **Test users → Add users** → apna Gmail address daalo. *(Testing mode mein sirf yahi log login kar sakte hain, max 100.)*
   - **Data Access → Add or remove scopes** → `.../auth/gmail.readonly` add karo → Save.
4. **Clients → Create client** (purane UI mein *Credentials → Create Credentials → OAuth client ID*):
   - Application type: **Web application**
   - Authorized JavaScript origins: `http://localhost:5173`
   - Authorized redirect URIs: `http://localhost:5173/api/auth/google/callback`
   - Create → **Client ID** aur **Client Secret** copy karo.

### 2. Gemini API key

Kuch karne ki zarurat nahi hai. Har user login ke baad **dashboard mein apni key khud daalta hai**, upar dekho. *(Sirf personal use ke liye `ALLOW_SERVER_GEMINI_KEY=true` set kar sakte ho.)*

### 3. MongoDB (dono mein se ek)

- **Option A: MongoDB Atlas (free, kuch install nahi karna)**: https://www.mongodb.com/cloud/atlas → free M0 cluster banao → Database user banao → *Network Access* mein apna IP allow karo → *Connect → Drivers* se connection string copy karo (`mongodb+srv://...`).
- **Option B: Laptop par**: [MongoDB Community Server](https://www.mongodb.com/try/download/community) install karo (Windows par service ke roop mein chalega). Connection string: `mongodb://localhost:27017`
- *(Docker ho to: `docker compose up -d` is folder mein.)*

### 4. `.env` file banao

```bash
# Windows (Command Prompt)
copy server\.env.example server\.env

# Mac / Linux
cp server/.env.example server/.env
```

Do secret keys banao. Ye command do baar chalao, ek `ENCRYPTION_KEY` ke liye aur ek `SESSION_SECRET` ke liye:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Ab `server/.env` kholo aur ye values bharo:

```
GOOGLE_CLIENT_ID=...         (step 1)
GOOGLE_CLIENT_SECRET=...     (step 1)
MONGODB_URI=...              (step 3)
ENCRYPTION_KEY=...           (64 hex characters)
SESSION_SECRET=...
```

### 5. Install aur chalao

```bash
npm install
npm run dev
```

Browser mein **http://localhost:5173** kholo → **Google se login karo** → dashboard par **apni Gemini key daalo**.

> Google ek screen dikhayega: *"Google hasn't verified this app"*. Ye testing mode mein normal hai. **Continue** dabao. Phir Gmail wala checkbox **tick** karke allow karo.

Pehli baar login ke baad pichhle 7 din ke emails (max 150) padhe aur samjhe jaate hain. Gemini free tier ki speed ke hisaab se isme 1 se 3 minute lagte hain, aur cards apne aap aa jaate hain.

---

## Kaise use karein

### Background mic (top-left corner)
- Page khulte hi mic **apne aap background mein chalta rehta hai**. Koi button dabane ki zarurat nahi hai. Pehli baar browser mic ki permission maangega, **Allow** karna.
- Top-left corner ke chhote mic icon ka matlab:
  - 🟢 hara = sun raha hai
  - 🟠 orange = aapki baat sun raha hai, aur neeche live caption dikhta hai
  - ⚪ grey = mic band hai
  - 🔴 laal = mic blocked hai
- **Wake word "Vaani"** (default on): sirf wo baat command maani jaati hai jo "Vaani" se shuru ho, jaise *"Vaani, aaj kya important aaya?"* Kamre mein ho rahi baaki baatein ignore hoti hain. Sirf "Vaani" bolo to wo 8 second tak aapke sawaal ka intezaar karti hai.
- Agent bol raha ho to **"Stop" / "Ruko" / "Bas"** bolo, wo turant ruk jaayega. **Esc** key bhi kaam karti hai.
- Mic icon par click karke mic band/on kar sakte ho, aur wake word on/off kar sakte ho.
- Tab minimize karne ya doosre tab par jaane par mic **apne aap ruk jaata hai**, aur wapas aane par phir chalu ho jaata hai. Awaaz kahin save nahi hoti.

### Status popups
- Naya important email aate hi top-right mein ek **animated popup** aata hai. Har type ka apna colour aur icon hai:
  - 🏆 Offer
  - 📅 Interview
  - ⭐ Shortlisted
  - ⚡ Action pending
  - ✏️ Test
  - 🛡️ Scam alert
  - ❤️ Personal
  - 💳 Bank
  - ⚠️ Khud check karo
- Popup 9 second mein apne aap chala jaata hai. Mouse upar rakho to ruk jaata hai. Ek baar dikha hua email dobara popup nahi banta. Haan, "Aaj ki briefing suno" chalane par top emails phir se popup hote hain.
- Popup ya kisi bhi card par click karo to **detail window** khulti hai. Usme summary, deadline, aapko kya karna hai, Verified/AI confidence, "Gmail mein kholo" aur "Suno" button hote hain.

### Baaki
- **"Aaj ki briefing suno"** se 30-second voice summary milti hai.
- Header mein **Hinglish / हिंदी / English** aur **30 sec / Detail** mode chuno.
- Har card par **✓ Verified** = status ka saboot original email mein mila. **⚠ Khud check karo** = AI ka claim verify nahi hua.

Example sawaal:
- "Kaunse emails mein mera kaam pending hai?"
- "Is hafte kitne rejection aaye?"
- "Infosys ka kya status hai?"
- "Sirf important batao"

**Windows tip:** Hindi awaaz ke liye *Settings → Time & Language → Language & region → Add a language → Hindi* (speech ke saath) install karo. Edge browser ki "Online (Natural)" voices sabse natural lagti hain.

---

## Tests

```bash
npm test
```

21 tests chalte hain, aur inhe credentials ki zarurat nahi hai. Fake Gmail + fake Gemini + in-memory DB ke saath poora flow check hota hai:

- Login redirect mein sirf read-only scope ho, aur OAuth state CSRF check kaam kare
- Sync → PII redaction ("482913" jaisa OTP AI tak kabhi na pahunche)
- Truth verification (AI ka galat "offer" claim pakda jaaye)
- Duplicate merge (2 reminders → 1 card, latest deadline)
- Briefing, Q&A (AI ke invent kiye email IDs drop ho jaayein), input validation, "Delete my data"

Type check: `npm run typecheck`

---

## Background sync: 2 modes

| Mode | Kab use karein | Kaise |
|---|---|---|
| `SYNC_MODE=poll` (default) | Laptop / localhost | Har `POLL_INTERVAL_SEC` (60s) Gmail History API se sirf naye emails laata hai |
| `SYNC_MODE=pubsub` | Server ke paas public HTTPS URL ho | Gmail khud batata hai jab naya mail aaye (real-time) |

**Pub/Sub setup (optional):**
1. Cloud Console → **Pub/Sub** API enable → Topic banao, jaise `gmail-push`.
2. Topic → Permissions → principal `gmail-api-push@system.gserviceaccount.com` ko role **Pub/Sub Publisher** do.
3. Topic par **Push subscription** banao. Endpoint: `https://<your-domain>/api/gmail/push?token=<PUBSUB_VERIFICATION_TOKEN>`
4. `.env` mein: `SYNC_MODE=pubsub`, `GMAIL_PUBSUB_TOPIC=projects/<project-id>/topics/gmail-push`, `PUBSUB_VERIFICATION_TOKEN=<random string>`

Watch har din apne aap renew hoti hai. Iske alawa ek safety-net sync har 15 minute mein chalta hai.

---

## Production build (ek hi server par)

```bash
npm run build                 # web/dist banata hai
# server/.env mein:
#   NODE_ENV=production
#   WEB_ORIGIN=https://your-domain.com
#   GOOGLE_REDIRECT_URI=https://your-domain.com/api/auth/google/callback
npm start                     # API + dashboard dono port 4000 par
```

OAuth client mein bhi naya origin aur redirect URI add karna mat bhoolna.

---

## Security, ek nazar mein

> Poori details: **[SECURITY.md](SECURITY.md)**

- **Secrets GitHub par nahi jaate:** `.gitignore` saari `.env` files, Google credential JSON aur private keys ko block karta hai. `npm install` ke waqt ek **git pre-commit hook** apne aap on ho jaata hai, jo har commit se pehle API keys, passwords aur `.env` files dhoondhta hai, aur mile to commit rok deta hai. Poori repo khud check karni ho to: `npm run check-secrets`
- **Bring-your-own Gemini key:** har user ki key AES-256-GCM se encrypted save hoti hai. Browser ko sirf aakhri 4 akshar dikhte hain, aur key ko check karne wale endpoint par 10 tries / 15 min ki limit hai.
- **Least privilege:** sirf `gmail.readonly`. Phase 1 kuch delete, send ya modify nahi kar sakta.
- **Encrypted tokens:** Google refresh token AES-256-GCM se encrypt hokar save hota hai.
- **Session:** httpOnly + SameSite cookie, signed JWT, 7 din.
- **OAuth CSRF:** random `state` cookie se verify hota hai.
- **PII redaction:** AI ko bhejne se pehle *aur* DB mein save karne se pehle hoti hai. Raw HTML save nahi hota.
- **Truth verification:** bina saboot ke koi "offer/shortlisted" claim nahi kiya jaata.
- **Rate limits:** API par 120/min, AI endpoints par 20/min.
- **Helmet** security headers + CSP, aur zod se har input validate hota hai.
- **Delete my data:** Google token revoke + saare emails aur user record delete.
- Mic sirf tab chalta hai jab VaaniMail ka tab khula aur saamne ho. Wake word ke bina koi command nahi chalta, aur awaaz kahin save nahi hoti. (Note: Chrome ka built-in speech recognition awaaz ko text banane ke liye Google ke server par bhejta hai.)

---

## Common problems

| Problem | Solution |
|---|---|
| `.env configuration problem` | Error message mein jo field likhi hai, wo `server/.env` mein bharo |
| `MongoDB chal nahi raha` | MongoDB service start karo, ya Atlas connection string check karo (IP allow list bhi) |
| `redirect_uri_mismatch` | OAuth client ke redirect URI aur `.env` ka `GOOGLE_REDIRECT_URI` **bilkul same** hone chahiye |
| `access_denied` / "app not verified" block | OAuth consent screen → Test users mein apna email add karo |
| Har ~7 din baad dobara login | Testing mode mein Google refresh tokens 7 din mein expire karta hai. Ye normal hai. |
| "AI analysis ruk gaya: 429" | Gemini free tier limit lag gayi. `.env` mein `GEMINI_MIN_INTERVAL_MS=8000` karo, wo apne aap retry karega |
| Model not found | `GEMINI_MODEL` ko https://ai.google.dev/gemini-api/docs/models par diye kisi Flash model par set karo |
| Mic kaam nahi kar raha | Chrome/Edge use karo, address bar ke 🔒 icon se mic allow karo |
| Hindi awaaz nahi aa rahi | Upar ka Windows tip dekho, ya Edge use karo |

---

## Aage kya (Phase 2)

Chrome Extension + Full-screen Overlay, Search, Trash/Archive + Undo, Smart Reply Review & Approval, Preference Memory, Natural-language Rules, Interruptible voice commands. Phase 2 mein Gmail scope `gmail.modify` tak badhega.
