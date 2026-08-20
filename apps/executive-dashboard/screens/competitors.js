/* NEXUS OS — screens/competitors.js
   Reworked on 19 Aug 2026 to answer one question: am I priced right?

   The old screen printed the scrape's own `price_diff_aed` column and trusted
   it. That number is a snapshot of what our list price was at scrape time, so
   after any re-price it quietly describes a price we no longer ask. This screen
   matches each scraped row against the stock we actually hold — make + model,
   and the year when the scrape recorded one — and computes the gap against the
   live list price in `inventory`. The stored figure is still shown in the
   drawer, labelled as the scrape's own snapshot, and flagged when the two
   disagree, because that disagreement is itself information.

   Freshness is stated rather than implied. A price comparison is only as good
   as the day it was collected, so the age of the newest row is on the screen at
   all times and a scrape that has missed a cycle says so in a banner. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, aedSigned, ago, esc, n0, num, pct, pill } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, panel, table, wireRows } from '../lib/ui.js';
import { deriveUnit, unitForm } from '../lib/unit-form.js';

/* The scraping workflow is documented as a daily job. One missed cycle is the
   point at which the numbers stop being safe to quote at a customer. */
const SCRAPE_EVERY_HOURS = 24;
const STALE_AFTER_HOURS = 48;
const ROW_LIMIT = 500;

const low = s => String(s == null ? '' : s).toLowerCase();
const isSold = u => low(u.status) === 'sold';
/* Model names arrive punctuated differently from every source — "Land-Cruiser",
   "LAND CRUISER", "Land Cruiser 300". Compare on letters and digits only. */
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* Reads the first column that actually carries a value. The competitor feed and
   the inventory table were built by different workflows and do not agree on
   names; this resolves them without inventing a value when none is present. */
function pick(row, names) {
  for (const k of names) {
    const v = row?.[k];
    if (v != null && String(v).trim() !== '') return v;
  }
  return null;
}

const cName  = r => pick(r, ['competitor', 'competitor_name', 'dealer', 'dealership', 'name', 'source']);
const cMake  = r => pick(r, ['make', 'brand', 'manufacturer']);
const cModel = r => pick(r, ['model', 'vehicle_model', 'vehicle']);
const cYear  = r => n0(pick(r, ['year', 'model_year']));
const cPrice = r => n0(pick(r, ['price_aed', 'competitor_price_aed', 'listed_price_aed', 'price']));
const cAt    = r => pick(r, ['scraped_at', 'checked_at', 'collected_at', 'updated_at', 'created_at']);

const uMake  = u => pick(u, ['make', 'brand']);
const uModel = u => pick(u, ['model', 'vehicle']);
const uYear  = u => n0(pick(u, ['year', 'model_year']));
const uPrice = u => n0(pick(u, ['list_price_aed', 'price_aed']));
const uRef   = u => pick(u, ['stock_id', 'id']);

const vehicleLabel = (make, model, year) =>
  [year == null ? '' : String(year), make || '', model || ''].filter(Boolean).join(' ').trim();

const BASIS = {
  exact:  { chip: 'make · model · year', why: 'Same make, model and year as a unit on the lot.' },
  mm:     { chip: 'make · model',        why: 'Same make and model. The scrape did not record a year, so the year is not part of this match.' },
  model:  { chip: 'model only',          why: 'Matched on the model name alone — the scrape or the stock record is missing a make, so this comparison is looser.' },
  none:   { chip: 'no unit in stock',    why: 'Nothing on the lot matches this make and model, so there is no price of ours to compare.' },
};

const FILTERS = {
  ALL:    'All',
  ABOVE:  'We ask more',
  BELOW:  'We undercut',
  LEVEL:  'Level',
  NOSTOCK:'Not stocked',
};
const SORTS = {
  above_first: 'Most overpriced first',
  below_first: 'Biggest undercut first',
  newest:      'Newest scrape first',
  oldest:      'Oldest scrape first',
  name:        'Competitor A–Z',
};

/* One competitor row, joined to the stock it can legitimately be compared with.
   Everything here is either a column Postgres returned or arithmetic over two
   of them; nothing is filled in when a side is missing. */
function compare(r, index) {
  const make = cMake(r), model = cModel(r), year = cYear(r), price = cPrice(r);
  const keyed = index.lookup(make, model);
  let units = keyed.units, basis = keyed.basis, yearNote = '';

  if (units.length && year != null) {
    const sameYear = units.filter(u => uYear(u) === year);
    if (sameYear.length) { units = sameYear; basis = basis === 'mm' ? 'exact' : basis; }
    else {
      const years = [...new Set(units.map(uYear).filter(y => y != null))].sort();
      yearNote = years.length
        ? `We do not stock a ${year}; comparing against ${years.join(', ')}.`
        : `The scrape says ${year}; our matching stock has no year recorded.`;
    }
  }

  /* A sold car is not a car we are pricing. It is only used as the comparable
     when it is the only thing that matches, and then it is labelled. */
  const onLot = units.filter(u => !isSold(u));
  const soldOnly = units.length > 0 && onLot.length === 0;
  if (onLot.length) units = onLot;

  const pricedUnits = units.filter(u => uPrice(u) != null);
  const prices = pricedUnits.map(uPrice);
  /* Several units of the same car rarely carry the same sticker. The shopper
     compares against the cheapest one we advertise, so that is the figure the
     gap is measured from; the spread is shown next to it. */
  const ourPrice = prices.length ? Math.min(...prices) : null;
  const ourHigh = prices.length ? Math.max(...prices) : null;
  const delta = (ourPrice != null && price != null) ? ourPrice - price : null;

  return {
    raw: r, name: cName(r), make, model, year, price,
    label: vehicleLabel(make, model, year) || String(model || '') || 'Unnamed vehicle',
    at: cAt(r),
    storedOur: n0(pick(r, ['our_price_aed'])),
    storedDiff: n0(pick(r, ['price_diff_aed'])),
    rec: pick(r, ['ai_recommendation', 'recommendation', 'notes']),
    units, pricedUnits, unmatched: units.length === 0,
    basis: units.length ? basis : 'none',
    yearNote, soldOnly, ourPrice, ourHigh, delta,
    deltaPct: (delta != null && price) ? (delta / price) * 100 : null,
  };
}

/* make+model first, model alone as the fallback, so a feed that puts the make
   inside the model string still finds the car. */
function buildIndex(inv) {
  const byMakeModel = new Map(), byModel = new Map();
  const add = (map, key, u) => { if (!key) return; if (!map.has(key)) map.set(key, []); map.get(key).push(u); };
  inv.forEach(u => {
    const m = norm(uModel(u));
    add(byModel, m, u);
    add(byMakeModel, norm(`${uMake(u) || ''} ${uModel(u) || ''}`), u);
  });
  return {
    lookup(make, model) {
      const m = norm(model);
      if (make) {
        const hit = byMakeModel.get(norm(`${make} ${model}`));
        if (hit) return { units: hit, basis: 'mm' };
      }
      const both = byMakeModel.get(m);        // feed put "Toyota Land Cruiser" in one field
      if (both) return { units: both, basis: make ? 'mm' : 'model' };
      const only = byModel.get(m);
      if (only) return { units: only, basis: make ? 'model' : 'model' };
      return { units: [], basis: 'none' };
    },
  };
}

const deltaCell = c => {
  if (c.delta == null) {
    const why = c.unmatched ? BASIS.none.why
      : c.price == null ? 'This row has no competitor price recorded.'
        : 'The matching unit has no list price on record.';
    return `<span class="t-muted" title="${esc(why)}">—</span>`;
  }
  if (c.delta === 0) return '<span class="t-muted">level</span>';
  const worse = c.delta > 0;
  return `<span class="${worse ? 't-hot' : 't-ok'}" style="font-weight:500"
      title="${esc(`Our ${aed(c.ourPrice)} against their ${aed(c.price)}`)}">
      <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px" aria-hidden="true">${worse ? 'arrow_upward' : 'arrow_downward'}</span>
      ${aedSigned(c.delta)}</span>
    ${c.deltaPct == null ? '' : `<div class="cell-sub">${pct(Math.abs(c.deltaPct))} ${worse ? 'above' : 'below'} theirs</div>`}`;
};

SCREENS.competitors = async host => {
  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const body = el('div'); body.style.marginTop = '16px'; host.appendChild(body);
  body.innerHTML = `<div class="card flush">${stateLoading(8)}</div>`;
  const below = el('div', 'grid g2 top'); below.style.marginTop = '16px'; host.appendChild(below);
  const byCompHost = el('div'); const blindHost = el('div');
  below.appendChild(byCompHost); below.appendChild(blindHost);

  /* Ordering is deliberately left to the client. The competitors feed is
     written by a scraping workflow and the column set has changed before;
     ordering server-side on a column that has been renamed returns a 400 and
     takes the whole screen down, while sorting here cannot. */
  let rows = [];
  try { rows = await db(`competitors?select=*&limit=${ROW_LIMIT}`); }
  catch (e) {
    strip.remove(); below.remove();
    body.innerHTML = `<div class="card">${stateError('competitor pricing', e.message, 'competitors')}</div>`;
    body.querySelector('[data-retry]')?.addEventListener('click', () => go('competitors'));
    return;
  }

  /* Inventory is a second, independent failure. Losing it costs the deltas, not
     the screen — the scraped prices are still worth seeing, so the comparison
     columns say why they are blank instead of the page showing an error. */
  let inv = [], invErr = null;
  try { inv = (await db('inventory?select=*&limit=1000')).map(deriveUnit); }
  catch (e) { invErr = e; }

  const index = buildIndex(inv);
  const all = rows.map(r => compare(r, index));
  const reload = () => go('competitors');

  const stamped = all.filter(c => c.at && !Number.isNaN(Date.parse(c.at)));
  const newest = stamped.length ? stamped.reduce((a, c) => (Date.parse(c.at) > Date.parse(a.at) ? c : a)).at : null;
  const oldest = stamped.length ? stamped.reduce((a, c) => (Date.parse(c.at) < Date.parse(a.at) ? c : a)).at : null;
  const ageHours = newest ? (Date.now() - Date.parse(newest)) / 3600000 : null;
  const stale = ageHours != null && ageHours > STALE_AFTER_HOURS;

  if (!all.length) {
    strip.remove(); below.remove();
    body.innerHTML = `<div class="card flush">
      <div class="card-head"><div><div class="card-title">Price comparison</div>
        <div class="card-sub">Nothing has been scraped yet</div></div></div>
      ${stateEmpty('No competitor prices yet',
        `The scraping workflow writes this table and is expected to run every ${SCRAPE_EVERY_HOURS} hours. Until it has run once there is no market price to compare our stock against.`,
        'trending_up')}</div>`;
    return;
  }

  /* ── Headline figures. Every one is a count or a difference of two stored
     prices; where a side is missing the row is excluded and said so. ─────── */
  const comparable = all.filter(c => c.delta != null);
  const above = comparable.filter(c => c.delta > 0);
  const level = comparable.filter(c => c.delta === 0);
  const belowMkt = comparable.filter(c => c.delta < 0);
  const notStocked = all.filter(c => c.unmatched);
  const worstAbove = above.length ? above.reduce((a, c) => (c.delta > a.delta ? c : a)) : null;
  const bestBelow = belowMkt.length ? belowMkt.reduce((a, c) => (c.delta < a.delta ? c : a)) : null;
  const competitorCount = new Set(all.map(c => norm(c.name)).filter(Boolean)).size;
  const modelCount = new Set(all.map(c => norm(c.label)).filter(Boolean)).size;
  const exposure = above.reduce((a, c) => a + c.delta, 0);

  strip.innerHTML = [
    kpi('Scraped prices', num(all.length),
      `${num(competitorCount)} competitor${competitorCount === 1 ? '' : 's'} · ${num(modelCount)} vehicle${modelCount === 1 ? '' : 's'}${all.length >= ROW_LIMIT ? ` · capped at ${num(ROW_LIMIT)} rows` : ''}`),
    kpi('Comparable to our stock', num(comparable.length),
      invErr
        ? '<span class="t-hot">Inventory did not load, so no comparison could be made</span>'
        : `<span class="t-muted">${num(notStocked.length)} not stocked · ${num(all.length - comparable.length - notStocked.length)} missing a price</span>`),
    kpi('We ask more', num(above.length),
      above.length
        ? `<span class="t-hot">Worst ${aedSigned(worstAbove.delta)} on ${esc(worstAbove.label)}</span>`
        : comparable.length ? '<span class="t-ok">No matched unit is above its scraped market price</span>' : '',
      above.length ? 't-hot' : ''),
    kpi('We undercut', num(belowMkt.length),
      bestBelow
        ? `<span class="t-ok">Best ${aedSigned(bestBelow.delta)} on ${esc(bestBelow.label)}</span>`
        : `<span class="t-muted">${num(level.length)} priced level</span>`),
    kpi('Newest scrape', newest ? ago(newest) : '—',
      newest
        ? (stale
          ? `<span class="t-hot">Older than ${SCRAPE_EVERY_HOURS * 2} hours</span> <span class="t-muted">· ${esc(new Date(newest).toLocaleString('en-GB'))}</span>`
          : `<span class="t-muted">${esc(new Date(newest).toLocaleString('en-GB'))}</span>`)
        : '<span class="t-muted">No row carries a scrape timestamp</span>',
      stale ? 't-hot' : ''),
  ].join('');

  /* ── Freshness and inventory-gap banners ─────────────────────────────────── */
  const banners = [];
  if (!newest) {
    banners.push(`<div class="banner warm" style="margin:14px 20px 0">
      <span class="material-symbols-outlined">schedule</span>
      <div>No row in this table carries a scrape timestamp, so how old these prices are cannot be established. Treat every figure below as undated.</div></div>`);
  } else if (stale) {
    banners.push(`<div class="banner hot" style="margin:14px 20px 0">
      <span class="material-symbols-outlined">update_disabled</span>
      <div style="flex:1">The newest competitor price here was scraped ${esc(ago(newest))} (${esc(new Date(newest).toLocaleString('en-GB'))}).
        The scrape is expected to run every ${SCRAPE_EVERY_HOURS} hours, so it has missed at least one cycle and these gaps may already be wrong.</div>
      <button class="btn sm" disabled
        title="No webhook exists for the price scrape. The competitors table is written by a scheduled workflow that has no manual trigger reachable from the browser, so it cannot be re-run from here.">Re-run scrape</button></div>`);
  }
  if (invErr) {
    banners.push(`<div class="banner hot" style="margin:14px 20px 0">
      <span class="material-symbols-outlined">error</span>
      <div style="flex:1">Our own stock could not be loaded (${esc(invErr.message)}), so no gap against our list price can be shown. The scraped prices below are unaffected.</div>
      <button class="btn sm" data-act="retry-inv">Retry</button></div>`);
  } else if (!inv.length) {
    banners.push(`<div class="banner info" style="margin:14px 20px 0">
      <span class="material-symbols-outlined">directions_car</span>
      <div>There are no vehicles in stock, so there is nothing of ours to price against these rows.</div></div>`);
  }

  /* ── Table chrome ────────────────────────────────────────────────────────── */
  const f = { view: 'ALL', q: '', sort: 'above_first' };
  const counts = {
    ALL: all.length, ABOVE: above.length, BELOW: belowMkt.length,
    LEVEL: level.length, NOSTOCK: notStocked.length,
  };

  const visible = () => {
    const q = f.q.trim().toLowerCase();
    return all.filter(c => {
      if (f.view === 'ABOVE' && !(c.delta > 0)) return false;
      if (f.view === 'BELOW' && !(c.delta < 0)) return false;
      if (f.view === 'LEVEL' && c.delta !== 0) return false;
      if (f.view === 'NOSTOCK' && !c.unmatched) return false;
      if (q && ![c.name, c.label, c.make, c.model].map(low).join(' ').includes(q)) return false;
      return true;
    });
  };

  /* Rows the sort key cannot speak about sink to the bottom in name order
     rather than being ranked as if they were the best or the worst. */
  const sorted = list => {
    if (f.sort === 'name') return [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const key = f.sort.startsWith('above') || f.sort.startsWith('below')
      ? (c => c.delta)
      : (c => (c.at && !Number.isNaN(Date.parse(c.at)) ? Date.parse(c.at) : null));
    const dir = (f.sort === 'below_first' || f.sort === 'oldest') ? 1 : -1;
    const known = list.filter(c => key(c) != null).sort((a, b) => dir * (key(a) - key(b)));
    const unknown = list.filter(c => key(c) == null)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return known.concat(unknown);
  };

  const matchChip = c => {
    const b = BASIS[c.basis] || BASIS.none;
    return `<span class="chip" title="${esc(b.why)}">${esc(b.chip)}</span>
      ${c.soldOnly ? '<div class="cell-sub">Only a sold unit matches</div>' : ''}
      ${c.yearNote ? `<div class="cell-sub" style="white-space:normal">${esc(c.yearNote)}</div>` : ''}`;
  };

  const cols = [
    { label: 'Competitor', strong: true, render: c => `${esc(c.name || 'Unnamed source')}
        <div class="cell-sub">${c.at ? esc(ago(c.at)) : 'no scrape date'}</div>` },
    { label: 'Vehicle', render: c => `${esc(c.label)}
        ${c.units.length > 1 ? `<div class="cell-sub">${num(c.units.length)} comparable units in stock</div>` : ''}` },
    { label: 'Their price', align: 'r', render: c => (c.price == null
      ? '<span class="t-muted" title="This row has no competitor price recorded.">—</span>'
      : aed(c.price)) },
    { label: 'Our list price', align: 'r', render: c => {
      if (invErr) return '<span class="t-muted" title="Inventory did not load.">—</span>';
      if (c.unmatched) return '<span class="t-muted" title="We do not stock this make and model.">not stocked</span>';
      if (c.ourPrice == null) return '<span class="t-muted" title="The matching unit carries no list price.">no price on record</span>';
      return `${aed(c.ourPrice)}${c.ourHigh !== c.ourPrice
        ? `<div class="cell-sub">lowest of ${aed(c.ourPrice)}–${aed(c.ourHigh)}</div>` : ''}`;
    } },
    { label: 'Gap vs their price', align: 'r', render: deltaCell },
    { label: 'Match', render: matchChip },
  ];

  const card = el('div', 'card flush');
  card.innerHTML = `
    <div class="card-head"><div><div class="card-title">Price comparison</div>
      <div class="card-sub">Every scraped price against the cheapest comparable unit we hold. A positive gap means we are asking more than they are.</div></div></div>
    <div class="toolbar">
      <div class="seg" id="cSeg" role="group" aria-label="Filter by where our price sits">
        ${Object.entries(FILTERS).map(([k, l]) =>
          `<button data-v="${k}">${esc(l)} · ${num(counts[k])}</button>`).join('')}
      </div>
      <div class="grow"><input type="search" id="cQ" aria-label="Search competitors and vehicles"
        placeholder="Search competitor, make or model" /></div>
      <select id="cSort" aria-label="Sort rows" style="width:auto">
        ${Object.entries(SORTS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
      </select>
      <div class="t-muted num" id="cCount"></div>
      <button class="btn sm" id="cInv">Open Inventory</button>
    </div>
    ${banners.join('')}
    <div id="cTable"></div>`;
  body.innerHTML = '';
  body.appendChild(card);
  $('cInv').addEventListener('click', () => go('inventory'));
  card.querySelector('[data-act="retry-inv"]')?.addEventListener('click', reload);

  /* ── Drawer: the whole case for one row ──────────────────────────────────── */
  function drawer(c) {
    const disagrees = c.storedOur != null && c.ourPrice != null && c.storedOur !== c.ourPrice;
    const best = c.pricedUnits.length
      ? c.pricedUnits.reduce((a, u) => (uPrice(u) < uPrice(a) ? u : a))
      : null;

    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1"><h2 style="font-size:18px">${esc(c.label)}</h2>
          <div class="cell-sub">${esc(c.name || 'Unnamed source')} · ${c.at ? `scraped ${esc(ago(c.at))}` : 'no scrape date recorded'}</div></div>
        <button class="btn ghost sm" id="dClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        ${c.at && stale ? `<div class="banner warm"><span class="material-symbols-outlined">schedule</span>
          <div>Collected ${esc(new Date(c.at).toLocaleString('en-GB'))}. The scrape has missed a cycle, so confirm before quoting this to a customer.</div></div>` : ''}
        ${c.delta == null ? `<div class="banner info"><span class="material-symbols-outlined">info</span>
          <div>${esc(c.unmatched ? BASIS.none.why : c.price == null
            ? 'This row has no competitor price, so no gap can be calculated.'
            : 'The matching unit has no list price on record, so no gap can be calculated.')}</div></div>`
          : `<div class="banner ${c.delta > 0 ? 'hot' : c.delta < 0 ? 'info' : 'warm'}">
              <span class="material-symbols-outlined">${c.delta > 0 ? 'trending_up' : c.delta < 0 ? 'trending_down' : 'trending_flat'}</span>
              <div>${c.delta === 0
                ? `We are asking exactly what ${esc(c.name || 'this competitor')} asks for this vehicle.`
                /* The sign already lives in the words "more"/"less", so the figure
                   itself is stated unsigned here; the columns above keep aedSigned(). */
                : `We are asking <strong>${esc(aed(Math.abs(c.delta)))}</strong>${c.deltaPct == null ? '' : ` (${esc(pct(Math.abs(c.deltaPct)))})`}
                   ${c.delta > 0 ? 'more than' : 'less than'} ${esc(c.name || 'this competitor')} on this vehicle.`}</div></div>`}

        <dl class="kv">
          <dt>Their price</dt><dd class="num">${c.price == null ? '—' : aed(c.price)}</dd>
          <dt>Our list price</dt><dd class="num">${c.ourPrice == null ? '—' : aed(c.ourPrice)}</dd>
          <dt>Gap</dt><dd class="num">${c.delta == null ? '—' : aedSigned(c.delta)}</dd>
          <dt>Match basis</dt><dd>${esc((BASIS[c.basis] || BASIS.none).chip)}</dd>
          <dt>Scraped</dt><dd>${c.at ? esc(new Date(c.at).toLocaleString('en-GB')) : '—'}</dd>
        </dl>

        ${c.yearNote ? `<div class="cell-sub" style="white-space:normal;margin-top:8px">${esc(c.yearNote)}</div>` : ''}

        <div style="margin-top:20px"><div class="label-caps">Comparable stock${c.units.length ? ` · ${num(c.units.length)}` : ''}</div>
          ${c.units.length ? c.units.map(u => {
            const p = uPrice(u), d = (p != null && c.price != null) ? p - c.price : null;
            return `<div class="list-item" style="cursor:default;align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div style="font-weight:500">${esc(uModel(u) || 'Unnamed unit')}${uYear(u) == null ? '' : ` · ${esc(String(uYear(u)))}`}</div>
                <div class="cell-sub mono">${esc(String(uRef(u) ?? '—'))}</div>
                <div class="cell-sub">${esc(String(u.status || 'status unknown'))}${n0(u.days_in_stock) == null ? '' : ` · ${num(u.days_in_stock)} days in stock`}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div class="num">${p == null ? '—' : aed(p)}</div>
                <div class="cell-sub">${d == null ? 'no gap' : esc(aedSigned(d))}</div>
                ${String(u.aging_alert || '').toUpperCase() === 'CRITICAL' ? pill('CRITICAL', 'hot') : ''}
              </div></div>`;
          }).join('')
          : `<div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(BASIS.none.why)}</div>`}
        </div>

        <div style="margin-top:20px"><div class="label-caps">As recorded by the scrape</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Our price at scrape time</dt><dd class="num">${c.storedOur == null ? '<span class="t-muted">not recorded</span>' : aed(c.storedOur)}</dd>
            <dt>Difference at scrape time</dt><dd class="num">${c.storedDiff == null ? '<span class="t-muted">not recorded</span>' : aedSigned(c.storedDiff)}</dd>
          </dl>
          ${disagrees ? `<div class="cell-sub" style="white-space:normal;margin-top:8px">The scrape recorded our price as ${esc(aed(c.storedOur))}; inventory currently lists ${esc(aed(c.ourPrice))}. The gap above uses the live list price.</div>` : ''}
          ${c.storedDiff != null ? `<div class="cell-sub" style="white-space:normal;margin-top:6px">The stored difference is signed by the scraping workflow's own convention and is shown here unchanged, not re-derived.</div>` : ''}
        </div>

        ${c.rec ? `<div style="margin-top:20px"><div class="label-caps">AI recommendation</div>
          <div class="cell-sub" style="white-space:normal;margin-top:8px">${esc(c.rec)}</div></div>` : ''}
      </div>
      <div class="drawer-foot">
        <button class="btn primary" id="dPrice"${best ? '' : ' disabled title="No comparable unit with a list price is in stock, so there is nothing here to re-price."'}>Adjust our list price</button>
        <button class="btn" id="dInv">Open Inventory</button>
      </div>`);
    $('dClose').addEventListener('click', closeDrawer);
    $('dInv').addEventListener('click', () => { closeDrawer(); go('inventory'); });
    if (best) $('dPrice').addEventListener('click', () => { closeDrawer(); unitForm(best, inv, reload); });
  }

  function draw() {
    card.querySelectorAll('#cSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === f.view));
    $('cSort').value = f.sort;
    const list = sorted(visible());
    $('cCount').textContent = `${list.length} of ${all.length} rows`;

    const th = $('cTable');
    th.innerHTML = table(cols, list, {
      onRow: true,
      empty: `${stateEmpty('No rows match these filters',
        'Clear the search or widen the filter to see the scraped prices again.', 'search_off')}
        <div style="text-align:center;padding:0 20px 32px"><button class="btn" id="cClear">Clear filters</button></div>`,
    });
    wireRows(th, list, drawer);
    $('cClear')?.addEventListener('click', () => { f.view = 'ALL'; f.q = ''; $('cQ').value = ''; draw(); });
  }

  card.querySelectorAll('#cSeg button').forEach(b =>
    b.addEventListener('click', () => { f.view = b.dataset.v; draw(); }));
  $('cQ').addEventListener('input', e => { f.q = e.target.value; draw(); });
  $('cSort').addEventListener('change', e => { f.sort = e.target.value; draw(); });
  draw();

  /* ── Per-competitor summary and our blind spots ──────────────────────────── */
  const requireInv = () => { if (invErr) throw invErr; return true; };

  await Promise.all([
    panel(byCompHost, {
      title: 'By competitor',
      sub: 'Where each source has us beaten, and how old its data is',
      load: async () => {
        const by = new Map();
        all.forEach(c => {
          const k = c.name || 'Unnamed source';
          if (!by.has(k)) by.set(k, { name: k, rows: [], above: 0, below: 0, cmp: 0, newest: null });
          const g = by.get(k);
          g.rows.push(c);
          if (c.delta != null) { g.cmp += 1; if (c.delta > 0) g.above += 1; else if (c.delta < 0) g.below += 1; }
          if (c.at && !Number.isNaN(Date.parse(c.at)) && (!g.newest || Date.parse(c.at) > Date.parse(g.newest))) g.newest = c.at;
        });
        return [...by.values()].sort((a, b) => b.above - a.above || b.rows.length - a.rows.length);
      },
      render: groups => (groups.length ? `<div>${groups.map(g => `
        <div class="list-item" style="cursor:default;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${esc(g.name)}</div>
            <div class="cell-sub">${num(g.rows.length)} price${g.rows.length === 1 ? '' : 's'} · ${g.cmp ? `${num(g.cmp)} comparable` : 'none comparable to our stock'}
              ${g.newest ? ` · scraped ${esc(ago(g.newest))}` : ' · no scrape date'}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="${g.above ? 't-hot' : 't-muted'}" style="font-weight:500">${num(g.above)}</div>
            <div class="cell-sub">we ask more${g.below ? ` · ${num(g.below)} lower` : ''}</div>
          </div></div>`).join('')}</div>`
        : stateEmpty('No sources yet', 'No scraped row carries a competitor name.', 'storefront')),
    }),

    panel(blindHost, {
      title: 'Stock with no market reference',
      sub: 'Unsold units no scraped row matches — priced on instinct, not on evidence',
      actions: '<button class="btn sm" data-act="inv">Open Inventory</button>',
      load: async () => {
        requireInv();
        const covered = new Set();
        all.forEach(c => c.units.forEach(u => covered.add(String(uRef(u)))));
        return inv.filter(u => !isSold(u) && !covered.has(String(uRef(u))))
          .sort((a, b) => (n0(b.days_in_stock) || 0) - (n0(a.days_in_stock) || 0));
      },
      render: units => (units.length ? `<div>${units.slice(0, 12).map(u => `
        <div class="list-item" style="cursor:default;align-items:flex-start">
          <span class="material-symbols-outlined t-muted" style="font-size:20px" aria-hidden="true">price_check</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${esc(vehicleLabel(uMake(u), uModel(u), uYear(u)) || 'Unnamed unit')}</div>
            <div class="cell-sub mono">${esc(String(uRef(u) ?? '—'))}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="num">${uPrice(u) == null ? '—' : aed(uPrice(u))}</div>
            <div class="cell-sub">${n0(u.days_in_stock) == null ? 'no acquisition date' : `${num(u.days_in_stock)} days in stock`}</div>
          </div></div>`).join('')}
        ${units.length > 12 ? `<div class="list-item" style="cursor:default"><div class="cell-sub">${num(units.length - 12)} more unit${units.length - 12 === 1 ? '' : 's'} have no scraped comparison</div></div>` : ''}</div>`
        : stateEmpty('Every unsold unit has a market reference',
          'Each car on the lot is matched by at least one scraped competitor price.', 'price_check')),
    }).then(c => c.querySelector('[data-act="inv"]')?.addEventListener('click', () => go('inventory'))),
  ]);
};

/* ==========================================================================
   S6 · Ask AI
   ========================================================================== */
