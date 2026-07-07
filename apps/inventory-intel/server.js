/**
 * AutoDealer AI OS - Vehicle Inventory Intelligence
 * ===================================================
 * 
 * BUSINESS PROBLEM:
 *   Vehicles sit in dealership lots for months without systematic price reviews.
 *   Holding costs (storage, insurance, depreciation) silently erode margins at
 *   ~AED 50/day. By day 120, a vehicle that originally had AED 25,000 margin
 *   has lost AED 6,000 just to holding costs — and nobody noticed.
 * 
 * CURRENT MANUAL PROCESS:
 *   1. Manager manually checks inventory spreadsheet (if it exists)
 *   2. Guesses which cars have been sitting too long
 *   3. Makes ad-hoc price reduction decisions
 *   4. No connection between inventory aging and marketing campaigns
 * 
 * AI-POWERED SOLUTION:
 *   - Tracks full vehicle lifecycle: Purchase → Import → Inspection → 
 *     Reconditioning → Photography → Listing → Lead → Sale → Warranty → Service
 *   - Calculates real-time holding costs and break-even prices
 *   - AI flags aging vehicles at 60/90/120 day thresholds
 *   - Automatically triggers marketing campaigns for slow-moving stock
 *   - Predicts demand based on historical sales patterns
 * 
 * EXPECTED BUSINESS IMPACT:
 *   - Reduced average days-in-stock
 *   - Lower holding cost losses
 *   - Better margin protection through proactive pricing
 *   - Automated connection between inventory aging and marketing
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 5003;

app.use(cors());
app.use(express.json());

// ==========================================
// VEHICLE LIFECYCLE STAGES
// ==========================================
const LIFECYCLE_STAGES = [
    'purchased',
    'in_transit',
    'customs_clearance',
    'inspection',
    'reconditioning',
    'photography',
    'listed',
    'lead_generated',
    'test_drive',
    'reserved',
    'finance_processing',
    'sold',
    'delivered',
    'in_warranty',
    'in_service',
    'trade_in_received',
    'resale_listed'
];

// ==========================================
// MOCK INVENTORY (In production: Supabase + Odoo ERP)
// ==========================================
const inventory = [
    {
        id: 'VH-001',
        vin: '1HGCM82633A123456',
        make: 'Toyota',
        model: 'Land Cruiser',
        year: 2024,
        color: 'White Pearl',
        mileage_km: 12000,
        condition: 'certified_preowned',
        lifecycle_stage: 'listed',
        
        // Financial Intelligence (Accounting USP)
        purchase_price: 185000,
        shipping_cost: 3500,
        customs_duty: 9425,    // 5% of CIF
        port_handling: 950,
        reconditioning_cost: 4200,
        total_landed_cost: 203075,
        
        listing_price: 228000,
        gross_margin: 24925,
        
        // Holding Cost Tracking
        stock_date: '2025-04-15',
        days_in_stock: 83,
        holding_cost_per_day: 50,
        total_holding_cost: 83 * 50,  // AED 4,150
        break_even_price: 203075 + (83 * 50), // AED 207,225
        
        // AI Intelligence
        ai_demand_score: 72,
        ai_price_recommendation: 225000,
        ai_aging_alert: 'WARNING',
        ai_recommendation: 'Vehicle approaching 90-day threshold. Current margin after holding: AED 20,775. Recommend price reduction of AED 3,000 or launch targeted WhatsApp campaign.'
    },
    {
        id: 'VH-002',
        vin: '5TDJKN30L500ABCDE',
        make: 'Nissan',
        model: 'Patrol V8',
        year: 2025,
        color: 'Black',
        mileage_km: 0,
        condition: 'new',
        lifecycle_stage: 'listed',
        
        purchase_price: 240000,
        shipping_cost: 0,
        customs_duty: 0,
        port_handling: 0,
        reconditioning_cost: 0,
        total_landed_cost: 240000,
        
        listing_price: 285000,
        gross_margin: 45000,
        
        stock_date: '2025-06-01',
        days_in_stock: 36,
        holding_cost_per_day: 50,
        total_holding_cost: 36 * 50,
        break_even_price: 240000 + (36 * 50),
        
        ai_demand_score: 91,
        ai_price_recommendation: 289000,
        ai_aging_alert: 'OK',
        ai_recommendation: 'High demand model. Consider increasing price by AED 4,000. Market shows strong buyer interest.'
    },
    {
        id: 'VH-003',
        vin: 'WBA8E9C50J2FGHIJK',
        make: 'Porsche',
        model: 'Cayenne S',
        year: 2023,
        color: 'Grey Metallic',
        mileage_km: 38000,
        condition: 'pre_owned',
        lifecycle_stage: 'listed',
        
        purchase_price: 195000,
        shipping_cost: 5200,
        customs_duty: 10010,
        port_handling: 1100,
        reconditioning_cost: 8500,
        total_landed_cost: 219810,
        
        listing_price: 262000,
        gross_margin: 42190,
        
        stock_date: '2025-02-10',
        days_in_stock: 147,
        holding_cost_per_day: 50,
        total_holding_cost: 147 * 50,  // AED 7,350
        break_even_price: 219810 + (147 * 50),  // AED 227,160
        
        ai_demand_score: 45,
        ai_price_recommendation: 245000,
        ai_aging_alert: 'CRITICAL',
        ai_recommendation: 'CRITICAL: Vehicle aged 147 days. Holding costs have consumed AED 7,350 of margin. Original margin: AED 42,190, Effective margin now: AED 34,840. Recommend immediate price reduction to AED 245,000 and launch clearance campaign. Write-down policy applies (2%/month after 120 days).'
    },
    {
        id: 'VH-004',
        vin: '2T1BURHE5KC234567',
        make: 'Lexus',
        model: 'LX 600',
        year: 2025,
        color: 'Sonic Titanium',
        mileage_km: 500,
        condition: 'new',
        lifecycle_stage: 'reserved',
        
        purchase_price: 340000,
        shipping_cost: 0,
        customs_duty: 0,
        port_handling: 0,
        reconditioning_cost: 0,
        total_landed_cost: 340000,
        
        listing_price: 420000,
        gross_margin: 80000,
        
        stock_date: '2025-06-20',
        days_in_stock: 17,
        holding_cost_per_day: 50,
        total_holding_cost: 17 * 50,
        break_even_price: 340000 + (17 * 50),
        
        ai_demand_score: 95,
        ai_price_recommendation: 425000,
        ai_aging_alert: 'OK',
        ai_recommendation: 'Premium model with strong demand. Customer reservation active. Estimated commission for salesperson: AED 8,000 (10% tier).'
    }
];

// ==========================================
// API ENDPOINTS
// ==========================================

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', service: 'AutoDealer Inventory Intelligence', vehicles_tracked: inventory.length });
});

// Full Inventory with AI Intelligence
app.get('/api/v1/inventory', (req, res) => {
    res.json({
        total_vehicles: inventory.length,
        total_inventory_value: inventory.reduce((sum, v) => sum + v.listing_price, 0),
        total_invested: inventory.reduce((sum, v) => sum + v.total_landed_cost, 0),
        total_holding_costs: inventory.reduce((sum, v) => sum + v.total_holding_cost, 0),
        total_potential_margin: inventory.reduce((sum, v) => sum + (v.gross_margin - v.total_holding_cost), 0),
        vehicles: inventory
    });
});

// Vehicle Lifecycle Tracking
app.get('/api/v1/inventory/:id/lifecycle', (req, res) => {
    const vehicle = inventory.find(v => v.id === req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    // Simulated lifecycle history
    const lifecycle = [
        { stage: 'purchased', date: vehicle.stock_date, notes: `Purchased for AED ${vehicle.purchase_price.toLocaleString()}` },
        { stage: 'in_transit', date: vehicle.stock_date, notes: `Shipping cost: AED ${vehicle.shipping_cost.toLocaleString()}` },
        { stage: 'customs_clearance', date: vehicle.stock_date, notes: `Duty: AED ${vehicle.customs_duty.toLocaleString()}` },
        { stage: 'inspection', date: vehicle.stock_date, notes: 'Passed technical inspection' },
        { stage: 'reconditioning', date: vehicle.stock_date, notes: `Cost: AED ${vehicle.reconditioning_cost.toLocaleString()}` },
        { stage: 'photography', date: vehicle.stock_date, notes: '24 photos taken, 360° view created' },
        { stage: 'listed', date: vehicle.stock_date, notes: `Listed at AED ${vehicle.listing_price.toLocaleString()}` },
        { stage: vehicle.lifecycle_stage, date: new Date().toISOString().split('T')[0], notes: 'Current stage' }
    ];

    res.json({
        vehicle_id: vehicle.id,
        vin: vehicle.vin,
        current_stage: vehicle.lifecycle_stage,
        available_stages: LIFECYCLE_STAGES,
        history: lifecycle
    });
});

// Aging Report (Critical for dealership management)
app.get('/api/v1/inventory/reports/aging', (req, res) => {
    const aging = {
        summary: {
            total_vehicles: inventory.length,
            avg_days_in_stock: Math.round(inventory.reduce((sum, v) => sum + v.days_in_stock, 0) / inventory.length),
            total_holding_cost_loss: inventory.reduce((sum, v) => sum + v.total_holding_cost, 0),
            vehicles_over_90_days: inventory.filter(v => v.days_in_stock > 90).length,
            vehicles_over_120_days: inventory.filter(v => v.days_in_stock > 120).length
        },
        brackets: [
            {
                range: '0-30 days',
                count: inventory.filter(v => v.days_in_stock <= 30).length,
                vehicles: inventory.filter(v => v.days_in_stock <= 30).map(v => v.id),
                status: 'HEALTHY'
            },
            {
                range: '31-60 days',
                count: inventory.filter(v => v.days_in_stock > 30 && v.days_in_stock <= 60).length,
                vehicles: inventory.filter(v => v.days_in_stock > 30 && v.days_in_stock <= 60).map(v => v.id),
                status: 'MONITOR'
            },
            {
                range: '61-90 days',
                count: inventory.filter(v => v.days_in_stock > 60 && v.days_in_stock <= 90).length,
                vehicles: inventory.filter(v => v.days_in_stock > 60 && v.days_in_stock <= 90).map(v => v.id),
                status: 'WARNING'
            },
            {
                range: '91-120 days',
                count: inventory.filter(v => v.days_in_stock > 90 && v.days_in_stock <= 120).length,
                vehicles: inventory.filter(v => v.days_in_stock > 90 && v.days_in_stock <= 120).map(v => v.id),
                status: 'ACTION_REQUIRED'
            },
            {
                range: '120+ days',
                count: inventory.filter(v => v.days_in_stock > 120).length,
                vehicles: inventory.filter(v => v.days_in_stock > 120).map(v => v.id),
                status: 'CRITICAL - Write-down policy applies'
            }
        ]
    };

    res.json(aging);
});

// Commission Calculator (Accounting USP)
app.post('/api/v1/deals/commission', (req, res) => {
    const { vehicle_id, selling_price, accessories_amount, finance_approved, insurance_sold } = req.body;
    const vehicle = inventory.find(v => v.id === vehicle_id);
    
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const final_selling = selling_price || vehicle.listing_price;
    const gross_margin = final_selling - vehicle.total_landed_cost;
    const effective_margin = gross_margin - vehicle.total_holding_cost;
    
    // Commission tiers (from HR policy)
    let commission_rate;
    if (gross_margin > 50000) commission_rate = 0.10;
    else if (gross_margin > 25000) commission_rate = 0.07;
    else if (gross_margin > 10000) commission_rate = 0.05;
    else commission_rate = 0.03;

    const salesperson_commission = gross_margin * commission_rate;
    const accessories_commission = (accessories_amount || 0) * 0.15;
    const finance_commission = finance_approved ? (finance_approved * 0.01) : 0;
    const insurance_commission = insurance_sold ? 200 : 0;
    
    const total_commission = salesperson_commission + accessories_commission + finance_commission + insurance_commission;

    // VAT Calculation
    const vat_rate = 0.05;
    const vat_on_sale = final_selling * vat_rate;
    const vat_on_purchase = vehicle.total_landed_cost * vat_rate;
    const vat_payable = vat_on_sale - vat_on_purchase;

    // Net Profit
    const net_profit = effective_margin - total_commission - vat_payable;

    res.json({
        vehicle: `${vehicle.make} ${vehicle.model} (${vehicle.year})`,
        financial_summary: {
            selling_price: final_selling,
            total_landed_cost: vehicle.total_landed_cost,
            gross_margin: gross_margin,
            days_in_stock: vehicle.days_in_stock,
            holding_cost_deducted: vehicle.total_holding_cost,
            effective_margin: effective_margin
        },
        commission_breakdown: {
            commission_tier: `${(commission_rate * 100)}% (margin: AED ${gross_margin.toLocaleString()})`,
            vehicle_commission: salesperson_commission,
            accessories_commission: accessories_commission,
            finance_commission: finance_commission,
            insurance_commission: insurance_commission,
            total_commission: total_commission
        },
        tax: {
            vat_on_sale: vat_on_sale,
            vat_input_credit: vat_on_purchase,
            vat_payable: vat_payable
        },
        net_profit: net_profit,
        profit_margin_pct: ((net_profit / final_selling) * 100).toFixed(2) + '%'
    });
});

// ==========================================
// CRON: Weekly Aging Alert
// ==========================================
cron.schedule('0 8 * * 1', () => {
    console.log('[Cron] Running weekly aging analysis...');
    const critical = inventory.filter(v => v.days_in_stock > 90);
    if (critical.length > 0) {
        console.log(`[Alert] ${critical.length} vehicles over 90 days. Triggering marketing campaigns.`);
        // In production: POST to automation-engine webhook
    }
});

// Start Server
app.listen(port, () => {
    console.log(`[Enterprise API] AutoDealer Inventory Intelligence on port ${port}`);
});

module.exports = app;
