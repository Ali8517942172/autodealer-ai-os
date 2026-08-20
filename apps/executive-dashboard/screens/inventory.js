/* NEXUS OS — screens/inventory.js
   Split out of the original monolithic app.js on 17 Aug 2026, then reworked on
   19 Aug 2026 into a lot-management view: filter by status and ageing alert,
   sort by days in stock and by margin, and totals that describe the rows
   actually on screen rather than the whole table.

   The write path is untouched. Create, edit and delete all still go through
   unitForm() in lib/unit-form.js — it is the only writer in the product and
   this screen only ever calls it and reloads. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, esc, n0, num, pill } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';
import { INV, deriveUnit, unitForm } from '../lib/unit-form.js';

const low = s => String(s == null ? '' : s).toLowerCase();
const up = s => String(s == null ? '' : s).toUpperCase();
const isSold = u => low(u.status) === 'sold';

/* A unit with neither a list price nor a cost has no margin — it has a missing
   record. deriveUnit() has to return a number for those columns, so it returns
   zero; showing "AED 0" would read as a break-even car. They render as "—" and
   sort to the bottom of both margin orders instead. */
const priced = u => n0(u.price_aed) != null || n0(u.cost_aed) != null;

const ALERTS = ['CRITICAL', 'WARNING', 'HEALTHY'];
const ALERT_TONE = { CRITICAL: 'hot', WARNING: 'warm', HEALTHY: 'ok' };
const ALERT_WHY = {
  CRITICAL: `${INV.CRITICAL_DAYS} days or more on the lot`,
  WARNING: `${INV.WARN_DAYS}–${INV.CRITICAL_DAYS - 1} days on the lot`,
  HEALTHY: `under ${INV.WARN_DAYS} days on the lot, or already sold`,
};

const SORTS = {
  days_desc: 'Longest in stock',
  days_asc: 'Newest in stock',
  margin_asc: 'Worst net margin',
  margin_desc: 'Best net margin',
  holding_desc: 'Highest holding cost',
};

/* Sums the rows that actually carry the figure and reports how many did. A
   total over four of nine rows is a different fact from a total over nine. */
function sum(rows, pick) {
  let total = 0, n = 0;
  for (const r of rows) { const v = n0(pick(r)); if (v != null) { total += v; n += 1; } }
  return { total: n ? total : null, n, of: rows.length };
}

SCREENS.inventory = async host => {
  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const body = el('div'); body.style.marginTop = '16px'; host.appendChild(body);
  body.innerHTML = `<div class="card flush">${stateLoading(8)}</div>`;

  let raw = [];
  try { raw = await db('inventory?select=*&order=acquired_at.asc&limit=1000'); }
  catch (e) {
    strip.remove();
    body.innerHTML = `<div class="card">${stateError('inventory', e.message, 'inventory')}</div>`;
    body.querySelector('[data-retry]')?.addEventListener('click', () => go('inventory'));
    return;
  }

  /* Derived live from acquired_at rather than read off the stored columns, so the
     aging numbers are true on the day you look at them, not on the day they were written. */
  const inv = raw.map(deriveUnit);
  const reload = () => go('inventory');

  const addBtn = (id, cls = 'btn primary sm') => `<button class="${cls}" id="${id}">
    <span class="material-symbols-outlined">add</span>Add vehicle</button>`;

  if (!inv.length) {
    strip.remove();
    body.innerHTML = `<div class="card flush">
      <div class="card-head"><div><div class="card-title">Stock</div>
        <div class="card-sub">Nothing on the lot yet</div></div>
        <div style="flex:1"></div>${addBtn('invAdd')}</div>
      ${stateEmpty('No vehicles in stock',
        'Add the first unit to start tracking days in stock, holding cost and margin.', 'directions_car')}</div>`;
    $('invAdd').addEventListener('click', () => unitForm(null, inv, reload));
    return;
  }

  /* Filter vocabularies come from the rows, not from a hardcoded list — a status
     the ERP wrote that nobody here expected must still be selectable. */
  const statuses = [...new Set(inv.map(u => String(u.status || '').trim()).filter(Boolean))]
    .sort((a, b) => {
      const ia = INV.STATUSES.findIndex(s => low(s) === low(a));
      const ib = INV.STATUSES.findIndex(s => low(s) === low(b));
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.localeCompare(b);
    });
  const alertCount = a => inv.filter(u => up(u.aging_alert) === a).length;
  const crit = alertCount('CRITICAL');
  const warn = alertCount('WARNING');

  const f = { status: 'ALL', alert: 'ALL', q: '', sort: 'days_desc' };

  function visible() {
    const q = f.q.trim().toLowerCase();
    return inv.filter(u => {
      if (f.status !== 'ALL' && low(u.status) !== low(f.status)) return false;
      if (f.alert !== 'ALL' && up(u.aging_alert) !== f.alert) return false;
      if (q && ![u.id, u.model, u.vin].map(low).join(' ').includes(q)) return false;
      return true;
    });
  }

  /* Rows the sort key cannot speak about (no acquisition date, no price at all)
     go to the bottom in stock-number order rather than being ranked as if they
     were the oldest or the least profitable unit on the lot. */
  function sorted(rows) {
    const key = f.sort.startsWith('days') ? (r => n0(r.days_in_stock))
      : f.sort.startsWith('holding') ? (r => n0(r.holding_cost_accrued))
        : (r => (priced(r) ? n0(r.net_margin) : null));
    const dir = f.sort.endsWith('_asc') ? 1 : -1;
    const known = rows.filter(r => key(r) != null).sort((a, b) => dir * (key(a) - key(b)));
    const unknown = rows.filter(r => key(r) == null)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return known.concat(unknown);
  }

  /* Only the three statuses this product defines get a coloured pill. Anything
     else the ERP wrote is shown verbatim as a plain chip — tone() would read
     "HOT" as a hot-lead pill and paint an unknown status red. */
  const statusPill = r => {
    const s = String(r.status || '').trim();
    if (!s) return '<span class="t-muted">—</span>';
    if (isSold(r)) return pill(s, 'ok');
    if (low(s) === 'reserved') return pill(s, 'cold');
    if (low(s) === 'available') return pill(s);   // neutral, as it was
    return `<span class="chip">${esc(s)}</span>`;
  };
  const alertPill = r => {
    const a = up(r.aging_alert);
    return ALERTS.includes(a)
      ? `<span title="${esc(ALERT_WHY[a])}">${pill(a, ALERT_TONE[a])}</span>`
      : '<span class="t-muted">—</span>';
  };
  const marginCell = (r, field) => (priced(r)
    ? `<span class="${(n0(r[field]) || 0) < 0 ? 't-hot' : ''}">${aed(r[field])}</span>`
    : `<span class="t-muted" title="This unit has neither a list price nor a cost on record, so no margin can be derived.">—</span>`);

  const cols = [
    {
      label: 'Vehicle', strong: true, render: r => {
        const a = up(r.aging_alert);
        const flag = a === 'CRITICAL' || a === 'WARNING'
          ? `<span class="material-symbols-outlined t-${ALERT_TONE[a]}" style="font-size:16px;vertical-align:-3px;margin-right:4px"
               title="${esc(a)} — ${esc(ALERT_WHY[a])}" aria-hidden="true">warning</span>` : '';
        return `${flag}${esc(r.model || 'Unnamed unit')}
          <div class="cell-sub mono">${esc(r.id)}${r.vin ? ' · ' + esc(r.vin) : ''}</div>`;
      }
    },
    { label: 'Status', render: statusPill },
    {
      label: 'Days', align: 'r', render: r => {
        const d = n0(r.days_in_stock);
        if (d == null) return '<span class="t-muted" title="No acquisition date on record.">—</span>';
        const t = ALERT_TONE[up(r.aging_alert)] || 'cold';
        const w = Math.max(2, Math.min(100, (d / INV.CRITICAL_DAYS) * 100));
        /* deriveUnit() counts from acquired_at whether or not the unit sold, so a
           sold car keeps ticking. Say so rather than letting it read as lot age. */
        const why = isSold(r)
          ? `${num(d)} days since acquisition — sold, so it no longer accrues holding cost`
          : `${num(d)} of ${INV.CRITICAL_DAYS} days to critical`;
        return `<div class="t-${t}" style="font-weight:500">${num(d)}</div>
                <div class="bar" style="width:56px;margin-left:auto"
                     title="${esc(why)}"><i style="width:${w.toFixed(0)}%;background:var(--${t})"></i></div>`;
      }
    },
    { label: 'Price', align: 'r', render: r => aed(r.price_aed) },
    { label: 'Gross margin', align: 'r', render: r => marginCell(r, 'gross_margin') },
    {
      label: 'Holding cost', align: 'r', render: r => {
        const h = n0(r.holding_cost_accrued);
        if (h == null) return '<span class="t-muted">—</span>';
        const eats = priced(r) && n0(r.gross_margin) != null && h > (n0(r.gross_margin) || 0);
        return `<span class="${eats ? 't-hot' : ''}"${eats ? ' title="Holding cost has overtaken this unit\'s gross margin."' : ''}>${aed(h)}</span>`;
      }
    },
    { label: 'Net margin', align: 'r', strong: true, render: r => marginCell(r, 'net_margin') },
    { label: 'Commission', align: 'r', render: r => (priced(r) ? aed(r.recommended_commission) : '<span class="t-muted">—</span>') },
    { label: 'Alert', render: alertPill },
  ];

  /* ── Chrome. Everything below the toolbar is repainted by draw(). ───────── */
  const banner = crit || warn ? `<div class="banner ${crit ? 'hot' : 'warm'}" style="margin:14px 20px 0">
      <span class="material-symbols-outlined">warning</span>
      <div style="flex:1">${crit ? `${num(crit)} unit${crit === 1 ? '' : 's'} past ${INV.CRITICAL_DAYS} days` : ''}${crit && warn ? ' · ' : ''}${warn ? `${num(warn)} past ${INV.WARN_DAYS} days` : ''}
        — each one accrues ${aed(INV.HOLDING_PER_DAY)} a day against its margin.</div>
      <button class="btn sm" id="invFocus">Show ${crit ? 'critical' : 'warning'} only</button>
    </div>` : '';

  const card = el('div', 'card flush');
  card.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="segAlert" role="group" aria-label="Filter by ageing alert">
        ${[['ALL', inv.length], ...ALERTS.map(a => [a, alertCount(a)])]
      .map(([k, c]) => `<button data-v="${k}" title="${esc(k === 'ALL' ? 'Every unit' : ALERT_WHY[k])}">${k === 'ALL' ? 'All' : k[0] + k.slice(1).toLowerCase()} · ${c}</button>`).join('')}
      </div>
      <div class="grow"><input type="search" id="invQ" aria-label="Search stock"
        placeholder="Search model, stock number or VIN" /></div>
      <select id="invStatus" aria-label="Filter by status" style="width:auto">
        <option value="ALL">All statuses</option>
        ${statuses.map(s => `<option value="${esc(s)}">${esc(s)} · ${inv.filter(u => low(u.status) === low(s)).length}</option>`).join('')}
      </select>
      <select id="invSort" aria-label="Sort stock" style="width:auto">
        ${Object.entries(SORTS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
      </select>
      <div class="t-muted num" id="invCount"></div>
      ${addBtn('invAdd')}
    </div>
    ${banner}
    <div id="invAging"></div>
    <div id="invTable"></div>`;
  body.innerHTML = '';
  body.appendChild(card);

  function paintTotals(rows) {
    const onLot = rows.filter(u => !isSold(u));
    const soldShown = rows.length - onLot.length;
    const value = sum(onLot, u => u.price_aed);
    const hold = sum(rows, u => u.holding_cost_accrued);
    const age = sum(onLot, u => u.days_in_stock);
    const shownCrit = rows.filter(u => up(u.aging_alert) === 'CRITICAL').length;
    const shownWarn = rows.filter(u => up(u.aging_alert) === 'WARNING').length;
    const byStatus = statuses
      .map(s => `${rows.filter(u => low(u.status) === low(s)).length} ${low(s)}`).join(' · ');

    strip.innerHTML = [
      kpi('Units shown', num(rows.length),
        `of ${num(inv.length)} in stock${byStatus ? ' · ' + esc(byStatus) : ''}`),
      kpi('Stock value', aed(value.total),
        value.n ? `Listed price of ${num(value.n)} unsold unit${value.n === 1 ? '' : 's'} shown${soldShown ? ` · ${num(soldShown)} sold excluded` : ''}`
          : 'No unsold unit in this view carries a list price'),
      kpi('Holding cost accrued', aed(hold.total),
        hold.n ? `${aed(INV.HOLDING_PER_DAY)} per unit per day · ${num(hold.n)} of ${num(hold.of)} rows shown`
          : 'No row in this view carries a holding figure'),
      kpi('Average days in stock', age.n ? num(age.total / age.n) : '—',
        age.n ? `Across ${num(age.n)} unsold unit${age.n === 1 ? '' : 's'} shown` : 'No dated unsold unit in this view'),
      kpi('Ageing alerts', num(shownCrit), `${num(shownWarn)} warning · ${num(rows.length - shownCrit - shownWarn)} healthy`,
        shownCrit ? 't-hot' : ''),
    ].join('');
  }

  /* Bands are the product's own thresholds, not decorative buckets: the split
     is exactly where WARNING and CRITICAL are raised. */
  function paintAging(rows) {
    const onLot = rows.filter(u => !isSold(u) && n0(u.days_in_stock) != null);
    const host2 = $('invAging');
    if (!onLot.length) {
      host2.innerHTML = `<div style="padding:14px 20px 0"><div class="cell-sub">No dated unsold unit in this view, so there is no ageing spread to show.</div></div>`;
      return;
    }
    const bands = [
      { a: 'HEALTHY', label: `0–${INV.WARN_DAYS - 1} d`, tone: 'ok' },
      { a: 'WARNING', label: `${INV.WARN_DAYS}–${INV.CRITICAL_DAYS - 1} d`, tone: 'warm' },
      { a: 'CRITICAL', label: `${INV.CRITICAL_DAYS}+ d`, tone: 'hot' },
    ].map(b => ({ ...b, n: onLot.filter(u => up(u.aging_alert) === b.a).length }));
    host2.innerHTML = `<div style="padding:16px 20px 4px">
      <div class="label-caps" style="margin-bottom:10px">Days in stock · ${num(onLot.length)} unsold unit${onLot.length === 1 ? '' : 's'} shown</div>
      <div class="stackbar">${bands.filter(b => b.n)
        .map(b => `<i style="width:${(b.n / onLot.length * 100).toFixed(1)}%;background:var(--${b.tone})" title="${esc(b.a)} · ${b.n}"></i>`).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        ${bands.map(b => `<button class="btn ghost sm" data-band="${b.a}"
          aria-label="Show only ${esc(b.a.toLowerCase())} units — ${esc(ALERT_WHY[b.a])}"
          title="${esc(ALERT_WHY[b.a])}"${b.n ? '' : ' disabled'}>
          <span style="width:8px;height:8px;border-radius:50%;background:var(--${b.tone})"></span>
          ${esc(b.label)}<span class="t-muted num">${b.n}</span></button>`).join('')}
      </div></div>`;
    host2.querySelectorAll('button[data-band]').forEach(b => b.addEventListener('click', () => {
      f.alert = f.alert === b.dataset.band ? 'ALL' : b.dataset.band;
      draw();
    }));
  }

  function drawer(unit) {
    const d = n0(unit.days_in_stock);
    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1"><h2 style="font-size:18px">${esc(unit.model || 'Unnamed unit')}</h2>
          <div class="cell-sub mono">${esc(unit.id)}${unit.vin ? ' · ' + esc(unit.vin) : ''}</div></div>
        <button class="btn ghost sm" id="dClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${statusPill(unit)}${alertPill(unit)}
          <span class="chip">${d == null ? 'No acquisition date' : `${num(d)} days in stock`}</span>
        </div>
        ${up(unit.aging_alert) === 'CRITICAL' || up(unit.aging_alert) === 'WARNING' ? `<div class="banner ${ALERT_TONE[up(unit.aging_alert)]}">
          <span class="material-symbols-outlined">warning</span>
          <div>${esc(ALERT_WHY[up(unit.aging_alert)])}. Holding cost so far is ${aed(unit.holding_cost_accrued)} and grows by ${aed(INV.HOLDING_PER_DAY)} a day while it stays on the lot.</div></div>` : ''}
        <div class="section"><div class="label-caps">AI recommendation</div>
          <div class="quote" style="margin-top:8px">${esc(unit.ai_recommendation || 'No recommendation generated for this unit.')}</div></div>
        <div class="section"><div class="label-caps">Financials</div>
          <dl class="kv" style="margin-top:8px">
            <dt>List price</dt><dd class="num">${aed(unit.price_aed)}</dd>
            <dt>Cost</dt><dd class="num">${aed(unit.cost_aed)}</dd>
            <dt>Gross margin</dt><dd class="num">${marginCell(unit, 'gross_margin')}</dd>
            <dt>Holding cost</dt><dd class="num">${aed(unit.holding_cost_accrued)}</dd>
            <dt>Net margin</dt><dd class="num"><strong>${marginCell(unit, 'net_margin')}</strong></dd>
            <dt>VAT</dt><dd class="num">${aed(unit.vat_amount)}</dd>
            <dt>Recommended commission</dt><dd class="num">${priced(unit) ? aed(unit.recommended_commission) : '<span class="t-muted">—</span>'}</dd>
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
  }

  function draw() {
    card.querySelectorAll('#segAlert button').forEach(b => b.classList.toggle('on', b.dataset.v === f.alert));
    $('invStatus').value = f.status;
    $('invSort').value = f.sort;

    const rows = sorted(visible());
    $('invCount').textContent = `${rows.length} of ${inv.length} units`;
    paintTotals(rows);
    paintAging(rows);

    const th = $('invTable');
    th.innerHTML = table(cols, rows, {
      onRow: true,
      empty: `${stateEmpty('No vehicles match these filters',
        'Clear the search or widen the status and ageing filters to see stock again.', 'search_off')}
        <div style="text-align:center;padding:0 20px 32px">
          <button class="btn" id="invClear">Clear filters</button></div>`,
    });
    wireRows(th, rows, drawer);
    $('invClear')?.addEventListener('click', () => {
      f.status = 'ALL'; f.alert = 'ALL'; f.q = ''; $('invQ').value = ''; draw();
    });
  }

  card.querySelectorAll('#segAlert button').forEach(b =>
    b.addEventListener('click', () => { f.alert = b.dataset.v; draw(); }));
  $('invQ').addEventListener('input', e => { f.q = e.target.value; draw(); });
  $('invStatus').addEventListener('change', e => { f.status = e.target.value; draw(); });
  $('invSort').addEventListener('change', e => { f.sort = e.target.value; draw(); });
  $('invAdd').addEventListener('click', () => unitForm(null, inv, reload));
  $('invFocus')?.addEventListener('click', () => { f.alert = crit ? 'CRITICAL' : 'WARNING'; draw(); });

  draw();
};

/* ==========================================================================
   S5 · Competitors
   ========================================================================== */
