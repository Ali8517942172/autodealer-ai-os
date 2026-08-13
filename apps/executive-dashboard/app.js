/* ============================================================================
   NEXUS OS — dashboard
   Twelve screens, all rendered from live Supabase data and live n8n webhooks.

   Two rules run through this whole file:
     1. Never invent a row. If a fetch fails the panel says so. An operator
        cannot tell a fabricated HOT lead from a real one, and acting on a fake
        one is worse than seeing nothing.
     2. Never render a number the database did not produce. No hardcoded KPI
        deltas, no placeholder rows, no "example" data.
   ========================================================================== */
import './styles.css';
import { createClient } from '@supabase/supabase-js';

/* ── Environment ─────────────────────────────────────────────────────────── */
const envStr = v => (typeof v === 'string' ? v.trim() : v);

/* A whole .env file once got pasted into a single Vercel variable. The value
   carried interior newlines, which .trim() cannot fix, and Chrome rejected the
   fetch with an opaque "Invalid value". Measure the value; do not guess. */
function envProblem(name, value, { minLen = 0, prefix = '' } = {}) {
  if (!value) return `${name} is empty.`;
  if (/[\x00-\x1F\x7F]/.test(value))
    return `${name} contains a newline or tab (length ${value.length}). It probably holds a whole .env file rather than one value.`;
  if (minLen && value.length < minLen)
    return `${name} is only ${value.length} characters; expected at least ${minLen}.`;
  if (prefix && !value.startsWith(prefix))
    return `${name} should start with "${prefix}".`;
  return null;
}

const SUPABASE_URL  = envStr(import.meta.env.VITE_SUPABASE_URL);
const SUPABASE_ANON = envStr(import.meta.env.VITE_SUPABASE_ANON_KEY);
const N8N_BASE      = (envStr(import.meta.env.VITE_N8N_BASE_URL) || '').replace(/\/+$/, '');

const envErrors = [
  envProblem('VITE_SUPABASE_URL', SUPABASE_URL, { prefix: 'https://' }),
  envProblem('VITE_SUPABASE_ANON_KEY', SUPABASE_ANON, { minLen: 40 }),
].filter(Boolean);

/* ── Small helpers ───────────────────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };

function esc(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
const nf = new Intl.NumberFormat('en-AE');
const n0 = v => (v == null || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
const num  = v => { const x = n0(v); return x == null ? '—' : nf.format(Math.round(x)); };
const aed  = v => { const x = n0(v); return x == null ? '—' : 'AED ' + nf.format(Math.round(x)); };
const aedSigned = v => { const x = n0(v); if (x == null) return '—'; return (x < 0 ? '−' : '+') + 'AED ' + nf.format(Math.abs(Math.round(x))); };
const pct  = v => { const x = n0(v); return x == null ? '—' : x.toFixed(1) + '%'; };
const mins = v => {
  const x = n0(v);
  if (x == null) return '—';
  /* Deliberately stays in minutes up to 2 h. The 5-minute rule is the founding
     promise of this product; "73 min" is uncomfortable in a way "1.2 h" is not,
     and that discomfort is the point. */
  if (x < 120) return `${Math.round(x)} min`;
  return `${(x / 60).toFixed(1)} h`;
};

function ago(ts) {
  if (!ts) return '—';
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (Number.isNaN(d)) return '—';
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d/60)} m ago`;
  if (d < 86400) return `${Math.floor(d/3600)} h ago`;
  if (d < 2592000) return `${Math.floor(d/86400)} d ago`;
  /* Stay relative past 30 days. The Age column was switching to an absolute
     date mid-list ("29 d ago" then "7 Jul 2026"), so two rows one day apart
     looked unrelated and could not be compared at a glance. */
  const mo = Math.floor(d / 2592000);
  if (mo < 12) return `${mo} mo ago`;
  return `${Math.floor(mo / 12)} y ago`;
}
const clock = ts => ts ? new Date(ts).toLocaleTimeString('en-GB', { hour12:false }) : '--:--:--';
const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0]).join('').toUpperCase();

const TONE = { HOT:'hot', WARM:'warm', COLD:'cold', GOOD:'ok', OK:'ok', SUCCESS:'ok', APPROVED:'ok',
               FAILED:'hot', REJECTED:'hot', ESCALATED:'warm', PENDING:'warm', CRITICAL:'hot' };
const tone = s => TONE[String(s || '').toUpperCase()] || '';
const pill = (label, t) => `<span class="pill ${t || tone(label)}"><span class="dot"></span>${esc(label)}</span>`;

/* ── States. Every panel has all four; a panel without them is not done. ─── */
const stateEmpty = (title, body, icon = 'inbox') =>
  `<div class="state"><span class="material-symbols-outlined">${icon}</span><h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
const stateError = (what, err, retry) =>
  `<div class="state err"><span class="material-symbols-outlined">error</span><h3>Couldn't load ${esc(what)}</h3>
   <p>${esc(err)}</p>${retry ? `<button class="btn" data-retry="${esc(retry)}">Retry</button>` : ''}</div>`;
const stateLoading = (rows = 5) =>
  `<div style="padding:20px">${Array.from({length:rows}, (_,i) =>
    `<div class="skeleton" style="height:16px;margin-bottom:12px;width:${95 - i*7}%"></div>`).join('')}</div>`;
const noSource = msg =>
  `<div class="state"><span class="material-symbols-outlined">link_off</span><h3>No data source yet</h3><p>${esc(msg)}</p></div>`;

/* ── Data access ─────────────────────────────────────────────────────────── */
const supabase = envErrors.length ? null : createClient(SUPABASE_URL, SUPABASE_ANON);
let SESSION = null;
let ME = null;

function headers() {
  return {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${SESSION?.access_token || SUPABASE_ANON}`,
    'Content-Type': 'application/json',
  };
}

async function db(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${body ? ' — ' + body.slice(0, 180) : ''}`);
  }
  return res.json();
}
async function dbWrite(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { ...headers(), Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} — ${(await res.text().catch(()=>'')).slice(0,180)}`);
  return res.json();
}

/* n8n webhooks. Kept separate from db() because a missing VITE_N8N_BASE_URL is
   a recoverable condition — those screens degrade, the rest of the app works. */
async function n8n(path, payload) {
  if (!N8N_BASE) throw new Error('VITE_N8N_BASE_URL is not set, so workflow calls are disabled.');
  const res = await fetch(`${N8N_BASE}/webhook/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} — ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/* ── Screen registry ─────────────────────────────────────────────────────── */
const NAV = [
  { group: 'Work', items: [
    { id:'overview',      title:'Overview',        icon:'dashboard' },
    { id:'leads',         title:'Leads',           icon:'person_search' },
    { id:'conversations', title:'Conversations',   icon:'forum' },
    { id:'compliance',    title:'Compliance',      icon:'verified_user' },
  ]},
  { group: 'Assets', items: [
    { id:'inventory',   title:'Inventory',   icon:'directions_car' },
    { id:'competitors', title:'Competitors', icon:'trending_up' },
  ]},
  { group: 'Intelligence', items: [
    { id:'ask',      title:'Ask AI',        icon:'auto_awesome' },
    { id:'finance',  title:'Finance Desk',  icon:'calculate' },
    { id:'customers',title:'Customer 360',  icon:'contacts' },
  ]},
  { group: 'Operations', items: [
    { id:'automation', title:'Automation', icon:'account_tree' },
    { id:'team',       title:'Team',       icon:'groups' },
  ]},
  { group: '', items: [
    { id:'settings', title:'Settings', icon:'settings' },
  ]},
];
const SCREENS = {};
const flatNav = () => NAV.flatMap(g => g.items);

let current = 'overview';

function buildNav() {
  const nav = $('nav');
  nav.innerHTML = '';
  NAV.forEach(group => {
    const wrap = el('div', 'nav-group');
    if (group.group) wrap.appendChild(el('div', 'nav-group-label', esc(group.group)));
    group.items.forEach(item => {
      const b = el('button', 'nav-item', `<span class="material-symbols-outlined">${item.icon}</span><span>${esc(item.title)}</span><span class="nav-badge hide" id="badge-${item.id}"></span>`);
      b.dataset.screen = item.id;
      b.addEventListener('click', () => go(item.id));
      wrap.appendChild(b);
    });
    nav.appendChild(wrap);
  });
}

function go(id) {
  if (!SCREENS[id]) id = 'overview';
  current = id;
  location.hash = id;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.screen === id));
  $('pageTitle').textContent = flatNav().find(i => i.id === id)?.title || 'NEXUS OS';
  closeDrawer();
  const host = $('screen');
  host.innerHTML = '';
  Promise.resolve(SCREENS[id](host)).catch(e => { host.innerHTML = stateError('this screen', e.message); });
}

/* ── Drawer ──────────────────────────────────────────────────────────────── */
function openDrawer(html) {
  $('drawer').innerHTML = html;
  $('drawer').classList.add('open');
  $('scrim').classList.add('open');
}
function closeDrawer() {
  $('drawer').classList.remove('open');
  $('scrim').classList.remove('open');
}

/* ── Reusable renderers ──────────────────────────────────────────────────── */
function kpi(label, value, sub, cls = '') {
  /* Long currency values wrapped mid-figure ("AED" on one line, the digits on
     the next). Shrink rather than wrap — a KPI must read as one number. */
  const long = String(value).replace(/<[^>]*>/g, '').length > 12;
  return `<div class="kpi"><div class="label-caps">${esc(label)}</div>
    <div class="kpi-value ${cls}${long ? ' long' : ''}">${value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
}

function table(cols, rows, opts = {}) {
  if (!rows.length) return opts.empty || stateEmpty('Nothing here yet', 'No rows matched.');
  const head = cols.map(c => `<th class="${c.align === 'r' ? 'r' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map((r, i) => {
    const tds = cols.map(c => `<td class="${c.align === 'r' ? 'r num' : ''} ${c.strong ? 'strong' : ''}">${c.render(r)}</td>`).join('');
    return `<tr class="${opts.onRow ? 'clickable' : ''}" data-i="${i}">${tds}</tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function wireRows(host, rows, handler) {
  if (!handler) return;
  host.querySelectorAll('tbody tr.clickable').forEach(tr => {
    tr.addEventListener('click', () => handler(rows[Number(tr.dataset.i)]));
  });
}

/* Renders a card whose body is produced by an async loader. Guarantees the
   loading / error / empty / loaded quartet without repeating it twelve times. */
async function panel(host, { title, sub, actions, load, render, cols = '' }) {
  const card = el('div', 'card flush');
  if (cols) card.style.gridColumn = cols;
  card.innerHTML = `${title ? `<div class="card-head"><div><div class="card-title">${esc(title)}</div>${sub ? `<div class="card-sub">${sub}</div>` : ''}</div><div style="flex:1"></div>${actions || ''}</div>` : ''}<div class="pbody">${stateLoading(4)}</div>`;
  host.appendChild(card);
  const body = card.querySelector('.pbody');
  try {
    const data = await load();
    body.innerHTML = render(data, card);
  } catch (e) {
    body.innerHTML = stateError(title || 'data', e.message, 'x');
    body.querySelector('[data-retry]')?.addEventListener('click', () => {
      card.remove();
      panel(host, { title, sub, actions, load, render, cols });
    });
  }
  return card;
}

/* ==========================================================================
   S1 · Overview
   ========================================================================== */
SCREENS.overview = async host => {
  const strip = el('div', 'grid g5'); host.appendChild(strip);
  strip.innerHTML = stateLoading(2);

  const lower = el('div', 'grid g2'); lower.style.marginTop = '16px'; host.appendChild(lower);
  const feedHost = el('div'); const attnHost = el('div');
  lower.appendChild(attnHost); lower.appendChild(feedHost);

  try {
    const [leads, inv, metrics] = await Promise.all([
      db('leads?select=status,ai_score,budget_aed,response_time_minutes,created_at,assigned_to_id&limit=2000'),
      db('inventory?select=status,days_in_stock,price_aed,holding_cost_accrued,aging_alert&limit=2000'),
      db('daily_metrics?select=*&order=snapshot_date.desc&limit=2'),
    ]);

    const up = s => String(s || '').toUpperCase();
    const hot = leads.filter(l => up(l.status) === 'HOT').length;
    const warm = leads.filter(l => up(l.status) === 'WARM').length;
    const cold = leads.filter(l => up(l.status) === 'COLD').length;
    const withResp = leads.filter(l => n0(l.response_time_minutes) != null);
    const avgResp = withResp.length ? withResp.reduce((a, l) => a + Number(l.response_time_minutes), 0) / withResp.length : null;
    const withBudget = leads.filter(l => n0(l.budget_aed) != null);
    const pipeline = withBudget.reduce((a, l) => a + Number(l.budget_aed), 0);
    const risk = inv.filter(i => up(i.aging_alert) === 'CRITICAL');
    const holding = inv.reduce((a, i) => a + (n0(i.holding_cost_accrued) || 0), 0);

    /* Deltas only exist once there are two snapshots. Until then no delta line
       renders at all — the previous build showed "-18s vs last week" as a
       hardcoded string with nothing behind it. */
    const prev = metrics.length > 1 ? metrics[1] : null;
    const delta = (now, before, fmt, lowerIsBetter) => {
      if (!prev || before == null || now == null) return '';
      const d = Number(now) - Number(before);
      if (!d) return `<span class="t-muted">no change vs ${ago(prev.snapshot_date)}</span>`;
      const good = lowerIsBetter ? d < 0 : d > 0;
      return `<span class="${good ? 't-ok' : 't-hot'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span> <span class="t-muted">vs previous snapshot</span>`;
    };

    strip.innerHTML = [
      kpi('Open leads', num(leads.length),
        `${pill(`${hot} HOT`,'hot')} ${pill(`${warm} WARM`,'warm')} ${pill(`${cold} COLD`,'cold')}`),
      kpi('Avg response time', mins(avgResp),
        avgResp != null && avgResp > 5
          ? `<span class="t-hot">Breaches the 5-minute rule</span>`
          : delta(avgResp, prev?.avg_response_minutes, v => mins(v), true)),
      kpi('Pipeline value', aed(pipeline),
        withBudget.length < leads.length
          ? `<span class="t-muted">From ${withBudget.length} of ${leads.length} leads · ${leads.length - withBudget.length} ${leads.length - withBudget.length === 1 ? 'has' : 'have'} no budget recorded</span>`
          : delta(pipeline, prev?.pipeline_aed, v => aed(v))),
      kpi('Units at risk', num(risk.length),
        risk.length ? `<span class="t-hot">Oldest ${num(Math.max(...risk.map(r => n0(r.days_in_stock) || 0)))} days in stock</span>` : 'No unit past the aging threshold'),
      kpi('Holding cost accrued', aed(holding), `Across ${num(inv.length)} units`),
    ].join('');

    await panel(attnHost, {
      title: 'Needs attention',
      sub: 'Live union of unassigned HOT leads, SLA breaches, aging stock, price undercuts and workflow failures',
      load: () => db('v_needs_attention?select=*&limit=60').then(rows => {
        /* A HOT lead with no owner decays in minutes; a car aging on the lot
           decays over weeks. Severity alone put four parked cars above a lead
           nobody is working. */
        const rank = { lead_unassigned: 0, sla_breach: 1, workflow_failure: 2, undercut: 3, inventory_aging: 4 };
        return rows.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9)
          || new Date(b.at) - new Date(a.at));
      }),
      render: items => {
        if (!items.length) return stateEmpty('Nothing needs you right now', 'No unassigned HOT leads, SLA breaches, aging units, undercuts or failures.', 'task_alt');
        const KIND = { lead_unassigned:'person_alert', sla_breach:'timer', inventory_aging:'directions_car',
                       undercut:'trending_down', workflow_failure:'error' };
        const SCREEN = { lead_unassigned:'leads', sla_breach:'leads', inventory_aging:'inventory',
                         undercut:'competitors', workflow_failure:'automation' };
        return `<div>${items.map(it => `
          <div class="list-item" data-goto="${esc(SCREEN[it.kind] || 'overview')}">
            <span class="material-symbols-outlined t-${tone(it.severity)}" style="font-size:20px">${KIND[it.kind] || 'warning'}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:500">${esc(it.title)}</div>
              <div class="cell-sub">${esc(it.detail)}</div>
            </div>
            <span class="material-symbols-outlined t-muted" style="font-size:18px">chevron_right</span>
          </div>`).join('')}</div>`;
      },
    }).then(card => {
      card.querySelectorAll('[data-goto]').forEach(n => n.addEventListener('click', () => go(n.dataset.goto)));
      const count = card.querySelectorAll('.list-item').length;
      const badge = $('badge-overview');
      if (badge && count) { badge.textContent = String(count); badge.classList.remove('hide'); }
    });

    await panel(feedHost, {
      title: 'Live lead feed',
      sub: 'Newest first',
      actions: `<button class="btn sm" data-act="leads">View all</button>`,
      load: () => db('leads?select=id,name,status,ai_score,vehicle_interest,source,created_at&order=created_at.desc&limit=8'),
      render: rows => rows.length ? table([
        { label:'When', render: r => `<div class="t-muted">${ago(r.created_at)}</div><div class="cell-sub mono">${clock(r.created_at)}</div>` },
        { label:'Status',  render: r => pill(r.status || 'NEW') },
        { label:'Name',    strong: true, render: r => esc(r.name) },
        { label:'Interest',render: r => `<span class="t-2">${esc(r.vehicle_interest || '—')}</span>` },
        { label:'Score', align:'r', render: r => num(r.ai_score) },
      ], rows) : stateEmpty('No leads yet', 'They appear here the moment the router webhook receives one.'),
    }).then(card => card.querySelector('[data-act]')?.addEventListener('click', () => go('leads')));

    const pipeCard = el('div', 'card'); pipeCard.style.marginTop = '16px'; host.appendChild(pipeCard);
    const seg = [['HOT', hot, 'var(--hot)'], ['WARM', warm, 'var(--warm)'], ['COLD', cold, 'var(--cold)']];
    const total = hot + warm + cold || 1;
    pipeCard.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Pipeline by stage</div>
      <div class="stackbar">${seg.map(([, v, c]) => `<i style="width:${(v/total*100).toFixed(1)}%;background:${c}"></i>`).join('')}</div>
      <div style="display:flex;gap:20px;margin-top:12px;flex-wrap:wrap">
        ${seg.map(([k, v, c]) => `<div style="display:flex;align-items:center;gap:8px">
          <span style="width:8px;height:8px;border-radius:50%;background:${c}"></span>
          <span style="font-weight:500">${esc(k)}</span><span class="t-muted num">${num(v)} leads</span></div>`).join('')}
      </div>`;
  } catch (e) {
    strip.innerHTML = stateError('the overview', e.message);
  }
};

/* ==========================================================================
   S2 · Leads
   ========================================================================== */
SCREENS.leads = async host => {
  const card = el('div', 'card flush'); host.appendChild(card);
  card.innerHTML = stateLoading(8);

  let all = [];
  try {
    // `users(id,name)` and not `users:assigned_to_id(...)` — the colon form is an
    // alias, not an FK hint, and PostgREST would look for a table called
    // `assigned_to_id`. leads has exactly one FK to users, so this is unambiguous.
    all = await db('leads?select=*,users(id,name)&order=created_at.desc&limit=1000');
  } catch (e) { card.innerHTML = stateError('leads', e.message); return; }

  const purchases = await db('purchase_history?select=email').catch(() => []);
  const vipSet = new Set(purchases.map(p => String(p.email || '').toLowerCase()));
  const sources = [...new Set(all.map(l => l.source).filter(Boolean))].sort();
  const reps = [...new Set(all.map(l => l.users?.name).filter(Boolean))].sort();

  const f = { status: 'ALL', q: '', source: 'ALL', rep: 'ALL' };

  function filtered() {
    return all.filter(l => {
      if (f.status !== 'ALL' && String(l.status || '').toUpperCase() !== f.status) return false;
      if (f.source !== 'ALL' && l.source !== f.source) return false;
      if (f.rep === '__none' && l.assigned_to_id) return false;
      if (f.rep !== 'ALL' && f.rep !== '__none' && l.users?.name !== f.rep) return false;
      if (f.q) {
        const hay = [l.name, l.email, l.phone, l.vehicle_interest].join(' ').toLowerCase();
        if (!hay.includes(f.q.toLowerCase())) return false;
      }
      return true;
    });
  }

  const count = s => all.filter(l => String(l.status || '').toUpperCase() === s).length;

  card.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="segStatus">
        ${[['ALL', all.length], ['HOT', count('HOT')], ['WARM', count('WARM')], ['COLD', count('COLD')]]
          .map(([k, c], i) => `<button data-v="${k}" class="${i === 0 ? 'on' : ''}">${k === 'ALL' ? 'All' : k} · ${c}</button>`).join('')}
      </div>
      <div class="grow"><input type="search" id="q" placeholder="Search name, email, phone or vehicle" /></div>
      <select id="fSource" style="width:auto"><option value="ALL">All sources</option>${sources.map(s => `<option>${esc(s)}</option>`).join('')}</select>
      <select id="fRep" style="width:auto"><option value="ALL">All reps</option><option value="__none">Unassigned</option>${reps.map(s => `<option>${esc(s)}</option>`).join('')}</select>
      <div class="t-muted num" id="resultCount"></div>
    </div>
    <div id="leadTable"></div>`;

  const cols = [
    { label:'Status', render: r => pill(r.status || 'NEW') },
    { label:'Name', strong: true, render: r => `${esc(r.name)}${vipSet.has(String(r.email||'').toLowerCase()) ? ' <span class="pill vip"><span class="dot"></span>VIP</span>' : ''}` },
    { label:'Contact', render: r => `<div>${esc(r.email || '—')}</div><div class="cell-sub">${esc(r.phone || '—')}</div>` },
    { label:'Vehicle interest', render: r => `<span class="t-2">${esc(r.vehicle_interest || '—')}</span>` },
    /* budget_aed is NULL for router-created leads because the Master Router does
       not capture it. Rendering 0 would understate the pipeline silently. */
    { label:'Budget', align:'r', render: r => n0(r.budget_aed) == null ? '<span class="t-muted">—</span>' : aed(r.budget_aed) },
    { label:'AI score', align:'r', render: r => {
        const s = n0(r.ai_score); if (s == null) return '<span class="t-muted">—</span>';
        const c = tone(r.status) === 'hot' ? 'hot' : tone(r.status) === 'warm' ? 'warm' : 'cold';
        return `<div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
          <div class="bar" style="width:44px"><i style="width:${s}%;background:var(--${c})"></i></div>
          <span style="font-weight:500;min-width:22px;text-align:right">${s}</span></div>`;
      }},
    { label:'Source', render: r => `<span class="chip nowrap" title="${esc(r.source || '')}">${esc(r.source || '—')}</span>` },
    { label:'Assigned', render: r => r.users?.name
        ? esc(r.users.name)
        : `<span class="pill warm"><span class="dot"></span>Unassigned</span>` },
    { label:'Age', render: r => `<span class="t-muted">${ago(r.created_at)}</span>` },
  ];

  function draw() {
    card.querySelectorAll('#segStatus button').forEach(b =>
      b.classList.toggle('on', b.dataset.v === f.status));
    const rows = filtered();
    $('resultCount').textContent = `${rows.length} of ${all.length} leads`;
    const host2 = $('leadTable');
    host2.innerHTML = table(cols, rows, {
      onRow: true,
      empty: stateEmpty('No leads match these filters', 'Try clearing the search or widening the status filter.', 'search_off'),
    });
    wireRows(host2, rows, leadDrawer);
  }

  card.querySelectorAll('#segStatus button').forEach(b => b.addEventListener('click', () => {
    card.querySelectorAll('#segStatus button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); f.status = b.dataset.v; draw();
  }));
  $('q').addEventListener('input', e => { f.q = e.target.value; draw(); });
  $('fSource').addEventListener('change', e => { f.source = e.target.value; draw(); });
  $('fRep').addEventListener('change', e => { f.rep = e.target.value; draw(); });
  draw();
};

async function leadDrawer(lead) {
  const email = String(lead.email || '').toLowerCase();
  openDrawer(`
    <div class="drawer-head">
      <div class="avatar">${esc(initials(lead.name))}</div>
      <div style="flex:1;min-width:0">
        <h2 style="font-size:18px">${esc(lead.name)}</h2>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${pill(lead.status || 'NEW')}
          ${n0(lead.ai_score) != null ? `<span class="chip">AI score ${lead.ai_score}</span>` : ''}</div>
      </div>
      <button class="btn ghost sm" id="dClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
    </div>
    <div class="drawer-body">
      <div class="section">
        <div class="label-caps">Contact</div>
        <dl class="kv">
          <dt>Email</dt><dd>${esc(lead.email || '—')}</dd>
          <dt>Phone</dt><dd>${esc(lead.phone || '—')}</dd>
          <dt>Source</dt><dd>${esc(lead.source || '—')}</dd>
          <dt>Vehicle</dt><dd>${esc(lead.vehicle_interest || '—')}</dd>
          <dt>Budget</dt><dd>${n0(lead.budget_aed) == null ? '<span class="t-muted">Not captured by the router</span>' : aed(lead.budget_aed)}</dd>
          <dt>Assigned to</dt><dd>${esc(lead.users?.name || 'Unassigned')}</dd>
          <dt>Response time</dt><dd>${n0(lead.response_time_minutes) == null ? '—' :
            `${mins(lead.response_time_minutes)} ${Number(lead.response_time_minutes) > 5 ? '<span class="t-hot">· breaches the 5-minute rule</span>' : '<span class="t-ok">· within SLA</span>'}`}</dd>
          <dt>Created</dt><dd>${ago(lead.created_at)}</dd>
        </dl>
      </div>
      <div class="section" id="dVip"></div>
      <div class="section">
        <div class="label-caps">Activity</div>
        <div id="dTimeline">${stateLoading(3)}</div>
      </div>
    </div>
    <div class="drawer-foot">
      <button class="btn" id="dWhats"><span class="material-symbols-outlined">chat</span>Open conversation</button>
      <button class="btn" id="dAssign">Assign to…</button>
    </div>`);

  $('dClose').addEventListener('click', closeDrawer);
  $('dWhats').addEventListener('click', () => { closeDrawer(); go('conversations'); });
  $('dAssign').addEventListener('click', () => assignDialog(lead));

  const [purch, comms, audit] = await Promise.all([
    db(`purchase_history?select=*&email=eq.${encodeURIComponent(lead.email || '')}`).catch(() => []),
    db(`communication_logs?select=*&lead_email=eq.${encodeURIComponent(lead.email || '')}&order=created_at.desc&limit=30`).catch(() => []),
    db(`audit_log?select=*&lead_email=eq.${encodeURIComponent(lead.email || '')}&order=logged_at.desc&limit=30`).catch(() => []),
  ]);

  const vipBox = $('dVip');
  if (vipBox) {
    vipBox.innerHTML = purch.length
      ? `<div class="label-caps">Purchase history · returning customer</div>
         ${purch.map(p => `<div class="quote" style="margin-top:8px">
            <strong>${esc(p.vehicle)}</strong> · ${aed(p.amount_aed)}
            <div class="cell-sub">${esc(p.purchase_date || '')}</div></div>`).join('')}`
      : '';
  }

  const events = [
    ...comms.map(c => ({ at: c.created_at, kind: c.channel, dir: c.direction, text: c.message })),
    ...audit.map(a => ({ at: a.logged_at, kind: a.workflow, dir: a.status, text: a.summary })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  $('dTimeline').innerHTML = events.length ? `<div class="timeline">${events.map(e => `
    <div class="tl-item">
      <span class="tl-dot" style="background:var(--${tone(e.dir) ? tone(e.dir).replace('ok','ok') : 'neutral'})"></span>
      <div class="tl-body">
        <div class="tl-meta"><span class="chip">${esc(e.kind)}</span> ${ago(e.at)}</div>
        <div style="margin-top:4px;white-space:pre-wrap">${esc(String(e.text || '').slice(0, 400))}</div>
      </div>
    </div>`).join('')}</div>`
    : stateEmpty('No activity recorded', 'Nothing has been logged against this email address yet.', 'history');
}

async function assignDialog(lead) {
  const users = await db('users?select=id,name,status&order=name').catch(() => []);
  const body = $('drawer').querySelector('.drawer-body');
  if (!body) return;
  body.scrollTop = 0;
  const box = el('div', 'card');
  box.style.marginBottom = '16px';
  box.innerHTML = `<div class="label-caps" style="margin-bottom:10px">Assign this lead</div>
    <select id="assignSel">${users.map(u => `<option value="${esc(u.id)}" ${u.id === lead.assigned_to_id ? 'selected' : ''}>${esc(u.name)}${u.status === 'pending_invite' ? ' (pending invite)' : ''}</option>`).join('')}</select>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn primary" id="assignGo">Save</button>
    <button class="btn" id="assignCancel">Cancel</button></div>
    <div class="cell-sub" id="assignMsg" style="margin-top:8px"></div>`;
  body.prepend(box);
  box.querySelector('#assignCancel').addEventListener('click', () => box.remove());
  box.querySelector('#assignGo').addEventListener('click', async () => {
    const id = box.querySelector('#assignSel').value;
    const name = users.find(u => u.id === id)?.name || null;
    try {
      await dbWrite('PATCH', `leads?id=eq.${lead.id}`, { assigned_to_id: id, assigned_to: name });
      box.querySelector('#assignMsg').innerHTML = '<span class="t-ok">Saved. Reopen the screen to see it in the table.</span>';
    } catch (e) {
      box.querySelector('#assignMsg').innerHTML = `<span class="t-hot">${esc(e.message)}</span>`;
    }
  });
}

/* ==========================================================================
   S3 · Conversations
   ========================================================================== */
SCREENS.conversations = async host => {
  const wrap = el('div', 'card flush');
  wrap.style.display = 'grid';
  wrap.style.gridTemplateColumns = '320px minmax(0,1fr)';
  wrap.style.minHeight = '640px';
  wrap.innerHTML = stateLoading(6);
  host.appendChild(wrap);

  let logs = [];
  try { logs = await db('communication_logs?select=*&order=created_at.desc&limit=500'); }
  catch (e) { wrap.innerHTML = stateError('conversations', e.message); return; }

  if (!logs.length) {
    wrap.style.display = 'block';
    wrap.innerHTML = stateEmpty('No messages yet', 'Conversations appear once the WhatsApp BDC agent sends or receives its first message.', 'forum');
    return;
  }

  const byEmail = new Map();
  logs.forEach(l => {
    const k = l.lead_email || 'unknown';
    if (!byEmail.has(k)) byEmail.set(k, []);
    byEmail.get(k).push(l);
  });
  const threads = [...byEmail.entries()].map(([email, msgs]) => ({
    email, msgs: msgs.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    last: msgs[0],
    inbound: msgs.filter(m => m.direction === 'inbound').length,
  })).sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));

  const leads = await db('leads?select=id,name,email,phone,status,ai_score,vehicle_interest,budget_aed').catch(() => []);
  const leadByEmail = new Map(leads.map(l => [String(l.email || '').toLowerCase(), l]));

  wrap.innerHTML = `
    <div style="border-right:1px solid var(--border);display:flex;flex-direction:column">
      <div class="toolbar" style="border-bottom:1px solid var(--border-subtle)">
        <div class="grow"><input type="search" id="tq" placeholder="Search conversations" /></div>
      </div>
      <div id="threadList" style="overflow-y:auto;flex:1"></div>
    </div>
    <div style="display:flex;flex-direction:column;min-width:0" id="threadPane"></div>`;

  function drawList(q = '') {
    const list = threads.filter(t => !q || (t.email + ' ' + (leadByEmail.get(t.email.toLowerCase())?.name || '')).toLowerCase().includes(q.toLowerCase()));
    $('threadList').innerHTML = list.length ? list.map((t, i) => {
      const lead = leadByEmail.get(t.email.toLowerCase());
      return `<div class="list-item" data-i="${threads.indexOf(t)}">
        <div class="avatar">${esc(initials(lead?.name || t.email))}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(lead?.name || t.email)}</div>
          <div class="cell-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(String(t.last.message || '').replace(/\s+/g, ' ').slice(0, 60))}</div>
        </div>
        <div class="cell-sub">${ago(t.last.created_at)}</div>
      </div>`;
    }).join('') : stateEmpty('No conversations match', 'Try a different search.', 'search_off');
    $('threadList').querySelectorAll('.list-item').forEach(n =>
      n.addEventListener('click', () => openThread(Number(n.dataset.i))));
  }

  function openThread(i) {
    const t = threads[i];
    $('threadList').querySelectorAll('.list-item').forEach(n => n.classList.toggle('on', Number(n.dataset.i) === i));
    const lead = leadByEmail.get(t.email.toLowerCase());
    const onlyOutbound = t.inbound === 0;
    $('threadPane').innerHTML = `
      <div class="card-head">
        <div><div class="card-title">${esc(lead?.name || t.email)}</div>
        <div class="card-sub">${esc(t.email)}${lead ? ' · ' + esc(lead.vehicle_interest || '') : ''}</div></div>
        <div style="flex:1"></div>
        ${lead ? pill(lead.status || 'NEW') : ''}
      </div>
      <div style="flex:1;overflow-y:auto">
        ${onlyOutbound ? `<div class="banner info" style="margin:16px 20px 0">
          <span class="material-symbols-outlined" style="font-size:20px">info</span>
          <div>Only outbound messages are recorded for this contact. Inbound capture is not yet writing to <span class="mono">communication_logs</span>, so this thread shows one side of the conversation.</div>
        </div>` : ''}
        <div class="thread">${t.msgs.map(m => `
          <div class="bubble ${m.direction === 'inbound' ? 'in' : 'out'}">${esc(m.message)}
            <div class="bubble-meta"><span class="chip">${esc(m.channel || 'unknown')}</span>
              <span>${esc(m.direction)}</span><span>${ago(m.created_at)}</span></div>
          </div>`).join('')}</div>
      </div>
      <div style="padding:16px 20px;border-top:1px solid var(--border-subtle);display:flex;gap:10px">
        <input type="text" placeholder="Sending from the dashboard is not wired to WAHA yet" disabled />
        <button class="btn" disabled>Send</button>
      </div>`;
  }

  $('tq').addEventListener('input', e => drawList(e.target.value));
  drawList();
  openThread(0);
};

/* ── Modal ───────────────────────────────────────────────────────────────────
   The drawer is the read view; a modal is the write view. Keeping them separate
   means a form can never be half-covered by a detail panel. */
function openModal(title, bodyHtml, footHtml) {
  document.getElementById('modalWrap')?.remove();
  const wrap = el('div');
  wrap.id = 'modalWrap';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:flex-start;'
    + 'justify-content:center;padding:40px 16px;overflow:auto;background:rgba(15,23,41,.45)';
  wrap.innerHTML = `<div class="card" style="width:100%;max-width:720px;margin:auto">
      <div class="card-head" style="margin-bottom:4px">
        <div class="card-title" style="flex:1">${esc(title)}</div>
        <button class="btn ghost sm" id="mClose" aria-label="Close">
          <span class="material-symbols-outlined">close</span></button>
      </div>
      <div id="modalBody">${bodyHtml}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:20px;flex-wrap:wrap">${footHtml || ''}</div>
      <div class="cell-sub" id="modalMsg" style="margin-top:12px"></div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('#mClose').addEventListener('click', close);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', function esc_(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc_); }
  });
  wrap.querySelector('input,select,textarea')?.focus();
  return { wrap, close, msg: t => { wrap.querySelector('#modalMsg').innerHTML = t; } };
}
function modalError(m, e) { m.msg(`<span class="t-hot">${esc(e.message || String(e))}</span>`); }

/* ==========================================================================
   S4 · Inventory
   ========================================================================== */

/* Every money column on this screen is derived, not entered. These constants were
   reverse-engineered from the twelve seeded units and reproduce all of them exactly.
   The one soft edge: the HEALTHY/WARNING boundary is only pinned to somewhere
   between 62 and 82 days by that data — 75 is the assumption. CRITICAL at 120 is
   exact (121 was CRITICAL, 97 was WARNING). */
const INV = {
  HOLDING_PER_DAY: 50,      // AED per unit per day
  VAT_RATE: 0.05,           // UAE VAT on the list price
  COMMISSION_RATE: 0.05,    // of net margin
  WARN_DAYS: 75,
  CRITICAL_DAYS: 120,
  STATUSES: ['Available', 'Reserved', 'Sold'],
};

const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/* acquired_at is the source of truth; everything else falls out of it. Units
   that are Sold stop accruing — a sold car is not costing the lot anything. */
function deriveUnit(u) {
  const price = n0(u.price_aed) || 0;
  const cost = n0(u.cost_aed) || 0;
  let days;
  if (u.acquired_at) {
    days = Math.max(0, Math.round((today0() - new Date(u.acquired_at + 'T00:00:00')) / 86400000));
  } else {
    days = n0(u.days_in_stock) || 0;   // pre-migration rows, if any survive
  }
  const sold = String(u.status || '').toLowerCase() === 'sold';
  const holding = sold ? (n0(u.holding_cost_accrued) || 0) : days * INV.HOLDING_PER_DAY;
  const gross = price - cost;
  const net = gross - holding;
  return {
    ...u,
    days_in_stock: days,
    holding_cost_accrued: holding,
    gross_margin: gross,
    net_margin: net,
    vat_amount: Math.round(price * INV.VAT_RATE),
    recommended_commission: Math.round(net * INV.COMMISSION_RATE),
    aging_alert: sold ? 'HEALTHY'
      : days >= INV.CRITICAL_DAYS ? 'CRITICAL'
      : days >= INV.WARN_DAYS ? 'WARNING' : 'HEALTHY',
  };
}

/* What actually goes to Postgres. The derived columns are stored as well as shown,
   because n8n workflows and the Finance Desk read them straight off the table. */
function unitRow(u) {
  const d = deriveUnit(u);
  return {
    id: d.id, model: d.model, vin: d.vin || null,
    status: d.status, acquired_at: d.acquired_at,
    price_aed: n0(d.price_aed) || 0, cost_aed: n0(d.cost_aed) || 0,
    days_in_stock: d.days_in_stock, holding_cost_accrued: d.holding_cost_accrued,
    gross_margin: d.gross_margin, net_margin: d.net_margin,
    vat_amount: d.vat_amount, recommended_commission: d.recommended_commission,
    aging_alert: d.aging_alert,
    ai_recommendation: d.ai_recommendation || null,
  };
}

function nextStockId(inv) {
  const nums = inv.map(u => /^VH-(\d+)$/.exec(String(u.id || ''))).filter(Boolean).map(m => Number(m[1]));
  return 'VH-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
}

const isoDate = d => new Date(d).toISOString().slice(0, 10);

function unitForm(existing, inv, onDone) {
  const isNew = !existing;
  const u = existing || {
    id: nextStockId(inv), model: '', vin: '', status: 'Available',
    acquired_at: isoDate(today0()), price_aed: '', cost_aed: '', ai_recommendation: '',
  };
  const f = (id, label, input, hint) => `<div class="field">
    <label for="${id}">${label}</label>${input}
    ${hint ? `<div class="cell-sub">${hint}</div>` : ''}</div>`;

  const m = openModal(isNew ? 'Add vehicle' : `Edit ${u.model}`, `
    <div class="grid g2">
      ${f('uId', 'Stock number', `<input id="uId" value="${esc(u.id)}" ${isNew ? '' : 'disabled'} />`,
          isNew ? 'Must be unique. Used as the row key everywhere.' : 'The stock number cannot be changed once a unit exists.')}
      ${f('uStatus', 'Status', `<select id="uStatus">${INV.STATUSES
          .map(s => `<option ${s === u.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
    </div>
    ${f('uModel', 'Model', `<input id="uModel" value="${esc(u.model)}" placeholder="Toyota Land Cruiser 2024" />`)}
    <div class="grid g2">
      ${f('uVin', 'VIN (optional)', `<input id="uVin" value="${esc(u.vin || '')}" />`)}
      ${f('uAcq', 'Acquired on', `<input type="date" id="uAcq" value="${esc(u.acquired_at || '')}" max="${isoDate(today0())}" />`,
          'Days in stock, holding cost and the aging alert are all counted from this date.')}
    </div>
    <div class="grid g2">
      ${f('uPrice', 'List price (AED)', `<input type="number" min="0" id="uPrice" value="${esc(u.price_aed)}" placeholder="290000" />`)}
      ${f('uCost', 'Cost (AED)', `<input type="number" min="0" id="uCost" value="${esc(u.cost_aed)}" placeholder="250000" />`)}
    </div>
    ${f('uRec', 'AI recommendation (optional)', `<textarea id="uRec" rows="2">${esc(u.ai_recommendation || '')}</textarea>`,
        'Normally written by the pricing workflow. Editable here for a manual override.')}
    <div class="card" style="background:var(--sunken);margin-top:4px">
      <div class="label-caps" style="margin-bottom:10px">Calculated</div>
      <dl class="kv" id="uCalc"></dl>
      <div class="cell-sub" style="margin-top:10px">
        Holding cost accrues at ${aed(INV.HOLDING_PER_DAY)} a day and stops when a unit is marked Sold.
        VAT is ${(INV.VAT_RATE * 100)}% of list; commission is ${(INV.COMMISSION_RATE * 100)}% of net margin.
      </div>
    </div>`,
    `<button class="btn primary" id="uSave">${isNew ? 'Add vehicle' : 'Save changes'}</button>
     <button class="btn" id="uCancel">Cancel</button>
     <div style="flex:1"></div>
     ${isNew ? '' : '<button class="btn danger" id="uDelete">Delete</button>'}`);

  const read = () => ({
    id: $('uId').value.trim(),
    model: $('uModel').value.trim(),
    vin: $('uVin').value.trim(),
    status: $('uStatus').value,
    acquired_at: $('uAcq').value,
    price_aed: $('uPrice').value,
    cost_aed: $('uCost').value,
    ai_recommendation: $('uRec').value.trim(),
  });

  const paint = () => {
    const d = deriveUnit(read());
    $('uCalc').innerHTML = `
      <dt>Days in stock</dt><dd class="num">${num(d.days_in_stock)}</dd>
      <dt>Aging alert</dt><dd>${pill(d.aging_alert)}</dd>
      <dt>Gross margin</dt><dd class="num ${d.gross_margin < 0 ? 't-hot' : ''}">${aed(d.gross_margin)}</dd>
      <dt>Holding cost</dt><dd class="num">${aed(d.holding_cost_accrued)}</dd>
      <dt>Net margin</dt><dd class="num"><strong class="${d.net_margin < 0 ? 't-hot' : ''}">${aed(d.net_margin)}</strong></dd>
      <dt>VAT</dt><dd class="num">${aed(d.vat_amount)}</dd>
      <dt>Recommended commission</dt><dd class="num">${aed(d.recommended_commission)}</dd>`;
  };
  ['uStatus', 'uAcq', 'uPrice', 'uCost'].forEach(id =>
    $(id).addEventListener('input', paint));
  paint();

  m.wrap.querySelector('#uCancel').addEventListener('click', m.close);

  m.wrap.querySelector('#uSave').addEventListener('click', async () => {
    const v = read();
    if (!v.id) return m.msg('<span class="t-hot">A stock number is required.</span>');
    if (!v.model) return m.msg('<span class="t-hot">A model is required.</span>');
    if (!v.acquired_at) return m.msg('<span class="t-hot">An acquisition date is required.</span>');
    if (v.price_aed === '' || v.cost_aed === '')
      return m.msg('<span class="t-hot">List price and cost are both required — every margin on this screen is derived from them.</span>');
    if (isNew && inv.some(x => String(x.id) === v.id))
      return m.msg(`<span class="t-hot">Stock number ${esc(v.id)} already exists.</span>`);

    const btn = m.wrap.querySelector('#uSave');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (isNew) await dbWrite('POST', 'inventory', unitRow(v));
      else await dbWrite('PATCH', `inventory?id=eq.${encodeURIComponent(v.id)}`, unitRow(v));
      m.close(); onDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = isNew ? 'Add vehicle' : 'Save changes';
      modalError(m, e);
    }
  });

  m.wrap.querySelector('#uDelete')?.addEventListener('click', () => {
    m.msg(`<span class="t-hot">Delete ${esc(u.id)} — ${esc(u.model)}? This cannot be undone.</span>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn danger" id="uDelYes">Yes, delete it</button>
        <button class="btn" id="uDelNo">Keep it</button></div>`);
    $('uDelNo').addEventListener('click', () => m.msg(''));
    $('uDelYes').addEventListener('click', async () => {
      try { await dbWrite('DELETE', `inventory?id=eq.${encodeURIComponent(u.id)}`, undefined); m.close(); onDone(); }
      catch (e) { modalError(m, e); }
    });
  });
}

SCREENS.inventory = async host => {
  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const tableHost = el('div'); tableHost.style.marginTop = '16px'; host.appendChild(tableHost);

  let raw = [];
  try { raw = await db('inventory?select=*&order=acquired_at.asc&limit=1000'); }
  catch (e) { strip.innerHTML = stateError('inventory', e.message); return; }

  /* Derived live from acquired_at rather than read off the stored columns, so the
     aging numbers are true on the day you look at them, not on the day they were written. */
  const inv = raw.map(deriveUnit).sort((a, b) => b.days_in_stock - a.days_in_stock);
  const reload = () => go('inventory');

  const st = s => inv.filter(i => String(i.status || '').toLowerCase() === s).length;
  const onLot = inv.filter(i => String(i.status || '').toLowerCase() !== 'sold');
  const value = onLot.reduce((a, i) => a + (n0(i.price_aed) || 0), 0);
  const holding = onLot.reduce((a, i) => a + (n0(i.holding_cost_accrued) || 0), 0);

  strip.innerHTML = [
    kpi('Total units', num(inv.length), `${st('available')} available · ${st('reserved')} reserved · ${st('sold')} sold`),
    kpi('Stock value', aed(value), 'Listed price of unsold units'),
    kpi('Holding cost accrued', aed(holding), `${aed(INV.HOLDING_PER_DAY)} per unit per day`),
    kpi('Critical aging', num(inv.filter(i => i.aging_alert === 'CRITICAL').length), `${INV.CRITICAL_DAYS} days or more on the lot`),
    kpi('Oldest unit', num(onLot[0]?.days_in_stock || 0) + ' d', esc(onLot[0]?.model || '—')),
  ].join('');

  const buckets = [[0, 30], [31, 60], [61, 90], [91, 120], [121, 99999]];
  const labels = ['0–30', '31–60', '61–90', '91–120', '120+'];
  const colors = ['var(--ok)', 'var(--ok)', 'var(--cold)', 'var(--warm)', 'var(--hot)'];
  const counts = buckets.map(([a, b]) => onLot.filter(i => i.days_in_stock >= a && i.days_in_stock <= b).length);
  const totalUnits = onLot.length || 1;

  const agingCard = el('div', 'card');
  agingCard.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Days in stock</div>
    <div class="stackbar">${counts.map((c, i) => `<i style="width:${(c / totalUnits * 100).toFixed(1)}%;background:${colors[i]}"></i>`).join('')}</div>
    <div style="display:flex;gap:18px;margin-top:12px;flex-wrap:wrap">
      ${labels.map((l, i) => `<div style="display:flex;align-items:center;gap:8px">
        <span style="width:8px;height:8px;border-radius:50%;background:${colors[i]}"></span>
        <span style="font-weight:500">${l} d</span><span class="t-muted num">${counts[i]}</span></div>`).join('')}
    </div>`;
  tableHost.appendChild(agingCard);

  const card = el('div', 'card flush'); card.style.marginTop = '16px'; tableHost.appendChild(card);
  const cols = [
    { label: 'Vehicle', strong: true, render: r => `${esc(r.model)}<div class="cell-sub mono">${esc(r.id)}${r.vin ? ' · ' + esc(r.vin) : ''}</div>` },
    { label: 'Status', render: r => pill(r.status || '—', String(r.status).toLowerCase() === 'sold' ? 'ok' : String(r.status).toLowerCase() === 'reserved' ? 'cold' : '') },
    {
      label: 'Days', align: 'r', render: r => {
        const d = r.days_in_stock;
        const c = d > 120 ? 'hot' : d > 90 ? 'warm' : 'cold';
        return `<div class="t-${c}" style="font-weight:500">${num(d)}</div>
                <div class="bar" style="width:56px;margin-left:auto"><i style="width:${Math.min(100, d / 2)}%;background:var(--${c})"></i></div>`;
      }
    },
    { label: 'Price', align: 'r', render: r => aed(r.price_aed) },
    { label: 'Gross margin', align: 'r', render: r => aed(r.gross_margin) },
    { label: 'Holding cost', align: 'r', render: r => `<span class="${(n0(r.holding_cost_accrued) || 0) > 5000 ? 't-hot' : ''}">${aed(r.holding_cost_accrued)}</span>` },
    { label: 'Net margin', align: 'r', render: r => aed(r.net_margin) },
    { label: 'Commission', align: 'r', render: r => aed(r.recommended_commission) },
    { label: 'Alert', render: r => r.aging_alert ? pill(r.aging_alert) : '<span class="t-muted">—</span>' },
  ];
  card.innerHTML = `<div class="card-head"><div><div class="card-title">Stock</div>
      <div class="card-sub">Click a row for the AI recommendation and margin detail</div></div>
      <div style="flex:1"></div>
      <button class="btn primary sm" id="invAdd">
        <span class="material-symbols-outlined">add</span>Add vehicle</button></div>
    <div id="invTable"></div>`;
  card.querySelector('#invAdd').addEventListener('click', () => unitForm(null, inv, reload));

  const th = card.querySelector('#invTable');
  th.innerHTML = inv.length ? table(cols, inv, { onRow: true })
    : stateEmpty('No vehicles in stock', 'Add the first unit to start tracking aging and margin.', 'directions_car');

  wireRows(th, inv, unit => {
    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1"><h2 style="font-size:18px">${esc(unit.model)}</h2>
          <div class="cell-sub mono">${esc(unit.id)}${unit.vin ? ' · ' + esc(unit.vin) : ''}</div></div>
        <button class="btn ghost sm" id="dClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section"><div class="label-caps">AI recommendation</div>
          <div class="quote" style="margin-top:8px">${esc(unit.ai_recommendation || 'No recommendation generated for this unit.')}</div></div>
        <div class="section"><div class="label-caps">Financials</div>
          <dl class="kv" style="margin-top:8px">
            <dt>List price</dt><dd class="num">${aed(unit.price_aed)}</dd>
            <dt>Cost</dt><dd class="num">${aed(unit.cost_aed)}</dd>
            <dt>Gross margin</dt><dd class="num">${aed(unit.gross_margin)}</dd>
            <dt>Holding cost</dt><dd class="num">${aed(unit.holding_cost_accrued)}</dd>
            <dt>Net margin</dt><dd class="num"><strong>${aed(unit.net_margin)}</strong></dd>
            <dt>VAT</dt><dd class="num">${aed(unit.vat_amount)}</dd>
            <dt>Recommended commission</dt><dd class="num">${aed(unit.recommended_commission)}</dd>
            <dt>Acquired</dt><dd>${esc(unit.acquired_at || '—')}</dd>
            <dt>Days in stock</dt><dd class="num">${num(unit.days_in_stock)}</dd>
          </dl></div>
      </div>
      <div class="drawer-foot">
        <button class="btn primary" id="dEdit">Edit</button>
        <button class="btn" id="dComp">Compare against competitors</button>
      </div>`);
    $('dClose').addEventListener('click', closeDrawer);
    $('dComp').addEventListener('click', () => { closeDrawer(); go('competitors'); });
    $('dEdit').addEventListener('click', () => { closeDrawer(); unitForm(unit, inv, reload); });
  });
};

/* ==========================================================================
   S5 · Competitors
   ========================================================================== */
SCREENS.competitors = async host => {
  const strip = el('div', 'grid g4'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const tableHost = el('div'); tableHost.style.marginTop = '16px'; host.appendChild(tableHost);

  let rows = [], inv = [];
  try {
    [rows, inv] = await Promise.all([
      db('competitors?select=*&order=price_diff_aed.asc&limit=500'),
      db('inventory?select=model,days_in_stock,aging_alert').catch(() => []),
    ]);
  } catch (e) { strip.innerHTML = stateError('competitor pricing', e.message); return; }

  const agedByModel = new Map(inv.filter(i => String(i.aging_alert).toUpperCase() === 'CRITICAL').map(i => [i.model, i.days_in_stock]));
  const cheaper = rows.filter(r => (n0(r.price_diff_aed) || 0) > 0).length;
  const pricier = rows.filter(r => (n0(r.price_diff_aed) || 0) < 0).length;
  const worst = rows.length ? rows[0] : null;
  const lastScrape = rows.reduce((a, r) => (!a || new Date(r.scraped_at) > new Date(a)) ? r.scraped_at : a, null);

  strip.innerHTML = [
    kpi('Models tracked', num(rows.length), `Last scraped ${ago(lastScrape)}`),
    kpi('We are cheaper', num(cheaper), cheaper ? 'Competitive on these models' : ''),
    kpi('We are pricier', num(pricier), pricier ? '<span class="t-hot">Needs a price review</span>' : ''),
    kpi('Largest gap', worst ? aedSigned(worst.price_diff_aed) : '—', worst ? esc(worst.model) : ''),
  ].join('');

  const card = el('div', 'card flush'); tableHost.appendChild(card);
  card.innerHTML = `<div class="card-head"><div class="card-title">Price comparison</div>
    <div class="card-sub">Negative means a competitor is undercutting us</div></div><div id="cTable"></div>`;

  card.querySelector('#cTable').innerHTML = table([
    { label:'Competitor', strong:true, render: r => esc(r.competitor) },
    { label:'Model', render: r => `${esc(r.model)}${agedByModel.has(r.model)
        ? ` <span class="pill hot"><span class="dot"></span>Aged ${agedByModel.get(r.model)} d</span>` : ''}` },
    { label:'Their price', align:'r', render: r => aed(r.price_aed) },
    { label:'Our price', align:'r', render: r => aed(r.our_price_aed) },
    { label:'Difference', align:'r', render: r => {
        const d = n0(r.price_diff_aed);
        if (d == null) return '—';
        const good = d > 0;
        return `<span class="${good ? 't-ok' : 't-hot'}" style="font-weight:500">
          <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">${good ? 'arrow_downward' : 'arrow_upward'}</span>
          ${aedSigned(d)}</span>`;
      }},
    { label:'AI recommendation', render: r => `<div class="t-2" style="max-width:380px;white-space:normal">${esc(r.ai_recommendation || '—')}</div>` },
  ], rows, { empty: stateEmpty('No competitor prices yet', 'The scraping workflow runs every 24 hours and fills this table.', 'trending_up') });
};

/* ==========================================================================
   S6 · Ask AI
   ========================================================================== */
SCREENS.ask = async host => {
  const wrap = el('div');
  wrap.style.maxWidth = '820px'; wrap.style.margin = '0 auto';
  host.appendChild(wrap);

  const docs = await db('rag_documents?select=doc_title').catch(() => []);
  const titles = [...new Set(docs.map(d => d.doc_title).filter(Boolean))];

  wrap.innerHTML = `
    <div id="askThread"></div>
    <div class="card" style="margin-top:16px">
      <div style="display:flex;gap:10px">
        <input type="text" id="askQ" placeholder="Ask anything about your dealership" />
        <button class="btn primary" id="askGo"><span class="material-symbols-outlined">send</span></button>
      </div>
    </div>`;

  const thread = $('askThread');
  function landing() {
    thread.innerHTML = `<div class="card"><div class="state">
      <span class="material-symbols-outlined">auto_awesome</span>
      <h3>Ask anything about your dealership</h3>
      <p>Answers come only from your ${docs.length} indexed document sections, and always cite the source.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
        ${titles.map(t => `<button class="btn sm" data-chip="${esc(t)}">${esc(t)}</button>`).join('')}
      </div></div></div>`;
    thread.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => {
      $('askQ').value = `What does the ${b.dataset.chip} say?`; ask();
    }));
  }
  landing();

  async function ask() {
    const q = $('askQ').value.trim();
    if (!q) return;
    thread.innerHTML = `<div class="card">
      <div class="bubble out" style="max-width:100%;margin-bottom:12px">${esc(q)}</div>
      <div class="bubble in" style="max-width:100%"><span class="t-muted">Searching your documents…</span></div></div>`;
    $('askQ').value = '';
    try {
      /* Path is just the webhook node's `path`, NOT `{webhookId}/{path}`.
         n8n's editor displays the longer form, but webhook_entity on the server
         registers only `ask-ai` — the longer URL returns "Cannot POST". */
      const r = await n8n('ask-ai', { question: q });
      const sources = Array.isArray(r.sources) ? r.sources : [];
      thread.innerHTML = `<div class="card">
        <div class="bubble out" style="max-width:100%;margin-bottom:12px">${esc(q)}</div>
        <div class="bubble in" style="max-width:100%">${esc(r.answer || 'No answer returned.')}</div>
        ${r.documents_consulted === 0 ? `<div class="banner warm" style="margin-top:14px">
            <span class="material-symbols-outlined" style="font-size:20px">search_off</span>
            <div>No documents in the knowledge base matched this question, so the answer is not grounded in your data.</div></div>` : ''}
        ${sources.length ? `<div style="margin-top:16px">
          <div class="label-caps" style="margin-bottom:8px">Sources</div>
          <div class="grid g3">${sources.map(s => `<div class="card" style="padding:12px">
            <div style="font-weight:500;font-size:13px">${esc(s.title || 'Document')}</div>
            <div class="cell-sub">${esc(s.section || '—')}${s.page_number != null ? ' · p. ' + esc(s.page_number) : ''}</div>
          </div>`).join('')}</div></div>` : ''}
        <div class="cell-sub" style="margin-top:14px">
          Answered from ${num(r.documents_consulted)} document${r.documents_consulted === 1 ? '' : 's'}${r.model ? ' · model ' + esc(r.model) : ''}
        </div></div>`;
    } catch (e) {
      thread.innerHTML = `<div class="card">${stateError('an answer', e.message)}</div>`;
    }
  }
  $('askGo').addEventListener('click', ask);
  $('askQ').addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
};

/* ==========================================================================
   S7 · Finance Desk
   ========================================================================== */
SCREENS.finance = async host => {
  const grid = el('div', 'grid g2'); host.appendChild(grid);

  const left = el('div', 'card');
  left.innerHTML = `
    <div class="card-title" style="margin-bottom:4px">Trade-in &amp; finance</div>
    <div class="card-sub" style="margin-bottom:16px">Calls the live Finance Calc workflow</div>
    <div class="grid" style="gap:14px">
      <div class="field"><label for="fVal">Vehicle value (AED)</label>
        <input type="number" id="fVal" min="1" placeholder="185000" /></div>
      <div class="field"><label for="fPay">Loan payoff amount (AED)</label>
        <input type="number" id="fPay" min="0" placeholder="60000" /></div>
      <div class="field"><label for="fScore">AECB credit score</label>
        <input type="number" id="fScore" min="300" max="900" placeholder="720" />
        <div class="hint">Entered manually from the customer's AECB report. Real-time bureau lookups require a licensed financial-institution agreement in the UAE.</div></div>
      <div class="field"><label for="fName">Customer name</label>
        <input type="text" id="fName" placeholder="Vikram Malhotra" /></div>
      <div class="field"><label for="fEmail">Customer email</label>
        <input type="email" id="fEmail" placeholder="name@example.com" />
        <div class="hint">A quote is a promise made to a named person. Without this the record cannot be traced back to anyone.</div></div>
      <button class="btn primary" id="fGo">Calculate</button>
    </div>
    <div id="fOut" style="margin-top:18px"></div>`;
  grid.appendChild(left);

  const right = el('div', 'card flush');
  right.innerHTML = `<div class="card-head"><div><div class="card-title">Commission</div>
    <div class="card-sub">From live inventory margins</div></div></div>
    <div style="padding:20px"><div class="field"><label for="cVeh">Vehicle</label><select id="cVeh"></select></div>
    <div id="cOut" style="margin-top:16px"></div></div>`;
  grid.appendChild(right);

  $('fGo').addEventListener('click', async () => {
    const vehicleValue = $('fVal').value, loanPayoffAmount = $('fPay').value, creditScore = $('fScore').value;
    const out = $('fOut');
    out.innerHTML = `<div class="t-muted">Calculating…</div>`;
    try {
      /* Attribution travels with the request. The backend records lead_email,
         lead_name and quoted_by; without these the quote is stored with nobody
         attached to it, which defeats the point of storing it. quoted_by comes
         from the session, never from a field the rep can type into. */
      const r = await n8n('finance-calc', {
        vehicleValue, loanPayoffAmount, creditScore,
        lead_name:  $('fName').value.trim()  || null,
        lead_email: $('fEmail').value.trim() || null,
        quoted_by:  ME?.name || SESSION?.user?.email || null,
      });
      if (r.status === 'error') {
        out.innerHTML = `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span>
          <div>${(r.errors || ['Invalid input']).map(esc).join('<br>')}</div></div>`;
        return;
      }
      const neg = r.equity_status === 'Negative';
      out.innerHTML = `
        <div class="grid g2">
          ${kpi('Equity', `<span class="${neg ? 't-hot' : 't-ok'}">${aed(r.equity_aed)}</span>`, pill(r.equity_status, neg ? 'hot' : 'ok'))}
          ${kpi('Indicative APR', pct(r.indicative_apr_pct), esc(r.finance_tier))}
        </div>
        <div style="margin-top:14px">
          <div class="label-caps" style="margin-bottom:6px">Loan to value · ${pct(r.loan_to_value_pct)}</div>
          <div class="bar"><i style="width:${Math.min(100, n0(r.loan_to_value_pct) || 0)}%;background:var(--${(n0(r.loan_to_value_pct)||0) > 80 ? 'hot' : 'primary'})"></i></div>
        </div>
        <div class="quote" style="margin-top:16px">${esc(r.disclaimer)}</div>`;
    } catch (e) {
      out.innerHTML = stateError('the calculation', e.message);
    }
  });

  /* Quote history. Until today finance_calc wrote nothing anywhere — every
     equity/APR figure a rep quoted a customer vanished with the HTTP response.
     This panel is the record. */
  const hist = el('div', 'card flush');
  hist.style.marginTop = '16px';
  hist.innerHTML = `<div class="card-head"><div><div class="card-title">Recent quotes</div>
    <div class="card-sub">Every calculation is now recorded and attributable</div></div></div>
    <div id="fqBody">${stateLoading(3)}</div>`;
  host.appendChild(hist);

  db('finance_quotes?select=*&order=created_at.desc&limit=50')
    .then(rows => {
      $('fqBody').innerHTML = rows.length ? table([
        { label:'When', render: r => `<span class="t-muted">${ago(r.created_at)}</span>` },
        { label:'Customer', strong:true, render: r => `${esc(r.lead_name || '—')}<div class="cell-sub">${esc(r.lead_email || '')}</div>` },
        { label:'Vehicle value', align:'r', render: r => aed(r.vehicle_value_aed) },
        { label:'Payoff', align:'r', render: r => aed(r.loan_payoff_aed) },
        { label:'Equity', align:'r', render: r => `<span class="${r.equity_status === 'Negative' ? 't-hot' : 't-ok'}">${aed(r.equity_aed)}</span>` },
        { label:'LTV', align:'r', render: r => pct(r.loan_to_value_pct) },
        { label:'Tier', render: r => `<span class="chip">${esc(r.finance_tier)}</span>` },
        { label:'APR', align:'r', render: r => pct(r.indicative_apr_pct) },
        { label:'Quoted by', render: r => esc(r.quoted_by || '—') },
      ], rows) : stateEmpty('No quotes recorded yet',
          'Every calculation from this screen is now stored, with the customer and the rep it belongs to.', 'receipt_long');
    })
    .catch(e => { $('fqBody').innerHTML = stateError('quote history', e.message); });

  try {
    const inv = await db('inventory?select=*&order=model');
    const sel = $('cVeh');
    sel.innerHTML = inv.map(i => `<option value="${esc(i.id)}">${esc(i.model)}</option>`).join('');
    const drawC = () => {
      const u = inv.find(i => i.id === sel.value) || inv[0];
      if (!u) return;
      $('cOut').innerHTML = `<dl class="kv">
        <dt>List price</dt><dd class="num">${aed(u.price_aed)}</dd>
        <dt>Gross margin</dt><dd class="num">${aed(u.gross_margin)}</dd>
        <dt>Holding cost</dt><dd class="num t-${(n0(u.holding_cost_accrued)||0) > 5000 ? 'hot' : 'muted'}">${aed(u.holding_cost_accrued)}</dd>
        <dt>Net margin</dt><dd class="num"><strong>${aed(u.net_margin)}</strong></dd>
        <dt>VAT</dt><dd class="num">${aed(u.vat_amount)}</dd>
        <dt>Commission</dt><dd class="num" style="font-size:18px;font-weight:600">${aed(u.recommended_commission)}</dd>
      </dl>`;
    };
    sel.addEventListener('change', drawC);
    drawC();
  } catch (e) {
    $('cOut').innerHTML = stateError('inventory', e.message);
  }
};

/* ==========================================================================
   S8 · Compliance / KYC
   ========================================================================== */
SCREENS.compliance = async host => {
  const strip = el('div', 'grid g4'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const body = el('div'); body.style.marginTop = '16px'; host.appendChild(body);

  let docs = [], audit = [], comms = [];
  try {
    [docs, audit, comms] = await Promise.all([
      db('kyc_documents?select=*&order=created_at.desc&limit=500').catch(() => []),
      db("audit_log?select=*&workflow=eq.KYC%20Auditor%20-%20Phase%205&order=logged_at.desc&limit=200").catch(() => []),
      db('communication_logs?select=*&order=created_at.desc&limit=500').catch(() => []),
    ]);
  } catch (e) { strip.innerHTML = stateError('compliance data', e.message); return; }

  const kycComms = comms.filter(c => String(c.message || '').startsWith('[KYC-'));
  const escalations = audit.filter(a => a.status === 'ESCALATED');

  strip.innerHTML = [
    kpi('Documents on file', num(docs.length), docs.length ? '' : 'The KYC workflow has not written a record yet'),
    kpi('Approved', num(docs.filter(d => d.verdict === 'APPROVED').length +
                        kycComms.filter(c => c.message.startsWith('[KYC-APPROVED]')).length)),
    kpi('Rejected / re-asked', num(docs.filter(d => d.verdict === 'REJECTED').length +
                        kycComms.filter(c => c.message.startsWith('[KYC-REJECT]')).length)),
    kpi('Escalated to a human', num(escalations.length),
        escalations.length ? '<span class="t-hot">The retry loop gave up</span>' : ''),
  ].join('');

  if (escalations.length) {
    const b = el('div', 'banner hot');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">block</span>
      <div><strong>${escalations.length} case${escalations.length > 1 ? 's' : ''} need a human.</strong>
      ${esc(escalations[0].summary || '')}</div>`;
    body.appendChild(b);
  }

  const queue = el('div', 'card flush'); body.appendChild(queue);
  queue.innerHTML = `<div class="card-head"><div><div class="card-title">Review queue</div>
    <div class="card-sub">Attempt counter shows how close a customer is to escalation</div></div></div><div id="kq"></div>`;

  if (docs.length) {
    queue.querySelector('#kq').innerHTML = table([
      { label:'Customer', strong:true, render: d => `${esc(d.lead_name || d.full_name || '—')}<div class="cell-sub">${esc(d.lead_email || '')}</div>` },
      { label:'Document', render: d => esc(d.document_type || '—') },
      { label:'Verdict', render: d => pill(d.verdict) },
      { label:'Tampering', render: d => d.tampering ? pill('Detected','hot') : '<span class="t-muted">None</span>' },
      { label:'Confidence', align:'r', render: d => {
          const c = n0(d.confidence_score); if (c == null) return '—';
          return `<div>${c}%</div><div class="bar" style="width:56px;margin-left:auto"><i style="width:${c}%;background:var(--${c > 70 ? 'ok' : c > 40 ? 'warm' : 'hot'})"></i></div>`;
        }},
      { label:'Attempt', align:'r', render: d => `<span class="${d.attempt_number >= d.max_attempts ? 't-hot' : ''}">${d.attempt_number} of ${d.max_attempts}</span>` },
      { label:'Submitted', render: d => `<span class="t-muted">${ago(d.created_at)}</span>` },
    ], docs);
  } else {
    queue.querySelector('#kq').innerHTML = stateEmpty(
      'No documents in the queue',
      'The KYC workflow writes here once it audits a document. Historic activity is shown below.',
      'verified_user');
  }

  const hist = el('div', 'card flush'); hist.style.marginTop = '16px'; body.appendChild(hist);
  const events = [...kycComms.map(c => ({ at: c.created_at, who: c.lead_email, text: c.message, kind: c.message.startsWith('[KYC-APPROVED]') ? 'APPROVED' : 'REJECTED' })),
                  ...audit.map(a => ({ at: a.logged_at, who: a.lead_email || a.lead_name, text: a.summary, kind: a.status }))]
                  .sort((a, b) => new Date(b.at) - new Date(a.at));
  hist.innerHTML = `<div class="card-head"><div class="card-title">KYC activity</div></div>
    <div>${events.length ? events.map(e => `
      <div class="list-item" style="cursor:default">
        <span class="mono t-muted">${clock(e.at)}</span>
        ${pill(e.kind)}
        <div style="flex:1;min-width:0">
          <div style="font-weight:500">${esc(e.who || 'Unknown contact')}</div>
          <div class="cell-sub">${esc(String(e.text || '').slice(0, 180))}</div></div>
        <div class="cell-sub">${ago(e.at)}</div>
      </div>`).join('')
      : stateEmpty('No KYC activity recorded', 'Nothing has passed through the auditor yet.', 'history')}</div>`;
};

/* ==========================================================================
   S9 · Automation
   ========================================================================== */
SCREENS.automation = async host => {
  const strip = el('div', 'grid g4'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const grid = el('div', 'grid g2 top'); grid.style.marginTop = '16px'; host.appendChild(grid);

  let health = [], log = [];
  try {
    [health, log] = await Promise.all([
      db('v_workflow_health?select=*&order=runs.desc,name.asc'),
      db('audit_log?select=*&order=logged_at.desc&limit=100'),
    ]);
  } catch (e) { strip.innerHTML = stateError('automation health', e.message); return; }

  const runs = health.reduce((a, w) => a + (w.runs || 0), 0);
  const fails = health.reduce((a, w) => a + (w.failures || 0), 0);
  const instrumented = health.filter(w => w.writes_audit_log).length;

  strip.innerHTML = [
    kpi('Workflows', num(health.length), `${health.filter(w => w.is_active).length} active`),
    kpi('Logged runs', num(runs), `Only ${instrumented} of ${health.length} workflows write to the audit log`),
    kpi('Failures', num(fails), fails ? '<span class="t-hot">Needs investigation</span>' : '<span class="t-ok">All clean</span>'),
    kpi('Success rate', runs ? pct((runs - fails) / runs * 100) : '—', 'Across logged runs only'),
  ].join('');

  const wCard = el('div', 'card flush'); grid.appendChild(wCard);
  const HEALTH = {
    HEALTHY:          ['ok',   'Healthy'],
    DEGRADED:         ['hot',  'Failing'],
    NEVER_RAN:        ['',     'No runs logged yet'],
    /* "0 runs" is ambiguous — a workflow can fire perfectly and simply have no
       Audit Log node. Only 4 of 13 write to audit_log. Saying "never ran" for
       the other 9 would be wrong. */
    NOT_INSTRUMENTED: ['',     'Not logged'],
  };
  const maxRuns = Math.max(1, ...health.map(w => w.runs || 0));
  wCard.innerHTML = `<div class="card-head"><div><div class="card-title">All workflows</div>
    <div class="card-sub">Audit logging was added to all 13 today — counts build up from the next run of each</div></div></div>
    <div>${health.map(w => {
      const [t, lbl] = HEALTH[w.health] || ['', w.health];
      return `<div class="list-item" style="cursor:default;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-weight:500">${esc(w.name)}</span>${pill(lbl, t)}
            <span class="chip">${esc(w.category)}</span>
            <span class="chip">${esc(w.trigger_type)}${w.trigger_detail ? ' · ' + esc(w.trigger_detail) : ''}</span>
          </div>
          <div class="cell-sub" style="margin-top:4px;white-space:normal">${esc(w.description || '')}</div>
          ${w.runs ? `<div class="bar" style="margin-top:8px;max-width:220px">
            <i style="width:${(w.runs / maxRuns * 100).toFixed(1)}%;background:var(--${w.failures ? 'hot' : 'primary'})"></i></div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div class="num" style="font-weight:500">${num(w.runs)}</div>
          <div class="cell-sub">${w.failures ? `<span class="t-hot">${w.failures} failed</span>` : 'runs'}</div>
          <div class="cell-sub">${w.last_run ? ago(w.last_run) : ''}</div>
        </div>
      </div>`;
    }).join('')}</div>`;

  const lCard = el('div', 'card flush'); grid.appendChild(lCard);
  lCard.innerHTML = `<div class="card-head"><div class="card-title">Activity log</div>
    <div class="card-sub">Newest first · ${log.length} entries</div></div>
    <div style="max-height:70vh;overflow-y:auto">${log.length ? log.map(a => `
      <div class="list-item" style="cursor:default">
        <span class="mono t-muted">${clock(a.logged_at)}</span>
        ${pill(a.status)}
        <div style="flex:1;min-width:0">
          <div style="font-weight:500">${esc(a.workflow)}</div>
          <div class="cell-sub">${esc(String(a.summary || '').slice(0, 160))}${a.lead_name ? ' · ' + esc(a.lead_name) : ''}</div>
        </div>
      </div>`).join('') : stateEmpty('No runs logged', 'Workflows with an Audit Log node write here.', 'receipt_long')}</div>`;

  const intg = el('div', 'card'); intg.style.marginTop = '16px'; host.appendChild(intg);
  intg.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Integration status</div><div id="intgRow">${stateLoading(1)}</div>`;
  renderIntegrations($('intgRow'));
};

/* Real probes only. A hardcoded green dot next to a dead WhatsApp session is
   the one component on this screen that can cause a worse outcome than having
   no screen at all. Anything we cannot probe says so. */
async function renderIntegrations(node) {
  const checks = [
    { name: 'Supabase', probe: async () => { await db('leads?select=id&limit=1'); return 'Connected'; } },
    { name: 'n8n', probe: async () => {
        if (!N8N_BASE) throw new Error('VITE_N8N_BASE_URL not set');
        const r = await fetch(`${N8N_BASE}/healthz`).catch(() => null);
        if (!r) throw new Error('Unreachable from the browser');
        return r.ok ? 'Reachable' : `HTTP ${r.status}`;
      }},
    /* Finance Calc is pure JavaScript inside n8n — probing it is free, so it
       runs automatically. Ask AI is NOT probed on load: every call spends
       OpenRouter tokens, and a health dot is not worth paying for on every
       page view. It gets a manual Test button instead. */
    { name: 'Finance Calc', probe: async () => { const r = await n8n('finance-calc', { vehicleValue: 1, loanPayoffAmount: 0, creditScore: 700 }); return r.status === 'success' ? 'Responding' : 'Reachable'; } },
  ];
  const manual = [
    { name: 'Ask AI (RAG)', run: async () => { const r = await n8n('ask-ai', { question: 'ping' }); return r.answer ? `Responding · ${r.documents_consulted} docs` : 'No answer'; } },
  ];
  const unprobed = ['WhatsApp (WAHA)', 'Bitrix24', 'Slack', 'Gmail', 'OpenRouter'];

  node.innerHTML = `<div class="grid g4">${checks.map((c, i) =>
    `<div class="card" style="padding:14px" id="ig${i}">
       <div style="font-weight:500">${esc(c.name)}</div>
       <div class="cell-sub">Checking…</div></div>`).join('')}
    ${manual.map((m, i) => `<div class="card" style="padding:14px" id="mg${i}">
       <div style="font-weight:500">${esc(m.name)}</div>
       <div class="cell-sub">Costs tokens — not auto-checked</div>
       <button class="btn sm" data-manual="${i}" style="margin-top:8px">Test</button></div>`).join('')}</div>
    <div style="margin-top:14px">
      <div class="label-caps" style="margin-bottom:8px">Not probed from the browser</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${unprobed.map(u => `<span class="chip">${esc(u)}</span>`).join('')}
      </div>
      <div class="cell-sub" style="margin-top:8px">These run server-side inside n8n and have no browser-reachable health endpoint. Their real status is visible in the activity log above — a green dot here would be decoration, not a check.</div>
    </div>`;

  node.querySelectorAll('[data-manual]').forEach(btn => btn.addEventListener('click', async () => {
    const i = Number(btn.dataset.manual), box = $(`mg${i}`);
    btn.disabled = true; btn.textContent = 'Testing…';
    try {
      const msg = await manual[i].run();
      box.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:var(--ok)"></span>
        <span style="font-weight:500">${esc(manual[i].name)}</span></div><div class="cell-sub">${esc(msg)}</div>`;
    } catch (e) {
      box.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:var(--hot)"></span>
        <span style="font-weight:500">${esc(manual[i].name)}</span></div><div class="cell-sub t-hot">${esc(String(e.message).slice(0,90))}</div>`;
    }
  }));

  checks.forEach(async (c, i) => {
    const box = $(`ig${i}`);
    try {
      const msg = await c.probe();
      box.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:var(--ok)"></span>
        <span style="font-weight:500">${esc(c.name)}</span></div><div class="cell-sub">${esc(msg)} · ${new Date().toLocaleTimeString('en-GB',{hour12:false})}</div>`;
    } catch (e) {
      box.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:var(--hot)"></span>
        <span style="font-weight:500">${esc(c.name)}</span></div><div class="cell-sub t-hot">${esc(String(e.message).slice(0,90))}</div>`;
    }
  });
}

/* ==========================================================================
   S10 · Customer 360
   ========================================================================== */
SCREENS.customers = async host => {
  const grid = el('div', 'card flush');
  grid.style.display = 'grid'; grid.style.gridTemplateColumns = '340px minmax(0,1fr)'; grid.style.minHeight = '620px';
  grid.innerHTML = stateLoading(6); host.appendChild(grid);

  let people = [];
  try { people = await db('v_customer_360?select=*&order=lifetime_value_aed.desc,lead_count.desc&limit=500'); }
  catch (e) { grid.innerHTML = stateError('customers', e.message); return; }

  if (!people.length) { grid.style.display = 'block'; grid.innerHTML = stateEmpty('No customers yet', 'Customers appear once a lead or a purchase is recorded.', 'contacts'); return; }

  grid.innerHTML = `
    <div style="border-right:1px solid var(--border);display:flex;flex-direction:column">
      <div class="toolbar"><div class="grow"><input type="search" id="cq" placeholder="Search customers" /></div></div>
      <div id="custList" style="overflow-y:auto;flex:1"></div>
    </div>
    <div id="custPane" style="overflow-y:auto"></div>`;

  function list(q = '') {
    const f = people.filter(p => !q || `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase()));
    $('custList').innerHTML = f.length ? f.map(p => `
      <div class="list-item" data-e="${esc(p.email)}">
        <div class="avatar">${esc(initials(p.name))}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name || p.email)}
            ${p.is_vip ? '<span class="pill vip"><span class="dot"></span>VIP</span>' : ''}</div>
          <div class="cell-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.email)}</div>
        </div>
        <div class="cell-sub num">${p.lifetime_value_aed ? aed(p.lifetime_value_aed) : ''}</div>
      </div>`).join('') : stateEmpty('No match', 'Try a different search.', 'search_off');
    $('custList').querySelectorAll('.list-item').forEach(n => n.addEventListener('click', () => open(n.dataset.e)));
  }

  async function open(email) {
    $('custList').querySelectorAll('.list-item').forEach(n => n.classList.toggle('on', n.dataset.e === email));
    const p = people.find(x => x.email === email);
    const pane = $('custPane');
    pane.innerHTML = stateLoading(5);
    const [leads, purch, comms] = await Promise.all([
      db(`leads?select=*&email=ilike.${encodeURIComponent(email)}&order=created_at.desc`).catch(() => []),
      db(`purchase_history?select=*&email=ilike.${encodeURIComponent(email)}&order=purchase_date.desc`).catch(() => []),
      db(`communication_logs?select=*&lead_email=ilike.${encodeURIComponent(email)}&order=created_at.desc&limit=50`).catch(() => []),
    ]);

    pane.innerHTML = `
      <div class="card-head">
        <div class="avatar" style="width:40px;height:40px;font-size:14px">${esc(initials(p.name))}</div>
        <div style="flex:1"><div class="card-title">${esc(p.name || email)}
          ${p.is_vip ? '<span class="pill vip"><span class="dot"></span>Returning customer</span>' : ''}</div>
          <div class="card-sub">${esc(email)}${p.phone ? ' · ' + esc(p.phone) : ''}</div></div>
      </div>
      <div style="padding:20px">
        <div class="grid g4">
          ${kpi('Lifetime value', aed(p.lifetime_value_aed), `${num(p.purchase_count)} purchase${p.purchase_count === 1 ? '' : 's'}`)}
          ${kpi('Leads', num(p.lead_count), p.latest_status ? pill(p.latest_status) : '')}
          ${kpi('Best AI score', num(p.best_ai_score), '')}
          ${kpi('Messages', num(p.message_count), p.last_contact_at ? 'Last ' + ago(p.last_contact_at) : 'Never contacted')}
        </div>

        <div class="section" style="margin-top:24px">
          <div class="label-caps">Purchase history</div>
          ${purch.length ? purch.map(x => `<div class="quote" style="margin-top:8px">
            <strong>${esc(x.vehicle)}</strong> · ${aed(x.amount_aed)}
            <div class="cell-sub">${esc(x.purchase_date || '')}</div></div>`).join('')
            : `<div class="cell-sub" style="margin-top:8px">No purchases recorded.</div>`}
        </div>

        <div class="section">
          <div class="label-caps">Leads</div>
          ${leads.length ? `<div class="timeline" style="margin-top:8px">${leads.map(l => `
            <div class="tl-item"><span class="tl-dot" style="background:var(--${tone(l.status) || 'neutral'})"></span>
            <div class="tl-body"><div class="tl-meta">${ago(l.created_at)} · ${esc(l.source || '')}</div>
            <div>${esc(l.vehicle_interest || '—')} ${pill(l.status || 'NEW')}</div></div></div>`).join('')}</div>`
            : `<div class="cell-sub" style="margin-top:8px">No leads recorded.</div>`}
        </div>

        <div class="section">
          <div class="label-caps">Engagement</div>
          ${(p.total_emails != null || p.total_slack_messages != null)
            ? `<dl class="kv" style="margin-top:8px"><dt>Emails</dt><dd class="num">${num(p.total_emails)}</dd>
               <dt>Slack messages</dt><dd class="num">${num(p.total_slack_messages)}</dd></dl>`
            : noSource('The Customer 360 aggregation workflow runs nightly at 02:00 but has produced 0 rows. Email and Slack counts stay empty until it is fixed — the rest of this profile is live.')}
        </div>

        <div class="section">
          <div class="label-caps">Recent messages</div>
          ${comms.length ? `<div class="timeline" style="margin-top:8px">${comms.slice(0, 10).map(c => `
            <div class="tl-item"><span class="tl-dot"></span><div class="tl-body">
            <div class="tl-meta"><span class="chip">${esc(c.channel)}</span> ${esc(c.direction)} · ${ago(c.created_at)}</div>
            <div style="white-space:pre-wrap">${esc(String(c.message || '').slice(0, 240))}</div></div></div>`).join('')}</div>`
            : `<div class="cell-sub" style="margin-top:8px">No messages recorded.</div>`}
        </div>
      </div>`;
  }

  $('cq').addEventListener('input', e => list(e.target.value));
  list();
  open(people[0].email);
};

/* ==========================================================================
   S11 · Team
   ========================================================================== */
SCREENS.team = async host => {
  let team = [], leads = [];
  try {
    [team, leads] = await Promise.all([
      db('v_team_performance?select=*&order=leads_assigned.desc'),
      db('leads?select=id,response_time_minutes,assigned_to_id'),
    ]);
  } catch (e) { host.innerHTML = stateError('team performance', e.message); return; }

  const pending = team.filter(t => t.status === 'pending_invite');
  if (pending.length) {
    const b = el('div', 'banner warm');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">info</span>
      <div><strong>${pending.length} team member${pending.length > 1 ? 's have' : ' has'} no account yet.</strong>
      These names were recovered from lead assignments; their email addresses are unknown, so they are marked pending invite rather than being given invented addresses.</div>`;
    host.appendChild(b);
  }

  const unassigned = leads.filter(l => !l.assigned_to_id);
  const withResp = leads.filter(l => n0(l.response_time_minutes) != null);
  const avg = withResp.length ? withResp.reduce((a, l) => a + Number(l.response_time_minutes), 0) / withResp.length : null;
  const withinSla = withResp.filter(l => Number(l.response_time_minutes) <= 5).length;

  const strip = el('div', 'grid g4'); host.appendChild(strip);
  strip.innerHTML = [
    kpi('Team members', num(team.length), `${team.filter(t => t.status === 'online').length} with an account`),
    kpi('Avg response time', mins(avg),
      avg != null && avg > 5 ? '<span class="t-hot">The 5-minute rule is the founding promise of this product</span>' : '<span class="t-ok">Within SLA</span>'),
    kpi('Within the 5-minute rule', `${num(withinSla)} / ${num(withResp.length)}`, pct(withResp.length ? withinSla / withResp.length * 100 : 0)),
    kpi('Unassigned leads', num(unassigned.length), unassigned.length ? '<span class="t-hot">Nobody owns these</span>' : ''),
  ].join('');

  const card = el('div', 'card flush'); card.style.marginTop = '16px'; host.appendChild(card);
  card.innerHTML = `<div class="card-head"><div class="card-title">Roster &amp; performance</div></div><div id="tt"></div>`;
  card.querySelector('#tt').innerHTML = table([
    { label:'Name', strong:true, render: t => `<div style="display:flex;align-items:center;gap:10px">
        <div class="avatar">${esc(initials(t.name))}</div><div>${esc(t.name)}
        <div class="cell-sub">${esc(t.email || 'no email on file')}</div></div></div>` },
    { label:'Role', render: t => `<span class="chip">${esc(t.role || '—')}</span>` },
    { label:'Account', render: t => t.status === 'online' ? pill('Active','ok') : pill('Pending invite','warm') },
    { label:'Leads', align:'r', render: t => num(t.leads_assigned) },
    { label:'HOT', align:'r', render: t => num(t.hot_leads) },
    { label:'Avg response', align:'r', render: t => `<span class="${(n0(t.avg_response_minutes)||0) > 5 ? 't-hot' : 't-ok'}">${mins(t.avg_response_minutes)}</span>` },
    { label:'Within SLA', align:'r', render: t => `${num(t.within_sla)} / ${num((t.within_sla||0)+(t.breached_sla||0))}` },
    { label:'Pipeline', align:'r', render: t => aed(t.pipeline_aed) },
  ], team);

  const dist = el('div', 'card'); dist.style.marginTop = '16px'; host.appendChild(dist);
  const b = [[0,5,'Under 5 min','ok'],[6,15,'5–15 min','cold'],[16,60,'15–60 min','warm'],[61,99999,'Over 60 min','hot']];
  const counts = b.map(([lo,hi]) => withResp.filter(l => Number(l.response_time_minutes) >= lo && Number(l.response_time_minutes) <= hi).length);
  const tot = withResp.length || 1;
  dist.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Response-time distribution</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${b.map(([,, label, c], i) => `<div style="display:flex;align-items:center;gap:12px">
        <div style="width:110px;font-size:13px">${label}</div>
        <div class="bar" style="flex:1;height:10px"><i style="width:${(counts[i]/tot*100).toFixed(1)}%;background:var(--${c})"></i></div>
        <div class="num t-muted" style="width:40px;text-align:right">${counts[i]}</div>
      </div>`).join('')}
    </div>
    <div class="cell-sub" style="margin-top:12px">${withResp.length} of ${leads.length} leads have a recorded response time.</div>`;
};

/* ==========================================================================
   S12 · Settings
   ========================================================================== */
SCREENS.settings = async host => {
  const grid = el('div', 'grid g2'); host.appendChild(grid);

  const prof = el('div', 'card');
  prof.innerHTML = `<div class="card-title" style="margin-bottom:12px">Profile</div>
    <dl class="kv">
      <dt>Signed in as</dt><dd>${esc(SESSION?.user?.email || '—')}</dd>
      <dt>Name</dt><dd>${esc(ME?.name || '—')}</dd>
      <dt>Role</dt><dd>${esc(ME?.role || '—')}</dd>
      <dt>User id</dt><dd class="mono">${esc(SESSION?.user?.id || '—')}</dd>
    </dl>
    <div class="cell-sub" style="margin-top:12px">Password changes are handled by Supabase Auth, not by this dashboard.</div>`;
  grid.appendChild(prof);

  const integ = el('div', 'card');
  integ.innerHTML = `<div class="card-title" style="margin-bottom:4px">Integrations</div>
    <div class="card-sub" style="margin-bottom:12px">Credentials live in n8n and the server environment</div>
    <div id="setIntg">${stateLoading(2)}</div>
    <div class="banner info" style="margin-top:16px">
      <span class="material-symbols-outlined" style="font-size:20px">lock</span>
      <div>API keys are never displayed or accepted here, masked or otherwise. A dashboard that can show a key is a dashboard that can leak one.</div>
    </div>`;
  grid.appendChild(integ);

  const kb = el('div', 'card flush'); kb.style.marginTop = '16px'; host.appendChild(kb);
  kb.innerHTML = `<div class="card-head"><div><div class="card-title">Knowledge base</div>
    <div class="card-sub">What Ask AI is allowed to answer from</div></div></div><div id="kbBody">${stateLoading(3)}</div>`;

  const prefs = el('div', 'card'); prefs.style.marginTop = '16px'; host.appendChild(prefs);
  prefs.innerHTML = `<div class="card-title" style="margin-bottom:12px">Appearance</div>
    <div class="field" style="max-width:280px"><label for="density">Table density</label>
      <select id="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div>`;
  const dsel = $('density');
  dsel.value = localStorage.getItem('nexus.density') || 'comfortable';
  applyDensity();
  dsel.addEventListener('change', () => { localStorage.setItem('nexus.density', dsel.value); applyDensity(); });

  renderIntegrations($('setIntg'));

  try {
    const docs = await db('rag_documents?select=doc_title,section,source_file,page_number&order=doc_title');
    const byTitle = docs.reduce((m, d) => { (m[d.doc_title] ||= []).push(d); return m; }, {});
    $('kbBody').innerHTML = Object.keys(byTitle).length ? Object.entries(byTitle).map(([t, secs]) => `
      <div class="list-item" style="cursor:default;align-items:flex-start">
        <span class="material-symbols-outlined t-muted" style="font-size:20px">description</span>
        <div style="flex:1"><div style="font-weight:500">${esc(t)}</div>
          <div class="cell-sub">${secs.length} section${secs.length === 1 ? '' : 's'} · ${esc(secs[0].source_file || 'no source file')}</div></div>
      </div>`).join('') : stateEmpty('No documents indexed', 'Ask AI has nothing to answer from until a document is added.', 'description');
  } catch (e) { $('kbBody').innerHTML = stateError('the knowledge base', e.message); }
};

function applyDensity() {
  document.body.classList.toggle('compact', (localStorage.getItem('nexus.density') || 'comfortable') === 'compact');
}

/* ==========================================================================
   Auth + boot
   ========================================================================== */
function renderLogin(msg) {
  $('boot').classList.remove('hide');
  $('app').classList.add('hide');
  $('boot').innerHTML = `
    <div class="card login-card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
        <div class="brand-mark">N</div><div class="brand-name">NEXUS OS</div>
      </div>
      ${msg ? `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span><div>${esc(msg)}</div></div>` : ''}
      <div class="grid" style="gap:14px">
        <div class="field"><label for="li">Email</label><input type="email" id="li" autocomplete="username" /></div>
        <div class="field"><label for="lp">Password</label><input type="password" id="lp" autocomplete="current-password" /></div>
        <button class="btn primary" id="lgo">Sign in</button>
      </div>
      <div class="cell-sub" style="margin-top:14px">Accounts are managed in Supabase Auth.</div>
    </div>`;
  const go2 = async () => {
    const btn = $('lgo'); btn.disabled = true; btn.textContent = 'Signing in…';
    const { error } = await supabase.auth.signInWithPassword({ email: $('li').value.trim(), password: $('lp').value });
    if (error) { renderLogin(error.message); return; }
    boot();
  };
  $('lgo').addEventListener('click', go2);
  $('lp').addEventListener('keydown', e => { if (e.key === 'Enter') go2(); });
}

async function boot() {
  if (envErrors.length) {
    $('boot').innerHTML = `<div class="card login-card">
      <h2 style="font-size:16px;margin-bottom:10px">Configuration problem</h2>
      ${envErrors.map(e => `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span><div>${esc(e)}</div></div>`).join('')}
      <div class="cell-sub">Fix these environment variables in Vercel, then redeploy.</div></div>`;
    return;
  }

  const { data } = await supabase.auth.getSession();
  SESSION = data.session;
  if (!SESSION) { renderLogin(); return; }

  ME = await db(`users?select=*&email=eq.${encodeURIComponent(SESSION.user.email)}`).then(r => r[0]).catch(() => null);

  $('boot').classList.add('hide');
  $('app').classList.remove('hide');
  $('userInitials').textContent = initials(ME?.name || SESSION.user.email);
  $('userName').textContent = ME?.name || SESSION.user.email;
  $('userRole').textContent = ME?.role || 'signed in';

  buildNav();
  applyDensity();
  $('signOutBtn').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });
  $('refreshBtn').addEventListener('click', () => go(current));
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== current) go(h); });

  const conn = $('connState');
  db('leads?select=id&limit=1')
    .then(() => { conn.className = 'pill ok'; conn.innerHTML = '<span class="dot"></span>Live'; })
    .catch(e => { conn.className = 'pill hot'; conn.innerHTML = `<span class="dot"></span>${esc(String(e.message).slice(0,40))}`; });

  go(location.hash.slice(1) || 'overview');
}

boot();
