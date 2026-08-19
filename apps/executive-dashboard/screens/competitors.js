/* NEXUS OS — screens/competitors.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db } from '../lib/data.js';
import { el } from '../lib/dom.js';
import { aed, aedSigned, ago, esc, n0, num } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi, table } from '../lib/ui.js';

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
