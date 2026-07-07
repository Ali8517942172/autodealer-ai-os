# Alba AI Operating System (Alba AI OS)

**Alba AI OS** is a unified, enterprise-grade automotive AI platform designed to power the end-to-end dealership workflows of modern automotive companies.

Unlike isolated prototypes, this monorepo represents a complete, interconnected ecosystem that drives business value through measurable improvements in **Revenue Generation, Time Optimization, Lead Conversion, and Customer Experience.**

## 🚀 The Ecosystem

The platform is divided into five core business applications, all natively communicating via an API Gateway and shared automation layers.

1. **Alba AI CRM (`apps/ai-crm`)**
   - **AI-First CRM:** Automatically assigns lead scores, intents, and probabilities across multiple inbound channels (Website, WhatsApp, Phone).
   - **AI Sales Copilot:** Analyzes natural language inputs to automatically generate quotations, follow-ups, and calendar reminders.
   - **Business Value:** Directly reduces salesperson administrative overhead and prevents lead leakage.

2. **Alba Marketing Intelligence OS (`apps/marketing-os`)**
   - **Competitor Intelligence:** Daily scraping of competitor pricing and inventory to suggest real-time price optimizations.
   - **AI Campaign Generator:** Automatically drafts multi-channel marketing campaigns (Ads, Email, SMS) based on market gaps.
   - **Business Value:** Increases marketing ROI by ensuring campaigns are purely data-driven and hyper-targeted.

3. **Alba Enterprise RAG (`apps/enterprise-rag`)**
   - **Multi-Agent Knowledge Base:** Utilizes Openclaw, Hermes, and Cowork agents to reason over complex HR policies, finance policies, and vehicle manuals.
   - **Verified Citations:** Every AI answer provides exact source citations to ensure compliance.
   - **Business Value:** Drastically reduces training time for new hires and ensures 100% compliance in customer communications.

4. **Alba Automation Engine (`apps/automation-engine`)**
   - The central nervous system powered by n8n and Make. Connects Supabase, Odoo ERP, WhatsApp, and internal endpoints.

5. **Executive Dashboard (`apps/executive-dashboard`)**
   - Live analytics pulling from all modules.

## 🏗 Enterprise Architecture

- **Frontend:** ReactJS, Vite, Tailwind CSS
- **Backend/API:** Node.js, Python (FastAPI)
- **Database Layer:** Supabase (Auth/Postgres), MongoDB, pgvector
- **Automation:** n8n, Make
- **Production Layer:** Docker, Docker Compose, CI/CD Actions, OpenAPI Specs.

## 📊 The "Accounting Advantage"

Unique to this platform is deep financial intelligence. The CRM doesn't just track cars—it tracks:
- **Gross Margins & Net Profit per vehicle**
- **Salesperson Commission logic**
- **Finance Commission & VAT Reporting**
- **Dynamic Purchase & Inventory Costing**

*Because AI should understand business, not just text.*

---
*Developed for ALBA CORP - AI Engineer (Vibe Coder) Role*
