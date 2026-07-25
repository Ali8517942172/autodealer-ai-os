# NEXUS OS — Baaki Bacha Hua Kaam (Antigravity Handoff Prompt)

> Yeh poora prompt copy karke Antigravity ko de do. Ismein poora context hai, kisi previous conversation ki zaroorat nahi.

---

## 1. Project Context (padhna zaroori hai)

NEXUS OS ek AI-powered automotive dealership operating system hai. Stack:

- **Automation/AI/RAG engine:** n8n (self-hosted, Docker, local) — **koi FastAPI ya Python backend NAHI hai**, sab kuch n8n ke andar hai.
- **WhatsApp:** WAHA (self-hosted WhatsApp HTTP API, Docker), n8n AI Agent nodes handle karte hain.
- **Database:** Supabase (Postgres + pgvector + Auth) — single source of truth. Local nahi hai, already live cloud DB hai.
- **CRM/ERP sync:** Odoo (`https://aliasgher.odoo.com`).
- **Dashboard:** Node.js + Socket.io + Tailwind (`nexus-os/apps/executive-dashboard`).
- **Zapier aur Make.com permanently hata diye gaye hain** — sirf n8n hai automation ke liye.
- Deployment target: Backend (n8n+WAHA) → Render. Frontend → Vercel. Supabase already cloud pe hai, migrate nahi karna.

Live n8n instance: `https://desktop-l3an0ma.tail2141f7.ts.net` (Tailscale Funnel tunnel se expose hai local Docker n8n ka).

**Important:** Iss project ki `.env` file mein already valid Supabase, OpenRouter, Slack, Odoo, Google OAuth credentials hain (`nexus-os/.env` dekho). Woh check karo pehle kisi bhi naye credential ki zarurat batane se pehle.

---

## 2. Critical Gotchas — yeh na dohrana

1. **n8n expression bug:** Kisi bhi node parameter mein `{{ ... }}` use karna hai toh string ki shuruaat mein literal `=` lagana zaroori hai (e.g. `"=Analyze this: {{$json}}"`). Bina `=` ke n8n us poore string ko static text samajh leta hai, expression evaluate hi nahi hota. Yeh bug pehle kai AI Agent prompts mein mila tha — dubara check karna kisi bhi naye/edited node mein.
2. **Switch node fallback:** `options.fallbackOutput` STRING `"extra"` hona chahiye, number nahi — warna fallback branch silently kaam nahi karta.
3. **Credential type mismatches:**
   - `@n8n/n8n-nodes-langchain.toolHttpRequest` (purana langchain HTTP Tool node) `httpCustomAuth`/generic credentials ACCEPT nahi karta. Iske bajaye native nodes use karo (jaise `n8n-nodes-base.supabaseTool` for Supabase).
   - `n8n-nodes-base.httpRequestTool` aur plain `n8n-nodes-base.httpRequest` dono generic credentials accept karte hain, koi problem nahi.
4. **Supabase API keys:** `sbp_...` prefix wali key = Management API Personal Access Token — yeh `/rest/v1/*` data calls ke liye KAAM NAHI karti. `sb_secret_...` / `sb_publishable_...` wali keys hi project data API ke liye sahi hain. Agar kahin `sbp_...` mila to woh galat key hai, replace karo.
5. **n8n `update_workflow` (agar MCP use kar rahe ho) atomic hota hai** — ek operation fail hua toh poora batch rollback ho jata hai. Chhote batches mein test karo.
6. **Ek specific n8n MCP tool bug hai** (agar Antigravity bhi n8n MCP use kar raha hai): `setNodeCredential` operation "KYC/AML Document Auditor" workflow ke "OpenRouter Vision (KYC Analysis)" node par consistently `Cannot read properties of undefined (reading 'execute')` error deta hai — yeh tool-level bug lagta hai, node/logic ki galti nahi. Isko **n8n UI mein manually** fix karna best hai (niche task #3 mein steps hain).

---

## 3. Baaki Bacha Hua Kaam (Priority Order Mein)

### Task 1 — Apify credential wire karo (Competitor Pricing workflow)
Workflow: **"Competitor Price Scraping & Supabase Update"** (n8n workflow ID `LphiGg4iqF1bn6El`).

Node **"Apify - Search Competitor Price"** mein query parameter `token` ki value abhi placeholder hai: `REPLACE_WITH_APIFY_API_TOKEN`.

Steps:
1. n8n UI → Credentials → New Credential → **Query Auth** type.
2. Name: `token`, Value: user ka Apify API token (unke paas hai, maang lena agar nahi diya).
3. Save karo, naam do "Apify account".
4. Us node ke `token` query parameter ko is naye credential se replace karo (ya credential reference wire karo, placeholder string hatao).

Yeh workflow already fully rebuilt hai real scraping ke sath: `Fetch Local Inventory → Build Apify Query → Apify - Search Competitor Price → Extract Price with AI (OpenRouter) → Parse AI Price → Should Update Price? → Build Update Payload → Update Prices in Supabase`. Sirf token wiring baaki hai.

**Zaroori verification:** `Build Apify Query` node (Code node) mein assume kiya gaya hai ki inventory items mein `brand`/`model`/`year` fields hain (fallback `name`/`sku` bhi hai). **Real Supabase `inventory` table ka schema check karo** aur agar column names alag hain toh us code node ko update karo — warna search queries galat/khaali banenge.

### Task 2 — KYC Auditor OpenRouter credential (manual fix)
Workflow: **"KYC/AML Document Auditor"** (ID `qTnh3nwWheFJbFkU`).

Node **"OpenRouter Vision (KYC Analysis)"** ka credential missing hai. n8n MCP tool se fix karne ki koshish 3 baar fail ho chuki hai (tool bug, upar dekho).

Manual fix: n8n UI mein workflow kholo → us node par click karo → "Credential for HTTP Header Auth" dropdown mein **"Header Auth account"** select karo (yeh credential already ban chuka hai, OpenRouter key already usme hai) → Save.

### Task 3 — Odoo credential "Access Denied"
Live n8n mein Odoo credential "Access Denied" error de raha hai. `.env` mein current values: `ODOO_URL=https://aliasgher.odoo.com`, `ODOO_DB=aliasgher`, `ODOO_USERNAME=aliasgher892@gmail.com`. Password/API key shayad expire ho gaya hai ya galat hai.

Fix: Odoo Settings → Users → API Keys se naya API key generate karo (password ke bajaye, zyada secure hai), n8n credential update karo. Workflow affected: **"wf_108 ERP Sync - Odoo"** (ID `bxNBzBrcOtcFpMPn`) aur **"Customer 360 - Data Aggregation"** (ID `AZkGM5M4c1uzSH7S`).

### Task 4 — Lead Escalation: Resend + Slack Alert nodes
Workflow: **"Lead Escalation - AI Agent"** (ID `KI6P1Qcf3MIZakNa`).

"Send Email via Resend" node ke paas real Resend API key nahi hai. "Send Slack Alert" node placeholder/broken hai.

Fix:
- User se real Resend API key lo (`resend.com/api-keys`) aur verified sender domain, `.env` mein `RESEND_API_KEY`/`RESEND_FROM_EMAIL` daalo, n8n credential banao.
- Slack Alert node ko native `n8n-nodes-base.slack` node se replace karo (working "Slack account" credential already available hai n8n mein), channel `#sales-hot-leads` target karo — lekin pehle Task 6 (Slack scope) fix karna padega warna yeh bhi fail hoga.

### Task 5 — 7-Day Warm Lead Drip Campaign
Workflow: **"7-Day Warm Lead Drip Campaign"** (ID `G7FhvMY2ucW5Fg7X`). Resend email nodes aur Twilio SMS node dono uncredentialed hain. Same Resend key Task 4 se use ho sakti hai. Twilio ke liye user se `TWILIO_ACCOUNT_SID` aur `TWILIO_AUTH_TOKEN` mangna padega (Twilio Console se) — agar SMS feature abhi priority nahi hai, is node ko disable kar do (`setNodeDisabled`) taaki workflow baaki sab kuch chalaye bina crash kiye.

### Task 6 — Slack bot channel access
Slack bot ko `#sales-hot-leads` channel mein invite nahi kiya gaya / ya `channels:read` OAuth scope missing hai. Fix: `api.slack.com` → apps → NEXUS OS app → OAuth & Permissions → Scopes mein `channels:read` (aur `chat:write` already hona chahiye) confirm karo → Slack mein `#sales-hot-leads` channel kholo → `/invite @NEXUS OS` (ya jo bhi bot ka naam hai) type karo.

### Task 7 — Ask-AI RAG query workflow (missing, banana hai)
Blueprint mein "Ask AI" feature hai (dashboard mein screen bhi design hui hai) lekin ismein query karne wala n8n workflow abhi tak nahi bana. Chahiye:
- Webhook trigger jo user ka sawaal receive kare.
- n8n **Supabase Vector Store node** (as Tool) query kare `deals_embeddings` ya knowledge-base table pgvector se (cosine similarity).
- n8n **AI Agent node** (OpenRouter chat model) retrieved context ke sath grounded, cited jawab de.
- Response webhook trigger ko wapas bheje.

Existing pattern dekho **"Sync Closed-Won Deals to Supabase pgvector"** workflow (ID `dhy2DDjWUqwuzHLW`) mein — wahan embeddings kaise generate/store ho rahe hain, wahi pattern query-side pe reverse mein use karo.

### Task 8 — Git push blocker
Do local commits (`7651410`, `459083f`) `nexus-os` branch par abhi tak GitHub (`Ali8517942172/autodealer-ai-os`) pe push nahi hue — is machine/session mein GitHub credentials configure nahi hain. Plus `.env` mein Supabase key fix hua tha, woh commit bhi nahi hua abhi tak.

Antigravity ke paas agar local machine access hai (jahan `git` already authenticated hai) toh:
```bash
cd nexus-os
git add .env docs/AI_Development_Workflow.md
git commit -m "fix: correct Supabase key type + remove stale FastAPI doc reference"
git push origin nexus-os
```
Isके baad Render deployment (Task 9) unblock ho jayega.

### Task 9 — Render deployment
n8n + WAHA abhi sirf local Docker mein chal rahe hain. Render par deploy karna hai (`render.yaml` already `nexus-os/` mein maujood hai, pehle audit ho chuka hai ki Dockerfile reference sahi hai). Git push (Task 8) hone ke baad Render dashboard se connect karke deploy karo.

### Task 10 — Vercel duplicate projects cleanup
Vercel account mein multiple duplicate dashboard projects ban gaye the (pichli sessions mein). Audit karo `list_projects` se aur sirf ek asli active project rakho, baaki archive/delete karo.

### Task 11 — Purani execution error investigate karo
"Customer 360 - Data Aggregation" workflow (ID `AZkGM5M4c1uzSH7S`) mein 24 July ~15:00 UTC ek execution "Error" status se fail hui thi, abhi tak investigate nahi hui. n8n Executions tab mein dekho, root cause identify karo (probably same Odoo Access Denied issue — Task 3 fix hone ke baad recheck karo).

---

## 4. Verification / Definition of Done

Har task complete hone ke baad:
1. Us workflow ko `validate_workflow` / ya n8n UI mein khol ke check karo — koi validation warning na ho.
2. Ek test execution chalao (manual trigger ya webhook test call) aur confirm karo real data flow ho raha hai (mock/placeholder data nahi).
3. Koi bhi naya secret sidha node parameter mein hardcode NA karo — hamesha n8n Credential object banao aur wire karo. (Isi galti ko is session mein baar baar fix kiya gaya hai — Supabase, OpenRouter dono jagah.)
4. Jo bhi `.env` ya doc files change karo, git commit karo (chhote, clear commit messages ke sath).

---

**Priority agar sab ek sath nahi ho sakta:** Task 1 (Apify token) → Task 2 (KYC) → Task 6 (Slack scope) → Task 4/5 (Resend/Twilio) → Task 3 (Odoo) → Task 8/9 (git+deploy) → Task 7 (Ask-AI) → Task 10/11 (cleanup/investigate).
