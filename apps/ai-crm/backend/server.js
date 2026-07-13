/**
 * AutoDealer AI OS — AI CRM Backend API
 * TECH STACK: Node.js + Express + Supabase (Postgres) — real persistent storage
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'placeholder_key';
const supabase = createClient(supabaseUrl, supabaseKey);

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

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', service: 'AutoDealer AI CRM Backend', version: '1.0.0', timestamp: new Date().toISOString() });
});

app.get('/api/v1/leads', async (req, res) => {
    const { status, limit = 50 } = req.query;
    try {
        let query = supabase.from('leads').select('*').order('created_at', { ascending: false });
        if (status) query = query.eq('status', status.toUpperCase());
        query = query.limit(parseInt(limit));
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, total: data.length, leads: data });
    } catch (err) {
        console.error('[CRM] Supabase leads fetch error:', err.message);
        res.status(500).json({ success: false, error: err.message, leads: [] });
    }
});

app.post('/api/v1/leads', async (req, res) => {
    const ai_score = scoreLead(req.body);
    const status = classifyLead(ai_score);
    const newLead = {
        name: req.body.name || 'Unknown',
        email: req.body.email || null,
        phone: req.body.phone || null,
        source: req.body.source || 'API',
        vehicle_interest: req.body.vehicle_interest || null,
        budget_aed: req.body.budget_aed || null,
        status,
        ai_score,
        assigned_to: status === 'HOT' ? 'Mohammed A.' : null,
        response_time_minutes: null
    };
    try {
        const { data, error } = await supabase.from('leads').insert(newLead).select().single();
        if (error) throw error;
        console.log(`[CRM] New lead created: ${data.name} | Score: ${ai_score} | Status: ${status}`);
        res.status(201).json({ success: true, lead: data });
    } catch (err) {
        console.error('[CRM] Supabase insert error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/v1/leads/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('leads').select('*').eq('id', req.params.id).single();
        if (error || !data) return res.status(404).json({ error: 'Lead not found' });
        res.json({ success: true, lead: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/v1/leads/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('leads').update({ ...req.body }).eq('id', req.params.id).select().single();
        if (error || !data) return res.status(404).json({ error: 'Lead not found' });
        res.json({ success: true, lead: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/v1/inbound-email', async (req, res) => {
    const { parsed_data, raw_email } = req.body;
    if (!parsed_data) return res.status(400).json({ error: 'parsed_data is required' });
    const ai_score = scoreLead({ ...parsed_data, source: 'email' });
    const status = classifyLead(ai_score);
    const newLead = {
        name: parsed_data.full_name || parsed_data.name || 'Email Inquiry',
        email: parsed_data.email || null,
        phone: parsed_data.phone_number || null,
        source: 'Email (Zapier)',
        vehicle_interest: parsed_data.vehicle_of_interest || null,
        budget_aed: parsed_data.budget || null,
        status,
        ai_score,
        assigned_to: status === 'HOT' ? 'Mohammed A.' : null
    };
    try {
        const { data, error } = await supabase.from('leads').insert(newLead).select().single();
        if (error) throw error;
        console.log(`[CRM] Zapier email lead ingested: ${data.name} | Score: ${ai_score}`);
        res.status(201).json({ success: true, lead: data, channel: 'zapier-email' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/v1/leads/hot', async (req, res) => {
    const newLead = { ...req.body, source: req.body.source || 'Make.com (HOT Route)', status: 'HOT', ai_score: 90, assigned_to: 'Mohammed A.' };
    try {
        const { data, error } = await supabase.from('leads').insert(newLead).select().single();
        if (error) throw error;
        console.log(`[CRM] Make.com HOT lead received: ${data.name}`);
        res.status(201).json({ success: true, lead: data, escalation: 'immediate' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/v1/leads/standard', async (req, res) => {
    const ai_score = scoreLead(req.body);
    const status = classifyLead(ai_score);
    const newLead = { ...req.body, source: req.body.source || 'Make.com', status, ai_score };
    try {
        const { data, error } = await supabase.from('leads').insert(newLead).select().single();
        if (error) throw error;
        console.log(`[CRM] Make.com standard lead received: ${data.name} | ${status}`);
        res.status(201).json({ success: true, lead: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/v1/inventory', async (req, res) => {
    try {
        const { data, error } = await supabase.from('inventory').select('*').order('days_in_stock', { ascending: false });
        if (error) throw error;
        res.json({ success: true, vehicles: data });
    } catch (err) {
        console.error('[CRM] Supabase inventory fetch error:', err.message);
        res.status(500).json({ success: false, error: err.message, vehicles: [] });
    }
});

app.get('/api/v1/reports/daily-stats', async (req, res) => {
    try {
        const { data: leads, error } = await supabase.from('leads').select('*');
        if (error) throw error;
        const hotLeads = leads.filter(l => l.status === 'HOT').length;
        const warmLeads = leads.filter(l => l.status === 'WARM').length;
        const coldLeads = leads.filter(l => l.status === 'COLD').length;
        const today = new Date().toDateString();
        res.json({
            success: true,
            generated_at: new Date().toISOString(),
            stats: {
                total_leads: leads.length,
                hot_leads: hotLeads,
                warm_leads: warmLeads,
                cold_leads: coldLeads,
                leads_today: leads.filter(l => new Date(l.created_at).toDateString() === today).length,
                avg_ai_score: leads.length ? Math.round(leads.reduce((s, l) => s + (l.ai_score || 0), 0) / leads.length) : 0
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/leads', (req, res) => res.redirect('/api/v1/leads'));
app.get('/api/inventory', (req, res) => res.redirect('/api/v1/inventory'));

app.listen(port, () => {
    console.log(`[Enterprise API] AutoDealer AI CRM Backend running on port ${port}`);
    console.log(`[Enterprise API] Data source: Supabase (real persistent storage)`);
});

module.exports = app;
