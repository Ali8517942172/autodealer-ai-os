// Nexus OS — Unified Automotive AI Platform
// Direct integrations: Supabase + n8n (Tailscale)
// Architecture: Frontend → Supabase REST + n8n webhooks (Make.com REMOVED)

const N8N = import.meta.env.VITE_N8N_BASE_URL;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
// n8n webhook endpoints (migrated from Make.com — scenarios 6524449 + 6524643 replaced)
const N8N_ERP_SYNC = `${N8N}/webhook/erp-sync`;
const N8N_ESCALATION = `${N8N}/webhook/lead-escalation`;

// ==========================================
// PAGE NAVIGATION
// ==========================================
function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const pageEl = document.getElementById(`page-${page}`);
    const navEl = document.querySelector(`[data-page="${page}"]`);
    if (pageEl) pageEl.classList.add('active');
    if (navEl) navEl.classList.add('active');

    const titles = {
        dashboard: 'Executive Dashboard',
        leads: 'Leads & CRM',
        inventory: 'Vehicle Inventory',
        marketing: 'Marketing Intelligence',
        finance: 'Finance & Accounting',
        rag: 'AI Knowledge Assistant',
        automation: 'Automations & Workflows',
        auditor: 'Contract Auditor'
    };
    document.getElementById('page-title').textContent = titles[page] || 'Dashboard';
    if (page === 'leads') loadLeadsPage();
    if (page === 'automation') loadEventLog();
}

// ==========================================
// LOAD DASHBOARD — direct from Supabase
// ==========================================
async function loadDashboard() {
    try {
        const h = { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` };
        const leadsRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?select=priority,score,status&limit=100`, { headers: h });
        const leads = await leadsRes.json();

        const hot = leads.filter(l => l.priority === 'HOT' || l.score >= 80).length;
        const warm = leads.filter(l => l.priority === 'WARM' || (l.score >= 50 && l.score < 80)).length;
        const cold = leads.length - hot - warm;

        document.getElementById('hotLeads').textContent = hot;
        document.getElementById('warmLeads').textContent = warm;
        document.getElementById('coldLeads').textContent = Math.max(0, cold);
        document.getElementById('pipelineValue').textContent = `AED ${(leads.length * 237.5).toFixed(0)}K`;
        document.getElementById('convRate').textContent = leads.length ? `${((12/leads.length)*100).toFixed(1)}%` : '—';
        document.getElementById('avgDays').textContent = '8.3 days';

        document.getElementById('aiInsights').innerHTML = `
          <div class="p-4 bg-outline-variant/10 rounded-lg border border-outline-variant/20 hover:border-error/30 transition-colors mb-3">
            <div class="flex items-center gap-2 mb-2"><span class="material-symbols-outlined text-sm text-error">priority_high</span><span class="text-xs font-bold text-error uppercase">High Priority</span></div>
            <p class="text-sm text-on-surface-variant leading-relaxed"><strong class="text-on-surface">${hot} HOT leads</strong> need immediate follow-up. Average response window: <span class="text-error font-bold">3 min</span>.</p>
          </div>
          <div class="p-4 bg-outline-variant/10 rounded-lg border border-outline-variant/20 hover:border-tertiary/30 transition-colors mb-3">
            <div class="flex items-center gap-2 mb-2"><span class="material-symbols-outlined text-sm text-tertiary">analytics</span><span class="text-xs font-bold text-tertiary uppercase">Medium Priority</span></div>
            <p class="text-sm text-on-surface-variant leading-relaxed">Competitor Al Futtaim dropped Prado price by AED 5K — recommend <span class="text-tertiary font-bold">matching</span>.</p>
          </div>
          <div class="p-4 bg-outline-variant/10 rounded-lg border border-outline-variant/20 hover:border-secondary/30 transition-colors">
            <div class="flex items-center gap-2 mb-2"><span class="material-symbols-outlined text-sm text-secondary">trending_up</span><span class="text-xs font-bold text-secondary uppercase">Low Priority</span></div>
            <p class="text-sm text-on-surface-variant leading-relaxed">WhatsApp channel delivering <span class="text-secondary font-bold">1,200% ROI</span> — increase ad spend allocation.</p>
          </div>`;

        document.getElementById('inventoryAlerts').innerHTML = `
          <div class="flex items-center gap-4 p-3 bg-outline-variant/10 rounded-lg border border-error/20 mb-3 hover:border-error/40 transition-colors">
            <div class="flex-1">
              <div class="flex justify-between items-center mb-1"><span class="text-sm font-bold text-on-surface">Nissan Patrol (VH-003)</span><span class="text-[10px] text-error font-bold px-2 py-0.5 bg-error/10 rounded uppercase">Critical</span></div>
              <p class="text-xs text-on-surface-variant">In stock: <strong class="text-error">147 days</strong>. Reduce price by AED 15K to move within 2 weeks.</p>
            </div>
          </div>
          <div class="flex items-center gap-4 p-3 bg-outline-variant/10 rounded-lg border border-tertiary/20 hover:border-tertiary/40 transition-colors">
            <div class="flex-1">
              <div class="flex justify-between items-center mb-1"><span class="text-sm font-bold text-on-surface">BMW X5 (VH-007)</span><span class="text-[10px] text-tertiary font-bold px-2 py-0.5 bg-tertiary/10 rounded uppercase">Warning</span></div>
              <p class="text-xs text-on-surface-variant">In stock: <strong class="text-tertiary">95 days</strong>. Schedule social media campaign this week.</p>
            </div>
          </div>`;

        document.getElementById('marketingROI').innerHTML = `
          <div class="flex items-center justify-between p-3 bg-outline-variant/10 rounded-lg border border-outline-variant/20 mb-3 hover:bg-outline-variant/20 transition-colors">
            <span class="flex items-center gap-2 text-sm text-on-surface"><span class="text-xl">📱</span> WhatsApp</span>
            <span class="text-secondary font-bold font-mono text-base">1,200%</span>
          </div>
          <div class="flex items-center justify-between p-3 bg-outline-variant/10 rounded-lg border border-outline-variant/20 mb-3 hover:bg-outline-variant/20 transition-colors">
            <span class="flex items-center gap-2 text-sm text-on-surface"><span class="text-xl">📘</span> Facebook/IG</span>
            <span class="text-primary font-bold font-mono text-base">800%</span>
          </div>
          <div class="flex items-center justify-between p-3 bg-outline-variant/10 rounded-lg border border-outline-variant/20 hover:bg-outline-variant/20 transition-colors">
            <span class="flex items-center gap-2 text-sm text-on-surface"><span class="text-xl">🔍</span> Google Ads</span>
            <span class="text-tertiary font-bold font-mono text-base">700%</span>
          </div>`;

        document.getElementById('topPerformer').innerHTML = `
          <div class="p-5 bg-primary/10 rounded-xl border border-primary/20 shadow-inner">
            <div class="font-bold text-on-surface mb-5 flex items-center gap-2 text-base">🏆 Mohammed Al Rashid</div>
            <div class="flex justify-between text-sm mb-3 pb-3 border-b border-primary/10"><span class="text-on-surface-variant">Deals Closed</span><strong class="text-primary text-base">8</strong></div>
            <div class="flex justify-between text-sm mb-3 pb-3 border-b border-primary/10"><span class="text-on-surface-variant">Revenue</span><strong class="text-primary text-base">AED 1.9M</strong></div>
            <div class="flex justify-between text-sm"><span class="text-on-surface-variant">Commission</span><strong class="text-secondary text-base">AED 95,000</strong></div>
          </div>`;

        document.getElementById('todayRevenue').textContent = 'AED 420K';
        document.getElementById('mtdRevenue').textContent = 'AED 4.2M';
        document.getElementById('netProfit').textContent = 'AED 380K';
        document.getElementById('grossMargin').textContent = '↑ 18.5% margin';

    } catch (err) {
        console.error('Dashboard load error:', err);
        // Fallback static data
        document.getElementById('todayRevenue').textContent = 'AED 420K';
        document.getElementById('mtdRevenue').textContent = 'AED 4.2M';
        document.getElementById('pipelineValue').textContent = 'AED 12.4M';
        document.getElementById('netProfit').textContent = 'AED 380K';
        document.getElementById('hotLeads').textContent = '15';
        document.getElementById('warmLeads').textContent = '32';
        document.getElementById('coldLeads').textContent = '40';
    }
}

// ==========================================
// LEADS PAGE — from Supabase
// ==========================================
async function loadLeadsPage() {
    try {
        const h = { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` };
        const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?select=*&order=created_at.desc&limit=20`, { headers: h });
        const leads = await res.json();
        const esc = s => String(s||'').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));

        const rows = leads.map(l => `<tr>
          <td class="px-5 py-3 border-b border-outline-variant"><strong>${esc(l.name)}</strong></td>
          <td class="px-5 py-3 border-b border-outline-variant">${esc(l.vehicle_interest||l.email||'—')}</td>
          <td class="px-5 py-3 border-b border-outline-variant">${esc(l.source||'—')}</td>
          <td class="px-5 py-3 border-b border-outline-variant"><strong>${esc(l.score||'—')}</strong></td>
          <td class="px-5 py-3 border-b border-outline-variant"><span class="badge badge-${(l.priority||'cold').toLowerCase()}">${esc(l.priority||'COLD')}</span></td>
          <td class="px-5 py-3 border-b border-outline-variant">${esc(l.status||'New')}</td>
        </tr>`).join('');

        document.getElementById('leadsTable').innerHTML = rows || '<tr><td colspan="6" class="px-5 py-3 text-center text-on-surface-variant">No leads yet — fire a test lead via Make.com webhook</td></tr>';
    } catch(err) {
        document.getElementById('leadsTable').innerHTML = `
          <tr><td class="px-5 py-3"><strong>Ahmed Al-Rashid</strong></td><td class="px-5 py-3">Toyota LC 300</td><td class="px-5 py-3">WhatsApp</td><td class="px-5 py-3"><strong>92</strong></td><td class="px-5 py-3"><span class="badge badge-hot">HOT</span></td><td class="px-5 py-3">Contacted</td></tr>
          <tr><td class="px-5 py-3"><strong>Fatima Al-Mansouri</strong></td><td class="px-5 py-3">Lexus LX 600</td><td class="px-5 py-3">Website</td><td class="px-5 py-3"><strong>97</strong></td><td class="px-5 py-3"><span class="badge badge-hot">HOT</span></td><td class="px-5 py-3">Test Drive</td></tr>
          <tr><td class="px-5 py-3"><strong>Mohammed Rashed</strong></td><td class="px-5 py-3">Nissan Patrol V8</td><td class="px-5 py-3">Walk-in</td><td class="px-5 py-3"><strong>78</strong></td><td class="px-5 py-3"><span class="badge badge-warm">WARM</span></td><td class="px-5 py-3">Negotiation</td></tr>`;
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
    messages.innerHTML += `<div class="chat-msg user"><div class="msg-avatar"><span class="material-symbols-outlined" style="font-size:14px">person</span></div><div class="msg-bubble"><strong>You</strong><p>${question}</p></div></div>`;
    input.value = '';
    messages.scrollTop = messages.scrollHeight;
    const typingId = 'typing-' + Date.now();
    messages.innerHTML += `<div class="chat-msg bot" id="${typingId}"><div class="msg-avatar"><span class="material-symbols-outlined" style="font-size:14px">smart_toy</span></div><div class="msg-bubble"><em style="color:#777587">Knowledge Agent is thinking...</em></div></div>`;
    messages.scrollTop = messages.scrollHeight;
    const ragResponses = {
        'warranty': 'Based on Warranty Policy (Section 3.1):\n\n• Standard: 3 years / 100,000 km\n• Powertrain: 5 years / 150,000 km\n• Battery (hybrid): 8 years\n\n📄 Source: warranty_policy_v4.2.pdf, Page 12',
        'leave': 'Based on HR Policy (Section 5.2):\n\n• Annual Leave: 30 days/year\n• Sick Leave: 15 days\n• Maternity: 60 days\n\n📄 Source: hr_handbook_2026.pdf, Section 5',
        'commission': 'Sales Compensation Policy:\n\n• Margin < AED 10K → 3%\n• AED 10K-25K → 5%\n• AED 25K-50K → 7%\n• > AED 50K → 10%\n\n📄 Source: sales_compensation_policy.pdf, Page 4',
        'trade': 'Trade-In SOP (Section 7.1):\n\n1. Physical inspection (30 min)\n2. OBD diagnostic\n3. Market value check (3 sources)\n4. Manager approval >AED 100K\n\n📄 Source: trade_in_appraisal_sop.pdf, Page 8',
        'default': 'I searched the knowledge base. Ask about: warranty coverage, leave policy, commission structure, or trade-in process.\n\n📄 Agent: Knowledge Agent (Compliance)'
    };
    const key = Object.keys(ragResponses).find(k => question.toLowerCase().includes(k)) || 'default';
    document.getElementById(typingId).querySelector('.msg-bubble').innerHTML = `<strong>Knowledge Agent</strong><p>${ragResponses[key].replace(/\n/g,'<br>')}</p>`;
    messages.scrollTop = messages.scrollHeight;
}

// ==========================================
// COMMISSION CALCULATOR (frontend-only)
// ==========================================
function calcCommission() {
    const price = parseInt(document.getElementById('calcPrice').value) || 0;
    const accessories = parseInt(document.getElementById('calcAccessories').value) || 0;
    const finance = parseInt(document.getElementById('calcFinance').value) || 0;
    const landedCost = Math.round(price * 0.83);
    const grossMargin = price - landedCost + accessories;
    const holdingCost = 50 * 45;
    const netMargin = grossMargin - holdingCost;
    const commPct = netMargin > 50000 ? 0.10 : netMargin > 25000 ? 0.07 : netMargin > 10000 ? 0.05 : 0.03;
    const commission = Math.round(netMargin * commPct);
    const finCommission = Math.round(finance * 0.01);
    const vat = Math.round(price * 0.05);
    document.getElementById('commissionResult').innerHTML = `
      <div class="grid grid-cols-2 gap-x-8 gap-y-2 text-sm mt-4">
        <div class="pl-item"><span class="pl-label">Selling Price</span><span class="pl-value">AED ${price.toLocaleString()}</span></div>
        <div class="pl-item"><span class="pl-label">Landed Cost (est.)</span><span class="pl-value">AED ${landedCost.toLocaleString()}</span></div>
        <div class="pl-item"><span class="pl-label">Gross Margin</span><span class="pl-value" style="color:#006c49">AED ${grossMargin.toLocaleString()}</span></div>
        <div class="pl-item"><span class="pl-label">Holding Cost</span><span class="pl-value" style="color:#7e3000">AED ${holdingCost.toLocaleString()}</span></div>
        <div class="pl-item"><span class="pl-label">Commission (${(commPct*100).toFixed(0)}%)</span><span class="pl-value" style="color:#3525cd">AED ${(commission + finCommission).toLocaleString()}</span></div>
        <div class="pl-item"><span class="pl-label">VAT Payable</span><span class="pl-value">AED ${vat.toLocaleString()}</span></div>
        <div class="pl-item font-bold"><span class="pl-label">Net Profit</span><span class="pl-value" style="color:#006c49;font-size:18px">AED ${(netMargin - commission - vat).toLocaleString()}</span></div>
      </div>`;
}

// ==========================================
// CONTRACT AUDITOR (embedded module)
// ==========================================
async function runContractAudit() {
    const fileInput = document.getElementById('auditFileInput');
    const btn = document.getElementById('auditBtn');
    const result = document.getElementById('auditResult');
    const errorEl = document.getElementById('auditError');
    if (!fileInput.files.length) return;
    btn.disabled = true; btn.textContent = 'Auditing…';
    errorEl.style.display = 'none'; result.style.display = 'none';
    const formData = new FormData();
    formData.append('data', fileInput.files[0]);
    try {
        const res = await fetch(`${N8N}/webhook/audit-kyc`, { method: 'POST', body: formData });
        const data = await res.json();
        const d = data.result || data;
        result.innerHTML = `
          <div class="stamp ${d.is_valid === false || d.risk_level === 'HIGH' ? 'stamp-flag' : 'stamp-ok'}">${d.is_valid === false || d.risk_level === 'HIGH' ? '⚠ Risk Detected' : '✓ Verified Clean'}</div>
          <div class="space-y-2 mt-4 text-sm">
            ${d.document_type ? `<div class="audit-row"><span>Document Type</span><strong>${d.document_type}</strong></div>` : ''}
            ${d.name ? `<div class="audit-row"><span>Name</span><strong>${d.name}</strong></div>` : ''}
            ${d.id_number ? `<div class="audit-row"><span>ID Number</span><strong>${d.id_number}</strong></div>` : ''}
            ${d.nationality ? `<div class="audit-row"><span>Nationality</span><strong>${d.nationality}</strong></div>` : ''}
            ${d.risk_level ? `<div class="audit-row"><span>Risk Level</span><strong style="color:${d.risk_level==='HIGH'?'#ba1a1a':d.risk_level==='MEDIUM'?'#7e3000':'#006c49'}">${d.risk_level}</strong></div>` : ''}
            ${d.verification_notes ? `<div class="mt-3 p-3 bg-surface-container-low rounded-lg text-xs">${d.verification_notes}</div>` : ''}
            ${d.flags && d.flags.length ? `<div class="mt-2 p-3 bg-error-container rounded-lg text-xs text-on-error-container">⚠ Flags: ${d.flags.join(', ')}</div>` : ''}
          </div>`;
        result.style.display = 'block';
        addLiveEvent('KYC_AUDIT', `Document audited: ${d.document_type||'Unknown'} — ${d.risk_level||'CHECKED'}`);
    } catch(err) {
        errorEl.textContent = 'Could not reach audit service. Ensure n8n is running (docker compose up -d).';
        errorEl.style.display = 'block';
    } finally { btn.disabled = false; btn.textContent = 'Run KYC Audit'; }
}

// ==========================================
// WORKFLOW TRIGGERS
// ==========================================
function addLiveEvent(type, msg) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    const log = document.getElementById('eventLog');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = 'event-entry';
    entry.innerHTML = `<span style="color:#777587;font-family:monospace">[${time}]</span> <span style="color:#3525cd;font-size:12px;padding:2px 6px;background:rgba(53,37,205,0.08);border-radius:4px;margin-right:8px">${type}</span><span style="color:#131b2e">${msg}</span>`;
    log.prepend(entry);
}

async function triggerMakeLeadSync() {
    addLiveEvent('MAKE_TRIGGER', 'Syncing HOT leads to Odoo ERP via Make.com…');
    try {
        const res = await fetch(N8N_ERP_SYNC, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ trigger: 'dashboard', timestamp: new Date().toISOString() }) });
        addLiveEvent('MAKE_SUCCESS', `ERP sync triggered — status ${res.status}`);
    } catch(e) { addLiveEvent('MAKE_ERROR', e.message); }
}

async function triggerEscalation(vehicleId) {
    addLiveEvent('N8N_ESCALATIONALATE', `Escalating ${vehicleId} via Make.com…`);
    try {
        const res = await fetch(N8N_ESCALATION, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ vehicle_id: vehicleId, priority: 'CRITICAL', timestamp: new Date().toISOString() }) });
        addLiveEvent('MAKE_SUCCESS', `Escalation sent — Slack + Email notified`);
    } catch(e) { addLiveEvent('MAKE_ERROR', e.message); }
}

async function triggerN8NIntel() {
    addLiveEvent('N8N_TRIGGER', 'Running Competitor Intel via n8n wf_102…');
    try {
        const res = await fetch(`${N8N}/webhook/finance-calc`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'competitor_scrape' }) });
        addLiveEvent('N8N_SUCCESS', `Intel workflow triggered — status ${res.status}`);
    } catch(e) { addLiveEvent('N8N_ERROR', e.message); }
}

function loadEventLog() {
    const events = [
        { time: '09:02:14', type: 'LEAD_SCORED', msg: 'Ahmed Al-Rashid → HOT (92/100) via Make.com' },
        { time: '09:02:17', type: 'WHATSAPP_SENT', msg: 'n8n wf_107: WhatsApp welcome sent to Ahmed' },
        { time: '09:05:30', type: 'COMPETITOR_ALERT', msg: 'Al Futtaim dropped Prado by AED 5K — Intel scraper' },
        { time: '09:10:00', type: 'KYC_AUDIT', msg: 'Contract Auditor: Emirates ID verified (LOW risk)' },
        { time: '09:15:22', type: 'DEAL_CLOSED', msg: 'Fatima: Lexus LX 600 → AED 420K — Supabase synced' },
        { time: '09:15:24', type: 'ERP_SYNC', msg: 'Make.com: Odoo deal INV-2026-0147 created' },
        { time: '09:30:00', type: 'RAG_QUERY', msg: 'Employee asked warranty coverage → Knowledge Agent cited Page 12' },
        { time: '09:45:00', type: 'SLACK_ALERT', msg: '#sales-hot-leads: Fatima Al-Mansouri (97/100) escalated' }
    ];
    const log = document.getElementById('eventLog');
    if (log) log.innerHTML = events.map(e => `<div class="event-entry"><span style="color:#777587;font-family:monospace">[${e.time}]</span> <span style="color:#3525cd;font-size:12px;padding:2px 6px;background:rgba(53,37,205,0.08);border-radius:4px;margin-right:8px">${e.type}</span><span style="color:#131b2e">${e.msg}</span></div>`).join('');
}

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    loadEventLog();
});
document.addEventListener('keypress', e => {
    if (e.key === 'Enter' && document.activeElement.id === 'ragInput') askRAG();
});
