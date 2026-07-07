# Alba AI Automation Engine

Central nervous system that connects all Alba AI OS modules through event-driven workflows.

## Automation Stack
- **n8n** - Primary workflow automation (self-hosted)
- **Make (Integromat)** - Backup/secondary automations
- **Webhooks** - Real-time event processing

## Deployed Workflows

### 1. Lead to CRM Pipeline (`lead_to_crm_pipeline.json`)
```
Website Form / WhatsApp / Phone
        ↓
   Webhook Intake
        ↓
  Cowork AI Agent (Lead Scoring)
        ↓
   HOT Lead? ──── YES ──→ CRM + WhatsApp + Slack Alert
        │
        NO ──→ CRM + Welcome Email
```
**Business Impact:** Reduces lead response time from 2 hours to < 5 minutes.

### 2. Daily Competitor Intelligence (`daily_competitor_intel.json`)
```
   Cron (6 AM Daily)
        ↓
   Scrape Competitors
        ↓
  Hermes AI Agent (Price Analysis)
        ↓
   Slack Report + CRM Price Alerts
```
**Business Impact:** Enables real-time price matching, preventing lost sales due to uncompetitive pricing.

## Environment Variables Required
```env
CRM_API_URL=http://localhost:5000
CRM_API_KEY=your_crm_api_key
MARKETING_API_URL=http://localhost:5001
N8N_WEBHOOK_URL=http://localhost:5678
WHATSAPP_API_KEY=your_whatsapp_key
SLACK_WEBHOOK_URL=your_slack_webhook
```

## Integration Map
| Source | → | Destination | Trigger |
|--------|---|-------------|---------|
| Website Form | → | CRM | Webhook (real-time) |
| WhatsApp | → | CRM | Webhook (real-time) |
| Competitor Scraper | → | CRM + Slack | Cron (daily) |
| CRM Deal Closed | → | Odoo ERP | Webhook (real-time) |
| Service Ticket | → | RAG + Manager | Webhook (real-time) |
| Inventory Aged 90+ days | → | Marketing OS | Cron (weekly) |
