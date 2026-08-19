/* NEXUS OS — screens/leads.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, esc, n0, pill, tone } from '../lib/format.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { table, wireRows } from '../lib/ui.js';

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
