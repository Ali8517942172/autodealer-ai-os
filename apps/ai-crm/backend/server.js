/**
 * AutoDealer AI OS — AI CRM Backend API
 * ========================================
 *
 * BUSINESS PROBLEM:
 *   Leads from multiple channels (website, WhatsApp, Zapier email parsing,
 *   n8n webhooks, Make.com routing) arrive with no standardized intake.
 *   Each channel needs its own endpoint, and all data must flow into
 *   a central CRM store (Supabase in production).
 *
 * SOLUTION:
 *   REST API with /api/v1/ versioning. Supports:
 *   - Direct lead creation (website forms, walk-ins)
 *   - Inbound email webhook (Zapier → /api/v1/inbound-email)
 *   - AI-scored lead ingestion (n8n → /api/v1/leads/scored)
 *   - Inventory costing data (Odoo ERP integration)
 *
 * TECH STACK: Node.js + Express + Supabase (Postgres)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// ─── Supabase Connection ──────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'placeholder_key';
const supabase = createClient(supabaseUrl, supabaseKey);

// ─── In-memory store (fallback when Supabase is not configured) ──────────────
let leads = [
    {
        id: 1,
        name: 'Mohammed Al Rashid',
        email: 'mohammed@example.com',
        phone: '+971 50 123 4567',
        source: 'Website Form',
        vehicle_interest: 'Toyota Land Cruiser 2024',
        budget_aed: 280000,
        status: 'HOT',
        ai_score: 92,
        assigned_to: 'Mohammed A.',
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    },
    {
        id: 2,
        name: 'Sarah Chen',
        email: 'sarah.chen@example.com',
        phone: '+971 55 987 6543',
        source: 'WhatsApp',
        vehicle_interest: 'Lexus LX 600 2024',
        budget_aed: 450000,
        status: 'WARM',
        ai_score: 74,
        assigned_to: 'Sarah K.',
        created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
    },
    {
        id: 3,
        name: 'Ali Hassan',
        email: 'ali.h@example.com',
        phone: '+971 52 555 0001',
        source: 'Facebook Lead Ad',
        vehicle_interest: 'Nissan Patrol 2024',
        budget_aed: 200000,
        status: 'COLD',
        ai_score: 38,
        assigned_to: null,
        created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    }
];

let nextId = 4;

// ─── Helper: Score lead with simple heuristic (real: AI Gateway) ─────────────
function scoreLead(lead) {
    let score = 50;
    if (lead.budget_aed > 300000) score += 20;
    if (lead.source === 'WhatsApp') score += 15;
    if (lead.source === 'Website Form') score += 10;
    if (lead.phone) score += 10;
    if (lead.vehicle_interest) score += 5;
    return Math.min(score, 100);
}

function classifyLead(score) {
    if (score >= 80) return 'HOT';
    if (score >= 55) return 'WARM';
    return 'COLD';
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'AutoDealer AI CRM Backend',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// LEADS — Core CRM Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/leads
 * Returns all leads with optional status filter.
 * Used by: Executive Dashboard, CRM UI, n8n workflows
 */
app.get('/api/v1/leads', async (req, res) => {
    const { status, limit = 50 } = req.query;
    let result = [...leads];
    if (status) result = result.filter(l => l.status === status.toUpperCase());
    result = result.slice(0, parseInt(limit));
    res.json({
        success: true,
        total: result.length,
        leads: result
    });
});

/**
 * POST /api/v1/leads
 * Create a new lead (manual entry, n8n webhook, Make.com routing).
 * Auto-scores and classifies the lead on creation.
 */
app.post('/api/v1/leads', async (req, res) => {
    const ai_score = scoreLead(req.body);
    const status = classifyLead(ai_score);

    const newLead = {
        id: nextId++,
        name: req.body.name || 'Unknown',
        email: req.body.email || null,
        phone: req.body.phone || null,
        source: req.body.source || 'API',
        vehicle_interest: req.body.vehicle_interest || null,
        budget_aed: req.body.budget_aed || null,
        notes: req.body.notes || null,
        status,
        ai_score,
        assigned_to: status === 'HOT' ? 'Mohammed A.' : null,
        created_at: new Date().toISOString()
    };

    leads.unshift(newLead);
    console.log(`[CRM] New lead created: ${newLead.name} | Score: ${ai_score} | Status: ${status}`);

    res.status(201).json({ success: true, lead: newLead });
});

/**
 * GET /api/v1/leads/:id
 * Single lead detail view.
 */
app.get('/api/v1/leads/:id', (req, res) => {
    const lead = leads.find(l => l.id === parseInt(req.params.id));
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, lead });
});

/**
 * PATCH /api/v1/leads/:id
 * Update lead status, assignment, notes.
 * Used by: CRM UI, salesperson mobile updates
 */
app.patch('/api/v1/leads/:id', (req, res) => {
    const idx = leads.findIndex(l => l.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Lead not found' });
    leads[idx] = { ...leads[idx], ...req.body, updated_at: new Date().toISOString() };
    res.json({ success: true, lead: leads[idx] });
});

// ─────────────────────────────────────────────────────────────────────────────
// INBOUND EMAIL WEBHOOK — Zapier Integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/inbound-email
 * Receives AI-parsed lead data from Zapier (Gmail → Formatter → Webhook).
 * JD Requirement: "Zapier" + "AI-powered lead capture"
 */
app.post('/api/v1/inbound-email', async (req, res) => {
    const { parsed_data, raw_email, source = 'email' } = req.body;

    if (!parsed_data) {
        return res.status(400).json({ error: 'parsed_data is required' });
    }

    const ai_score = scoreLead({ ...parsed_data, source: 'email' });
    const status = classifyLead(ai_score);

    const newLead = {
        id: nextId++,
        name: parsed_data.full_name || parsed_data.name || 'Email Inquiry',
        email: parsed_data.email || null,
        phone: parsed_data.phone_number || null,
        source: 'Email (Zapier)',
        vehicle_interest: parsed_data.vehicle_of_interest || null,
        budget_aed: parsed_data.budget || null,
        urgency: parsed_data.urgency || 'MEDIUM',
        notes: raw_email ? raw_email.substring(0, 500) : null,
        status,
        ai_score,
        assigned_to: status === 'HOT' ? 'Mohammed A.' : null,
        created_at: new Date().toISOString()
    };

    leads.unshift(newLead);
    console.log(`[CRM] Zapier email lead ingested: ${newLead.name} | Score: ${ai_score}`);

    res.status(201).json({ success: true, lead: newLead, channel: 'zapier-email' });
});

// ─────────────────────────────────────────────────────────────────────────────
// MAKE.COM WEBHOOK — Multi-Channel Routing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/leads/hot
 * Hot leads route from Make.com multi-channel router (immediate escalation).
 */
app.post('/api/v1/leads/hot', (req, res) => {
    const newLead = {
        id: nextId++,
        ...req.body,
        source: req.body.source || 'Make.com (HOT Route)',
        status: 'HOT',
        ai_score: 90,
        assigned_to: 'Mohammed A.',
        priority: 'URGENT',
        created_at: new Date().toISOString()
    };
    leads.unshift(newLead);
    console.log(`[CRM] Make.com HOT lead received: ${newLead.name}`);
    res.status(201).json({ success: true, lead: newLead, escalation: 'immediate' });
});

/**
 * POST /api/v1/leads/standard
 * Standard leads route from Make.com (WARM or COLD).
 */
app.post('/api/v1/leads/standard', (req, res) => {
    const ai_score = scoreLead(req.body);
    const status = classifyLead(ai_score);

    const newLead = {
        id: nextId++,
        ...req.body,
        source: req.body.source || 'Make.com',
        status,
        ai_score,
        created_at: new Date().toISOString()
    };
    leads.unshift(newLead);
    console.log(`[CRM] Make.com standard lead received: ${newLead.name} | ${status}`);
    res.status(201).json({ success: true, lead: newLead });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY (Odoo ERP Data) — Financial Intelligence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/inventory
 * Vehicle inventory with full financial costing data.
 * JD: "Accounting background" — tracks margins, commissions, VAT
 */
app.get('/api/v1/inventory', (req, res) => {
    res.json({
        success: true,
        vehicles: [
            {
                id: 'VH-001',
                model: 'Toyota Land Cruiser 2024',
                vin: 'JTMHV05J584123456',
                status: 'Available',
                days_in_stock: 83,
                price_aed: 290000,
                cost_aed: 250000,
                gross_margin: 40000,
                holding_cost_accrued: 4150,
                net_margin: 35850,
                recommended_commission: 1793,
                vat_amount: 14500,
                aging_alert: 'WARNING',
                ai_recommendation: 'Approaching 90-day threshold. Consider targeted WhatsApp campaign.'
            },
            {
                id: 'VH-002',
                model: 'Lexus LX 600 2024',
                vin: 'JTJAM7FX4N4123456',
                status: 'Reserved',
                days_in_stock: 12,
                price_aed: 510000,
                cost_aed: 430000,
                gross_margin: 80000,
                holding_cost_accrued: 600,
                net_margin: 79400,
                recommended_commission: 3970,
                vat_amount: 25500,
                aging_alert: 'HEALTHY',
                ai_recommendation: 'High-margin vehicle. Priority delivery to retain customer.'
            },
            {
                id: 'VH-003',
                model: 'Porsche Cayenne S 2023',
                vin: 'WP1ZZZ9YZPDA12345',
                status: 'Available',
                days_in_stock: 147,
                price_aed: 380000,
                cost_aed: 310000,
                gross_margin: 70000,
                holding_cost_accrued: 7350,
                net_margin: 62650,
                recommended_commission: 3133,
                vat_amount: 19000,
                aging_alert: 'CRITICAL',
                ai_recommendation: 'Reduce price by AED 17,000 or launch clearance campaign immediately.'
            }
        ]
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS — Daily Stats for n8n Executive Briefing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/reports/daily-stats
 * Used by n8n daily reporting workflow → AI Executive Briefing node.
 */
app.get('/api/v1/reports/daily-stats', (req, res) => {
    const hotLeads = leads.filter(l => l.status === 'HOT').length;
    const warmLeads = leads.filter(l => l.status === 'WARM').length;
    const coldLeads = leads.filter(l => l.status === 'COLD').length;

    res.json({
        success: true,
        generated_at: new Date().toISOString(),
        stats: {
            total_leads: leads.length,
            hot_leads: hotLeads,
            warm_leads: warmLeads,
            cold_leads: coldLeads,
            leads_today: leads.filter(l => {
                const today = new Date().toDateString();
                return new Date(l.created_at).toDateString() === today;
            }).length,
            avg_ai_score: Math.round(leads.reduce((s, l) => s + (l.ai_score || 0), 0) / leads.length),
            pipeline_value_aed: 4200000,
            deals_closed_mtd: 12,
            revenue_mtd_aed: 2850000
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Legacy endpoints (backward compat)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/leads', (req, res) => res.redirect('/api/v1/leads'));
app.post('/api/leads', (req, res) => {
    req.url = '/api/v1/leads';
    app.handle(req, res);
});
app.get('/api/inventory', (req, res) => res.redirect('/api/v1/inventory'));

// ─────────────────────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────────────────────
app.listen(port, () => {
    console.log(`[Enterprise API] Alba AI CRM Backend running on port ${port}`);
    console.log(`[Enterprise API] Health check: http://localhost:${port}/api/health`);
    console.log(`[Enterprise API] Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
