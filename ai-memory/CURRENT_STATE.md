# Current State
> Last Updated: 2026-07-22

## ✅ Completed
- [x] Initial Codebase Push to GitHub (`autodealer-ai-os`)
- [x] Resume and Dashboard Branding (Production Render URLs, GitHub links updated)
- [x] Browser Subagent Execution Policy created (`SKILL.md` & `docs/browser_subagent_instructions.md`)
- [x] Main Agent Delegation Policy created (`.agents/AGENTS.md`)
- [x] AI Engineering Portfolio System instantiated (`ai-memory` structure)
- [x] Master Blueprint written & saved (`nexus_blueprint.md`)
- [x] **Tailscale Funnel setup** — permanent tunnel active at `https://desktop-l3an0ma.tail2141f7.ts.net/`
- [x] **n8n connected to Claude Desktop via MCP** — using `npx mcp-remote` through Tailscale URL
- [x] `docker-compose.yml` updated with Tailscale WEBHOOK_URL & N8N_EDITOR_BASE_URL
- [x] `claude_desktop_config.json` updated with permanent Tailscale MCP URL
- [x] **Contract Auditor frontend** built (`index.html`) — car dealer contract hidden fee detector
- [x] **n8n workflow JSON** for Contract Auditor structured
- [x] **OpenRouter API Key** acquired (free tier)
- [x] Session chat history compiled → `Alba_Cars_Project_Chats.md` in parent folder
- [x] **Architectural Migration:** Zapier and Make.com workflows completely deleted and replaced by a unified `nexus_master_router.json` in n8n.

## ⏳ In Progress / Blocked

### Automations
- [x] n8n: Import "Lead Ingestion" and "Daily Briefing" workflows (Deployed automatically via script)
- [x] n8n: Import Contract Auditor workflow (Deployed automatically)

### Cloud Deployment
- [ ] Deploy backend services (API, Marketing, Gateway) to Render
- [ ] Deploy frontend to Vercel

---

## ⚙️ n8n — 10 Workflows (All Active ✅)
> Docker running | http://localhost:5678 | Login: aliasgher892@gmail.com / Ali@7861105253
> Tailscale: https://desktop-l3an0ma.tail2141f7.ts.net

| ID | Workflow | Active | Webhook Path | Status |
|----|----------|--------|--------------|--------|
| wf_100 | Customer 360 - Data Aggregation | ✅ | — | ⚠️ Gmail OAuth needs 1 click |
| wf_101 | KYC/AML Document Auditor | ✅ | /webhook/audit-kyc | ✅ |
| wf_102 | Competitor Price Scraping | ✅ | — | ✅ 10 real UAE dealers |
| wf_103 | Finance Calc: Auto Loan | ✅ | /webhook/finance-calc | ✅ |
| wf_104 | 7-Day Warm Lead Drip | ✅ | — | ✅ |
| wf_105 | Sync Deals to pgvector | ✅ | /webhook/new-deal | ✅ |
| wf_106 | Slack Command Center | ✅ | /webhook/slack/command/crm-update | ✅ Channel ID C0BJ5PLTPDJ |
| wf_107 | WhatsApp BDC AI Agent | ✅ | Meta webhook | ⚠️ Needs Meta Phone Number ID |
| wf_108 | ERP Sync: HOT Leads → Odoo CRM | ✅ | /webhook/erp-sync | ✅ MIGRATED FROM MAKE |
| wf_109 | Lead Escalation: Save + Email | ✅ | /webhook/lead-escalation | ✅ MIGRATED FROM MAKE |

Replaces: Make Scenario 1 (6524449) — NOW DEACTIVATED
Flow: Webhook → GET Supabase HOT leads → Odoo Login → Loop each lead → Create Odoo CRM lead → Respond

### wf_109 — Lead Escalation (ID: dYPIvmmllnxhEmVs)
Replaces: Make Scenario 2 (6524643) — NOW DEACTIVATED
Flow: Webhook → POST lead to Supabase → Build HOT email → Send via Resend → Respond

---

## ❌ MAKE.COM — DEACTIVATED (Replaced by n8n)
| Scenario | ID | Status |
|----------|-----|--------|
| ERP Sync (CRM to Odoo) | 6524449 | ❌ DEACTIVATED |
| Lead Escalation (Email + CRM) | 6524643 | ❌ DEACTIVATED |

> Old webhooks now dead. All traffic routes through n8n.

---

## ❌ ZAPIER — NO ACTIVE ZAPS
- Slack + Gmail connected but zero automated Zaps were running
- System never used Zapier for any automation — only MCP access
- Can be disconnected from system docs

---

## n8n Credentials (All Created)
| Credential | Type | ID | Status |
|-----------|------|----|--------|
| Gmail OAuth2 - Alba Cars | gmailOAuth2 | xxTAonO2KV6cmKzK | ⚠️ Created, needs OAuth click |
| WhatsApp Business API Token | httpHeaderAuth | W1bKj9lO2JiWjifO | ✅ |
| Twilio SMS API | twilioApi | uSZczHzmgv3bHs5w | ✅ |
| Supabase - Alba Cars | supabaseApi | WxfEocKnaEZhpmoV | ✅ |
| Supabase Postgres (Docker) | postgres | 2njx6fRNkElVRJ6x | ✅ |
| OpenRouter API | httpHeaderAuth | 2hBISF8xyersMO9B | ✅ |
| Slack - Alba Cars Bot | slackApi | HPTEqLu6xjmhEXDN | ✅ |
| Odoo - Alba Cars | odooApi | QFndoyD3gLoVLidE | ✅ |
| Resend Email API | httpHeaderAuth | AUsufgmxQqmkeIPw | ✅ |
| Supabase REST (HTTP) | httpHeaderAuth | SyZEhmMRL9vUAzSK | ✅ |

---

## 🔑 Key Credentials & URLs
| Item | Value |
|------|-------|
| n8n local | `http://localhost:5678` |
| n8n Tailscale | `https://desktop-l3an0ma.tail2141f7.ts.net/` |
| Supabase Project | `dsvuoovivysszdoiorch.supabase.co` |
| GitHub Repo | `Ali8517942172/autodealer-ai-os` |
| Slack #sales-hot-leads | Channel ID: `C0BJ5PLTPDJ` |
| Full credentials | `alba-ai-platform/.env` |

### Active Webhook URLs
| Workflow | URL |
|----------|-----|
| wf_101 KYC | `https://desktop-l3an0ma.tail2141f7.ts.net/webhook/audit-kyc` |
| wf_103 Finance | `https://desktop-l3an0ma.tail2141f7.ts.net/webhook/finance-calc` |
| wf_105 Deals | `https://desktop-l3an0ma.tail2141f7.ts.net/webhook/new-deal` |
| wf_106 Slack | `https://desktop-l3an0ma.tail2141f7.ts.net/webhook/slack/command/crm-update` |
| wf_108 ERP Sync | `https://desktop-l3an0ma.tail2141f7.ts.net/webhook/erp-sync` |
| wf_109 Escalation | `https://desktop-l3an0ma.tail2141f7.ts.net/webhook/lead-escalation` |

---

## ⏳ PENDING — Kaam Baaki Hai

### 🔴 P1 — Ek Manual Click (30 seconds)
**wf_100 Gmail OAuth Authorization**
- URL: `http://localhost:5678/home/credentials/xxTAonO2KV6cmKzK`
- Action: "Sign in with Google" → aliasgher892@gmail.com se authorize karo

### 🔴 P2 — WhatsApp Business API Setup
**wf_107 WhatsApp BDC — Phone Number ID chahiye**
- Go to: [business.facebook.com](https://business.facebook.com) → WhatsApp → Manage Phone Numbers
- Register +971526647253 → get numeric Phone Number ID
- Set `WHATSAPP_PHONE_NUMBER_ID=<ID>` in Docker env → restart container

### 🟡 P3 — Manual Cleanup (User Action Required)
**Vercel — 2 Projects Delete Karo** *(needs explicit user confirmation to delete)*
- `alba-rag-system` (prj_f7RGDjMVNXKCQRWlKieVmR1GgwuI)
- `alba-erp-crm` (prj_esi6ROVVsKfeTQi75rLHFlGOUM0F)
- Keep only: `autodealer-ai-os`

**Render — 5 Services Delete Karo** *(user must confirm or do manually)*
- `autodealer-gateway`, `autodealer-dashboard`, `autodealer-marketing`, `autodealer-crm-api`, `autodealer-rag`

---

## 🟢 Production Status — Full System

| System | Status | Notes |
|--------|--------|-------|
| n8n Docker | ✅ LIVE | 10/10 workflows active |
| Tailscale Funnel | ✅ LIVE | Permanent HTTPS tunnel |
| wf_101 KYC Auditor | ✅ LIVE | OpenRouter Vision |
| wf_102 Competitor Intel | ✅ LIVE | 10 UAE dealers real data |
| wf_103 Finance Calc | ✅ LIVE | DTI/credit scoring |
| wf_104 Drip Campaign | ✅ LIVE | Twilio + Resend |
| wf_105 pgvector Sync | ✅ LIVE | OpenRouter embeddings |
| wf_106 Slack CRM | ✅ LIVE | Channel C0BJ5PLTPDJ |
| wf_108 ERP Sync | ✅ LIVE | Replaces Make Scenario 1 |
| wf_109 Lead Escalation | ✅ LIVE | Replaces Make Scenario 2 |
| Make.com | ❌ OFF | Both scenarios deactivated |
| Zapier | ❌ N/A | Never had running Zaps |
| wf_100 Customer 360 | ⚠️ PARTIAL | Gmail OAuth authorize karo |
| wf_107 WhatsApp BDC | ⚠️ PARTIAL | Meta Phone Number ID chahiye |

---

## wf_102 — UAE Competitor Data (10 Real Dealers)
| Dealer | Brand | URL |
|--------|-------|-----|
| Al-Futtaim Toyota | Toyota | toyota.ae |
| Al-Futtaim Honda | Honda | honda.ae |
| Gargash | Mercedes-Benz | gargash.ae |
| Arabian Automobiles | Nissan/Infiniti | arabianautomobiles.com |
| Al Habtoor Motors | Mitsubishi | alhabtoormotors.com |
| Al Nabooda | VW/Audi | alnabooda.com |
| Galadari | Mazda | galadariautomobiles.com |
| Swaidan Trading | Hyundai/Kia | swaidantrading.com |
| Trading Enterprises | Jeep/Dodge | tradingenterprises.ae |
| Al Rostamani | Ford | alrostamani.ae |

---

## 📄 Documentation
- Master Blueprint: `autodealer_blueprint.md`
- AI Rules: `ai-memory/rules/AI_AGENT_RULES.md`
- Automation Module: `ai-memory/modules/AUTOMATION.md`
- Current State: `ai-memory/CURRENT_STATE.md` (this file)
