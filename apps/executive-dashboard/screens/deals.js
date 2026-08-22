/* NEXUS OS — screens/deals.js
   Closed-won revenue, and the vector memory that is supposed to be built from
   it. Two separate stories that this screen deliberately keeps separate:

     · purchase_history  — the money. Every recorded deal, what it was worth,
       and (where the columns exist) what it cost and what was made on it.
     · deals_embeddings  — what Ask AI can actually cite. It is written *only*
       by the Closed-Won workflow, never by this browser, so it can and does
       fall behind purchase_history. When it has no rows at all the screen says
       so in words; a silent zero next to a healthy revenue figure would read
       as "nothing to embed" rather than "the memory is empty".

   Recording a deal posts to n8n('deals/closed-won') via lib/deal-form.js. That
   round trip is what produces the embedding — a row written straight into
   purchase_history from here would be invisible to Ask AI forever. One write
   path, one source of truth.

   purchase_history is not in SCHEMA.md column by column, and the deployed table
   has grown columns at different times, so every money and date field is
   resolved against the keys the rows actually came back with. A figure whose
   column is absent is not estimated and not substituted — the tile says which
   column it wanted. */
import { db } from '../lib/data.js';
import { dealForm } from '../lib/deal-form.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, esc, n0, num, pct, pill } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';

/* Both reads are capped, and both caps are disclosed when they are hit. A
   capped deal list that quietly claims to be lifetime revenue is the worst
   possible number on this screen; a capped vector read would mark genuinely
   embedded deals as missing, so the label changes wording when it is capped
   rather than asserting something it cannot know. */
const DEAL_LIMIT = 1000;
const VEC_LIMIT = 500;
const VEC_SHOWN = 50;
const TREND_MONTHS = 12;

/* No endpoint re-sends one existing deal to the embedder. deals_embeddings is
   service-role only and the Closed-Won webhook takes a whole deal record, not
   a purchase_history id, so the honest control is a disabled one that says
   exactly what is missing. */
const NO_REEMBED =
  'There is no re-embed endpoint. deals_embeddings is written only by the Closed-Won workflow and is service-role only, so the browser cannot push an existing row into the vector store. Recording the deal again through "Record a deal" does re-send it, but this screen cannot pre-fill that form without a change to lib/deal-form.js.';

/* ── Column resolution ───────────────────────────────────────────────────── */
const CANDIDATES = {
  amount:   ['amount_aed', 'sale_price_aed', 'price_aed', 'deal_value_aed', 'total_aed'],
  cost:     ['cost_price_aed', 'cost_aed', 'vehicle_cost_aed', 'purchase_cost_aed', 'acquisition_cost_aed'],
  margin:   ['gross_margin_aed', 'margin_aed', 'gross_profit_aed', 'profit_aed', 'net_margin'],
  date:     ['purchase_date', 'closed_at', 'sold_at', 'created_at'],
  customer: ['customer_name', 'lead_name', 'name', 'full_name'],
  email:    ['email', 'lead_email', 'customer_email'],
  vehicle:  ['vehicle', 'vehicle_interest', 'vehicle_name', 'model'],
  phone:    ['phone', 'lead_phone', 'mobile'],
};

const lower = v => String(v ?? '').trim().toLowerCase();
const day10 = v => String(v ?? '').slice(0, 10);

function resolveColumns(rows) {
  const keys = new Set();
  rows.forEach(r => Object.keys(r || {}).forEach(k => keys.add(k)));
  const out = { _keys: [...keys].sort() };
  for (const [role, list] of Object.entries(CANDIDATES)) out[role] = list.find(c => keys.has(c)) || null;
  return out;
}

/* A month bucket from a date-only column and from a timestamp are the same
   slice, and slicing is deliberate: parsing "2026-08-01" into a Date and
   reading it back locally moves a deal into July for anyone west of UTC. */
const monthOf = v => (/^\d{4}-\d{2}/.test(String(v ?? '')) ? String(v).slice(0, 7) : null);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = m => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1] || m.slice(5, 7)} ${m.slice(0, 4)}`;
const stamp = v => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? t : null; };

const SORTS = {
  new:  'Newest close first',
  old:  'Oldest close first',
  high: 'Largest deal first',
  low:  'Smallest deal first',
  name: 'Customer A–Z',
};
const PERIODS = [['ALL', 'All time'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']];

SCREENS.deals = async host => {
  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const banners = el('div'); banners.style.marginTop = '16px'; host.appendChild(banners);

  const mid = el('div', 'grid g2 top'); mid.style.marginTop = '16px'; host.appendChild(mid);
  const trendCard = el('div', 'card'); trendCard.innerHTML = stateLoading(5); mid.appendChild(trendCard);
  const repeatCard = el('div', 'card flush'); repeatCard.innerHTML = stateLoading(5); mid.appendChild(repeatCard);

  const listCard = el('div', 'card flush'); listCard.style.marginTop = '16px';
  listCard.innerHTML = stateLoading(8); host.appendChild(listCard);
  const vecCard = el('div', 'card flush'); vecCard.style.marginTop = '16px';
  vecCard.innerHTML = stateLoading(4); host.appendChild(vecCard);

  /* allSettled, not catch(() => []). "The vector store is empty" and "the
     vector store could not be read" are opposite answers on this screen, and a
     swallowed error turns the second into the first. */
  const [dealsR, vecR, leadsR] = await Promise.allSettled([
    /* purchase_date is the close date on the deployed table, but it is not
       guaranteed by SCHEMA.md — if ordering on it is rejected, read the table
       unordered and sort in the browser, which this screen does anyway. */
    db(`purchase_history?select=*&order=purchase_date.desc&limit=${DEAL_LIMIT}`)
      .catch(() => db(`purchase_history?select=*&limit=${DEAL_LIMIT}`)),
    db(`deals_embeddings?select=id,deal_id,content,created_at&order=created_at.desc&limit=${VEC_LIMIT}`),
    db('leads?select=id,name,email,phone,vehicle_interest,budget_aed,status&order=created_at.desc&limit=1000'),
  ]);

  const deals    = dealsR.status === 'fulfilled' ? dealsR.value : null;
  const dealsErr = dealsR.status === 'rejected' ? (dealsR.reason?.message || 'Unknown error') : null;
  const vectors  = vecR.status === 'fulfilled' ? vecR.value : null;
  const vecErr   = vecR.status === 'rejected' ? (vecR.reason?.message || 'Unknown error') : null;
  const leads    = leadsR.status === 'fulfilled' ? leadsR.value : [];
  const leadsErr = leadsR.status === 'rejected' ? (leadsR.reason?.message || 'Unknown error') : null;

  const col = resolveColumns(deals || []);
  const get  = (row, role) => (col[role] ? row[col[role]] : null);
  const amountOf = row => (col.amount ? n0(row[col.amount]) : null);
  const dateOf   = row => (col.date ? row[col.date] : null);
  const nameOf   = row => get(row, 'customer');
  const emailOf  = row => get(row, 'email');

  /* Margin is taken from a margin column when the table has one. Otherwise it
     is amount − cost, and only when BOTH sides are present on that row —
     never amount alone, which would report the whole sale price as profit. */
  const marginOf = row => {
    if (col.margin) { const m = n0(row[col.margin]); if (m != null) return m; }
    if (col.amount && col.cost) {
      const a = n0(row[col.amount]), c = n0(row[col.cost]);
      if (a != null && c != null) return a - c;
    }
    return null;
  };
  const marginSource = col.margin
    ? `<span class="mono">${esc(col.margin)}</span>`
    : (col.amount && col.cost)
      ? `<span class="mono">${esc(col.amount)}</span> − <span class="mono">${esc(col.cost)}</span>`
      : null;

  const dealsCapped = !!deals && deals.length >= DEAL_LIMIT;
  const vecCapped = !!vectors && vectors.length >= VEC_LIMIT;

  /* ── Vector matching ──────────────────────────────────────────────────────
     The Closed-Won workflow derives `auto:<email>|<closed_at>` when the caller
     supplies no deal_id, and closed_at arrives as a full ISO timestamp while
     the deal row stores a date. Comparing the ids whole would never match and
     every row would claim "Not embedded" forever — a status column that is
     always wrong is worse than no column. Match on an explicit id first, then
     fall back to the email and the calendar day. */
  const dayKey = (email, when) => `${lower(email)}|${day10(when)}`;
  const byId = new Map(), byDay = new Map();
  (vectors || []).forEach(v => {
    const id = String(v.deal_id ?? '');
    if (id && !byId.has(id)) byId.set(id, v);
    const m = /^auto:([^|]+)\|(.+)$/.exec(id);
    if (m) { const k = dayKey(m[1], m[2]); if (!byDay.has(k)) byDay.set(k, v); }
  });
  const usedVectors = new Set();
  const vectorFor = row => {
    if (!vectors) return null;
    for (const c of [row.deal_id, row.id]) {
      const s = c == null ? '' : String(c);
      if (s && byId.has(s)) return byId.get(s);
    }
    const k = dayKey(emailOf(row), dateOf(row));
    return byDay.get(k) || null;
  };
  (deals || []).forEach(d => { const v = vectorFor(d); if (v) usedVectors.add(v); });
  const orphanVectors = (vectors || []).filter(v => !usedVectors.has(v));
  const embeddedCount = (deals || []).filter(d => vectorFor(d)).length;

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  if (!deals) {
    strip.classList.remove('grid', 'g5');
    strip.innerHTML = stateError('closed-won deals', dealsErr);
  } else {
    const amounts = deals.map(amountOf).filter(x => x != null);
    const revenue = amounts.reduce((a, b) => a + b, 0);
    const withMargin = deals.filter(d => marginOf(d) != null);
    const marginTotal = withMargin.reduce((a, d) => a + marginOf(d), 0);
    /* The margin percentage is taken against the revenue of the same rows the
       margin came from. Dividing by total revenue would silently understate it
       whenever a deal has an amount but no cost. */
    const marginBase = withMargin.map(amountOf).filter(x => x != null).reduce((a, b) => a + b, 0);
    const stamps = deals.map(d => stamp(dateOf(d))).filter(x => x != null).sort((a, b) => a - b);

    strip.innerHTML = [
      kpi('Deals closed', num(deals.length),
        deals.length
          ? (stamps.length
              ? `<span class="t-muted">Oldest ${esc(ago(stamps[0]))} · newest ${esc(ago(stamps[stamps.length - 1]))}</span>`
              : '<span class="t-muted">No readable close date on any row</span>')
            + (dealsCapped ? `<br><span class="t-warm">Capped at the ${num(DEAL_LIMIT)} most recent — older deals are not counted here</span>` : '')
          : 'Nothing recorded in purchase_history yet'),

      kpi('Revenue', col.amount ? aed(revenue) : '—',
        col.amount
          ? `<span class="t-muted">From ${num(amounts.length)} of ${num(deals.length)} deals · column <span class="mono">${esc(col.amount)}</span></span>`
          : `<span class="t-warm">purchase_history has no amount column (looked for ${CANDIDATES.amount.map(c => `<span class="mono">${esc(c)}</span>`).join(', ')})</span>`),

      kpi('Average deal', amounts.length ? aed(revenue / amounts.length) : '—',
        amounts.length
          ? `<span class="t-muted">Mean over the ${num(amounts.length)} deal${amounts.length === 1 ? '' : 's'} that carry an amount</span>`
          : '<span class="t-muted">No deal carries a readable amount, so there is no average to take</span>'),

      kpi('Gross margin', withMargin.length ? aed(marginTotal) : '—',
        withMargin.length
          ? `<span class="t-muted">${marginSource} · from ${num(withMargin.length)} of ${num(deals.length)} deals${
              marginBase > 0 ? ` · ${esc(pct(marginTotal / marginBase * 100))} of their revenue` : ''}</span>`
          : `<span class="t-muted">No margin recorded. purchase_history carries neither a margin column (${
              CANDIDATES.margin.map(c => `<span class="mono">${esc(c)}</span>`).join(', ')}) nor an amount and a cost column to subtract.</span>`),

      kpi('In vector memory', vecErr ? '—' : num(vectors.length),
        vecErr
          ? `<span class="t-hot">deals_embeddings could not be read — ${esc(vecErr)}</span>`
          : vectors.length
            ? `<span class="t-muted">${num(embeddedCount)} of ${num(deals.length)} recorded deals matched to a vector row</span>`
            : '<span class="t-hot">deals_embeddings has no rows — Ask AI cannot cite a single recorded deal</span>',
        (!vecErr && !vectors.length) || vecErr ? 't-hot' : ''),
    ].join('');
  }

  /* ── Banners ───────────────────────────────────────────────────────────── */
  /* Each banner states a count and then hands over the exact rows it counted,
     so the filter under it can never disagree with the number above it. */
  let focusList = () => {};

  if (deals && !vecErr && vectors) {
    if (deals.length && !vectors.length) {
      const b = el('div', 'banner hot'); b.style.marginBottom = '12px';
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">database_off</span>
        <div style="flex:1"><strong>${num(deals.length)} closed-won deal${deals.length === 1 ? ' is' : 's are'} recorded and the vector memory is completely empty.</strong>
        <span class="mono">deals_embeddings</span> is written only by the Closed-Won workflow, so either it has never run for these rows or its embedding step is failing.
        Until it writes, Ask AI answers about past deals from nothing.</div>`;
      banners.appendChild(b);
    } else if (deals.length && embeddedCount < deals.length) {
      const missing = deals.length - embeddedCount;
      const b = el('div', 'banner warm'); b.style.marginBottom = '12px';
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">psychology_alt</span>
        <div style="flex:1"><strong>${num(missing)} recorded deal${missing === 1 ? ' has' : 's have'} no matching row in the vector memory.</strong>
        ${vecCapped
          ? `The vector read is capped at ${num(VEC_LIMIT)} rows, so some of these may be embedded outside the window that was read.`
          : 'Ask AI cannot quote those deals back.'}</div>
        <button class="btn sm" id="dShowMissing">Show ${missing === 1 ? 'it' : 'them'}</button>`;
      banners.appendChild(b);
      b.querySelector('#dShowMissing').addEventListener('click', () => focusList({ memory: 'OUT' }));
    }
  }

  if (orphanVectors.length) {
    const b = el('div', 'banner info'); b.style.marginBottom = '12px';
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">link_off</span>
      <div><strong>${num(orphanVectors.length)} vector row${orphanVectors.length === 1 ? '' : 's'} could not be matched to a deal on this page.</strong>
      Either the deal predates the ${num(DEAL_LIMIT)}-row window read above, or the workflow embedded it under a deal id this screen cannot tie back to <span class="mono">purchase_history</span>.</div>`;
    banners.appendChild(b);
  }

  if (leadsErr) {
    const b = el('div', 'banner warm'); b.style.marginBottom = '12px';
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">person_off</span>
      <div>Leads could not be read (${esc(leadsErr)}), so the deal form cannot offer a lead to pick from. Every field can still be typed in by hand.</div>`;
    banners.appendChild(b);
  }

  /* ── Deals over time ───────────────────────────────────────────────────── */
  if (!deals) {
    trendCard.innerHTML = stateError('the revenue trend', dealsErr);
  } else {
    const buckets = new Map();
    let undated = 0;
    deals.forEach(d => {
      const m = monthOf(dateOf(d));
      if (!m) { undated++; return; }
      const b = buckets.get(m) || { n: 0, revenue: 0, withAmount: 0 };
      b.n++;
      const a = amountOf(d);
      if (a != null) { b.revenue += a; b.withAmount++; }
      buckets.set(m, b);
    });

    const months = [...buckets.keys()].sort();
    if (!months.length) {
      trendCard.innerHTML = `<div class="label-caps">Deals over time</div>${stateEmpty(
        deals.length ? 'No deal carries a readable close date' : 'No deals to chart yet',
        deals.length
          ? `${col.date ? `The ${col.date} column is empty or unparseable on every row read.` : 'purchase_history has no close-date column, so the deals cannot be placed on a timeline.'}`
          : 'Record a closed-won deal and it appears here by month.', 'bar_chart')}`;
    } else {
      /* Months with no deal are shown as gaps rather than skipped: a row of
         bars that jumps March → September reads as continuous trade. The empty
         months are a fact of the table, not a filled-in value. */
      const span = [];
      let [y, mo] = months[0].split('-').map(Number);
      const [ly, lmo] = months[months.length - 1].split('-').map(Number);
      for (let i = 0; i < 240 && (y < ly || (y === ly && mo <= lmo)); i++) {
        span.push(`${y}-${String(mo).padStart(2, '0')}`);
        mo++; if (mo > 12) { mo = 1; y++; }
      }
      const shown = span.slice(-TREND_MONTHS);
      const useRevenue = !!col.amount;
      const peak = Math.max(...shown.map(m => (useRevenue ? (buckets.get(m)?.revenue || 0) : (buckets.get(m)?.n || 0))), 0);

      trendCard.innerHTML = `
        <div class="label-caps">Deals over time</div>
        <div class="card-sub" style="margin-bottom:12px">${useRevenue
          ? `Revenue per calendar month from <span class="mono">${esc(col.amount)}</span>, dated on <span class="mono">${esc(col.date)}</span>`
          : `Deals per calendar month, dated on <span class="mono">${esc(col.date)}</span>. purchase_history has no amount column, so this counts deals rather than money.`}</div>
        <div>${shown.map(m => {
          const b = buckets.get(m);
          const v = useRevenue ? (b?.revenue || 0) : (b?.n || 0);
          const w = peak > 0 ? (v / peak * 100) : 0;
          return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
            <div class="cell-sub" style="width:64px;flex-shrink:0">${esc(monthLabel(m))}</div>
            <div class="bar" style="flex:1"><i style="width:${w.toFixed(1)}%"></i></div>
            <div class="num" style="width:120px;text-align:right;flex-shrink:0">${
              b ? (useRevenue ? aed(b.revenue) : num(b.n)) : '<span class="t-muted">—</span>'}</div>
            <div class="cell-sub num" style="width:64px;text-align:right;flex-shrink:0">${
              b ? `${num(b.n)} deal${b.n === 1 ? '' : 's'}` : ''}</div>
          </div>`;
        }).join('')}</div>
        <div class="cell-sub" style="margin-top:10px;white-space:normal">
          ${span.length > shown.length ? `Showing the last ${num(shown.length)} of ${num(span.length)} months on record. ` : ''}
          ${undated ? `${num(undated)} deal${undated === 1 ? ' has' : 's have'} no readable close date and ${undated === 1 ? 'is' : 'are'} not on this chart. ` : ''}
          ${useRevenue && deals.some(d => amountOf(d) == null) ? 'Deals with no amount are counted but contribute nothing to the bars.' : ''}
        </div>`;
    }
  }

  /* ── Returning customers ───────────────────────────────────────────────── */
  if (!deals) {
    repeatCard.innerHTML = `<div class="card-head"><div><div class="card-title">Returning customers</div></div></div>${stateError('returning customers', dealsErr)}`;
  } else {
    /* Grouped on email, which is the identity the rest of the product keys on.
       Rows with no email are grouped on the customer name instead and marked,
       because two different people can share a name and the grouping is then
       a guess the reader should be able to see. */
    const groups = new Map();
    deals.forEach(d => {
      const email = lower(emailOf(d));
      const key = email || `name:${lower(nameOf(d))}`;
      if (key === 'name:') return;
      const g = groups.get(key) || { email, name: nameOf(d), n: 0, revenue: 0, withAmount: 0, last: null, byName: !email };
      g.n++;
      const a = amountOf(d);
      if (a != null) { g.revenue += a; g.withAmount++; }
      const t = stamp(dateOf(d));
      if (t != null && (g.last == null || t > g.last)) g.last = t;
      if (!g.name && nameOf(d)) g.name = nameOf(d);
      groups.set(key, g);
    });
    const repeat = [...groups.values()].filter(g => g.n > 1)
      .sort((a, b) => b.revenue - a.revenue || b.n - a.n);
    const noKey = deals.filter(d => !lower(emailOf(d)) && !lower(nameOf(d))).length;

    repeatCard.innerHTML = `<div class="card-head"><div>
        <div class="card-title">Returning customers</div>
        <div class="card-sub">Contacts with more than one recorded deal, ranked by total spend</div>
      </div></div>
      ${repeat.length
        ? `<div style="max-height:340px;overflow-y:auto">${repeat.slice(0, 25).map(g => `
            <div class="list-item" style="cursor:default">
              <span class="pill vip"><span class="dot"></span>${num(g.n)} deals</span>
              <div style="flex:1;min-width:0">
                <div style="font-weight:500">${esc(g.name || g.email || 'Unnamed customer')}</div>
                <div class="cell-sub">${esc(g.email || 'No email on these rows — grouped by name')}${
                  g.last != null ? ` · last deal ${esc(ago(g.last))}` : ''}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div class="num" style="font-weight:500">${g.withAmount ? aed(g.revenue) : '<span class="t-muted">—</span>'}</div>
                <div class="cell-sub">${g.withAmount === g.n ? 'total spend' : `${num(g.withAmount)} of ${num(g.n)} priced`}</div>
              </div>
            </div>`).join('')}
            ${repeat.length > 25 ? `<div class="list-item" style="cursor:default"><div class="cell-sub">${num(repeat.length - 25)} more returning customers not shown</div></div>` : ''}
          </div>
          ${noKey ? `<div class="list-item" style="cursor:default"><div class="cell-sub">${num(noKey)} deal${noKey === 1 ? ' has' : 's have'} neither an email nor a customer name and cannot be grouped.</div></div>` : ''}`
        : stateEmpty(deals.length ? 'Every recorded deal is a different customer' : 'No deals recorded yet',
            deals.length
              ? 'No email or name appears twice in purchase_history, so there is no repeat business to report.'
              : 'Repeat business appears here once the same customer buys twice.', 'group')}`;
  }

  /* ── The deal list ─────────────────────────────────────────────────────── */
  const actions = `<button class="btn primary" id="newDeal">
    <span class="material-symbols-outlined">add</span> Record a deal</button>`;

  if (!deals) {
    listCard.innerHTML = `<div class="card-head"><div><div class="card-title">Closed-won deals</div></div>
      <div style="flex:1"></div>${actions}</div>${stateError('closed-won deals', dealsErr)}`;
  } else {
    const f = { q: '', memory: 'ALL', period: 'ALL', sort: 'new' };
    const dated = deals.filter(d => stamp(dateOf(d)) != null).length;

    listCard.innerHTML = `<div class="card-head"><div>
        <div class="card-title">Closed-won deals</div>
        <div class="card-sub">Straight from <span class="mono">purchase_history</span>. Recording a deal here posts to the Closed-Won workflow, which is what writes the pgvector memory — nothing on this screen writes the table directly. Click a row for the full record.${
          dealsCapped ? ` <span class="t-warm">Showing the ${num(DEAL_LIMIT)} most recent rows — this read is capped.</span>` : ''}</div>
      </div><div style="flex:1"></div>${actions}</div>
      <div class="toolbar">
        <div class="grow"><input type="search" id="dq" aria-label="Search closed-won deals"
          placeholder="Search customer, email or vehicle" /></div>
        <select id="dPeriod" aria-label="Filter by close date" style="width:auto">
          ${PERIODS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}
        </select>
        <select id="dMem" aria-label="Filter by vector memory state" style="width:auto"
          ${vecErr ? `disabled title="deals_embeddings could not be read (${esc(vecErr)}), so this screen does not know which deals are embedded."` : ''}>
          <option value="ALL">All memory states</option>
          <option value="IN">In vector memory · ${num(embeddedCount)}</option>
          <option value="OUT">Not embedded · ${num(deals.length - embeddedCount)}</option>
        </select>
        <select id="dSort" aria-label="Sort deals" style="width:auto">
          ${Object.entries(SORTS).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}
        </select>
        <div class="t-muted num" id="dCount"></div>
      </div>
      <div id="dNote"></div>
      <div id="dTable"></div>`;

    const cols = [
      { label: 'Customer', strong: true, render: d => `${esc(nameOf(d) || 'Unnamed customer')}
          <div class="cell-sub">${esc(emailOf(d) || 'No email on this row')}</div>` },
      { label: 'Vehicle', render: d => esc(get(d, 'vehicle') || '—') },
      { label: 'Amount', align: 'r', render: d => {
          const a = amountOf(d);
          return a == null ? '<span class="t-muted">—</span>' : aed(a);
        } },
    ];
    if (col.margin || (col.amount && col.cost)) {
      cols.push({ label: 'Gross margin', align: 'r', render: d => {
        const m = marginOf(d), a = amountOf(d);
        if (m == null) return '<span class="t-muted">—</span>';
        return `<span class="${m < 0 ? 't-hot' : ''}">${aed(m)}</span>${
          a ? `<div class="cell-sub">${esc(pct(m / a * 100))}</div>` : ''}`;
      } });
    }
    cols.push(
      { label: 'Closed', render: d => {
          const raw = dateOf(d);
          if (!raw) return '<span class="t-muted">No date recorded</span>';
          return `<div>${esc(day10(raw))}</div><div class="cell-sub">${esc(ago(raw))}</div>`;
        } },
      { label: 'Vector memory', render: d => {
          if (vecErr) return `<span class="t-muted" title="deals_embeddings could not be read">Unknown</span>`;
          if (vectorFor(d)) return pill('Embedded', 'ok');
          return `<span class="t-muted">${vecCapped ? 'Not in the rows read' : 'Not embedded'}</span>`;
        } },
    );

    const th = listCard.querySelector('#dTable');
    const countEl = listCard.querySelector('#dCount');
    const noteEl = listCard.querySelector('#dNote');

    const visible = () => {
      const q = f.q.trim().toLowerCase();
      const cutoff = f.period === 'ALL' ? null : Date.now() - Number(f.period) * 86400000;
      return deals.filter(d => {
        if (cutoff != null) { const t = stamp(dateOf(d)); if (t == null || t < cutoff) return false; }
        if (f.memory === 'IN' && !vectorFor(d)) return false;
        if (f.memory === 'OUT' && vectorFor(d)) return false;
        if (!q) return true;
        return [nameOf(d), emailOf(d), get(d, 'vehicle'), get(d, 'phone')].some(v => lower(v).includes(q));
      });
    };

    const sortRows = rows => {
      const byDate = (a, b) => (stamp(dateOf(b)) ?? -Infinity) - (stamp(dateOf(a)) ?? -Infinity);
      if (f.sort === 'new') return rows.slice().sort(byDate);
      if (f.sort === 'old') return rows.slice().sort((a, b) => (stamp(dateOf(a)) ?? Infinity) - (stamp(dateOf(b)) ?? Infinity));
      if (f.sort === 'name') return rows.slice().sort((a, b) => lower(nameOf(a)).localeCompare(lower(nameOf(b))) || byDate(a, b));
      /* Deals with no amount cannot take part in a value sort. They are kept at
         the end in date order rather than treated as zero, which would rank a
         missing price alongside a giveaway. */
      const dir = f.sort === 'low' ? 1 : -1;
      const priced = rows.filter(r => amountOf(r) != null).sort((a, b) => dir * (amountOf(a) - amountOf(b)));
      return priced.concat(rows.filter(r => amountOf(r) == null).sort(byDate));
    };

    function draw() {
      if (!deals.length) {
        countEl.textContent = '';
        noteEl.innerHTML = '';
        th.innerHTML = stateEmpty('No deals recorded yet',
          'Record a closed-won deal and it becomes both revenue on this screen and something Ask AI can quote back.', 'handshake');
        return;
      }
      const rows = sortRows(visible());
      countEl.textContent = `${rows.length} of ${deals.length}`;
      const notes = [];
      if (f.period !== 'ALL' && dated < deals.length) {
        notes.push(`${num(deals.length - dated)} deal${deals.length - dated === 1 ? ' has' : 's have'} no readable close date and cannot appear while a period filter is set.`);
      }
      if (f.memory !== 'ALL' && vecCapped) {
        notes.push(`The vector read is capped at ${num(VEC_LIMIT)} rows, so a deal embedded outside that window is filtered as "not embedded".`);
      }
      noteEl.innerHTML = notes.length
        ? `<div class="list-item" style="cursor:default">
             <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
             <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}</div></div>`
        : '';
      th.innerHTML = table(cols, rows, {
        onRow: true,
        empty: stateEmpty('No deal matches these filters',
          'Clear the search, widen the period or pick another memory state.', 'filter_alt_off'),
      });
      wireRows(th, rows, openDeal);
    }

    listCard.querySelector('#dq').addEventListener('input', e => { f.q = e.target.value; draw(); });
    listCard.querySelector('#dPeriod').addEventListener('change', e => { f.period = e.target.value; draw(); });
    listCard.querySelector('#dMem').addEventListener('change', e => { f.memory = e.target.value; draw(); });
    listCard.querySelector('#dSort').addEventListener('change', e => { f.sort = e.target.value; draw(); });

    /* The coverage banner lands here. It resets the fields it was not asked
       for, so a leftover search box cannot hide half the rows it just counted. */
    focusList = ({ memory = 'ALL', period = 'ALL' } = {}) => {
      f.memory = memory; f.period = period; f.q = '';
      listCard.querySelector('#dMem').value = memory;
      listCard.querySelector('#dPeriod').value = period;
      listCard.querySelector('#dq').value = '';
      draw();
      listCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    draw();
  }

  $('newDeal')?.addEventListener('click', () => dealForm(leads, () => go('deals')));

  /* ── Vector memory ─────────────────────────────────────────────────────── */
  if (vecErr) {
    vecCard.innerHTML = `<div class="card-head"><div><div class="card-title">Vector memory</div>
      <div class="card-sub">What the Closed-Won workflow has embedded into pgvector</div></div></div>
      ${stateError('the vector memory', vecErr)}`;
  } else if (!vectors.length) {
    vecCard.innerHTML = `<div class="card-head"><div><div class="card-title">Vector memory</div>
      <div class="card-sub">What the Closed-Won workflow has embedded into pgvector</div></div></div>
      ${stateEmpty('deals_embeddings has no rows at all',
        deals && deals.length
          ? `The table is empty, not merely behind: none of the ${deals.length} recorded deals has been embedded, so Ask AI has no closed-deal memory to search. Only the Closed-Won workflow writes here.`
          : 'Nothing has been embedded yet. Recording a closed-won deal sends it to the workflow that writes this table.', 'database')}`;
  } else {
    const shown = vectors.slice(0, VEC_SHOWN);
    vecCard.innerHTML = `<div class="card-head"><div>
        <div class="card-title">Vector memory</div>
        <div class="card-sub">${num(vectors.length)} row${vectors.length === 1 ? '' : 's'} the Closed-Won workflow has embedded into pgvector${
          vecCapped ? ` · <span class="t-warm">capped at ${num(VEC_LIMIT)}, so this is a window rather than the whole store</span>` : ''}</div>
      </div></div>
      <div style="max-height:50vh;overflow-y:auto">${shown.map(x => `
        <div class="list-item" style="cursor:default;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div class="mono" style="font-weight:500;font-size:12px">${esc(x.deal_id || 'no deal_id')}</div>
            <div class="cell-sub" style="white-space:normal">${esc(String(x.content || '').slice(0, 220))}${
              String(x.content || '').length > 220 ? '…' : ''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="cell-sub">${esc(ago(x.created_at))}</div>
            ${usedVectors.has(x) ? '' : '<div class="cell-sub t-muted">no deal on this page</div>'}
          </div>
        </div>`).join('')}
        ${vectors.length > shown.length
          ? `<div class="list-item" style="cursor:default"><div class="cell-sub">${num(vectors.length - shown.length)} more embedded row${vectors.length - shown.length === 1 ? '' : 's'} not shown</div></div>`
          : ''}</div>`;
  }

  /* ── One deal, in full ─────────────────────────────────────────────────── */
  function openDeal(d) {
    const v = vectorFor(d);
    const m = marginOf(d);
    const a = amountOf(d);
    /* Every column the row actually came back with is listed. This is the
       screen an argument about a number ends on, so nothing is hidden behind a
       curated subset — money columns are formatted, everything else is printed
       as the database returned it. */
    const rowKeys = Object.keys(d).sort();
    const fmt = (k, val) => {
      if (val == null || val === '') return '<span class="t-muted">—</span>';
      if (/_aed$|^net_margin$/.test(k) && n0(val) != null) return esc(aed(val));
      if (typeof val === 'object') return `<span class="mono">${esc(JSON.stringify(val).slice(0, 200))}</span>`;
      return esc(String(val).slice(0, 300));
    };

    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1;min-width:0">
          <div class="card-title">${esc(nameOf(d) || 'Unnamed customer')}</div>
          <div class="card-sub">${esc(get(d, 'vehicle') || 'No vehicle recorded')}${
            a == null ? '' : ' · ' + esc(aed(a))}${dateOf(d) ? ' · closed ' + esc(day10(dateOf(d))) : ''}</div>
        </div>
        <button class="btn ghost" id="ddClose" aria-label="Close deal details">
          <span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section">
          <div class="label-caps">Deal</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Customer</dt><dd>${esc(nameOf(d) || '—')}</dd>
            <dt>Email</dt><dd>${esc(emailOf(d) || '—')}</dd>
            <dt>Phone</dt><dd>${esc(get(d, 'phone') || '—')}</dd>
            <dt>Vehicle</dt><dd>${esc(get(d, 'vehicle') || '—')}</dd>
            <dt>Amount</dt><dd class="num">${a == null ? '<span class="t-muted">Not recorded</span>' : esc(aed(a))}</dd>
            <dt>Gross margin</dt><dd class="num">${m == null
              ? '<span class="t-muted">No margin column, and no amount and cost to subtract</span>'
              : `${esc(aed(m))}${a ? ` <span class="cell-sub">(${esc(pct(m / a * 100))})</span>` : ''}`}</dd>
            <dt>Closed on</dt><dd>${dateOf(d) ? esc(day10(dateOf(d))) + ` <span class="cell-sub">${esc(ago(dateOf(d)))}</span>` : '<span class="t-muted">Not recorded</span>'}</dd>
          </dl>
        </div>

        <div class="section">
          <div class="label-caps">Vector memory</div>
          ${vecErr
            ? `<div class="cell-sub" style="margin-top:8px">deals_embeddings could not be read (${esc(vecErr)}), so whether this deal is embedded is unknown.</div>`
            : v
              ? `<div style="margin-top:8px">${pill('Embedded', 'ok')}</div>
                 <div class="cell-sub mono" style="margin-top:8px">${esc(v.deal_id || 'no deal_id')}</div>
                 <div class="quote" style="margin-top:8px;white-space:pre-wrap">${esc(String(v.content || 'The vector row carries no content.'))}</div>
                 <div class="cell-sub" style="margin-top:8px">Embedded ${esc(ago(v.created_at))}</div>`
              : `<div class="cell-sub" style="margin-top:8px">${vecCapped
                  ? `No match inside the ${num(VEC_LIMIT)} vector rows that were read. This deal may still be embedded outside that window.`
                  : 'No row in deals_embeddings matches this deal, so Ask AI cannot quote it.'}</div>`}
        </div>

        <div class="section">
          <div class="label-caps">Row as stored</div>
          <dl class="kv" style="margin-top:8px">
            ${rowKeys.map(k => `<dt class="mono">${esc(k)}</dt><dd>${fmt(k, d[k])}</dd>`).join('')}
          </dl>
        </div>
      </div>
      <div class="drawer-foot">
        <button class="btn" id="ddDone">Close</button>
        <button class="btn" disabled title="${esc(NO_REEMBED)}">Re-embed this deal</button>
      </div>`);

    $('ddClose')?.addEventListener('click', closeDrawer);
    $('ddDone')?.addEventListener('click', closeDrawer);
  }
};
