# Vehicle Inventory Intelligence

## Business Problem
Vehicles sit in dealership lots for months without systematic price reviews. Holding costs (storage, insurance, depreciation at ~AED 50/day) silently erode margins. A vehicle with AED 25,000 original margin loses AED 6,000 in just 120 days — and nobody notices until the sale closes at a loss.

## Current Manual Process
1. Manager manually checks an Excel spreadsheet (updated weekly, maybe)
2. Guesses which cars have been sitting too long
3. Makes ad-hoc price reduction decisions with no data
4. No connection between inventory aging and marketing campaigns
5. Commission calculated manually after the sale

## AI-Powered Solution
- **Full Vehicle Lifecycle Tracking:** From Purchase → Import → Customs → Inspection → Reconditioning → Photography → Listing → Lead → Test Drive → Reservation → Finance → Sale → Delivery → Warranty → Service → Trade-in → Resale
- **Real-time Financial Intelligence:** Break-even price, holding costs, margin erosion — updated daily
- **AI Aging Alerts:** Automatic flags at 60/90/120 day thresholds
- **Commission Calculator:** Instant calculation based on sliding margin tiers, accessories, finance, insurance
- **Event-driven Marketing Trigger:** Aging vehicles automatically trigger clearance campaigns in Marketing OS

## Business Workflow
```
Vehicle Purchased
    ↓
Import → Customs → Inspection → Reconditioning
    ↓
Photography → Website Listing
    ↓
[Daily] AI monitors: days_in_stock, holding_cost, demand_score
    ↓
Day 60: MONITOR alert to manager
Day 90: WARNING + auto-generate marketing campaign
Day 120: CRITICAL + write-down policy + clearance sale
    ↓
Sale → Commission auto-calculated → Profit logged → Dashboard updated
```

## Expected Business Impact
- Reduced average days-in-stock through proactive management
- Lower holding cost losses through early intervention
- Better margin protection through AI-powered pricing recommendations
- Automated connection between inventory status and marketing campaigns

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/inventory` | Full inventory with AI intelligence |
| GET | `/api/v1/inventory/:id/lifecycle` | Vehicle lifecycle history |
| GET | `/api/v1/inventory/reports/aging` | Aging analysis by bracket |
| POST | `/api/v1/deals/commission` | Calculate deal commission and profit |
| GET | `/api/health` | Service health check |
