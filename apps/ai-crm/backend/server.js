require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Enterprise Supabase Connection
// Replace with actual Supabase keys in production .env
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'placeholder_key';
const supabase = createClient(supabaseUrl, supabaseKey);

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Alba AI CRM Gateway running' });
});

// Financial Intelligence API: Get Car Inventory with Costing
app.get('/api/inventory', async (req, res) => {
    // Mock Odoo ERP / Supabase Query
    res.json([
        {
            id: 1,
            model: 'Toyota Land Cruiser Prado',
            price_aed: 210000,
            cost_aed: 185000,
            status: 'Available',
            gross_margin: 25000,
            recommended_commission: 1250 // 5% of margin
        },
        {
            id: 2,
            model: 'Nissan Patrol V8',
            price_aed: 280000,
            cost_aed: 240000,
            status: 'Reserved',
            gross_margin: 40000,
            recommended_commission: 2000
        }
    ]);
});

app.listen(port, () => {
    console.log(`[Enterprise API] Alba AI CRM Gateway listening on port ${port}`);
});
