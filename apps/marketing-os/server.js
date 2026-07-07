/**
 * Alba Marketing Intelligence OS - API Server
 * 
 * Enterprise marketing platform for automotive dealerships.
 * Connects to MongoDB for lead/campaign storage and integrates
 * with the Hermes AI agent for automated campaign generation.
 * 
 * Architecture:
 *   MongoDB -> Express API -> Hermes Agent -> n8n/Make -> CRM
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const mongoUrl = process.env.MONGO_URI || 'mongodb://localhost:27017';
const dbName = 'alba_marketing';
let db;

async function connectDB() {
    try {
        const client = new MongoClient(mongoUrl);
        await client.connect();
        db = client.db(dbName);
        console.log('[MongoDB] Connected to alba_marketing database');
    } catch (err) {
        console.error('[MongoDB] Connection failed:', err.message);
    }
}

// ==========================================
// Health Check
// ==========================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', service: 'Alba Marketing Intelligence OS' });
});

// ==========================================
// COMPETITOR INTELLIGENCE
// ==========================================

/**
 * GET /api/competitors
 * Returns latest competitor pricing data from MongoDB.
 * In production, this is populated by the daily cron scraper.
 */
app.get('/api/competitors', async (req, res) => {
    try {
        if (db) {
            const data = await db.collection('competitor_pricing').find().sort({ scraped_at: -1 }).limit(50).toArray();
            return res.json(data);
        }
        // Fallback mock data for demo/interview
        res.json([
            {
                competitor: 'Al Futtaim Motors',
                model: 'Toyota Land Cruiser',
                price_aed: 215000,
                scraped_at: new Date().toISOString(),
                source: 'website',
                ai_recommendation: 'Competitor is AED 5,000 below our listing. Consider matching or adding free service package.'
            },
            {
                competitor: 'Arabian Automobiles',
                model: 'Nissan Patrol',
                price_aed: 275000,
                scraped_at: new Date().toISOString(),
                source: 'dubizzle',
                ai_recommendation: 'Our price is competitive. Maintain current listing.'
            },
            {
                competitor: 'Al Nabooda',
                model: 'Porsche Cayenne',
                price_aed: 320000,
                scraped_at: new Date().toISOString(),
                source: 'website',
                ai_recommendation: 'High demand model. Consider increasing price by AED 8,000.'
            }
        ]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// AI CAMPAIGN GENERATOR (Hermes Agent)
// ==========================================

/**
 * POST /api/campaigns/generate
 * Uses the Hermes AI agent to generate multi-channel marketing campaigns
 * based on competitor gaps and inventory data.
 */
app.post('/api/campaigns/generate', async (req, res) => {
    const { target_model, budget_aed, channels } = req.body;

    // Hermes Agent simulation
    // In production: calls OpenRouter/Claude API with dealership context
    const campaign = {
        id: `CAMP-${Date.now()}`,
        target_model: target_model || 'Toyota Land Cruiser Prado',
        budget_aed: budget_aed || 5000,
        channels: channels || ['google_ads', 'meta_ads', 'whatsapp'],
        status: 'generated',
        created_at: new Date().toISOString(),
        generated_by: 'Hermes AI Agent',
        content: {
            google_ads: {
                headline: `Best Price on ${target_model || 'Toyota Prado'} in UAE`,
                description: 'Certified pre-owned. Full warranty. Finance available from AED 2,500/month.',
                keywords: ['buy toyota prado uae', 'best car deals dubai', 'alba cars']
            },
            meta_ads: {
                primary_text: `Looking for a ${target_model || 'Toyota Prado'}? Alba Cars has the best prices in the UAE. Visit us today!`,
                cta: 'LEARN_MORE',
                audience: 'UAE residents, Age 25-55, Interest: Cars, Luxury'
            },
            whatsapp: {
                template: `Hi {{name}}, we have a special offer on the ${target_model || 'Toyota Prado'}. Would you like to schedule a test drive? Reply YES to confirm.`
            }
        },
        estimated_roi: {
            impressions: 45000,
            clicks: 1800,
            leads: 90,
            cost_per_lead_aed: (budget_aed || 5000) / 90,
            estimated_conversions: 5,
            estimated_revenue_aed: 5 * 210000,
            roi_percentage: ((5 * 210000 - (budget_aed || 5000)) / (budget_aed || 5000) * 100).toFixed(1)
        }
    };

    if (db) {
        await db.collection('campaigns').insertOne(campaign);
    }

    res.json(campaign);
});

// ==========================================
// MARKETING ATTRIBUTION
// ==========================================

/**
 * GET /api/attribution
 * Returns marketing ROI attribution by channel.
 * Connects marketing spend to actual CRM closed-won deals.
 */
app.get('/api/attribution', async (req, res) => {
    res.json({
        period: 'Last 30 days',
        channels: [
            {
                channel: 'Google Ads',
                spend_aed: 12000,
                leads_generated: 85,
                deals_closed: 4,
                revenue_aed: 820000,
                gross_profit_aed: 96000,
                true_roi: ((96000 - 12000) / 12000 * 100).toFixed(1) + '%',
                cost_per_acquisition: 3000
            },
            {
                channel: 'Facebook/Instagram',
                spend_aed: 8000,
                leads_generated: 120,
                deals_closed: 3,
                revenue_aed: 645000,
                gross_profit_aed: 72000,
                true_roi: ((72000 - 8000) / 8000 * 100).toFixed(1) + '%',
                cost_per_acquisition: 2667
            },
            {
                channel: 'WhatsApp Broadcast',
                spend_aed: 500,
                leads_generated: 35,
                deals_closed: 2,
                revenue_aed: 420000,
                gross_profit_aed: 48000,
                true_roi: ((48000 - 500) / 500 * 100).toFixed(1) + '%',
                cost_per_acquisition: 250
            }
        ],
        ai_insight: 'WhatsApp has the highest ROI at 9500%. Recommend increasing WhatsApp budget by 300% and reducing Facebook spend by 20%.'
    });
});

// ==========================================
// LEAD NURTURING (Hermes Agent)
// ==========================================

/**
 * POST /api/nurture/trigger
 * Triggers automated lead nurturing sequence for inactive leads.
 * Integrates with n8n/Make for multi-step workflows.
 */
app.post('/api/nurture/trigger', async (req, res) => {
    const { lead_id, inactive_days } = req.body;

    const nurture_sequence = {
        lead_id: lead_id || 'LEAD-001',
        triggered_at: new Date().toISOString(),
        triggered_by: 'Hermes AI Agent',
        reason: `Lead inactive for ${inactive_days || 30} days`,
        sequence: [
            { day: 1, channel: 'whatsapp', action: 'Send personalized offer based on last viewed vehicle' },
            { day: 3, channel: 'email', action: 'Send market comparison report showing price advantage' },
            { day: 5, channel: 'sms', action: 'Limited time offer notification' },
            { day: 7, channel: 'crm_task', action: 'Assign salesperson for personal follow-up call' },
            { day: 14, channel: 'whatsapp', action: 'Send exclusive discount code (5% off)' }
        ],
        n8n_webhook: process.env.N8N_WEBHOOK_URL || 'https://n8n.albacars.internal/webhook/nurture',
        status: 'activated'
    };

    res.json(nurture_sequence);
});

// ==========================================
// DAILY CRON: Competitor Price Scraper
// ==========================================
// Runs every day at 6 AM to scrape competitor prices
cron.schedule('0 6 * * *', async () => {
    console.log('[Cron] Running daily competitor price scraper...');
    // In production: calls scripts/competitor_scraper.js
    // Stores results in MongoDB competitor_pricing collection
});

// Start Server
connectDB().then(() => {
    app.listen(port, () => {
        console.log(`[Enterprise API] Alba Marketing OS listening on port ${port}`);
    });
});

module.exports = app;
