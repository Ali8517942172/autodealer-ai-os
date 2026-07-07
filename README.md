# AutoDealer AI OS

**AutoDealer AI OS** is an enterprise AI operating system for automotive dealerships that unifies CRM, Marketing, Knowledge Management, Sales Intelligence, Inventory Lifecycle, and Business Automation into a single platform.

The platform is designed to increase dealership profitability, reduce operational overhead, improve lead conversion, and enable AI-assisted decision making across every department.

> *Reference implementation created for the Alba Corp AI Engineer portfolio challenge.*

---

## Business Problems This Platform Solves

| Problem | Current Manual Process | AI-Powered Solution |
|---------|----------------------|---------------------|
| Leads go cold | Salesperson manually checks inbox every few hours | AI scores and routes leads in < 60 seconds |
| No pricing intelligence | Manager guesses competitor pricing | Daily automated competitor scraping with AI recommendations |
| Slow customer answers | Employee searches through PDF folders | RAG-powered Knowledge Assistant with source citations |
| Revenue leakage | Commission and margin calculated in Excel | Real-time financial intelligence with automated costing |
| Disconnected systems | Copy-paste between CRM, ERP, WhatsApp, Email | Event-driven automation connecting all platforms |
| Vehicle aging losses | Nobody tracks holding costs until it's too late | AI flags aging inventory and suggests price reductions |
| Slow onboarding | New hires take weeks to learn policies | Knowledge Agent answers any policy question instantly |

---

## Platform Modules

### 1. AI-Powered CRM (`apps/ai-crm/`)
**Business Problem:** Leads from multiple channels (website, WhatsApp, walk-ins, referrals) are handled inconsistently. Response times vary from minutes to days. No standardized qualification process.

**Solution:** AI-first CRM that automatically scores every lead, assigns priority, routes to the right salesperson, and triggers multi-channel follow-up — all within 60 seconds of lead creation.

### 2. Marketing Intelligence OS (`apps/marketing-os/`)
**Business Problem:** Marketing team has no visibility into competitor pricing. Campaigns are created based on intuition rather than data. No way to measure true ROI per channel.

**Solution:** Daily automated competitor scraping with AI-powered pricing recommendations. Campaign generator that creates multi-channel content (Google, Meta, WhatsApp) based on actual market gaps. Revenue attribution that connects marketing spend directly to closed deals.

### 3. Enterprise Knowledge Assistant (`apps/enterprise-rag/`)
**Business Problem:** Company policies, vehicle manuals, warranty terms, and sales procedures are buried in PDF folders. Employees waste hours searching for answers. New hires take weeks to become productive.

**Solution:** Multi-agent RAG system where specialized AI agents (Compliance, Sales Support, Marketing) answer questions with exact source citations. Supports HR policies, finance procedures, warranty terms, sales SOPs, and vehicle documentation.

### 4. Vehicle Inventory Intelligence (`apps/inventory-intel/`)
**Business Problem:** Vehicles sit in stock for months without price reviews. Holding costs (AED 50/day) silently erode margins. No systematic way to track the full vehicle lifecycle from purchase to resale.

**Solution:** AI-powered inventory lifecycle management that tracks every vehicle from import through sale, calculates real-time holding costs, flags aging stock, predicts demand, and recommends optimal pricing.

### 5. Automation Engine (`apps/automation-engine/`)
**Business Problem:** Business processes require manual handoffs between CRM, ERP, WhatsApp, email, and spreadsheets. Data gets lost. Steps get skipped. No audit trail.

**Solution:** Event-driven automation hub powered by n8n and Make that connects every system. When a lead arrives, it automatically flows through scoring, CRM creation, salesperson assignment, WhatsApp confirmation, and dashboard update — without human intervention.

### 6. Executive Dashboard (`apps/executive-dashboard/`)
**Business Problem:** Management relies on end-of-month reports to make decisions. No real-time visibility into sales pipeline, inventory health, marketing ROI, or team performance.

**Solution:** Live dashboard pulling from all modules showing today's sales, lead conversion, revenue, profit, marketing ROI, inventory aging, and AI-generated forecasts.

---

## Measurable Business KPIs

| Capability | KPI |
|-----------|-----|
| AI Lead Scoring | Higher qualified lead conversion |
| AI Sales Copilot | Reduced quotation preparation time |
| Knowledge Assistant | Faster onboarding and information retrieval |
| Marketing Intelligence | Better campaign targeting and attribution |
| Inventory Intelligence | Reduced aging inventory and holding costs |
| Executive Dashboard | Faster management decision-making |

---

## Dealership Financial Intelligence

Built by an engineer with professional accounting background. The platform doesn't just track cars — it tracks money.

| Metric | Description |
|--------|-------------|
| Gross Margin | Selling price minus total landed cost |
| Net Profit | Gross margin minus all commissions and VAT |
| Floor Plan Financing Cost | Daily interest cost of financing inventory |
| Vehicle Aging Analysis | Days in stock with holding cost accumulation |
| Holding Cost per Day | Storage, insurance, depreciation (AED 50/day default) |
| Break-even Price | Minimum selling price to avoid loss |
| Expected Margin | AI-predicted margin based on market conditions |
| Reconditioning Cost | Per-vehicle repair and preparation costs |
| Trade-in Profitability | Margin analysis on trade-in vehicles |
| Finance Partner Commission | Bank commission on approved loans |
| Accessory Attach Rate | Percentage of deals with accessory upsells |
| Warranty Margin | Revenue from extended warranty sales |
| Salesperson Incentive Forecast | Projected commissions based on pipeline |
| VAT Reporting | Input/Output VAT tracking per transaction |

---

## Multi-Agent Architecture

Each agent is specialized for a specific business domain:

| Agent | Role | Trigger |
|-------|------|---------|
| Lead Agent | Scores and qualifies incoming leads | New lead event |
| Sales Agent (Cowork) | Assists salesperson with quotes, follow-ups | Salesperson request |
| Finance Agent | Checks loan eligibility, calculates EMI | Finance application |
| Inventory Agent | Monitors stock aging, recommends pricing | Daily cron / manual |
| Marketing Agent (Hermes) | Generates campaigns, analyzes competitors | Campaign request / daily |
| Knowledge Agent (Openclaw) | Answers policy/manual questions with citations | Employee query |
| Compliance Agent | Validates warranty claims, checks regulations | Claim submission |
| Manager Agent | Summarizes team performance, flags issues | Daily digest |

---

## Event-Driven Architecture

The platform runs on business events, not just API calls:

```
Lead Created → Event Bus → CRM + Marketing + Notification + Analytics
Deal Closed  → Event Bus → ERP + Commission + Inventory + Dashboard
Vehicle Aged → Event Bus → Price Review + Marketing + Manager Alert
Claim Filed  → Event Bus → RAG + Service + Compliance + Customer Update
```

---

## Production Engineering

| Category | Implementation |
|----------|---------------|
| Authentication | Supabase Auth with JWT |
| Authorization | Role-Based Access Control (RBAC) |
| Database | Supabase (Postgres), MongoDB, pgvector |
| API Documentation | OpenAPI / Swagger |
| Containerization | Docker + Docker Compose |
| CI/CD | GitHub Actions |
| Audit Trail | Every data mutation logged with user, timestamp, and diff |
| Health Checks | `/api/health` on every service |
| Rate Limiting | Per-user API rate limits |
| Secrets Management | Environment variables via `.env` (never committed) |
| Error Handling | Structured error responses with correlation IDs |
| Background Jobs | Cron-based scrapers, scheduled reports |
| API Versioning | `/api/v1/` prefix on all endpoints |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | ReactJS, Vite, Tailwind CSS |
| Backend | Node.js (Express), Python (FastAPI) |
| Databases | Supabase (Postgres + Auth), MongoDB, pgvector |
| AI/LLM | OpenRouter, LangChain, LangGraph |
| Automation | n8n, Make |
| ERP | Odoo (integration layer) |
| Deployment | Docker, Docker Compose |

---

## Multi-Tenant Architecture

The platform is designed as a SaaS product adaptable to any dealership:

```
/customers
  ├── alba-cars/
  ├── toyota-dubai/
  ├── nissan-uae/
  └── bmw-abudhabi/
```

Each tenant gets isolated data, configurable workflows, and customizable branding.

---

## Repository Structure

```
autodealer-ai-os/
├── .github/workflows/        # CI/CD pipelines
├── architecture/              # System diagrams, DB schemas, API specs
├── deployment/                # Docker Compose, environment configs
├── docs/                      # Business flows, AI dev workflow, setup guides
├── apps/
│   ├── ai-crm/                # AI-First CRM (React + Node.js + Supabase)
│   ├── ai-gateway/            # Centralized AI/LLM Gateway (FastAPI + OpenRouter)
│   ├── marketing-os/          # Marketing Intelligence (Node.js + MongoDB)
│   ├── enterprise-rag/        # Multi-Agent Knowledge Assistant (FastAPI + pgvector)
│   ├── inventory-intel/       # Vehicle Lifecycle Management (Node.js + Supabase)
│   ├── odoo-integration/      # Odoo ERP Integration (Node.js + XML-RPC)
│   ├── automation-engine/     # n8n / Make / Zapier Workflows
│   └── executive-dashboard/   # Real-time Analytics (React)
└── README.md
```

---

## Complete JD Requirements Mapping

Every requirement from the Alba Corp AI Engineer (Vibe Coder) job description is implemented:

| JD Requirement | Where It's Implemented | How |
|---------------|----------------------|-----|
| **Supabase** | `ai-crm/`, `inventory-intel/`, `enterprise-rag/` | Auth, RBAC, Postgres, pgvector, Realtime, Storage |
| **MongoDB** | `marketing-os/` | AI memory, competitor data, campaign analytics |
| **Openclaw Agent** | `ai-gateway/` | Knowledge & Compliance agent via `/api/v1/agent/run` |
| **Hermes Agent** | `ai-gateway/` | Marketing Intelligence agent |
| **Cowork Agent** | `ai-gateway/` | Sales Copilot agent |
| **n8n** | `automation-engine/workflows/` | Lead pipeline, competitor intel, daily reports |
| **Make** | `automation-engine/workflows/` | Google Sheets → CRM sync |
| **Zapier** | `automation-engine/workflows/` | Gmail inquiry → AI parsing → CRM lead |
| **ReactJS + Vite + Tailwind** | `ai-crm/frontend/` | CRM dashboard UI |
| **Node.js** | `ai-crm/backend/`, `marketing-os/`, `inventory-intel/`, `odoo-integration/` | API Gateway, business logic |
| **Python (FastAPI)** | `enterprise-rag/`, `ai-gateway/` | AI services, RAG engine, agent orchestration |
| **Odoo ERP** | `odoo-integration/` | Sales, Inventory, Accounting, Purchase sync |
| **Claude Code / Codex** | `docs/AI_Development_Workflow.md` | Entire development methodology |
| **API Development** | Every service | REST APIs with `/api/v1/` versioning, Swagger |
| **Docker** | `docker-compose.yml` | Full platform orchestration |
| **Production Systems** | All services | Health checks, .env, audit logs, RBAC, error handling |

---

## Cost to Run

| Component | Cost |
|-----------|------|
| React + Vite + Tailwind | Free |
| Node.js + FastAPI | Free |
| Supabase (Free Tier) | Free |
| MongoDB Atlas (Free Tier) | Free |
| n8n (Self-hosted) | Free |
| Odoo Community Edition | Free |
| OpenRouter (Free Models) | Free |
| GitHub | Free |
| **Total** | **$0** |
