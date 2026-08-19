/* NEXUS OS — screens/compliance.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db } from '../lib/data.js';
import { el } from '../lib/dom.js';
import { ago, clock, esc, n0, num, pill } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi, table } from '../lib/ui.js';

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
   S9 · Campaigns
   The 7-day warm drip and the 12-hour silence detector both ran entirely inside
   n8n with nothing in the product to show for them, and no way to start one.
   A campaign nobody can see or trigger is indistinguishable from a broken one —
   which is exactly how the drip sat failing on every run without being noticed.
   ========================================================================== */
