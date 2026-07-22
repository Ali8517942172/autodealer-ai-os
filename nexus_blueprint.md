# NEXUS OS: Master Blueprint & Action Plan

> [!NOTE]
> **Project Vision**
> The NEXUS OS is an enterprise-grade, fully automated AI operating system. It acts as a central "brain" that intercepts every customer interaction, uses Artificial Intelligence to score and route them, and synchronizes the data across the company's CRM, ERP, and communication channels in real-time.

---

## 1. Deep Research: Real-World Problems

### A. Problems We Are Solving RIGHT NOW
We have built this AI OS to solve the following critical pain points:

1. **Lead Decay (The 5-Minute Rule):**
   * *The Problem:* Industry data shows that if a business doesn't respond to a lead within 5 minutes, the odds of qualifying that lead drop by 80%.
   * *Our Solution:* The AI OS intercepts leads instantly via Webhooks. It reads the lead, scores it, and if it's "Hot", it bypasses the CRM queue entirely and pings the top closer directly on WhatsApp/Slack within **3 seconds**.
2. **"Spray and Pray" Follow-ups:**
   * *The Problem:* High-value leads get lost in the noise of general marketing.
   * *Our Solution:* The **n8n Master Router** uses OpenAI to intelligently score leads (Hot/Warm/Cold). Hot leads are instantly assigned to senior reps; Cold leads are automatically placed into an email drip sequence without human intervention.
3. **Inventory Holding Costs & Aging Stock:**
   * *The Problem:* Idle inventory costs money.
   * *Our Solution:* Our Dashboard ties directly into Odoo ERP. It highlights aging inventory and enables automated marketing campaigns (via n8n).
4. **Data Silos & Rogue Communication:**
   * *The Problem:* Sales reps use personal WhatsApp numbers. Management has zero real-time visibility.
   * *Our Solution:* The **Central Event Bus (Node.js)** synchronizes everything. All WhatsApp communications flow through the official API via n8n. All data lives centrally in Supabase.
5. **Knowledge Bottlenecks (Training & Policy):**
   * *The Problem:* Staff constantly interrupt managers for policy answers.
   * *Our Solution:* The **RAG (Retrieval-Augmented Generation) System**. An AI assistant that knows every company document by heart and answers questions instantly, citing the source document.

---

## 2. The Technology Stack & Platform Breakdown

> [!IMPORTANT]
> **Pure-n8n Architecture Update:** 
> We have successfully migrated completely away from Zapier and Make.com to eliminate subscription costs and centralize logic. **n8n** now acts as both the catcher and the brain.

### 🧠 n8n (The Unified Engine)
Hosted locally via Docker to save costs on massive API volume. n8n catches all webhooks, scores them with OpenAI, and executes the final actions.
* **`nexus_master_router.json`**: The central catch-all webhook. Receives leads from FB/Gmail/Typeform, sends them to OpenAI for scoring, and uses a Switch node to call the sub-workflows below.
* **`slack_router.json`**: Receives "Hot" leads from the Master Router and instantly posts into the `#sales-hot-leads` Slack channel.
* **`whatsapp_bdc.json`**: Connects to the WhatsApp Cloud API to send a personalized welcome message.
* **`marketing_drip.json`**: A time-delayed workflow for "Cold" leads. Sends a 7-day email/SMS drip campaign.
* **`customer_360.json`**: Uses XML-RPC to connect directly to the **Odoo ERP**.

### 🗄️ THE VAULT (Database Architecture)
* **Supabase (PostgreSQL):** The source of truth for structured data. Holds the `leads` table and the `inventory` table. Also utilizes the `pgvector` extension to store 1536-dimensional OpenAI embeddings for the RAG system. RLS secured.
* **MongoDB:** The Data Lake. Every raw webhook, API error, and system log is dumped here as unstructured JSON.

### 🤖 ENTERPRISE RAG (How "Ask AI" Works)
* **The Stack:** Python (FastAPI), Supabase pgvector, OpenAI `text-embedding-ada-002`.
* **How it works:** 
  1. FastAPI receives text and asks OpenAI to turn it into a vector.
  2. It performs a **Cosine Similarity Math Search** inside Supabase.
  3. It retrieves the exact paragraphs from the database, feeds them to GPT-4, and generates an answer.

### 🖥️ THE MAGIC SHOW (Executive Dashboard)
* **The Stack:** Node.js, Socket.io, Tailwind CSS, HTML.
* **How it works:** Management views a live, dark/light mode dashboard. Instead of reloading the page, the Node.js backend emits WebSocket events. The HTML uses DOM manipulation to instantly animate new leads into the table and pulse the revenue numbers upward like a live stock ticker.

---

## 3. What Has Been Completed? (Audit Report)

The entire system has been engineered, coded, and rigorously audited by a **15-Agent QA Swarm**. 

**Migration & Rebranding Completed:**
* **NEXUS Rebrand:** All internal files, documentation, and logic references have been updated to the new "Nexus" identity.
* **n8n Migration:** Zapier and Make.com workflows were permanently deleted. `nexus_master_router.json` was created to consolidate the architecture.

**Security & QA Fixes Applied:**
* **Frontend XSS Patched:** Added deep regex sanitization to the Dashboard.
* **Backend Data Leakage Patched:** The FastAPI RAG system was upgraded to use JWT Bearer Auth and request-scoped Supabase clients.
* **Database Hardened:** MongoDB insertion logic was rewritten to block NoSQL injection vectors.
* **WebSockets Fixed:** Re-installed missing dependencies (`socket.io`, `multer`) to stabilize the live dashboard.

---

## 4. Final Deployment Actions

1. Run `node scripts/deploy_n8n.js` to push the new unified workflows to your active n8n instance.
2. Start the dashboard (`npm run dev`) and Python RAG backend (`uvicorn main:app`).
3. Replace all external webhook URLs (in Facebook Ads, Typeform, etc.) with the new n8n Catch-All Webhook URL.
