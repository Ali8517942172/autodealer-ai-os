/* NEXUS OS — screens/compliance.js
   The KYC / AML register. This is the screen an auditor or a buyer's lawyer is
   pointed at, so it holds itself to a stricter standard than the rest of the
   product: every row in kyc_documents is listed, every field the auditor
   extracted is shown, and the retention story is stated explicitly rather than
   implied by an empty cell.

   Retention has four distinct meanings and they must never be conflated:
     · purged_at set                  → the file was deleted on schedule. Correct.
     · storage_path set, no purge     → the file is archived and retrievable.
     · both null, created ON or AFTER the archive feature shipped
                                      → ARCHIVE FAILURE. A hole in the audit
                                        trail, surfaced as a banner with a count.
     · both null, created BEFORE it   → predates archiving. Explained, not flagged.
   Nothing on this screen is estimated and no row is fabricated: if a table
   cannot be read, the panel that depends on it says so. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { ago, clock, esc, n0, num, pill } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';

/* The moment the archive step went live. A row older than this was written by a
   build that never stored a file at all, so a null storage_path there is
   expected history, not a compliance failure. Flagging those would drown the
   real gaps in noise the dealership can never clear. */
const ARCHIVE_EPOCH = '2026-08-17T16:01:48Z';
const ARCHIVE_EPOCH_MS = Date.parse(ARCHIVE_EPOCH);
const ARCHIVE_EPOCH_LABEL = '17 Aug 2026 16:01 UTC';

/* The register is read newest-first with a hard cap. An auditor is entitled to
   know when they are looking at a window rather than the whole book, so when the
   read comes back exactly full the screen says so, rather than letting a capped
   page imply the dealership has only ever audited this many documents. */
const ROW_LIMIT = 500;

/* Every write path this screen would need is service-role only. Stating the
   exact missing piece on the disabled control is the difference between "this
   product is broken" and "this step is not built yet". */
const NO_DECISION_HOOK =
  'No KYC decision endpoint exists yet. kyc_documents is service-role only, and the audit-kyc webhook audits a document — it does not accept a human verdict — so the browser cannot record an approval or a rejection.';
const NO_REASK_HOOK =
  'No re-request endpoint exists yet. Asking the customer for another upload needs a WAHA send-message webhook, and none is deployed.';
const NO_FILE_LINK =
  'Documents live in the private kyc-documents bucket and can only be opened through a short-lived signed URL. There is no browser helper that mints one, so link-outs stay disabled.';
const PURGED_FILE =
  'This file was deleted on schedule under the retention policy. There is nothing left to open.';

/* Date-only columns (date_of_birth, expiry_date, retain_until) are rendered
   verbatim. Parsing "2026-08-17" into a Date and formatting it locally shifts
   it a day either side of UTC midnight, and a passport expiry that moves by a
   day depending on who is looking at it is worse than an unformatted one. */
const todayISO = () => new Date().toISOString().slice(0, 10);
const isPastDate = v => {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s < todayISO();
};

/* Two different facts hide behind one expired date and a reviewer cares about
   only one of them. An identity document that had already expired on the day it
   was audited was accepted expired — a control failure, and the first thing a
   money-laundering review looks for. One that has merely lapsed since is
   ordinary aging and is stated without alarm. Both dates come straight off the
   row; neither is inferred. */
const expiredAtAudit = d => {
  const exp = String(d.expiry_date || '').slice(0, 10);
  const aud = String(d.created_at || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(exp) && /^\d{4}-\d{2}-\d{2}$/.test(aud) && exp < aud;
};

/* ── The retention verdict for one row ───────────────────────────────────── */
const RETENTION = {
  archived: { label: 'Archived',        tone: 'ok',   icon: 'inventory_2' },
  purged:   { label: 'Purged',          tone: '',     icon: 'delete_sweep' },
  failed:   { label: 'Archive failure', tone: 'hot',  icon: 'folder_off' },
  legacy:   { label: 'Pre-archive',     tone: '',     icon: 'history' },
  unknown:  { label: 'Undated',         tone: 'warm', icon: 'help' },
};

function retentionOf(d) {
  if (d.purged_at) return { key: 'purged', detail: `File deleted on schedule ${ago(d.purged_at)}.` };
  if (d.storage_path) return { key: 'archived', detail: 'File is stored in the private kyc-documents bucket.' };
  const t = Date.parse(d.created_at);
  if (!Number.isFinite(t)) {
    return { key: 'unknown', detail: 'This row has no readable created_at timestamp, so it cannot be placed either side of the archive cut-over. It is deliberately not counted as a failure.' };
  }
  if (t < ARCHIVE_EPOCH_MS) {
    return { key: 'legacy', detail: `Audited before archiving shipped (${ARCHIVE_EPOCH_LABEL}), so no file was ever stored for it. Expected history, not a gap.` };
  }
  return { key: 'failed', detail: 'The document was audited but never written to storage, and it was not purged either. The evidence behind this verdict no longer exists.' };
}

const retentionPill = r => {
  const m = RETENTION[r.key];
  return pill(m.label, m.tone || undefined);
};

/* The other half of the retention story: a stored file whose retain_until has
   passed means the purge schedule did not run. Purged rows are excluded —
   those are the ones that worked. */
const overdueRetention = d => !d.purged_at && !!d.storage_path && isPastDate(d.retain_until);

/* The handful of row-level facts the register is actually read for. Each is a
   plain statement about one row — no score, no weighting, nothing the database
   did not say — and each is filterable so a banner can hand the reviewer the
   exact set it just counted instead of a number and a hunt. */
const finalAttempt = d => {
  const a = n0(d.attempt_number), m = n0(d.max_attempts);
  return a != null && m != null && a >= m;
};
const FLAGS = {
  expired:   { label: 'Expired when audited',  match: expiredAtAudit },
  tampering: { label: 'Tampering detected',    match: d => !!d.tampering },
  invalid:   { label: 'Marked not valid',      match: d => d.is_valid === false },
  final:     { label: 'Final attempt reached', match: finalAttempt },
  overdue:   { label: 'Purge overdue',         match: overdueRetention },
};
const FLAG_KEYS = Object.keys(FLAGS);

SCREENS.compliance = async host => {
  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const banners = el('div'); banners.style.marginTop = '16px'; host.appendChild(banners);
  const body = el('div'); body.style.marginTop = '16px'; host.appendChild(body);

  /* allSettled, not catch(() => []): a table that failed to load and a table
     with no rows look identical once the error is swallowed, and on this screen
     "there are no rejected documents" and "we could not read the register" are
     opposite answers. */
  const [docsR, auditR, commsR] = await Promise.allSettled([
    db(`kyc_documents?select=*&order=created_at.desc&limit=${ROW_LIMIT}`),
    /* ilike rather than one exact workflow name, so a renamed or versioned KYC
       workflow keeps appearing here instead of silently dropping out. */
    db('audit_log?select=*&workflow=ilike.*KYC*&order=logged_at.desc&limit=200'),
    db('communication_logs?select=lead_email,message,created_at&order=created_at.desc&limit=500'),
  ]);

  const docs = docsR.status === 'fulfilled' ? docsR.value : null;
  const docsErr = docsR.status === 'rejected' ? (docsR.reason?.message || 'Unknown error') : null;
  const audit = auditR.status === 'fulfilled' ? auditR.value : null;
  const auditErr = auditR.status === 'rejected' ? (auditR.reason?.message || 'Unknown error') : null;
  const comms = commsR.status === 'fulfilled' ? commsR.value : null;
  const commsErr = commsR.status === 'rejected' ? (commsR.reason?.message || 'Unknown error') : null;

  const kycComms = (comms || []).filter(c => String(c.message || '').startsWith('[KYC-'));
  const escalations = (audit || []).filter(a => a.status === 'ESCALATED');

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  if (!docs) {
    /* A full-width failure notice, not one squeezed into the first of five
       columns where it reads as a broken tile rather than a message. */
    strip.classList.remove('grid', 'g5');
    strip.innerHTML = stateError('the KYC register', docsErr);
  } else {
    const verdict = v => docs.filter(d => String(d.verdict || '').toUpperCase() === v).length;
    const failures = docs.filter(d => retentionOf(d).key === 'failed').length;
    const legacyApproved = kycComms.filter(c => c.message.startsWith('[KYC-APPROVED]')).length;
    const legacyRejected = kycComms.filter(c => c.message.startsWith('[KYC-REJECT]')).length;
    const noVerdict = docs.filter(d => !d.verdict).length;

    strip.innerHTML = [
      kpi('Documents on file', num(docs.length),
        docs.length
          ? (noVerdict
              ? `<span class="t-warm">${num(noVerdict)} carr${noVerdict === 1 ? 'ies' : 'y'} no verdict yet</span>`
              : '<span class="t-muted">Every row carries an auditor verdict</span>')
          : 'The KYC workflow has not written a record yet'),
      kpi('Approved', num(verdict('APPROVED')),
        legacyApproved ? `<span class="t-muted">${num(legacyApproved)} older approval${legacyApproved === 1 ? ' exists' : 's exist'} only as a message log</span>` : ''),
      kpi('Rejected', num(verdict('REJECTED')),
        legacyRejected ? `<span class="t-muted">${num(legacyRejected)} older rejection${legacyRejected === 1 ? ' exists' : 's exist'} only as a message log</span>` : ''),
      kpi('Escalated to a human', num(verdict('ESCALATED')),
        escalations.length
          ? `<span class="t-warm">${num(escalations.length)} escalation${escalations.length === 1 ? '' : 's'} logged by the auditor workflow</span>`
          : (auditErr ? '<span class="t-muted">Audit log could not be read</span>' : '')),
      kpi('Archive failures', num(failures),
        failures
          ? '<span class="t-hot">Audited, never stored, never purged</span>'
          : '<span class="t-ok">Every document after the cut-over is accounted for</span>',
        failures ? 't-hot' : ''),
    ].join('');
  }

  /* ── Banners ───────────────────────────────────────────────────────────── */
  /* Every banner states a count and then hands the reviewer that exact set.
     A banner that reports "3 documents have no archived file" and then leaves
     you to reconstruct the filter by hand is a dead end, and the two can drift
     apart. They all drive one setter, which moves the controls and the rows
     together, so the filter row can never disagree with the list under it. */
  let focusRegister = () => {};

  if (docs) {
    const failed = docs.filter(d => retentionOf(d).key === 'failed');
    const overdue = docs.filter(overdueRetention);

    if (failed.length) {
      /* docs arrive newest-first, so the last failure in the list is the oldest
         one — the row that has been unprovable the longest. */
      const oldest = failed[failed.length - 1];
      const b = el('div', 'banner hot');
      b.style.marginBottom = '12px';
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">folder_off</span>
        <div style="flex:1">
          <strong>${num(failed.length)} document${failed.length === 1 ? ' has' : 's have'} no archived file.</strong>
          Audited after ${esc(ARCHIVE_EPOCH_LABEL)} with <span class="mono">storage_path</span> null and no
          <span class="mono">purged_at</span>, so the evidence behind ${failed.length === 1 ? 'that verdict' : 'those verdicts'} cannot be produced on request.
          Oldest audited ${esc(ago(oldest.created_at))}.
        </div>
        <button class="btn sm" id="cShowFailed">Show ${failed.length === 1 ? 'it' : 'them'}</button>`;
      banners.appendChild(b);
      b.querySelector('#cShowFailed').addEventListener('click', () => focusRegister({ retention: 'failed' }));
    }

    if (overdue.length) {
      const b = el('div', 'banner warm');
      b.style.marginBottom = '12px';
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">schedule</span>
        <div style="flex:1"><strong>${num(overdue.length)} archived file${overdue.length === 1 ? ' is' : 's are'} past retain_until and still stored.</strong>
        The purge schedule has not run for ${overdue.length === 1 ? 'it' : 'them'}. Deleting stored documents is a service-role job; nothing in the browser can do it.</div>
        <button class="btn sm" id="cShowOverdue">Show ${overdue.length === 1 ? 'it' : 'them'}</button>`;
      banners.appendChild(b);
      b.querySelector('#cShowOverdue').addEventListener('click', () => focusRegister({ flag: 'overdue' }));
    }

    /* Accepted-while-expired is the one finding on this screen that is about the
       decision rather than the paperwork around it: the auditor approved an
       identity document that had already lapsed on the day it read it. Only
       APPROVED rows are counted — a rejected expired document is the control
       working, not failing. */
    const acceptedExpired = docs.filter(d =>
      expiredAtAudit(d) && String(d.verdict || '').toUpperCase() === 'APPROVED');
    if (acceptedExpired.length) {
      const b = el('div', 'banner warm');
      b.style.marginBottom = '12px';
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">event_busy</span>
        <div style="flex:1"><strong>${num(acceptedExpired.length)} approved document${acceptedExpired.length === 1 ? ' had' : 's had'} already expired when audited.</strong>
        The expiry date on the document predates the day it was checked, so ${acceptedExpired.length === 1 ? 'that identity was' : 'those identities were'} accepted on lapsed ID.</div>
        <button class="btn sm" id="cShowExpired">Show ${acceptedExpired.length === 1 ? 'it' : 'them'}</button>`;
      banners.appendChild(b);
      b.querySelector('#cShowExpired').addEventListener('click', () =>
        focusRegister({ flag: 'expired', verdict: 'APPROVED' }));
    }
  }

  if (escalations.length) {
    const b = el('div', 'banner warm');
    b.style.marginBottom = '12px';
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">block</span>
      <div><strong>${num(escalations.length)} case${escalations.length === 1 ? ' needs' : 's need'} a human.</strong>
      ${esc(escalations[0].summary || 'The retry loop gave up.')}</div>`;
    banners.appendChild(b);
  }

  /* ── Retention position ────────────────────────────────────────────────── */
  const retCard = el('div', 'card'); body.appendChild(retCard);
  if (!docs) {
    retCard.innerHTML = stateError('the retention breakdown', docsErr);
  } else if (!docs.length) {
    retCard.innerHTML = `<div class="label-caps">Retention position</div>${stateEmpty(
      'Nothing to retain yet',
      'No KYC document has been audited, so there is no retention position to report.', 'shield')}`;
  } else {
    const order = ['archived', 'purged', 'legacy', 'unknown', 'failed'];
    const colour = { archived: 'var(--ok)', purged: 'var(--cold)', legacy: 'var(--neutral)', unknown: 'var(--warm)', failed: 'var(--hot)' };
    const counts = {};
    docs.forEach(d => { const k = retentionOf(d).key; counts[k] = (counts[k] || 0) + 1; });
    const present = order.filter(k => counts[k]);
    const total = docs.length;
    const withRetain = docs.filter(d => d.retain_until).length;
    retCard.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Retention position · ${num(total)} document${total === 1 ? '' : 's'}</div>
      <div class="stackbar">${present.map(k => `<i style="width:${(counts[k] / total * 100).toFixed(1)}%;background:${colour[k]}"></i>`).join('')}</div>
      <div style="display:flex;gap:20px;margin-top:12px;flex-wrap:wrap">
        ${present.map(k => `<div style="display:flex;align-items:center;gap:8px">
          <span style="width:8px;height:8px;border-radius:50%;background:${colour[k]}"></span>
          <span style="font-weight:500">${esc(RETENTION[k].label)}</span>
          <span class="t-muted num">${num(counts[k])}</span></div>`).join('')}
      </div>
      <div class="cell-sub" style="margin-top:12px;white-space:normal">
        ${num(withRetain)} of ${num(total)} row${total === 1 ? '' : 's'} carry a retain_until date.
        Rows audited before ${esc(ARCHIVE_EPOCH_LABEL)} predate the archive step and are labelled Pre-archive rather than counted as failures.
      </div>`;
  }

  /* ── The register ──────────────────────────────────────────────────────── */
  const queue = el('div', 'card flush'); queue.style.marginTop = '16px'; body.appendChild(queue);

  if (!docs) {
    queue.innerHTML = `<div class="card-head"><div><div class="card-title">KYC register</div></div></div>
      ${stateError('the KYC register', docsErr)}`;
  } else {
    const up = s => String(s || '').toUpperCase();
    const low = s => String(s || '').toLowerCase();
    const f = { verdict: 'ALL', retention: 'ALL', flag: 'ALL', q: '' };

    const vCount = v => docs.filter(d => up(d.verdict) === v).length;
    const noVerdict = docs.filter(d => !d.verdict).length;
    const segs = [['ALL', docs.length], ['APPROVED', vCount('APPROVED')], ['REJECTED', vCount('REJECTED')], ['ESCALATED', vCount('ESCALATED')]];
    if (noVerdict) segs.push(['NONE', noVerdict]);
    const retCounts = {};
    docs.forEach(d => { const k = retentionOf(d).key; retCounts[k] = (retCounts[k] || 0) + 1; });
    const flagCounts = {};
    FLAG_KEYS.forEach(k => { flagCounts[k] = docs.filter(FLAGS[k].match).length; });
    /* Exactly full means the cap was hit, which is the only thing the browser can
       know without a count query. Saying "the newest 500" is honest; saying
       nothing would let a capped page read as the complete book. */
    const capped = docs.length >= ROW_LIMIT;

    queue.innerHTML = `<div class="card-head"><div>
        <div class="card-title">KYC register</div>
        <div class="card-sub">Every audited document with its extracted identity fields, attempt counter and retention state. Click a row for the full record.${
          capped ? ` <span class="t-warm">Showing the ${num(ROW_LIMIT)} most recent rows — this read is capped, so older documents are not on this page.</span>` : ''}</div>
      </div></div>
      <div class="toolbar">
        <div class="seg" id="cSegVerdict" role="group" aria-label="Filter by verdict">
          ${segs.map(([k, c], i) => `<button data-v="${esc(k)}" class="${i === 0 ? 'on' : ''}">${k === 'ALL' ? 'All' : k === 'NONE' ? 'No verdict' : esc(k)} · ${num(c)}</button>`).join('')}
        </div>
        <div class="grow"><input type="search" id="cq" aria-label="Search KYC documents"
          placeholder="Search name, email, document type or chat id" /></div>
        <select id="cRet" aria-label="Filter by retention state" style="width:auto">
          <option value="ALL">All retention states</option>
          ${['archived', 'purged', 'failed', 'legacy', 'unknown'].map(k =>
            `<option value="${k}">${esc(RETENTION[k].label)} · ${num(retCounts[k] || 0)}</option>`).join('')}
        </select>
        <select id="cFlag" aria-label="Filter by finding" style="width:auto">
          <option value="ALL">All findings</option>
          ${FLAG_KEYS.map(k =>
            `<option value="${esc(k)}">${esc(FLAGS[k].label)} · ${num(flagCounts[k])}</option>`).join('')}
        </select>
        <div class="t-muted num" id="cCount"></div>
      </div>
      <div id="cTable"></div>`;

    const cols = [
      { label: 'Customer', strong: true, render: d => `${esc(d.lead_name || d.full_name || 'Unknown contact')}
          <div class="cell-sub">${esc(d.lead_email || 'No email on the record')}</div>` },
      { label: 'Document', render: d => `${esc(d.document_type || '—')}
          ${d.chat_id ? `<div class="cell-sub mono">${esc(d.chat_id)}</div>` : ''}` },
      { label: 'Verdict', render: d => `${d.verdict ? pill(d.verdict) : '<span class="t-muted">Not decided</span>'}
          ${d.reviewed_by ? `<div class="cell-sub">by ${esc(d.reviewed_by)}${d.reviewed_at ? ' · ' + esc(ago(d.reviewed_at)) : ''}</div>` : ''}` },
      { label: 'Extracted identity', render: d => {
          if (!d.full_name && !d.date_of_birth && !d.expiry_date) return '<span class="t-muted">Nothing extracted</span>';
          /* Expired when audited is red; expired since is amber. Painting both
             the same colour makes a paperwork chore look like a control failure
             and buries the rows that are one. */
          const atAudit = expiredAtAudit(d);
          const lapsed = !atAudit && isPastDate(d.expiry_date);
          const note = atAudit ? ' (expired when audited)' : lapsed ? ' (expired since)' : '';
          const cls = atAudit ? 't-hot' : lapsed ? 't-warm' : '';
          return `<div>${esc(d.full_name || '—')}</div>
            <div class="cell-sub">DOB ${d.date_of_birth ? esc(d.date_of_birth) : '—'} · expires
              ${d.expiry_date ? `<span class="${cls}">${esc(d.expiry_date)}${note}</span>` : '—'}</div>`;
        } },
      { label: 'Checks', render: d => {
          const bits = [d.tampering ? pill('Tampering', 'hot') : '<span class="t-muted">No tampering</span>'];
          if (d.is_valid === false) bits.push(pill('Not valid', 'hot'));
          else if (d.is_valid === true) bits.push(pill('Valid', 'ok'));
          if (expiredAtAudit(d)) bits.push(pill('Expired when audited', 'hot'));
          if (finalAttempt(d) && String(d.verdict || '').toUpperCase() !== 'APPROVED') bits.push(pill('Retries exhausted', 'warm'));
          return `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${bits.join('')}</div>`;
        } },
      { label: 'Confidence', align: 'r', render: d => {
          const c = n0(d.confidence_score);
          if (c == null) return '<span class="t-muted">—</span>';
          const w = Math.max(0, Math.min(100, c));
          return `<div>${num(c)}%</div><div class="bar" style="width:56px;margin-left:auto"><i style="width:${w}%;background:var(--${c > 70 ? 'ok' : c > 40 ? 'warm' : 'hot'})"></i></div>`;
        } },
      { label: 'Attempt', align: 'r', render: d => {
          const a = n0(d.attempt_number), m = n0(d.max_attempts);
          if (a == null) return '<span class="t-muted">—</span>';
          const last = m != null && a >= m;
          return `<span class="${last ? 't-hot' : ''}">${num(a)}${m != null ? ` of ${num(m)}` : ''}</span>
            ${last ? '<div class="cell-sub t-hot">Final attempt</div>' : ''}`;
        } },
      { label: 'Retention', render: d => {
          const r = retentionOf(d);
          const od = overdueRetention(d);
          const sub = d.purged_at
            ? `purged ${esc(ago(d.purged_at))}`
            : d.retain_until
              ? `retain until ${esc(d.retain_until)}${od ? ' · overdue' : ''}`
              : 'no retain_until set';
          return `${retentionPill(r)}<div class="cell-sub ${od ? 't-warm' : ''}">${sub}</div>`;
        } },
      { label: 'Submitted', render: d => `<span class="t-muted">${esc(ago(d.created_at))}</span>` },
      { label: 'Decision', align: 'r', render: d => {
          const who = d.lead_name || d.lead_email || 'this document';
          const btn = (label, title) => `<button class="btn sm" disabled
            aria-label="${esc(label)} — ${esc(who)}" title="${esc(title)}">${esc(label)}</button>`;
          return `<div style="display:flex;gap:6px;justify-content:flex-end">
            ${btn('Approve', NO_DECISION_HOOK)}${btn('Reject', NO_DECISION_HOOK)}${btn('Re-ask', NO_REASK_HOOK)}</div>`;
        } },
    ];

    const th = queue.querySelector('#cTable');
    const countEl = queue.querySelector('#cCount');

    const visible = () => {
      const q = f.q.trim().toLowerCase();
      return docs.filter(d => {
        if (f.verdict === 'NONE') { if (d.verdict) return false; }
        else if (f.verdict !== 'ALL' && up(d.verdict) !== f.verdict) return false;
        if (f.retention !== 'ALL' && retentionOf(d).key !== f.retention) return false;
        if (f.flag !== 'ALL' && !FLAGS[f.flag].match(d)) return false;
        if (!q) return true;
        return [d.lead_name, d.full_name, d.lead_email, d.document_type, d.chat_id].some(v => low(v).includes(q));
      });
    };

    function draw() {
      if (!docs.length) {
        countEl.textContent = '';
        th.innerHTML = stateEmpty('No documents in the register',
          'The KYC workflow writes here once it audits a document. Historic activity is shown below.', 'verified_user');
        return;
      }
      const rows = visible();
      countEl.textContent = `${rows.length} of ${docs.length}`;
      th.innerHTML = table(cols, rows, {
        onRow: true,
        empty: stateEmpty('No document matches these filters',
          'Clear the search or pick another verdict, retention state or finding.', 'filter_alt_off'),
      });
      wireRows(th, rows, openDoc);
    }

    queue.querySelectorAll('#cSegVerdict button').forEach(b => b.addEventListener('click', () => {
      queue.querySelectorAll('#cSegVerdict button').forEach(x => x.classList.toggle('on', x === b));
      f.verdict = b.dataset.v; draw();
    }));
    queue.querySelector('#cq').addEventListener('input', e => { f.q = e.target.value; draw(); });
    queue.querySelector('#cRet').addEventListener('change', e => { f.retention = e.target.value; draw(); });
    queue.querySelector('#cFlag').addEventListener('change', e => { f.flag = e.target.value; draw(); });

    /* Every banner's "Show them" lands here: it sets the whole filter state at
       once, writes it back into the controls, and scrolls the register into
       view. Clearing the fields it was not asked for is deliberate — a leftover
       search box silently hiding half of the rows the banner just counted is
       the failure mode this exists to prevent. */
    focusRegister = ({ verdict = 'ALL', retention = 'ALL', flag = 'ALL' } = {}) => {
      f.verdict = verdict; f.retention = retention; f.flag = flag; f.q = '';
      queue.querySelector('#cRet').value = retention;
      queue.querySelector('#cFlag').value = flag;
      queue.querySelector('#cq').value = '';
      queue.querySelectorAll('#cSegVerdict button').forEach(x => x.classList.toggle('on', x.dataset.v === verdict));
      draw();
      queue.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    draw();
  }

  /* ── One document, in full ─────────────────────────────────────────────── */
  function openDoc(d) {
    const r = retentionOf(d);
    const m = RETENTION[r.key];
    const od = overdueRetention(d);
    const conf = n0(d.confidence_score);
    const a = n0(d.attempt_number), mx = n0(d.max_attempts);
    const atAudit = expiredAtAudit(d);
    const lapsed = !atAudit && isPastDate(d.expiry_date);
    const fileTitle = d.purged_at ? PURGED_FILE : NO_FILE_LINK;

    /* Re-uploads from the same customer are separate rows that relate to each
       other only through attempt_number, so a reviewer reading one row cannot
       see that it is the fourth try. Three rejections then an approval is a
       different story from a single clean pass, and the story is the thing the
       lawyer asked for. Rows are matched on the exact lead_email or chat_id the
       workflow wrote — never on a name, which two customers can share. */
    const key = v => String(v || '').trim().toLowerCase();
    const chain = (docs || []).filter(x =>
      (key(d.lead_email) && key(x.lead_email) === key(d.lead_email)) ||
      (key(d.chat_id) && key(x.chat_id) === key(d.chat_id))
    ).slice().sort((x, y) =>
      ((n0(x.attempt_number) || 0) - (n0(y.attempt_number) || 0)) ||
      (new Date(x.created_at) - new Date(y.created_at)));
    const chainHtml = chain.length > 1
      ? `<div class="timeline" style="margin-top:8px">${chain.map(x => {
          const xa = n0(x.attempt_number);
          const here = x === d;
          return `<div class="tl-item">
            <span class="tl-dot" style="background:var(--${here ? 'primary' : 'neutral'})"></span>
            <div class="tl-body">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <span style="font-weight:500">Attempt ${xa == null ? '—' : num(xa)}</span>
                ${x.verdict ? pill(x.verdict) : '<span class="t-muted">No verdict</span>'}
                ${here ? '<span class="chip">Viewing</span>' : ''}
              </div>
              <div class="tl-meta">${esc(x.document_type || 'Unknown document')} · ${esc(ago(x.created_at))}
                ${n0(x.confidence_score) == null ? '' : ' · ' + num(x.confidence_score) + '% confidence'}
                · ${esc(RETENTION[retentionOf(x).key].label.toLowerCase())}</div>
            </div></div>`;
        }).join('')}</div>`
      : (n0(d.attempt_number) || 0) > 1
        ? `<div class="cell-sub" style="margin-top:8px;white-space:normal">This is attempt ${num(d.attempt_number)}, but no earlier attempt for this customer is in the ${num(ROW_LIMIT)} rows loaded here. The earlier rows may simply be older than this page reaches.</div>`
        : '<div class="cell-sub" style="margin-top:8px">Only one upload from this customer is on file.</div>';

    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1">
          <h2 style="font-size:18px">${esc(d.lead_name || d.full_name || 'Unknown contact')}</h2>
          <div class="cell-sub">${esc(d.document_type || 'Unknown document')} · submitted ${esc(ago(d.created_at))}</div>
          <div class="cell-sub mono">${esc(d.id ?? '')}</div>
        </div>
        <button class="btn ghost sm" id="cClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section">
          <div class="label-caps">Verdict</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${d.verdict ? pill(d.verdict) : '<span class="t-muted">No verdict recorded</span>'}
            ${d.tampering ? pill('Tampering detected', 'hot') : ''}
            ${d.is_valid === false ? pill('Not valid', 'hot') : d.is_valid === true ? pill('Valid', 'ok') : ''}
          </div>
          <dl class="kv" style="margin-top:12px">
            <dt>Confidence</dt><dd class="num">${conf == null ? '<span class="t-muted">Not scored</span>' : num(conf) + '%'}</dd>
            <dt>Attempt</dt><dd class="num">${a == null ? '<span class="t-muted">—</span>' : num(a) + (mx != null ? ` of ${num(mx)}` : '')}</dd>
            <dt>Reviewed by</dt><dd>${d.reviewed_by ? esc(d.reviewed_by) : '<span class="t-muted">Not reviewed by a human</span>'}</dd>
            <dt>Reviewed at</dt><dd>${d.reviewed_at ? esc(ago(d.reviewed_at)) : '<span class="t-muted">—</span>'}</dd>
          </dl>
          ${d.remarks ? `<div class="quote" style="margin-top:12px">${esc(d.remarks)}</div>` : ''}
        </div>

        <div class="section">
          <div class="label-caps">Extracted identity</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Full name</dt><dd>${d.full_name ? esc(d.full_name) : '<span class="t-muted">Not extracted</span>'}</dd>
            <dt>Date of birth</dt><dd>${d.date_of_birth ? esc(d.date_of_birth) : '<span class="t-muted">Not extracted</span>'}</dd>
            <dt>Expiry date</dt><dd>${d.expiry_date
              ? `<span class="${atAudit ? 't-hot' : lapsed ? 't-warm' : ''}">${esc(d.expiry_date)}${
                  atAudit ? ' · already expired on the day it was audited' : lapsed ? ' · expired since it was audited' : ''}</span>`
              : '<span class="t-muted">Not extracted</span>'}</dd>
            <dt>Contact email</dt><dd>${d.lead_email ? esc(d.lead_email) : '<span class="t-muted">—</span>'}</dd>
            <dt>Chat id</dt><dd class="mono">${d.chat_id ? esc(d.chat_id) : '—'}</dd>
          </dl>
        </div>

        <div class="section">
          <div class="label-caps">Attempt history</div>
          ${chainHtml}
        </div>

        <div class="section">
          <div class="label-caps">Retention</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
            <span class="material-symbols-outlined ${r.key === 'failed' ? 't-hot' : r.key === 'archived' ? 't-ok' : 't-muted'}">${esc(m.icon)}</span>
            ${retentionPill(r)}
          </div>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(r.detail)}</div>
          ${od ? `<div class="banner warm" style="margin-top:12px"><span class="material-symbols-outlined">schedule</span>
            <div>retain_until has passed and the file is still stored. The purge schedule has not run for this row.</div></div>` : ''}
          <dl class="kv" style="margin-top:12px">
            <dt>storage_path</dt><dd class="mono" style="word-break:break-all">${d.storage_path ? esc(d.storage_path) : '<span class="t-muted">null</span>'}</dd>
            <dt>retain_until</dt><dd>${d.retain_until ? `<span class="${od ? 't-warm' : ''}">${esc(d.retain_until)}</span>` : '<span class="t-muted">null</span>'}</dd>
            <dt>purged_at</dt><dd>${d.purged_at ? esc(ago(d.purged_at)) : '<span class="t-muted">null</span>'}</dd>
            <dt>Audited</dt><dd>${esc(ago(d.created_at))}</dd>
          </dl>
        </div>
      </div>
      <div class="drawer-foot">
        <button class="btn primary" disabled title="${esc(NO_DECISION_HOOK)}">Approve</button>
        <button class="btn danger" disabled title="${esc(NO_DECISION_HOOK)}">Reject</button>
        <button class="btn" disabled title="${esc(NO_REASK_HOOK)}">Re-request upload</button>
        <button class="btn ghost" disabled title="${esc(fileTitle)}">Open file</button>
      </div>`);
    $('cClose').addEventListener('click', closeDrawer);
  }

  /* ── Activity trail ────────────────────────────────────────────────────── */
  const hist = el('div', 'card flush'); hist.style.marginTop = '16px'; body.appendChild(hist);
  const down = [auditErr ? 'the audit log' : '', commsErr ? 'the message log' : ''].filter(Boolean);
  const events = [
    ...kycComms.map(c => ({ at: c.created_at, who: c.lead_email, text: c.message,
      kind: c.message.startsWith('[KYC-APPROVED]') ? 'APPROVED' : 'REJECTED' })),
    ...(audit || []).map(a => ({ at: a.logged_at, who: a.lead_email || a.lead_name, text: a.summary, kind: a.status })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  const trailBody = (auditErr && commsErr)
    ? stateError('KYC activity', auditErr)
    : events.length
      ? events.map(e => `
        <div class="list-item" style="cursor:default">
          <span class="mono t-muted">${esc(clock(e.at))}</span>
          ${pill(e.kind || 'LOGGED')}
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${esc(e.who || 'Unknown contact')}</div>
            <div class="cell-sub">${esc(String(e.text || '').slice(0, 180))}</div></div>
          <div class="cell-sub">${esc(ago(e.at))}</div>
        </div>`).join('')
      : stateEmpty('No KYC activity recorded', 'Nothing has passed through the auditor yet.', 'history');

  hist.innerHTML = `<div class="card-head"><div><div class="card-title">KYC activity</div>
      <div class="card-sub">Auditor runs from audit_log and customer-facing KYC messages from communication_logs</div></div></div>
    ${down.length && !(auditErr && commsErr) ? `<div style="padding:14px 20px 0"><div class="banner warm">
      <span class="material-symbols-outlined">warning</span>
      <div>Could not read ${esc(down.join(' or '))} (${esc(auditErr || commsErr)}), so this trail is incomplete.</div></div></div>` : ''}
    <div>${trailBody}</div>`;
};

/* ==========================================================================
   S9 · Campaigns
   The 7-day warm drip and the 12-hour silence detector both ran entirely inside
   n8n with nothing in the product to show for them, and no way to start one.
   A campaign nobody can see or trigger is indistinguishable from a broken one —
   which is exactly how the drip sat failing on every run without being noticed.
   ========================================================================== */
