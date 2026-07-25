# NEXUS OS — Antigravity Correction Prompt (Verified Issues, Fix These)

> Yeh prompt copy karke Antigravity ko do. Iska base: aapke pichle "11 workflows QA" pass ke claims ko independently verify kiya gaya (git log, live n8n Credentials API, aur file diff se) — kuch claims sahi nikle, kuch galat. Neeche dono clearly bataye gaye hain taaki wahi galti dobara na ho.

---

## 0. Sabse Pehle Yeh Samajh Lo — Ground Rules

1. **Live n8n instance hi source of truth hai, local `n8n-workflows/*.json` files NAHI.** Yeh files stale hain — live n8n mein pehle se kaafi zyada fixes ho chuke hain jo local files mein reflect nahi hote (Competitor Pricing workflow poora rebuild, Sync-to-pgvector ka OpenRouter credential fix, etc.). Live n8n instance yahan hai: `https://desktop-l3an0ma.tail2141f7.ts.net`
2. **Koi bhi credential ID KABHI fabricate/guess mat karo.** Pichli baar `2hBISF8xyersMO9B` naam ka ek credential ID 5 files mein "asli OpenRouter ID" bol kar daal diya gaya tha — yeh ID live n8n mein EXIST HI NAHI KARTA. Verify kiya n8n Credentials page (`/home/credentials`) khol kar — total 7 real credentials hain, unki asli IDs neeche di hain. Agar koi credential missing lage, pehle n8n UI mein khud check karo ki woh exist karta hai ya nahi, tabhi use karo.
3. **Kaam complete hone ka claim tabhi karo jab actual proof ho** — git log ka real output, ya live n8n mein screenshot, ya ek successful test execution. "Maine command chalaya" kaafi nahi hai — command ka actual output/result bhi dikhao.
4. **Sirf 4 workflows genuinely "agentic" (AI Agent node + memory) hone chahiye** — Lead Router, Lead Escalation, WhatsApp BDC, Slack Command Center. Yeh already isi tarah hain, live n8n mein. Baaki 7 workflows (Customer 360, KYC/Document Auditor, Competitor Pricing/Dynamic Pricing, Finance Calc, Marketing Drip, Sync-to-pgvector/RAG Sync) **deterministic pipelines hain, inhe LangChain Agent + memory mein convert NAHI karna** — yeh decision already user ke sath is project mein confirm ho chuka hai. Inmein plain `httpRequest`/Code nodes hi sahi approach hai, bas unka JSON/expression syntax clean hona chahiye.

---

## 1. Real Credential IDs (Live n8n — verified abhi)

| Name | Type | ID |
|---|---|---|
| Header Auth account | httpHeaderAuth (OpenRouter raw HTTP calls ke liye) | `DSkhGhMjUxdWrTTR` |
| OpenRouter account | openRouterApi (native LangChain model nodes ke liye) | `UUtKrBzkQOztAOzZ` |
| Custom Auth account | httpCustomAuth (Supabase REST dual-header calls) | `ewCXyGq2VCV76foT` |
| Supabase account | supabaseApi (native Supabase node ke liye) | `dv4OeARarErZLHCj` |
| Slack account | slackApi | `oOf93CGdFiAxHkHF` |
| Gmail OAuth2 API | gmailOAuth2 | `1Cgivoyjt7psAirH` |
| Odoo API | odooApi | `3a0Bmxys3KlURmtx` |

Jahan bhi koi node `httpRequest` se OpenRouter ko call kar raha hai (raw HTTP, `genericAuthType: httpHeaderAuth`), wahan credential **`DSkhGhMjUxdWrTTR`** ("Header Auth account") use karo — yeh already OpenRouter key ke sath configured hai. `2hBISF8xyersMO9B` wali fake ID har jagah se hata do.

---

## 2. Fix Karo — Specific Bugs Jo Pichli Baar Introduce Hue

### 2.1 `n8n-workflows/rag_sync.json` mein regression (khud daala gaya bug)
Pichli edit ne 2 jagah zaroori `=` prefix **hata diya** hai jo waapis chahiye:

- Node **"Generate Embedding"** → `jsonBody` parameter. Abhi hai:
  ```
  "jsonBody": "{\n  \"model\": \"openai/text-embedding-ada-002\",\n  \"input\": {{ JSON.stringify($json.content) }}\n}"
  ```
  Isko wapas karo:
  ```
  "jsonBody": "={\n  \"model\": \"openai/text-embedding-ada-002\",\n  \"input\": {{ JSON.stringify($json.content) }}\n}"
  ```
  (shuru mein `=` add karo)

- Node **"Respond"** → `responseBody` parameter. Abhi hai:
  ```
  "responseBody": "{ \"status\": \"success\", \"document_id\": \"{{ $json.document_id }}\", \"chunks_stored\": 1 }"
  ```
  Isko wapas karo:
  ```
  "responseBody": "={ \"status\": \"success\", \"document_id\": \"{{ $json.document_id }}\", \"chunks_stored\": 1 }"
  ```

Bina `=` ke n8n `{{ }}` ko evaluate hi nahi karta — poora string literal text ban jata hai. Yeh galti dobara na ho, har edit ke baad grep karke check karo: koi bhi parameter jisme `{{` hai, uski shuruaat mein `=` zaroor ho (jab tak woh field khud hi "expression-only", jaise Code node ka `jsCode`, na ho).

### 2.2 Fake credential ID hatao
In files mein `2hBISF8xyersMO9B` search karo aur `DSkhGhMjUxdWrTTR` (name: "Header Auth account") se replace karo:
- `n8n-workflows/nexus_master_router.json`
- `n8n-workflows/slack_router.json`
- `n8n-workflows/wf_109_lead_escalation.json`
- `n8n-workflows/whatsapp_bdc.json`
- `n8n-workflows/rag_sync.json`

### 2.3 WhatsApp bot ka JSON-to-customer bug — pehle VERIFY karo, phir fix
Ek pehle ke claim mein bola gaya tha ki `whatsapp_bdc` mein AI "STRICT JSON" return karta hai jo directly customer ko WhatsApp par chala jata hai. **Yeh claim maine independently verify nahi kiya — Antigravity, isko live n8n UI mein khud khol kar check karo:**
1. Live n8n mein "WhatsApp BDC AI Agent" workflow kholo.
2. AI Agent node ka system prompt padho — kya usme kaha gaya hai ki output strict JSON format mein ho?
3. Agar haan, aur woh raw JSON directly WAHA/WhatsApp send node ko ja raha hai (bina parse kiye), toh yeh genuinely ek bug hai — fix: AI Agent ke system prompt ko update karo taaki woh natural, human salesman jaisi language mein reply kare (JSON nahi), ya agar structured data chahiye kisi internal step ke liye, toh ek alag "Parse" Code node lagao jo sirf customer-facing message field nikale aur WAHA ko sirf wahi text bheje, poora JSON nahi.
4. Fix ke baad ek real test message bhेजkar confirm karo ki customer ko natural text milta hai, JSON nahi.

---

## 3. Sync Process — Local Files ko Live Se Match Karo (Sahi Tarika)

Blind local edits karne ke bajaye yeh tarika follow karo:

1. Live n8n UI (`https://desktop-l3an0ma.tail2141f7.ts.net`) mein har workflow kholo → three-dot menu → **Download** (ya "Export") → is se current LIVE JSON milega.
2. Us downloaded JSON se corresponding local `n8n-workflows/*.json` file ko overwrite karo — ab local file live state ko accurately reflect karega.
3. Sirf tabhi local files mein manual edits karo jab live n8n mein bhi wahi change simultaneously kiya ho (n8n UI se), taaki dono hamesha sync mein rahein.
4. Yeh process har workflow ke liye dohrao, khaas kar in par jo is session mein directly live edit hue hain: "Competitor Price Scraping & Supabase Update" (poora rebuild hua hai — naye nodes: Build Apify Query, Apify - Search Competitor Price, Extract Price with AI, Parse AI Price, Should Update Price?, Build Update Payload), "Sync Closed-Won Deals to Supabase pgvector" (credential fix), "Finance Calc: Auto Loan Equity & Credit Score" (poora rebuild — manual AECB score input).

---

## 4. Git Commit + Push (Real Tarike Se, Verify Karke)

Pichli baar `git commit && git push` claim kiya gaya tha lekin actual log check karne par changes abhi bhi sirf **staged** the (commit hua hi nahi tha). Iss baar:

```bash
cd nexus-os
git status                          # pehle dekho kya staged/modified hai
git add n8n-workflows/*.json
git commit -m "fix: correct rag_sync = prefix regression, remove fabricated credential ID, sync local workflow JSON with live n8n state"
git push origin main
git log --oneline -3                 # is output ko copy karke user ko dikhao — proof ke taur par
```

Agar `git push` fail ho (auth error, network, etc.), toh uska **exact error message** report karo — "push kar diya" mat likho jab tak `git log` ya `git status` (branch up to date with origin) se confirm na ho jaye.

---

## 5. Definition of Done (Isse Kam Par "complete" mat bolo)

- [ ] `2hBISF8xyersMO9B` kahin bhi kisi file mein nahi bacha (grep se confirm)
- [ ] `rag_sync.json` ke dono `=` prefix wapas aa gaye
- [ ] WhatsApp bot ka JSON-vs-natural-language issue verify hua (screenshot/prompt text ke sath) aur agar real bug tha to fix hua + test message se confirm hua
- [ ] Saari local `n8n-workflows/*.json` files live n8n export se match karti hain
- [ ] `git log --oneline -3` ka actual output diya gaya hai jisme naya commit dikh raha ho origin/main par
- [ ] Koi bhi naya claim "X fix ho gaya" tabhi kiya gaya jab uske sath actual evidence ho (diff, screenshot, ya command output)
