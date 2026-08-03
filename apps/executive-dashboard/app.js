// Nexus OS — Unified Automotive AI Platform
// Direct integrations: Supabase + n8n (Tailscale)
// Architecture: Frontend → Supabase REST + n8n webhooks (Make.com REMOVED)

import { createClient } from '@supabase/supabase-js';

// Always trim. A trailing newline is trivially easy to paste into a Vercel
// env var (PowerShell's Set-Clipboard appends one), and it does not fail
// visibly: the newline lands in the `apikey` HTTP header, Chrome rejects the
// header, and every request dies with the opaque
// "Failed to execute 'fetch' on 'Window': Invalid value".
const envStr = (v) => (typeof v === 'string' ? v.trim() : v);

const N8N = envStr(import.meta.env.VITE_N8N_BASE_URL);
const SUPABASE_URL = envStr(import.meta.env.VITE_SUPABASE_URL);
const SUPABASE_ANON = envStr(import.meta.env.VITE_SUPABASE_ANON_KEY);

// ==========================================
// AUTH GATE
// ==========================================
// The publishable key ships inside the browser bundle, so anyone with the URL
// holds it. `leads`, `audit_log` and `competitors` deliberately have NO policy
// for the `anon` role — they are readable only by `authenticated`. That means
// this dashboard MUST sign a real user in; without it every panel silently
// renders empty. Do not "fix" empty panels by adding an anon read policy on
// `leads` — that table holds customer names, emails, phones and budgets.
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// Every Supabase REST call must carry the signed-in user's access token, not the
// bare publishable key, or RLS evaluates the request as `anon`.
let SESSION = null;
function authHeaders() {
    const token = SESSION?.access_token || SUPABASE_ANON;
    return { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` };
}

function renderLogin(message) {
    const el = document.getElementById('authGate');
    if (!el) return;
    el.style.display = 'flex';
    el.innerHTML = `
      <div style="background:#fff;border:1px solid #c6c6cd;border-radius:12px;padding:32px;width:100%;max-width:380px;box-shadow:0 10px 30px rgba(0,0,0,.08)">
        <h1 style="font:700 20px Inter,sans-serif;color:#1b1b1d;margin:0 0 4px">NEXUS OS</h1>
        <p style="font:400 13px Inter,sans-serif;color:#45474c;margin:0 0 20px">Sign in to view live dealership data.</p>
        <form id="loginForm">
          <input id="authEmail" type="email" required placeholder="you@dealership.ae" autocomplete="username"
                 style="width:100%;padding:10px 12px;border:1px solid #c6c6cd;border-radius:8px;font:400 14px Inter,sans-serif;margin-bottom:10px" />
          <input id="authPassword" type="password" required placeholder="Password" autocomplete="current-password"
                 style="width:100%;padding:10px 12px;border:1px solid #c6c6cd;border-radius:8px;font:400 14px Inter,sans-serif;margin-bottom:14px" />
          <button type="submit" id="authSubmit"
                 style="width:100%;padding:11px;border:0;border-radius:8px;background:#000;color:#fff;font:600 14px Inter,sans-serif;cursor:pointer">Sign in</button>
        </form>
        <p id="authMsg" style="font:400 12px Inter,sans-serif;color:#b3261e;margin:12px 0 0;min-height:16px">${message || ''}</p>
      </div>`;
    document.getElementById('loginForm').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const btn = document.getElementById('authSubmit');
        const msg = document.getElementById('authMsg');
        btn.disabled = true; btn.textContent = 'Signing in…'; msg.textContent = '';
        const { data, error } = await supabase.auth.signInWithPassword({
            email: document.getElementById('authEmail').value.trim(),
            password: document.getElementById('authPassword').value
        });
        if (error) {
            btn.disabled = false; btn.textContent = 'Sign in';
            msg.textContent = error.message;
            return;
        }
        SESSION = data.session;
        el.style.display = 'none';
        startDashboard();
    });
}

async function signOut() {
    await supabase.auth.signOut();
    SESSION = null;
    location.reload();
}

function startDashboard() {
    loadDashboard();
    loadEventLog();
}

async function initAuth() {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
        SESSION = data.session;
        const gate = document.getElementById('authGate');
        if (gate) gate.style.display = 'none';
        startDashboard();
    } else {
        renderLogin();
    }
}
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
    if (navEl) navEl.classList.add('active');

    if (pageEl) {
        pageEl.classList.add('active');
    } else {
        // The nav offers more destinations than the Stitch export actually ships.
        // Say so plainly instead of leaving the operator on a blank screen.
        let stub = document.getElementById('page-notbuilt');
        if (!stub) {
            stub = document.createElement('section');
            stub.id = 'page-notbuilt';
            stub.className = 'page';
            const host = document.querySelector('#page-dashboard')?.parentElement;
            if (host) host.appendChild(stub);
        }
        stub.innerHTML = `<div class="max-w-[1440px] mx-auto p-8">
            <div class="bg-surface-container-lowest rounded-lg border border-outline-variant p-8 text-center">
              <span class="material-symbols-outlined text-on-surface-variant" style="font-size:40px">construction</span>
              <h2 class="text-lg font-bold mt-3 mb-1">This screen isn't built yet</h2>
              <p class="text-sm text-on-surface-variant">The <strong>${String(page).replace(/[^a-z]/gi,'')}</strong> screen is designed but not wired to live data. The Overview, Conversations and Inventory screens are live.</p>
            </div></div>`;
        stub.classList.add('active');
    }

    // The Stitch header has no #page-title node — guard rather than throw, which
    // would abort the click handler and leave navigation dead.
    const titles = {
        dashboard: 'Executive Dashboard', leads: 'Leads & CRM', inventory: 'Vehicle Inventory',
        conversations: 'Conversations', competitors: 'Competitor Pricing',
        rag: 'AI Knowledge Assistant', automation: 'Automations & Workflows', auditor: 'Contract Auditor'
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = titles[page] || 'Dashboard';

    if (page === 'leads') loadLeadsPage();
    if (page === 'automation') loadEventLog();
}

// ==========================================
// LOAD DASHBOARD — direct from Supabase
// ==========================================
async function loadDashboard() {
    const esc = s => String(s ?? '').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
    // Write only if the element exists. The Stitch markup does not yet contain
    // every panel the older dashboard had, and a missing node must not abort the
    // whole render.
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const setHTML = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
    const blank = () => ['kpiOpenLeads','kpiLeadBreakdown','kpiLeadsToday','kpiAvgResponse',
                         'kpiInvAtRisk','kpiHoldingCost','pipelineValue','kpiPipelineSub']
                        .forEach(id => setText(id, '—'));

    const h = authHeaders();
    const AED = n => 'AED ' + Number(n || 0).toLocaleString('en-US');
    const band = (l) => {
        const s = String(l.status || '').toUpperCase();
        if (s === 'HOT' || s === 'WARM' || s === 'COLD') return s;
        const n = Number(l.ai_score) || 0;
        return n >= 80 ? 'HOT' : n >= 50 ? 'WARM' : 'COLD';
    };
    const ago = (ts) => {
        if (!ts) return '—';
        const mins = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
        if (mins < 60) return `${mins} min ago`;
        const hrs = Math.round(mins / 60);
        return hrs < 24 ? `${hrs} h ago` : `${Math.round(hrs / 24)} d ago`;
    };

    try {
        // ---- KPI row: every figure below is computed from live Supabase rows ----
        const leadsRes = await fetch(
            `${SUPABASE_URL}/rest/v1/leads?select=status,ai_score,budget_aed,response_time_minutes,created_at&limit=1000`,
            { headers: h });
        const leads = await leadsRes.json();
        if (!Array.isArray(leads)) throw new Error('leads query failed: ' + JSON.stringify(leads).slice(0, 200));

        const hot  = leads.filter(l => band(l) === 'HOT').length;
        const warm = leads.filter(l => band(l) === 'WARM').length;
        const cold = leads.filter(l => band(l) === 'COLD').length;
        const today = new Date().toISOString().slice(0, 10);
        const newToday = leads.filter(l => String(l.created_at || '').slice(0, 10) === today).length;

        setText('kpiOpenLeads', leads.length);
        setText('kpiLeadBreakdown', `${hot} HOT · ${warm} WARM · ${cold} COLD`);
        setText('kpiLeadsToday', newToday ? `+${newToday} today` : 'none today');

        const resp = leads.map(l => Number(l.response_time_minutes)).filter(Number.isFinite);
        if (resp.length) {
            const avg = resp.reduce((a, b) => a + b, 0) / resp.length;
            setText('kpiAvgResponse', avg < 1 ? `${Math.round(avg * 60)}s` : `${avg.toFixed(1)} min`);
        } else setText('kpiAvgResponse', '—');

        const pipeline = leads.reduce((sum, l) => sum + (Number(l.budget_aed) || 0), 0);
        const withBudget = leads.filter(l => Number(l.budget_aed) > 0).length;
        setText('pipelineValue', pipeline ? AED(pipeline) : '—');
        setText('kpiPipelineSub', `across ${withBudget} leads with a stated budget`);

        // ---- Inventory at risk ----
        try {
            const invRes = await fetch(
                `${SUPABASE_URL}/rest/v1/inventory?select=id,model,days_in_stock,holding_cost_accrued&order=days_in_stock.desc&limit=200`,
                { headers: h });
            const inv = await invRes.json();
            if (Array.isArray(inv)) {
                const aged = inv.filter(v => (Number(v.days_in_stock) || 0) >= 90);
                const holding = aged.reduce((s, v) => s + (Number(v.holding_cost_accrued) || 0), 0);
                setText('kpiInvAtRisk', aged.length);
                setText('kpiHoldingCost', holding ? `${AED(holding)} holding cost accrued` : 'no holding cost recorded');

                setHTML('inventoryAlerts', aged.length ? aged.slice(0, 5).map(v => {
                    const critical = Number(v.days_in_stock) >= 120;
                    return `<div class="flex items-center gap-4 p-3 rounded-lg border ${critical ? 'border-status-hot/30' : 'border-status-warm/30'} mb-3">
                      <div class="flex-1">
                        <div class="flex justify-between items-center mb-1"><span class="text-sm font-bold">${esc(v.model)}</span><span class="text-[10px] ${critical ? 'bg-status-hot-light text-status-hot' : 'bg-status-warm-light text-status-warm'} font-bold px-2 py-0.5 rounded uppercase">${critical ? 'Critical' : 'Warning'}</span></div>
                        <p class="text-xs text-on-surface-variant">In stock <strong>${esc(v.days_in_stock)} days</strong>${Number(v.holding_cost_accrued) ? ` · ${esc(AED(v.holding_cost_accrued))} accrued` : ''}</p>
                      </div>
                    </div>`;
                }).join('') : `<div class="p-4 text-sm text-on-surface-variant">No unit has been in stock 90+ days.</div>`);
            } else { setText('kpiInvAtRisk', '—'); setText('kpiHoldingCost', '—'); }
        } catch (e) {
            console.error('inventory KPI failed:', e);
            setText('kpiInvAtRisk', '—'); setText('kpiHoldingCost', '—');
        }

        // ---- Live Lead Feed ----
        try {
            const feedRes = await fetch(
                `${SUPABASE_URL}/rest/v1/leads?select=name,vehicle_interest,status,ai_score,created_at&order=created_at.desc&limit=8`,
                { headers: h });
            const feed = await feedRes.json();
            if (!Array.isArray(feed)) throw new Error('feed query failed');
            setHTML('leadFeedBody', feed.length ? feed.map(l => {
                const b = band(l);
                const tone = b === 'HOT' ? 'hot' : b === 'WARM' ? 'warm' : 'cold';
                const score = Number(l.ai_score) || 0;
                return `<tr class="hover:bg-surface-container transition-colors">
                  <td class="py-3 px-4"><span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-status-${tone}-light text-status-${tone} uppercase tracking-wider">${esc(b)}</span></td>
                  <td class="py-3 px-4 font-medium">${esc(l.name || 'Unknown')}</td>
                  <td class="py-3 px-4 text-on-surface-variant">${esc(l.vehicle_interest || '—')}</td>
                  <td class="py-3 px-4 text-center"><span class="text-[12px] font-bold">${score || '—'}</span></td>
                  <td class="py-3 px-4 text-right text-on-surface-variant text-[12px]">${esc(ago(l.created_at))}</td>
                </tr>`;
            }).join('') : `<tr><td class="py-3 px-4 text-on-surface-variant" colspan="5">No leads yet — fire a test lead at the n8n webhook.</td></tr>`);
        } catch (e) {
            console.error('lead feed failed:', e);
            setHTML('leadFeedBody', `<tr><td class="py-3 px-4 text-status-hot" colspan="5">Could not load the live lead feed from Supabase.</td></tr>`);
        }

        // Panels with no live data source yet. Say so rather than invent numbers.
        setHTML('marketingROI', `<div class="p-4 text-sm text-on-surface-variant italic">Channel ROI attribution is not wired to a data source yet.</div>`);
        setHTML('topPerformer', `<div class="p-4 text-sm text-on-surface-variant italic">No sales leaderboard data source connected yet.</div>`);

    } catch (err) {
        console.error('Dashboard load error:', err);
        blank();
        setHTML('leadFeedBody', `<tr><td class="py-3 px-4 text-status-hot" colspan="5">Could not reach Supabase. Showing nothing rather than stale data.</td></tr>`);
    }
}

// ==========================================
// LEADS PAGE — from Supabase
// ==========================================
async function loadLeadsPage() {
    try {
        const h = authHeaders();
        const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?select=*&order=created_at.desc&limit=20`, { headers: h });
        const leads = await res.json();
        const esc = s => String(s||'').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));

        const rows = leads.map(l => `<tr>
          <td class="px-5 py-3 border-b border-outline-variant"><strong>${esc(l.name)}</strong></td>
          <td class="px-5 py-3 border-b border-outline-variant">${esc(l.vehicle_interest||l.email||'—')}</td>
          <td class="px-5 py-3 border-b border-outline-variant">${esc(l.source||'—')}</td>
          <td class="px-5 py-3 border-b border-outline-variant"><strong>${esc(l.ai_score ?? '—')}</strong></td>
          <td class="px-5 py-3 border-b border-outline-variant"><span class="badge badge-${String(l.status||'cold').toLowerCase()}">${esc(l.status||'—')}</span></td>
          <td class="px-5 py-3 border-b border-outline-variant">${esc(l.assigned_to||'Unassigned')}</td>
        </tr>`).join('');

        document.getElementById('leadsTable').innerHTML = rows || '<tr><td colspan="6" class="px-5 py-3 text-center text-on-surface-variant">No leads yet — fire a test lead via the n8n webhook</td></tr>';
    } catch(err) {
        // Never fall back to invented leads. A dealership manager cannot tell a
        // fabricated row from a real one, and acting on a fake HOT lead is worse
        // than seeing nothing. Show the failure honestly instead.
        console.error('loadLeadsPage failed:', err);
        document.getElementById('leadsTable').innerHTML =
          `<tr><td colspan="6" class="px-5 py-3 text-center text-error">Could not load leads from Supabase. Check the connection and reload — no data is being shown rather than stale or sample data.</td></tr>`;
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

async function triggerErpSync() {
    addLiveEvent('ERP_SYNC_TRIGGER', 'Syncing HOT leads to Bitrix24 CRM via n8n…');
    try {
        const res = await fetch(N8N_ERP_SYNC, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ trigger: 'dashboard', timestamp: new Date().toISOString() }) });
        addLiveEvent('ERP_SYNC_SUCCESS', `ERP sync triggered — status ${res.status}`);
    } catch(e) { addLiveEvent('ERP_SYNC_ERROR', e.message); }
}

async function triggerEscalation(vehicleId) {
    addLiveEvent('N8N_ESCALATION', `Escalating ${vehicleId} via n8n…`);
    try {
        const res = await fetch(N8N_ESCALATION, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ vehicle_id: vehicleId, priority: 'CRITICAL', timestamp: new Date().toISOString() }) });
        addLiveEvent('N8N_ESCALATION_SUCCESS', `Escalation sent — Slack + Email notified`);
    } catch(e) { addLiveEvent('N8N_ESCALATION_ERROR', e.message); }
}

async function triggerN8NIntel() {
    addLiveEvent('N8N_TRIGGER', 'Running Competitor Intel via n8n wf_102…');
    try {
        const res = await fetch(`${N8N}/webhook/finance-calc`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'competitor_scrape' }) });
        addLiveEvent('N8N_SUCCESS', `Intel workflow triggered — status ${res.status}`);
    } catch(e) { addLiveEvent('N8N_ERROR', e.message); }
}

// Reads the real `audit_log` table that every n8n workflow writes to. This used
// to be a hard-coded array of invented events (including one referencing Odoo,
// which was removed from this project entirely) — a demo panel that looked like
// production telemetry.
async function loadEventLog() {
    const log = document.getElementById('eventLog');
    if (!log) return;
    const esc = s => String(s ?? '').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
    try {
        const h = authHeaders();
        const res = await fetch(
            `${SUPABASE_URL}/rest/v1/audit_log?select=workflow,status,lead_name,intent,lead_score,summary,logged_at&order=logged_at.desc&limit=15`,
            { headers: h }
        );
        const rows = await res.json();
        if (!Array.isArray(rows)) throw new Error('audit_log query failed: ' + JSON.stringify(rows).slice(0, 200));

        if (!rows.length) {
            log.innerHTML = `<div class="event-entry" style="color:#777587">No workflow activity logged yet.</div>`;
            return;
        }

        log.innerHTML = rows.map(e => {
            const t = e.logged_at ? new Date(e.logged_at).toLocaleTimeString([], { hour12: false }) : '--:--:--';
            const type = String(e.workflow || 'WORKFLOW').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 24);
            const bits = [e.lead_name, e.intent, e.lead_score != null ? `${e.lead_score}/100` : null]
                .filter(Boolean).join(' · ');
            const detail = bits || String(e.summary || '').split('\n')[0].slice(0, 120) || e.status || '';
            return `<div class="event-entry"><span style="color:#777587;font-family:monospace">[${esc(t)}]</span> <span style="color:#3525cd;font-size:12px;padding:2px 6px;background:rgba(53,37,205,0.08);border-radius:4px;margin-right:8px">${esc(type)}</span><span style="color:#131b2e">${esc(detail)}</span></div>`;
        }).join('');
    } catch (err) {
        console.error('loadEventLog failed:', err);
        log.innerHTML = `<div class="event-entry" style="color:#b3261e">Could not load the activity log from Supabase.</div>`;
    }
}

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', initAuth);
document.addEventListener('keypress', e => {
    if (e.key === 'Enter' && document.activeElement.id === 'ragInput') askRAG();
});


// ==========================================
// EXPOSE HANDLERS TO INLINE onclick=""
// app.js is a <script type="module">, so its declarations are module-scoped and
// invisible to inline attributes. Without this, every nav click threw
// "showPage is not defined" and no page ever switched.
// ==========================================
Object.assign(window, {
    showPage, signOut, loadDashboard, loadLeadsPage, loadEventLog, askRAG,
    calcCommission, runContractAudit, triggerErpSync, triggerEscalation,
    triggerN8NIntel, addLiveEvent
});
