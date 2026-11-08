# Security

## 0. Chrome extension (main product)

- No Vaani server: the extension talks directly to Gmail (with the user's Google sign-in via `chrome.identity`) and to Gemini (with the user's own key).
- Everything Vaani stores (redacted email copies, analysis, the user's Gemini key, the last action for Undo) lives in that browser profile's `chrome.storage.local`, which web pages, including Gmail, cannot read. **Sign out** revokes Google access and deletes it all.
- Each user signs in with **their own** Google OAuth Client ID (their own Cloud project), via `chrome.identity.launchWebAuthFlow`. A Client ID is not a secret. The extension never asks for, or accepts, a Client **secret** (it refuses anything that looks like `GOCSPX-…`).
- Access tokens live only in `chrome.storage.session` (memory, cleared when the browser closes) and are renewed silently. A random `state` value protects the sign-in against CSRF, and Vaani checks that Gmail permission was really granted.
- The overlay runs in a closed Shadow DOM, all email text is HTML-escaped before display, and the test-only hook is removed from normal builds.


## 1. Kaunsi cheezein SECRET hain (GitHub par kabhi nahi jaani chahiye)

| Secret | Kahan rehta hai | Leak ho jaaye to kya hoga |
|---|---|---|
| `GOOGLE_CLIENT_SECRET` | sirf `server/.env` | Koi tumhari app ke naam se login flow bana sakta hai |
| `GEMINI_API_KEY` (agar server key use karte ho) | sirf `server/.env` | Koi tumhare quota / billing par AI chala sakta hai |
| User ki Gemini key | DB mein **encrypted** (`encGeminiKey`) | `ENCRYPTION_KEY` ke bina padhi nahi ja sakti |
| `MONGODB_URI` (password ke saath) | sirf `server/.env` | Poora database khul jaayega |
| `ENCRYPTION_KEY` | sirf `server/.env` | Saved Google tokens aur Gemini keys decrypt ho sakti hain |
| `SESSION_SECRET` | sirf `server/.env` | Koi fake login session bana sakta hai |
| `PUBSUB_VERIFICATION_TOKEN` | sirf `server/.env` | Koi fake "naya mail aaya" signal bhej sakta hai |
| Google credential JSON (`client_secret_*.json`) | repository ke **bahar** rakho | Client secret leak |
| `server/data/*.json` (app ka database) | sirf server par | Users ki list, encrypted tokens aur redacted email copies. `.gitignore` aur secret check dono ise GitHub par jaane se rokte hain |

GitHub par sirf **`server/.env.example`** jaata hai, jisme koi asli value nahi hoti.

## 2. Teen suraksha deewarein

1. **`.gitignore`** – `.env`, `.env.*`, `client_secret*.json`, `credentials*.json`, `*service-account*.json`, `*.pem`, `*.key` ko git kabhi track nahi karega.
2. **Pre-commit hook** (`.githooks/pre-commit` → `scripts/check-secrets.mjs`) – `npm install` karte hi apne aap on ho jaata hai. Har commit se pehle ye check karta hai:
   - Google/Gemini API keys (`AIza…`), OAuth client secrets (`GOCSPX-…`), Google tokens
   - private keys, password wale MongoDB URLs, GitHub tokens
   - `.env` files aur upar ki secret variables mein asli values

   Agar kuch mila to **commit ruk jaata hai** aur file aur line number dikhaaye jaate hain.
3. **Manual check** – kabhi bhi poori repository check karo:
   ```bash
   npm run check-secrets
   ```

> Hook band nahi karna chahiye. `git commit --no-verify` hook ko skip kar deta hai, isse use mat karna.
> Agar kisi line mein jaan-boojhkar ek nakli (example) key likhni ho, to us line mein `secret-scan:allow` likh do.

## 3. Galti se secret GitHub par chala gaya? Turant ye karo

Sirf commit delete karna **kaafi nahi hai**. GitHub ki history aur forks mein secret reh jaata hai. **Secret ko badlo (rotate karo):**

| Kya leak hua | Kya karna hai |
|---|---|
| Gemini API key | https://aistudio.google.com/apikey → purani key **Delete** → nayi banao |
| Google Client Secret | Cloud Console → Google Auth Platform → Clients → apna client → **Reset secret** (ya naya client banao) |
| MongoDB password | Atlas → Database Access → user ka **password badlo** |
| `SESSION_SECRET` | Naya random value daalo (sab users ko dobara login karna padega) |
| `ENCRYPTION_KEY` | Naya value daalo **aur** DB mein saved tokens/keys hatao (users dobara login karke apni Gemini key dobara daalenge) |

Uske baad secret ko history se hatana ho to [GitHub ka guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) dekho.

## 4. App ke andar user data ki suraksha

- Gmail access `gmail.modify` hai: padhna aur Trash mein bhejna. App email **send nahi kar sakta** aur **permanently delete nahi kar sakta**.
- Spam delete jaisa har action sirf aapke "confirm" ke baad hota hai, `actions` collection mein log hota hai, aur "Undo" se wapas aata hai.
- Chrome extension ka token sirf extension ke background worker mein rehta hai (Gmail page use nahi padh sakta). Server par sirf uska SHA-256 hash save hota hai. Is token se account delete, Gemini key change ya naya token nahi ban sakta.
- Google refresh token aur user ki Gemini key **AES-256-GCM** se encrypted save hote hain.
- OTP, Aadhaar, PAN, card, phone, UPI aur passwords AI ko bhejne aur DB mein save karne se **pehle mask** ho jaate hain.
- Session httpOnly + SameSite cookie mein rehta hai. Rate limits lage hain: API 120/min, AI 20/min, key check 10 / 15 min.
- **Delete my data** se Google token revoke hota hai, aur emails, user record aur Gemini key sab delete ho jaate hain.

## 5. Security problem report karna

Agar is project mein koi security problem mile, to public GitHub issue mat kholo. Repository owner ko seedha message karo.
