# Vaani — Hinglish guide (step by step)

> English README: [../README.md](../README.md)

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
- Permission `gmail.modify` hai: padhna, Trash, draft aur send. Vaani **permanently delete nahi kar sakta**. Har delete se pehle aapka "confirm" chahiye, aur Undo milta hai.
- **Reply (Phase 2):** "Vaani, TCS ko reply karo" → 3 ideas → draft → Vaani padhkar sunata hai → "send it" bolo. 5 second tak "stop" bolkar rok sakte ho. "make it shorter", "save as draft", "cancel" bhi chalta hai.
- **Apna naam:** install ke baad assistant puchta hai "What would you like to call me?" — jo naam bologe (Nova, Zara…) wahi wake word ban jata hai. Baad mein: "change your name to …" ya popup mein "Assistant's name".
- **Naya email:** "write an email to Rahul about the project update" / "Priya ko mail bhejo ki main late hoon" / "compose kholo" → kisko bhejna hai → kya likhna hai → draft padh ke sunata hai → "send it".
- **Gmail kaam:** "archive it", "mark as read", "star this", "delete this email", "mark all as read" — sab ka Undo.
- **Calendar:** "what's on my calendar tomorrow", "kal ka schedule", "add this to my calendar", "Friday 3 baje Rahul ke saath meeting add karo".
- **Notes (Google Tasks):** "note: bank ko call karna", "resume update karna hai note kar lo", "show my notes".
- **Stop sabse pehle:** "stop", "ruko", "bas", "chup" bolte hi assistant turant chup (aapke bolte-bolte). Aap beech mein kuch bhi bolo to woh chup ho kar wahi karega.
- **Poora sidebar:** "promotions kholo", "important kholo", "purchases dikhao", "manage subscriptions", "gmail settings kholo", "all mail kholo" — sab kuch. Apne labels bhi: "IMPORTANT MAIL label kholo", "create a label called Jobs", "isko Jobs label mein daalo".
- **Sabke liye (naya):** AI har email padh ke samajhta hai ki woh kis kaam ka hai (help maangi, sawaal, meeting, bill, deadline, order, job…) aur "aapse kya chahiye". Full window ke dabbe aapke inbox se bante hain. Setup mein "What do you use email for?" chuno (Job search / Study / Work / Business / Personal) — wahi cheezein upar aayengi.
- Poocho: "kisi ne aaj help maangi hai", "any questions for me", "show my bills", "what's pending", "jinka reply nahi diya".
- **Alerts:** "jab bhi koi help maange mujhe batana", "tell me whenever TCS emails", "show my alerts", "stop all alerts" — Chrome notification + awaaz.
- **Job analytics:** "show my job funnel", "which companies ghosted me", "follow up with TCS", "kaunsi company kitne din mein reply karti hai".
- **Reports:** "weekly report" (Monday ko apne aap), "upcoming deadlines", "show my contacts".
- **Purane emails:** "import my old emails" (6 mahine) — din ki free AI limit ke andar dheere-dheere; "import status".
- **SQL history (naya):** saare emails aapke computer par SQLite database mein save hote hain (kuch install nahi karna). Poocho: "is mahine kitne interview aaye", "how many rejections last month", "show my job tracker", "TCS ka status kya hai", "search my history for offer letter", "show my stats", "aaj kya kiya", "export my applications" (CSV download). Inme AI quota kharch nahi hota aur jawab turant aata hai.
- **Doosre tab se:** Gmail tab khula ho to doosre tab mein bhi naam bolo — Gmail aage aa jayega. Ya `Ctrl+Shift+Space`.
- **Setup mein naya:** Google Cloud mein Gmail ke saath **Google Calendar API** aur **Google Tasks API** bhi Enable karo. Pehle se sign-in hai to setup panel mein "Allow Calendar & Notes" ek baar dabao.
- **Date / search:** "25 oct ka message dikhao", "kal ke mail", "unread emails", "attachment wale emails" → Gmail search khulta hai aur cards dikhte hain (poore Gmail mein, sirf pichhle hafte nahi).
- **Microsoft Edge:** Edge ki speech service aksar extension mein kaam nahi karti ("network" error). Voice ke liye **Google Chrome** use karein. Edge mein `Alt+V` se type karke command de sakte ho.
- **Baat-cheet:** "how are you", "kaise ho", "thank you", "who are you" → Vaani turant dosti se jawab deta hai (AI quota kharch nahi hota).
- **Samajhdaar:** "open inbox" jaisi saaf command bina "Vaani" bole bhi chalti hai. Baaki kuch bhi bolo ("kya mera koi naukri ka call aaya?") to AI samajh ke sahi kaam karta hai.
- **Free limit khatam ho jaye:** Vaani dusre free model par chala jata hai. Sab khatam ho to bhi naye emails sender + subject ke saath dikhte hain.
- **Awaaz chuno:** "Vaani, change voice" bolo, ya extension icon → popup → "Vaani's voice". Speed aur pitch bhi badal sakte ho.
- Mic sirf tab chalta hai jab Gmail tab saamne ho. Awaaz save nahi hoti. Chrome ka speech recognition awaaz ko text banane ke liye Google ko bhejta hai.
- Details: [SECURITY.md](../SECURITY.md)

## Developers

```bash
npm install
npm test             # server + extension tests
npm run release      # build extension → extension/release/vaani-extension
```
- `extension/`: Chrome extension (main product)
- `server/src/ai/*Core.ts`, `server/src/intel/`, `server/src/privacy/`: shared AI / verification / privacy logic, jo extension mein bundle hota hai
- `server/` + `web/`: **optional** purana web dashboard aur server, jo normal users ke liye zaroori nahi hai. Dekho [server-dashboard.md](server-dashboard.md)
- `design/`: editable HUD design file
