/* NEXUS OS — screens/inventory.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, esc, n0, num, pill } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';
import { INV, deriveUnit, unitForm } from '../lib/unit-form.js';

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
