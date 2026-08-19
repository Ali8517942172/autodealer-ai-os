/* NEXUS OS — screens/deals.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db } from '../lib/data.js';
import { dealForm } from '../lib/deal-form.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, esc, n0, num, pill } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi, table } from '../lib/ui.js';

SCREENS.deals = async host => {
  const strip = el('div', 'grid g4'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const body = el('div'); body.style.marginTop = '16px'; host.appendChild(body);

  const load = async () => Promise.all([
    db('purchase_history?select=*&order=purchase_date.desc'),
    db('deals_embeddings?select=id,deal_id,content,created_at&order=created_at.desc&limit=200').catch(() => []),
    db('leads?select=id,name,email,phone,vehicle_interest,budget_aed,status'),
  ]);

  let purchases = [], vectors = [], leads = [];
  try { [purchases, vectors, leads] = await load(); }
  catch (e) { strip.innerHTML = stateError('deal data', e.message); return; }

  const revenue = purchases.reduce((t, p) => t + (n0(p.amount_aed) || 0), 0);

  /* The Closed-Won workflow derives an id of `auto:<email>|<closed_at>` when the
     caller supplies no deal_id, and closed_at arrives as a full ISO timestamp
     while purchase_history only stores a date. Comparing the ids whole would
     therefore never match, and every row would claim "Not embedded" forever —
     a status column that is always wrong is worse than no column. Match on the
     email and the calendar day instead. */
  const dayKey = (email, when) => `${String(email || '').toLowerCase()}|${String(when || '').slice(0, 10)}`;
  const embedded = new Set(vectors.map(v => {
    const m = /^auto:([^|]+)\|(.+)$/.exec(String(v.deal_id || ''));
    return m ? dayKey(m[1], m[2]) : null;
  }).filter(Boolean));

  strip.innerHTML = [
    kpi('Deals closed', num(purchases.length), 'Recorded in purchase_history'),
    kpi('Revenue', aed(revenue), 'Lifetime, across all recorded deals'),
    kpi('Average deal', aed(purchases.length ? revenue / purchases.length : null)),
    kpi('In RAG memory', num(vectors.length),
        vectors.length ? 'Embedded and searchable by Ask AI' : '<span class="t-hot">Ask AI cannot cite a single real deal</span>'),
  ].join('');

  const t = el('div', 'card flush'); body.appendChild(t);
  t.innerHTML = `<div class="card-head"><div><div class="card-title">Closed-won deals</div>
    <div class="card-sub">Recording a deal here also embeds it into pgvector, so Ask AI can quote it back</div></div>
    <div style="flex:1"></div>
    <button class="btn primary" id="newDeal"><span class="material-symbols-outlined">add</span> Record a deal</button></div>
    <div id="dealT"></div>`;

  t.querySelector('#dealT').innerHTML = table([
    { label:'Customer', strong:true, render: p => `${esc(p.customer_name || '—')}<div class="cell-sub">${esc(p.email || '')}</div>` },
    { label:'Vehicle', render: p => esc(p.vehicle || '—') },
    { label:'Amount', align:'r', render: p => aed(p.amount_aed) },
    { label:'Closed', render: p => `<span class="t-muted">${esc(p.purchase_date || '—')}</span>` },
    { label:'RAG memory', render: p => embedded.has(dayKey(p.email, p.purchase_date))
        ? pill('Embedded', 'ok') : '<span class="t-muted">Not embedded</span>' },
  ], purchases, { empty: stateEmpty('No deals recorded yet',
      'Record a closed-won deal and it becomes part of what Ask AI knows.', 'handshake') });

  t.querySelector('#newDeal').addEventListener('click', () => dealForm(leads, () => go('deals')));

  const v = el('div', 'card flush'); v.style.marginTop = '16px'; body.appendChild(v);
  v.innerHTML = `<div class="card-head"><div><div class="card-title">RAG memory</div>
    <div class="card-sub">What the Closed-Won workflow has embedded into pgvector</div></div></div>
    <div style="max-height:50vh;overflow-y:auto">${vectors.length ? vectors.map(x => `
      <div class="list-item" style="cursor:default">
        <div style="flex:1;min-width:0">
          <div class="mono" style="font-weight:500;font-size:12px">${esc(x.deal_id)}</div>
          <div class="cell-sub" style="white-space:normal">${esc(String(x.content || '').slice(0, 220))}</div>
        </div>
        <div class="cell-sub">${ago(x.created_at)}</div>
      </div>`).join('')
      : stateEmpty('Nothing embedded yet',
          'Every deal recorded above is sent to the Closed-Won workflow, which embeds it here.', 'database')}</div>`;
};

/* The deal form posts to n8n rather than writing purchase_history directly:
   the workflow is what produces the embedding, and a row written straight to
   Postgres would be invisible to Ask AI. One write path, one source of truth. */
