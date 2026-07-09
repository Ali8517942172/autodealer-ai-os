// AutoDealer AI OS - Dashboard Frontend JavaScript
// Connects to all backend services and renders live data

const API = {
    crm: 'http://localhost:5000',
    marketing: 'http://localhost:5001',
    inventory: 'http://localhost:5003',
    odoo: 'http://localhost:5004',
    dashboard: 'http://localhost:5005',
    gateway: 'http://localhost:5010'
};

// ==========================================
// PAGE NAVIGATION
// ==========================================
function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    document.querySelector(`[data-page="${page}"]`).classList.add('active');

    const titles = {
        dashboard: 'Executive Dashboard',
        leads: 'Leads & CRM',
        inventory: 'Vehicle Inventory',
        marketing: 'Marketing Intelligence',
        finance: 'Finance & Accounting',
        rag: 'AI Knowledge Assistant',
        automation: 'Automations & Workflows'
    };
    document.getElementById('page-title').textContent = titles[page] || 'Dashboard';

    // Load page-specific data
    if (page === 'inventory') loadInventoryPage();
    if (page === 'marketing') loadMarketingPage();
    if (page === 'finance') loadFinancePage();
    if (page === 'leads') loadLeadsPage();
    if (page === 'automation') loadEventLog();
}

// ==========================================
// DASHBOARD LOAD
// ==========================================
async function loadDashboard() {
    try {
        const res = await fetch(`${API.dashboard}/api/v1/dashboard`);
        const data = await res.json();

        // KPIs
        document.getElementById('todayRevenue').textContent = `AED ${(data.sales.today_revenue/1000).toFixed(0)}K`;
        document.getElementById('mtdRevenue').textContent = `AED ${(data.sales.mtd_revenue/1000000).toFixed(1)}M`;
        document.getElementById('pipelineValue').textContent = `AED ${(data.sales.pipeline_value/1000000).toFixed(1)}M`;
        document.getElementById('netProfit').textContent = `AED ${(data.finance.net_profit_mtd/1000).toFixed(0)}K`;
        document.getElementById('grossMargin').textContent = `↑ ${data.finance.gross_margin_pct} margin`;

        // Pipeline
        document.getElementById('hotLeads').textContent = data.sales.hot_leads;
        document.getElementById('warmLeads').textContent = data.sales.warm_leads;
        document.getElementById('coldLeads').textContent = data.sales.cold_leads;
        document.getElementById('convRate').textContent = data.sales.conversion_rate;
        document.getElementById('avgDays').textContent = `${data.sales.avg_days_to_close} days`;

        // AI Insights
        const insightsHtml = data.ai_insights.map(i => `
            <div class="insight-item ${i.priority.toLowerCase()}">
                <div class="insight-priority" style="color: ${i.priority === 'HIGH' ? 'var(--danger)' : i.priority === 'MEDIUM' ? 'var(--warning)' : 'var(--accent)'}">
                    ${i.priority} PRIORITY
                </div>
                ${i.insight}
                <div style="margin-top:6px;color:var(--accent);font-size:12px;">Action: ${i.action}</div>
            </div>
        `).join('');
        document.getElementById('aiInsights').innerHTML = insightsHtml;

        // Inventory Alerts
        const alertsHtml = data.inventory.ai_alerts.map(a => `
            <div class="alert-item">
                <div class="alert-badge" style="color: ${a.alert === 'CRITICAL' ? 'var(--danger)' : 'var(--warning)'}">
                    ${a.alert === 'CRITICAL' ? '🔴' : '🟡'} ${a.alert}
                </div>
                <strong>${a.vehicle}</strong> — ${a.days} days
                <div style="color:var(--text-muted);font-size:12px;margin-top:4px;">${a.action}</div>
            </div>
        `).join('');
        document.getElementById('inventoryAlerts').innerHTML = alertsHtml;

        // Marketing ROI
        const channels = [
            { name: 'WhatsApp', roi: data.marketing.best_channel_roi, color: 'var(--success)' },
            { name: 'Facebook/IG', roi: '800%', color: 'var(--accent)' },
            { name: 'Google Ads', roi: '700%', color: 'var(--warning)' }
        ];
        document.getElementById('marketingROI').innerHTML = channels.map(c => `
            <div class="channel-item">
                <span>${c.name}</span>
                <span class="channel-roi" style="color:${c.color}">${c.roi}</span>
            </div>
        `).join('');

        // Top Performer
        document.getElementById('topPerformer').innerHTML = `
            <div class="perf-name">🏆 ${data.team.top_performer.name}</div>
            <div class="perf-stat"><span>Deals Closed</span><strong>${data.team.top_performer.deals}</strong></div>
            <div class="perf-stat"><span>Revenue</span><strong>AED ${(data.team.top_performer.revenue/1000).toFixed(0)}K</strong></div>
            <div class="perf-stat"><span>Commission</span><strong>AED ${data.team.top_performer.commission.toLocaleString()}</strong></div>
        `;
    } catch (err) {
        console.error('Dashboard load error:', err);
    }
}

// ==========================================
// INVENTORY PAGE
// ==========================================
async function loadInventoryPage() {
    try {
        const res = await fetch(`${API.inventory}/api/v1/inventory`);
        const data = await res.json();

        document.getElementById('invTotal').textContent = data.total_vehicles;
        document.getElementById('invValue').textContent = `AED ${(data.total_inventory_value/1000000).toFixed(1)}M`;
        document.getElementById('invHolding').textContent = `AED ${data.total_holding_costs.toLocaleString()}`;
        document.getElementById('invMargin').textContent = `AED ${data.total_potential_margin.toLocaleString()}`;

        document.getElementById('inventoryTable').innerHTML = data.vehicles.map(v => `
            <tr>
                <td>${v.id}</td>
                <td><strong>${v.make} ${v.model}</strong> (${v.year})</td>
                <td>AED ${v.listing_price.toLocaleString()}</td>
                <td>AED ${v.total_landed_cost.toLocaleString()}</td>
                <td>AED ${v.gross_margin.toLocaleString()}</td>
                <td>${v.days_in_stock} days</td>
                <td><span class="badge badge-${v.ai_aging_alert.toLowerCase()}">${v.ai_aging_alert}</span></td>
            </tr>
        `).join('');

        // Aging Report
        const agingRes = await fetch(`${API.inventory}/api/v1/inventory/reports/aging`);
        const aging = await agingRes.json();
        const colors = ['var(--success)', 'var(--accent)', 'var(--warning)', '#f97316', 'var(--danger)'];
        const maxCount = Math.max(...aging.brackets.map(b => b.count), 1);

        document.getElementById('agingBars').innerHTML = aging.brackets.map((b, i) => `
            <div class="aging-bar-item">
                <span class="aging-label">${b.range}</span>
                <div class="aging-bar">
                    <div class="aging-fill" style="width:${Math.max((b.count/maxCount)*100, b.count > 0 ? 20 : 5)}%;background:${colors[i]};">
                        ${b.count} vehicles
                    </div>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Inventory load error:', err);
    }
}

// ==========================================
// MARKETING PAGE
// ==========================================
async function loadMarketingPage() {
    try {
        const attrRes = await fetch(`${API.marketing}/api/attribution`);
        const attr = await attrRes.json();

        document.getElementById('attributionTable').innerHTML = attr.channels.map(c => `
            <tr>
                <td><strong>${c.channel}</strong></td>
                <td>AED ${c.spend_aed.toLocaleString()}</td>
                <td>${c.leads_generated}</td>
                <td>${c.deals_closed}</td>
                <td>AED ${c.revenue_generated_aed.toLocaleString()}</td>
                <td style="color:var(--success);font-weight:700;">${c.true_roi}</td>
            </tr>
        `).join('');

        const compRes = await fetch(`${API.marketing}/api/competitors`);
        const comps = await compRes.json();

        document.getElementById('competitorList').innerHTML = comps.map(c => `
            <div class="competitor-item">
                <div class="comp-name">${c.competitor} — ${c.model}</div>
                <div>Price: <strong>AED ${c.price_aed.toLocaleString()}</strong></div>
                <div class="comp-rec">🤖 ${c.ai_recommendation}</div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Marketing load error:', err);
    }
}

// ==========================================
// FINANCE PAGE
// ==========================================
async function loadFinancePage() {
    try {
        const res = await fetch(`${API.odoo}/api/v1/erp/accounting/summary`);
        const data = await res.json();

        document.getElementById('finRevenue').textContent = `AED ${(data.revenue.total/1000000).toFixed(1)}M`;
        document.getElementById('finCOGS').textContent = `AED ${(data.cost_of_goods.total/1000000).toFixed(1)}M`;
        document.getElementById('finGross').textContent = `AED ${(data.gross_profit/1000).toFixed(0)}K`;
        document.getElementById('finNet').textContent = `AED ${(data.net_profit/1000).toFixed(0)}K`;

        const items = [
            { label: 'Vehicle Sales', value: `AED ${data.revenue.vehicle_sales.toLocaleString()}` },
            { label: 'Accessories', value: `AED ${data.revenue.accessories.toLocaleString()}` },
            { label: 'Warranty Sales', value: `AED ${data.revenue.warranty_sales.toLocaleString()}` },
            { label: 'Finance Commission', value: `AED ${data.revenue.finance_commission.toLocaleString()}` },
            { label: 'Salaries', value: `AED ${data.operating_expenses.salaries.toLocaleString()}` },
            { label: 'Marketing', value: `AED ${data.operating_expenses.marketing.toLocaleString()}` },
            { label: 'VAT Payable', value: `AED ${data.vat_payable.toLocaleString()}` },
            { label: 'Commissions', value: `AED ${data.salesperson_commissions.toLocaleString()}` }
        ];
        document.getElementById('plSummary').innerHTML = items.map(i => `
            <div class="pl-item"><span class="pl-label">${i.label}</span><span class="pl-value">${i.value}</span></div>
        `).join('');
    } catch (err) {
        console.error('Finance load error:', err);
    }
}

// ==========================================
// LEADS PAGE
// ==========================================
async function loadLeadsPage() {
    try {
        const res = await fetch(`${API.crm}/api/leads`);
        const liveLeads = await res.json();
        
        const dummyLeads = [
            { name: 'Ahmed Al Maktoum', vehicle: 'Toyota Land Cruiser', source: 'Website', score: 92, priority: 'hot', status: 'Contacted' },
            { name: 'Fatima Hassan', vehicle: 'Lexus LX 600', source: 'WhatsApp', score: 88, priority: 'hot', status: 'Test Drive' },
            { name: 'Mohammed Rashed', vehicle: 'Nissan Patrol V8', source: 'Walk-in', score: 85, priority: 'hot', status: 'Negotiation' },
            { name: 'Sara Al Ali', vehicle: 'BMW X5', source: 'Google Ads', score: 78, priority: 'warm', status: 'Follow-up' }
        ];

        const formattedLive = liveLeads.map(l => ({
            name: l.name,
            vehicle: l.email || 'Automated Lead',
            source: l.source,
            score: 99,
            priority: 'hot',
            status: l.status
        }));

        const leads = [...formattedLive, ...dummyLeads];

        document.getElementById('leadsTable').innerHTML = leads.map(l => `
            <tr>
                <td><strong>${l.name}</strong></td>
                <td>${l.vehicle}</td>
                <td>${l.source}</td>
                <td><strong>${l.score}</strong></td>
                <td><span class="badge badge-${l.priority}">${l.priority.toUpperCase()}</span></td>
                <td>${l.status}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Leads load error:', err);
    }
}

// ==========================================
// ASK AI (Manager Agent)
// ==========================================
async function askAI() {
    const input = document.getElementById('askAiInput');
    const question = input.value.trim();
    if (!question) return;

    try {
        const res = await fetch(`${API.dashboard}/api/v1/dashboard/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
        });
        const data = await res.json();

        const card = document.getElementById('aiResponseCard');
        card.style.display = 'block';
        document.getElementById('aiResponse').innerHTML = `
            <strong>Q: ${data.question}</strong>
            <p style="margin-top:8px;">${data.answer}</p>
            <small style="color:var(--text-muted);">Answered by: ${data.agent}</small>
        `;
        input.value = '';
    } catch (err) {
        console.error('Ask AI error:', err);
    }
}

// ==========================================
// RAG CHAT
// ==========================================
async function askRAG() {
    const input = document.getElementById('ragInput');
    const question = input.value.trim();
    if (!question) return;

    const messages = document.getElementById('chatMessages');
    messages.innerHTML += `<div class="chat-msg user"><strong>You</strong><p>${question}</p></div>`;
    input.value = '';
    messages.scrollTop = messages.scrollHeight;

    // Demo responses for common questions
    const ragResponses = {
        'warranty': 'Based on our Warranty Policy (Section 3.1):\n\n• **Standard Warranty:** 3 years / 100,000 km (whichever comes first)\n• **Extended Warranty:** Available for additional 2 years\n• **Powertrain:** 5 years / 150,000 km\n• **Battery (hybrid):** 8 years / 160,000 km\n\n⚠️ Warranty is void if service intervals are not followed per manufacturer guidelines.\n\n📄 Source: warranty_policy_v4.2.pdf, Page 12',
        'leave': 'Based on HR Policy (Section 5.2 - Leave Entitlement):\n\n• **Annual Leave:** 30 calendar days per year\n• **Sick Leave:** 15 days (first 45 days full pay, next 45 half pay)\n• **Maternity:** 60 days\n• **Hajj Leave:** 30 days (once during tenure)\n• **Carry Forward:** Max 15 days to next year\n\n📄 Source: hr_handbook_2026.pdf, Section 5',
        'commission': 'Based on Sales Compensation Policy (Section 2.1):\n\n• **Margin < AED 10K:** 3% commission\n• **Margin AED 10K-25K:** 5% commission\n• **Margin AED 25K-50K:** 7% commission\n• **Margin > AED 50K:** 10% commission\n• **Bonus:** +AED 200 per extended warranty sold\n• **Bonus:** +15% on accessories sold\n\n📄 Source: sales_compensation_policy.pdf, Page 4',
        'trade': 'Based on Trade-In Appraisal SOP (Section 7.1):\n\n1. Physical inspection (30 min)\n2. OBD diagnostic scan\n3. Market value check (3 sources)\n4. Deduction matrix applied\n5. Manager approval required for offers > AED 100K\n6. Valid for 48 hours\n\n📄 Source: trade_in_appraisal_sop.pdf, Page 8',
        'default': 'I searched our document database and found relevant information. In a production deployment, I would use pgvector embeddings to find the most relevant document chunks and provide cited answers.\n\nPlease try asking about: warranty coverage, leave policy, commission structure, or trade-in process.\n\n📄 Agent: Openclaw (Knowledge & Compliance)'
    };

    const key = Object.keys(ragResponses).find(k => question.toLowerCase().includes(k)) || 'default';

    setTimeout(() => {
        messages.innerHTML += `<div class="chat-msg bot"><strong>Openclaw Agent</strong><p>${ragResponses[key].replace(/\n/g, '<br>')}</p></div>`;
        messages.scrollTop = messages.scrollHeight;
    }, 800);
}

// ==========================================
// COMMISSION CALCULATOR
// ==========================================
async function calcCommission() {
    const vehicleId = document.getElementById('calcVehicle').value;
    const price = parseInt(document.getElementById('calcPrice').value);
    const accessories = parseInt(document.getElementById('calcAccessories').value) || 0;
    const finance = parseInt(document.getElementById('calcFinance').value) || 0;

    try {
        const res = await fetch(`${API.inventory}/api/v1/deals/commission`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                vehicle_id: vehicleId,
                selling_price: price,
                accessories_amount: accessories,
                finance_approved: finance,
                insurance_sold: true
            })
        });
        const data = await res.json();

        document.getElementById('commissionResult').innerHTML = `
            <h4 style="margin-bottom:12px;">📊 ${data.vehicle}</h4>
            <div class="pl-grid">
                <div class="pl-item"><span class="pl-label">Selling Price</span><span class="pl-value">AED ${data.financial_summary.selling_price.toLocaleString()}</span></div>
                <div class="pl-item"><span class="pl-label">Landed Cost</span><span class="pl-value">AED ${data.financial_summary.total_landed_cost.toLocaleString()}</span></div>
                <div class="pl-item"><span class="pl-label">Gross Margin</span><span class="pl-value" style="color:var(--success)">AED ${data.financial_summary.gross_margin.toLocaleString()}</span></div>
                <div class="pl-item"><span class="pl-label">Holding Cost</span><span class="pl-value" style="color:var(--warning)">AED ${data.financial_summary.holding_cost_deducted.toLocaleString()}</span></div>
                <div class="pl-item"><span class="pl-label">Commission Tier</span><span class="pl-value">${data.commission_breakdown.commission_tier}</span></div>
                <div class="pl-item"><span class="pl-label">Total Commission</span><span class="pl-value" style="color:var(--accent)">AED ${data.commission_breakdown.total_commission.toLocaleString()}</span></div>
                <div class="pl-item"><span class="pl-label">VAT Payable</span><span class="pl-value">AED ${data.tax.vat_payable.toLocaleString()}</span></div>
                <div class="pl-item"><span class="pl-label" style="font-weight:700">Net Profit</span><span class="pl-value" style="color:var(--success);font-size:18px">AED ${data.net_profit.toLocaleString()} (${data.profit_margin_pct})</span></div>
            </div>
        `;
    } catch (err) {
        console.error('Commission calc error:', err);
    }
}

// ==========================================
// EVENT LOG (Simulated Live Events)
// ==========================================
function loadEventLog() {
    const events = [
        { time: '09:02:14', type: 'LEAD_CREATED', msg: 'New lead: Ahmed → Toyota LC (Website)' },
        { time: '09:02:15', type: 'AI_SCORED', msg: 'Lead scored: 92/100 → HOT' },
        { time: '09:02:16', type: 'CRM_UPDATED', msg: 'Lead assigned to Mohammed A.' },
        { time: '09:02:17', type: 'WHATSAPP_SENT', msg: 'Auto-reply sent to +971-50-XXX' },
        { time: '09:05:30', type: 'COMPETITOR_ALERT', msg: 'Al Futtaim dropped Prado by AED 5K' },
        { time: '09:10:00', type: 'INVENTORY_AGING', msg: 'VH-003 hit 147 days → CRITICAL alert' },
        { time: '09:15:22', type: 'DEAL_CLOSED', msg: 'Fatima: Lexus LX 600 → AED 420K' },
        { time: '09:15:23', type: 'COMMISSION_CALC', msg: 'Commission: AED 12,350 (10% tier)' },
        { time: '09:15:24', type: 'INVOICE_CREATED', msg: 'Odoo Invoice INV-2026-0147 created' },
        { time: '09:15:25', type: 'DASHBOARD_UPDATE', msg: 'Revenue KPI updated: +AED 420K' },
        { time: '09:20:00', type: 'CAMPAIGN_GENERATED', msg: 'Hermes: Weekend Patrol promo created' },
        { time: '09:30:00', type: 'RAG_QUERY', msg: 'Employee asked: "warranty coverage for Prado?"' },
        { time: '09:30:01', type: 'RAG_RESPONSE', msg: 'Openclaw: Answered with citation (Page 12)' },
        { time: '09:45:00', type: 'DAILY_REPORT', msg: 'Manager Agent: Morning summary generated' }
    ];

    document.getElementById('eventLog').innerHTML = events.map(e => `
        <div class="event-entry">
            <span class="event-time">[${e.time}]</span>
            <span class="event-type">${e.type}</span>
            ${e.msg}
        </div>
    `).join('');
}

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
});

// Enter key for Ask AI
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && document.activeElement.id === 'askAiInput') askAI();
});
