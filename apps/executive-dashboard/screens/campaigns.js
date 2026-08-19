/* NEXUS OS — screens/campaigns.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { HOOK, db, n8n } from '../lib/data.js';
import { el } from '../lib/dom.js';
import { aed, ago, clock, esc, num, pill } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi, table } from '../lib/ui.js';

SCREENS.campaigns = async host => {
  const strip = el('div', 'grid g4'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const body = el('div'); body.style.marginTop = '16px'; host.appendChild(body);

  let leads = [], comms = [], audit = [];
  try {
    [leads, comms, audit] = await Promise.all([
      db('leads?select=*&order=ai_score.desc'),
      db('communication_logs?select=*&order=created_at.desc&limit=500'),
      db('audit_log?select=*&order=logged_at.desc&limit=300'),
    ]);
  } catch (e) { strip.innerHTML = stateError('campaign data', e.message); return; }

  const dripAudit  = audit.filter(a => /drip/i.test(a.workflow || ''));
  const emails     = comms.filter(c => String(c.channel || '').toLowerCase() === 'email' && c.direction === 'outbound');
  const silenced   = comms.filter(c => String(c.message || '').startsWith('[SILENCE-ESCALATED]'));
  const eligible   = leads.filter(l => ['WARM', 'COLD'].includes(String(l.status || '').toUpperCase()) && l.email);
  const started    = new Set(dripAudit.map(a => String(a.lead_email || '').toLowerCase()).filter(Boolean));

  strip.innerHTML = [
    kpi('Eligible for a drip', num(eligible.length), 'Warm and cold leads that have an email address'),
    kpi('Drips started', num(started.size),
        started.size ? 'Distinct leads in the audit log' : '<span class="t-hot">Never started from the product</span>'),
    kpi('Drip emails sent', num(emails.length), 'Outbound, as recorded in communication_logs'),
    kpi('Silence escalations', num(silenced.length),
        silenced.length ? '<span class="t-warm">Twelve hours with no reply</span>' : 'Nobody has gone quiet'),
  ].join('');

  /* ── Eligible leads, each with the one action this screen exists for ── */
  const q = el('div', 'card flush'); body.appendChild(q);
  q.innerHTML = `<div class="card-head"><div><div class="card-title">Warm &amp; cold leads</div>
    <div class="card-sub">Day 1 welcome, day 3 follow-up, day 7 final offer — sent by n8n, not by this browser</div></div></div>
    <div id="dripT"></div>`;

  q.querySelector('#dripT').innerHTML = table([
    { label:'Lead', strong:true, render: l => `${esc(l.name || '—')}<div class="cell-sub">${esc(l.email || '')}</div>` },
    { label:'Status', render: l => pill(l.status || 'NEW') },
    { label:'Interest', render: l => esc(l.vehicle_interest || '—') },
    { label:'Budget', align:'r', render: l => aed(l.budget_aed) },
    { label:'Score', align:'r', render: l => num(l.ai_score) },
    { label:'Drip', render: l => started.has(String(l.email || '').toLowerCase())
        ? pill('Started', 'ok')
        : '<span class="t-muted">Not started</span>' },
    { label:'', align:'r', render: l => `<button class="btn sm" data-drip="${esc(l.email)}"
        data-name="${esc(l.name || '')}" data-veh="${esc(l.vehicle_interest || '')}">Start drip</button>` },
  ], eligible, { empty: stateEmpty('No warm or cold leads',
      'Every lead is currently HOT, so nothing qualifies for the nurture sequence.', 'campaign') });

  q.querySelectorAll('[data-drip]').forEach(btn => btn.addEventListener('click', async () => {
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Starting…';
    try {
      /* Field names match what Normalize Lead Input actually reads. This pairing
         is the whole bug that kept the drip at 0 successful runs — the dashboard
         and the workflow have to agree on one vocabulary, so it is written once,
         here, and not re-derived per caller. */
      await n8n(HOOK.warmDrip, {
        lead_email: btn.dataset.drip,
        lead_name: btn.dataset.name,
        vehicle_interest: btn.dataset.veh,
      });
      btn.textContent = 'Started';
      btn.classList.add('ok');
    } catch (e) {
      btn.disabled = false; btn.textContent = original;
      alert(`Could not start the drip.\n\n${e.message}`);
    }
  }));

  /* ── Silence detector ── */
  const s = el('div', 'card flush'); s.style.marginTop = '16px'; body.appendChild(s);
  s.innerHTML = `<div class="card-head"><div><div class="card-title">Silence detector</div>
    <div class="card-sub">A lead that has not replied for twelve hours is escalated once, then never again</div></div></div>
    <div>${silenced.length ? silenced.map(c => `
      <div class="list-item" style="cursor:default">
        <span class="mono t-muted">${clock(c.created_at)}</span>
        ${pill('Escalated', 'warm')}
        <div style="flex:1;min-width:0">
          <div style="font-weight:500">${esc(c.lead_email || 'Unknown contact')}</div>
          <div class="cell-sub">${esc(String(c.message || '').replace('[SILENCE-ESCALATED]', '').trim())}</div>
        </div>
        <div class="cell-sub">${ago(c.created_at)}</div>
      </div>`).join('')
      : stateEmpty('Nobody has gone silent',
          'The detector only fires for leads that received an outbound message and did not reply within twelve hours.',
          'notifications_off')}</div>`;

  /* ── Drip activity ── */
  const a = el('div', 'card flush'); a.style.marginTop = '16px'; body.appendChild(a);
  a.innerHTML = `<div class="card-head"><div class="card-title">Campaign activity</div>
    <div class="card-sub">Newest first</div></div>
    <div style="max-height:50vh;overflow-y:auto">${dripAudit.length ? dripAudit.map(x => `
      <div class="list-item" style="cursor:default">
        <span class="mono t-muted">${clock(x.logged_at)}</span>
        ${pill(x.status)}
        <div style="flex:1;min-width:0">
          <div style="font-weight:500">${esc(x.lead_name || x.lead_email || x.workflow)}</div>
          <div class="cell-sub">${esc(String(x.summary || '').slice(0, 160))}</div>
        </div>
        <div class="cell-sub">${ago(x.logged_at)}</div>
      </div>`).join('')
      : stateEmpty('No campaign runs logged',
          'The drip workflow writes here every time it starts a sequence.', 'receipt_long')}</div>`;
};

/* ==========================================================================
   S10 · Deals
   Closing a deal is what feeds the RAG memory: the Closed-Won workflow embeds
   the deal and writes it to pgvector so Ask AI can reason over real sales.
   Until now that workflow could only be triggered by hand outside the product.
   ========================================================================== */
