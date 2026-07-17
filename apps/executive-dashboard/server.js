/**
 * AutoDealer AI OS - Executive Dashboard API
 * ============================================
 * 
 * BUSINESS PROBLEM:
 *   CEO and managers rely on end-of-month reports compiled manually in Excel.
 *   No real-time visibility into sales pipeline, inventory health, marketing ROI,
 *   or team performance. By the time data reaches management, decisions are late.
 * 
 * CURRENT MANUAL PROCESS:
 *   1. Finance team compiles sales data weekly
 *   2. Marketing sends separate campaign reports
 *   3. Inventory manager shares stock Excel via email
 *   4. CEO sees consolidated numbers only at month-end meetings
 * 
 * AI-POWERED SOLUTION:
 *   Real-time dashboard pulling from ALL platform modules:
 *   - CRM (leads, deals, pipeline value)
 *   - Inventory (stock health, aging alerts)
 *   - Marketing (campaign ROI, attribution)
 *   - Finance (P&L, margins, commissions)
 *   Plus "Ask AI" feature: CEO types a question, Manager Agent answers with data.
 * 
 * EXPECTED BUSINESS IMPACT:
 *   - Same-day decision making instead of month-end reviews
 *   - Instant visibility into problem areas (cold leads, aging stock, underperforming campaigns)
 *   - AI-powered forecasting and recommendations
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const port = process.env.PORT || 5005;

// Create HTTP server for WebSocket Support
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*', // Allow all origins for the dashboard
        methods: ['GET', 'POST']
    }
});

// Setup Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}`);
    
    socket.on('disconnect', () => {
        console.log(`[WebSocket] Client disconnected: ${socket.id}`);
    });
});

// Simulate real-time business events for the executive dashboard
// Broadcasts 'revenue_updated' and 'lead_updated' events periodically
setInterval(() => {
    const revenueIncrease = Math.floor(Math.random() * 5000) + 1000;
    io.emit('revenue_updated', {
        timestamp: new Date().toISOString(),
        amount: revenueIncrease,
        currency: 'AED',
        message: `New deal closed! Revenue increased by AED ${revenueIncrease}`
    });
}, 45000);

setInterval(() => {
    const leadSources = ['Website', 'WhatsApp', 'Instagram', 'Referral'];
    const randomSource = leadSources[Math.floor(Math.random() * leadSources.length)];
    io.emit('lead_updated', {
        timestamp: new Date().toISOString(),
        source: randomSource,
        status: 'HOT',
        message: `New HOT lead acquired via ${randomSource}`
    });
}, 30000);

// Make io accessible to Express routes
app.set('io', io);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Service URLs (in production: from environment or service discovery)
const SERVICES = {
    crm: process.env.CRM_API_URL || 'http://localhost:5000',
    marketing: process.env.MARKETING_API_URL || 'http://localhost:5001',
    rag: process.env.RAG_API_URL || 'http://localhost:5002',
    inventory: process.env.INVENTORY_API_URL || 'http://localhost:5003',
    odoo: process.env.ODOO_API_URL || 'http://localhost:5004',
    gateway: process.env.AI_GATEWAY_URL || 'http://localhost:5010'
};

// ==========================================
// Health Check
// ==========================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', service: 'AutoDealer Executive Dashboard' });
});

// ==========================================
// MAIN DASHBOARD DATA
// ==========================================

/**
 * GET /api/v1/dashboard
 * Aggregated real-time metrics for CEO/Manager view.
 * In production: Pulls from Supabase (CRM), MongoDB (Marketing), and Odoo (Finance).
 */
app.get('/api/v1/dashboard', async (req, res) => {
    const today = new Date().toISOString().split('T')[0];

    const dashboard = {
        generated_at: new Date().toISOString(),
        period: 'Today',

        // Sales Pipeline
        sales: {
            today_revenue: 285000,
            mtd_revenue: 2850000,
            deals_closed_today: 1,
            deals_closed_mtd: 12,
            active_leads: 87,
            hot_leads: 15,
            warm_leads: 32,
            cold_leads: 40,
            pipeline_value: 4200000,
            avg_deal_size: 237500,
            conversion_rate: '13.8%',
            avg_days_to_close: 18
        },

        // Inventory Health
        inventory: {
            total_vehicles: 48,
            total_value: 11520000,
            available: 35,
            reserved: 8,
            sold_pending_delivery: 5,
            aging_summary: {
                healthy_0_30: 18,
                monitor_31_60: 10,
                warning_61_90: 4,
                action_91_120: 2,
                critical_120_plus: 1
            },
            total_holding_cost_today: 2400,
            ai_alerts: [
                { vehicle: 'Porsche Cayenne S 2023 (VH-003)', days: 147, alert: 'CRITICAL', action: 'Reduce price by AED 17,000 or launch clearance campaign' },
                { vehicle: 'Toyota LC 2024 (VH-001)', days: 83, alert: 'WARNING', action: 'Approaching 90-day threshold. Consider targeted marketing.' }
            ]
        },

        // Marketing Performance
        marketing: {
            active_campaigns: 5,
            total_spend_mtd: 20500,
            leads_from_marketing: 52,
            cost_per_lead: 394,
            best_channel: 'WhatsApp Broadcast',
            best_channel_roi: '9500%',
            worst_channel: 'TikTok Ads',
            worst_channel_roi: '120%',
            competitor_alerts: 2
        },

        // Financial Summary (Accounting USP)
        finance: {
            gross_profit_mtd: 584500,
            gross_margin_pct: '19.9%',
            net_profit_mtd: 326500,
            total_commissions_mtd: 38500,
            vat_payable_mtd: 29225,
            avg_profit_per_vehicle: 24875,
            top_profit_vehicle: 'Lexus LX 600 (AED 80,000 margin)',
            floor_plan_interest_mtd: 12400
        },

        // Team Performance
        team: {
            total_salespeople: 8,
            top_performer: {
                name: 'Mohammed A.',
                deals: 4,
                revenue: 980000,
                commission: 14200
            },
            needs_attention: {
                name: 'Sarah K.',
                deals: 0,
                last_deal_days_ago: 18,
                ai_recommendation: 'Consider reassigning hot leads or scheduling 1:1 coaching session'
            }
        },

        // AI Insights (Manager Agent)
        ai_insights: [
            {
                priority: 'HIGH',
                insight: 'Lead response time averaged 2.3 hours yesterday. Target is under 1 hour. 3 hot leads went cold.',
                action: 'Review sales team workload distribution'
            },
            {
                priority: 'MEDIUM',
                insight: 'Competitor Al Futtaim dropped Land Cruiser prices by AED 5,000. Our 3 Land Cruisers may need price adjustment.',
                action: 'Review pricing via Inventory Intelligence module'
            },
            {
                priority: 'LOW',
                insight: 'WhatsApp campaigns showing 40x better ROI than paid ads. Consider reallocating 30% of ad budget.',
                action: 'Discuss with Marketing team'
            }
        ]
    };

    res.json(dashboard);
});

// ==========================================
// "ASK AI" - CEO talks to Manager Agent
// ==========================================

/**
 * POST /api/v1/dashboard/ask
 * CEO/Manager types a question, Manager Agent answers using data from all modules.
 * JD: "Deploy and manage AI agents across multiple operational use cases"
 */
app.post('/api/v1/dashboard/ask', async (req, res) => {
    const { question } = req.body;

    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }

    // Try to route to AI Gateway's Manager Agent
    try {
        const gatewayResponse = await axios.post(`${SERVICES.gateway}/api/v1/agent/run`, {
            agent: 'manager',
            input: question,
            context: {
                role: 'CEO/Manager',
                data_access: 'full',
                modules: ['crm', 'inventory', 'marketing', 'finance']
            }
        });

        return res.json({
            question: question,
            answer: gatewayResponse.data.response,
            agent: gatewayResponse.data.agent,
            model: gatewayResponse.data.model_used
        });
    } catch (err) {
        // Fallback demo response when AI Gateway is not running
        const demoAnswers = {
            'sales': 'Sales are tracking 8% above last month. 12 deals closed MTD vs 11 same period last month. Pipeline value is AED 4.2M with 15 hot leads.',
            'inventory': '48 vehicles in stock. 3 vehicles are over 90 days (action needed). Total holding cost: AED 2,400/day. Porsche Cayenne needs immediate price reduction.',
            'marketing': 'WhatsApp campaigns are your best ROI channel at 9500%. Recommend shifting 30% budget from TikTok (120% ROI) to WhatsApp.',
            'profit': 'MTD gross profit: AED 584,500 (19.9% margin). Net profit: AED 326,500 after commissions and VAT. Top vehicle: Lexus LX 600.',
            'team': 'Mohammed A. is top performer (4 deals, AED 980K). Sarah K. needs attention (0 deals in 18 days).'
        };

        const relevantKey = Object.keys(demoAnswers).find(k => question.toLowerCase().includes(k)) || 'sales';

        res.json({
            question: question,
            answer: demoAnswers[relevantKey],
            agent: 'Manager Agent (Demo Mode)',
            note: 'AI Gateway not connected. Showing cached demo response.'
        });
    }
});

// ==========================================
// FORECAST API
// ==========================================

/**
 * GET /api/v1/dashboard/forecast
 * AI-generated monthly forecast based on current pipeline and trends.
 */
app.get('/api/v1/dashboard/forecast', (req, res) => {
    res.json({
        forecast_month: 'July 2026',
        predicted_revenue: 3200000,
        predicted_deals: 14,
        confidence: '78%',
        key_assumptions: [
            '15 hot leads in pipeline with 60% avg close rate',
            '8 warm leads with 25% close rate',
            '2 Lexus LX 600 reservations (high-margin deals)',
            'Competitor pricing stable (no major disruptions expected)'
        ],
        risks: [
            'Porsche Cayenne aging stock (AED 17K price reduction may be needed)',
            'Sarah K. underperformance could reduce team output by 1-2 deals',
            'Ramadan period starts mid-month (historically -15% footfall)'
        ],
        generated_by: 'Manager Agent',
        generated_at: new Date().toISOString()
    });
});

// ==========================================
// SERVICE HEALTH MONITOR
// ==========================================

/**
 * GET /api/v1/dashboard/services
 * Monitor health of all platform microservices.
 * JD: "Monitor system reliability, troubleshoot technical issues"
 */
app.get('/api/v1/dashboard/services', async (req, res) => {
    const services = Object.entries(SERVICES).map(([name, url]) => ({
        name,
        url,
        status: 'checking...'
    }));

    // Check each service health endpoint
    for (const service of services) {
        try {
            const response = await axios.get(`${service.url}/api/health`, { timeout: 2000 });
            service.status = response.data.status || 'OK';
            service.response_time_ms = response.headers['x-response-time'] || 'N/A';
        } catch (err) {
            service.status = 'OFFLINE';
            service.error = err.message;
        }
    }

    res.json({
        platform: 'AutoDealer AI OS',
        checked_at: new Date().toISOString(),
        services
    });
});

// ==========================================
// WORKFLOW AUTOMATION WEBHOOKS
// ==========================================

// These endpoints proxy the frontend requests to actual SaaS Webhook URLs.
// This hides the webhook URLs from the client and provides a single integration point.

const WEBHOOK_URLS = {
    escalation: process.env.ESCALATION_WEBHOOK_URL || 'https://hook.eu1.make.com/i7w3h8xccfhnfkh7nl431nk2oe7fyq75',
    make: process.env.MAKE_WEBHOOK_URL || 'https://hook.eu1.make.com/ptx1qx6rw7esr3pk50k4jch5fwg44ifz',
    n8n: process.env.N8N_WEBHOOK_URL || 'https://desktop-l3an0ma.tail2141f7.ts.net/webhook/competitor-intel',
    contractAudit: process.env.CONTRACT_AUDIT_WEBHOOK_URL || 'https://desktop-l3an0ma.tail2141f7.ts.net/webhook/contract-audit'
};

/**
 * POST /api/v1/workflows/trigger-zapier
 * Escalate inventory alerts via Cowork Agent on Zapier
 */
app.post('/api/v1/workflows/trigger-escalation', async (req, res) => {
    try {
        const payload = req.body;
        // INJECT SECRETS at runtime so Make.com doesn't need them hardcoded in blueprint
        payload.secrets = {
            slack_url: process.env.SLACK_WEBHOOK,
            email_key: process.env.RESEND_API_KEY
        };
        // Actually trigger the Escalation webhook
        await axios.post(WEBHOOK_URLS.escalation, payload);
        
        console.log(`[Escalation Webhook Triggered] Payload:`, { ...payload, secrets: '[REDACTED]' });
        res.json({ success: true, message: 'Escalate workflow triggered successfully', platform: 'make' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to trigger Escalation workflow', details: err.message });
    }
});

/**
 * POST /api/v1/workflows/trigger-make
 * Sync Leads to Odoo ERP and enrich via Supabase DB through Make.com
 */
app.post('/api/v1/workflows/trigger-make', async (req, res) => {
    try {
        const payload = req.body;
        // INJECT SECRETS at runtime so Make.com doesn't need them hardcoded
        payload.secrets = {
            supabase_key: process.env.SUPABASE_KEY,
            odoo_key: process.env.ODOO_KEY
        };
        await axios.post(WEBHOOK_URLS.make, payload);
        
        console.log(`[Make.com Webhook Triggered] Payload:`, { ...payload, secrets: '[REDACTED]' });
        res.json({ success: true, message: 'Make.com Lead Sync & Enrichment triggered', platform: 'make' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to trigger Make.com workflow', details: err.message });
    }
});

/**
 * POST /api/v1/workflows/trigger-n8n
 * Run Competitor Intelligence pipeline via Hermes Agent on n8n
 */
app.post('/api/v1/workflows/trigger-n8n', async (req, res) => {
    try {
        const payload = req.body;
        await axios.post(WEBHOOK_URLS.n8n, payload);
        
        console.log(`[n8n Webhook Triggered] Payload:`, payload);
        res.json({ success: true, message: 'n8n Competitor Intel pipeline started', platform: 'n8n' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to trigger n8n workflow', details: err.message });
    }
});

/**
 * POST /api/v1/workflows/trigger-contract-audit
 * Transparency Agent - forwards an uploaded contract image/PDF to the
 * n8n Contract Error Auditor workflow and returns its analysis.
 */
app.post('/api/v1/workflows/trigger-contract-audit', upload.single('data'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded. Attach the contract as form-data field "data".' });
        }

        const forwardForm = new FormData();
        forwardForm.append('data', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype
        });

        const n8nResponse = await axios.post(WEBHOOK_URLS.contractAudit, forwardForm, {
            headers: forwardForm.getHeaders(),
            maxBodyLength: Infinity
        });

        console.log(`[Contract Audit Webhook Triggered] File: ${req.file.originalname}`);
        res.json(n8nResponse.data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to run contract audit', details: err.message });
    }
});

// Start Server
server.listen(port, () => {
    console.log(`[Enterprise API] Executive Dashboard on port ${port} (with WebSockets)`);
});

module.exports = { app, server, io };
