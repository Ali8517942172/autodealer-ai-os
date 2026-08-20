/* NEXUS OS — screens/campaigns.js
   Rebuilt on 19 Aug 2026 from "a list of leads with a Start drip button" into
   the drip surface proper: who is enrolled, what has actually been sent, and
   one guarded way to enrol somebody else.

   The thing this screen has to be honest about is that *enrolling* and
   *sending* are two different events. The 7-day sequence is queued inside n8n
   the moment `lead-trigger` returns 2xx, but every send step in that sequence
   goes out through Gmail and that credential is currently revoked. So the
   product can truthfully report a lead as enrolled while nothing whatsoever
   reaches the customer. That gap is stated in a banner at the top of the
   screen instead of being left for somebody to discover a week later, and it is
   repeated inside the confirm dialog, because the dialog is where the decision
   is actually taken.

   Nothing here writes to the database. `communication_logs` and `audit_log` are
   service-role only; this screen reads them and calls exactly one n8n webhook.
   Every count below is a count of rows Postgres returned — there is no
   estimated, projected or example figure anywhere on this screen. */
import { HOOK, db, n8n } from '../lib/data.js';
import { el } from '../lib/dom.js';
import { N8N_BASE } from '../lib/env.js';
import { aed, ago, clock, esc, n0, num, pill } from '../lib/format.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { openModal } from '../lib/modal.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi, table, wireRows } from '../lib/ui.js';

/* Bounded reads. An unbounded select is how a screen starts timing out once the
   dealership has a year of history behind it; where a cap is actually hit it is
   said out loud, because a truncated roster that looks complete is a lie about
   how many customers are mid-sequence. */
const LOG_LIMIT   = 1000;
const AUDIT_LIMIT = 1000;

const low = s => String(s || '').trim().toLowerCase();
const ts  = v => { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; };
const stamp = v => { const t = Date.parse(v); return Number.isNaN(t) ? 'no timestamp recorded' : new Date(t).toLocaleString('en-GB'); };

/* Written once, shown in three places: the page banner, the confirm dialog and
   the title of every enrol button. The operator should not be able to reach the
   irreversible click without having been told. */
const GMAIL_REVOKED =
  'The drip sends through Gmail and that Gmail credential is currently revoked in n8n. '
  + 'Enrolling queues the sequence, but no email leaves until Gmail is reconnected.';

/* n8n does not expose credential state to the browser, so this banner is a
   hand-recorded operating condition rather than a reading. Saying which it is
   matters: a reader must not assume it will clear itself once Gmail is fixed. */
const GMAIL_NOT_PROBED =
  'This is a known operating condition recorded by hand. n8n does not expose credential '
  + 'health to the dashboard, so this banner cannot clear itself — remove it once Gmail is reconnected.';

/* A drip message is an outbound row whose channel mentions mail, which catches
   "email" and "gmail" both. communication_logs records no workflow id, so mail
   the drip sent cannot be told apart from mail anything else sent; the panel
   below says so rather than labelling all of it as drip output. */
const isMail = c => /mail/i.test(String(c.channel || ''));

const FILTERS = [
  ['new', 'Not yet enrolled'],
  ['on',  'Enrolled'],
  ['all', 'All warm & cold'],
];

SCREENS.campaigns = async host => {
  const bannerHost = el('div');
  const strip      = el('div', 'grid g5');
  const enrolCard  = el('div', 'card flush');
  const midRow     = el('div', 'grid g2 top');
  const rosterCard = el('div', 'card flush');
  const mailCard   = el('div', 'card flush');
  const lowRow     = el('div', 'grid g2 top');
  const silenceCard  = el('div', 'card flush');
  const activityCard = el('div', 'card flush');

  enrolCard.style.marginTop = '16px';
  midRow.style.marginTop    = '16px';
  lowRow.style.marginTop    = '16px';
  midRow.appendChild(rosterCard); midRow.appendChild(mailCard);
  lowRow.appendChild(silenceCard); lowRow.appendChild(activityCard);
  [bannerHost, strip, enrolCard, midRow, lowRow].forEach(n => host.appendChild(n));

  await boot();

  async function boot() {
    /* ── Loading ─────────────────────────────────────────────────────────── */
    bannerHost.innerHTML = '';
    strip.innerHTML = stateLoading(2);
    [enrolCard, rosterCard, mailCard, silenceCard, activityCard]
      .forEach(c => { c.innerHTML = stateLoading(5); });

    /* ── Core read ───────────────────────────────────────────────────────────
       One read feeds the strip, the roster, the mail log and the enrol table,
       so the four cannot contradict each other. If it fails, every region says
       so and offers a Retry that genuinely refetches. */
    let leads, comms, audit;
    try {
      [leads, comms, audit] = await Promise.all([
        db('leads?select=*,users(id,name)&order=created_at.desc&limit=1000'),
        db(`communication_logs?select=id,lead_email,direction,message,channel,created_at&order=created_at.desc&limit=${LOG_LIMIT}`),
        db(`audit_log?select=workflow,status,lead_name,lead_email,summary,logged_at&order=logged_at.desc&limit=${AUDIT_LIMIT}`),
      ]);
    } catch (e) {
      strip.innerHTML = stateError('the campaign summary', e.message);
      [['the enrolment list', enrolCard], ['the enrolment roster', rosterCard],
       ['the mail log', mailCard], ['the silence detector', silenceCard],
       ['campaign activity', activityCard]].forEach(([what, card]) => {
        card.innerHTML = stateError(what, e.message, 'reload');
        card.querySelector('[data-retry]')?.addEventListener('click', boot);
      });
      return;
    }

    /* ── Which audit rows belong to the drip ─────────────────────────────────
       workflow_registry exists for exactly this mapping: `audit_name` plus
       `audit_aliases[]` tie a workflow's n8n name to the string it writes into
       audit_log. Reading it means the roster is not built on a guessed regex.
       Where the registry cannot be read, or holds no workflow pointing at the
       lead-trigger webhook, the fallback is a name match and the difference is
       stated on screen rather than hidden. */
    let registry = null;
    const notes = [];
    try {
      registry = await db('workflow_registry?select=name,audit_name,audit_aliases,category,trigger_detail,is_active,writes_audit_log');
    } catch (e) {
      notes.push(`workflow_registry could not be read (${e.message}), so drip runs are matched on the workflow name instead of the registry's audit aliases.`);
    }

    const dripFlows = (registry || []).filter(w =>
      low(w.trigger_detail).includes(HOOK.warmDrip)
      || /drip|nurture/i.test(`${w.name || ''} ${w.category || ''}`));
    const dripNames = new Set();
    for (const w of dripFlows) {
      [w.name, w.audit_name, ...(Array.isArray(w.audit_aliases) ? w.audit_aliases : [])]
        .filter(Boolean).forEach(n => dripNames.add(low(n)));
    }
    const matchedByRegistry = dripNames.size > 0;
    const isDrip = a => matchedByRegistry
      ? dripNames.has(low(a.workflow))
      : /drip|nurture/i.test(String(a.workflow || ''));

    if (registry && !matchedByRegistry) {
      notes.push('No workflow_registry row points at the lead-trigger webhook or is named as a drip, so runs are matched on the workflow name.');
    }
    /* An empty roster has two very different causes and they must not look
       alike: nobody enrolled, or the workflow never writes an audit row. */
    const instrumented = matchedByRegistry ? dripFlows.some(w => w.writes_audit_log) : null;
    if (dripFlows.length && dripFlows.every(w => w.is_active === false)) {
      notes.push('Every registered drip workflow is marked inactive in workflow_registry, so an enrolment may not be picked up at all.');
    }
    if (comms.length >= LOG_LIMIT) notes.push(`Only the newest ${num(LOG_LIMIT)} messages were read, so older drip mail is not counted here.`);
    if (audit.length >= AUDIT_LIMIT) notes.push(`Only the newest ${num(AUDIT_LIMIT)} audit rows were read, so enrolments older than those are missing from the roster.`);

    /* ── Derive ──────────────────────────────────────────────────────────── */
    const dripRuns = audit.filter(isDrip);

    /* audit_log arrives newest first, so the first row seen for an address is
       the latest run and the last one seen is the original enrolment. */
    const roster = new Map();
    for (const a of dripRuns) {
      const k = low(a.lead_email);
      if (!k) continue;
      let r = roster.get(k);
      if (!r) { r = { key: k, email: a.lead_email, name: a.lead_name || null, runs: 0, failures: 0, last: a, first: a }; roster.set(k, r); }
      r.runs++;
      if (['FAILED', 'REJECTED'].includes(String(a.status || '').toUpperCase())) r.failures++;
      if (!r.name && a.lead_name) r.name = a.lead_name;
      r.first = a;                                   // overwritten until the oldest row wins
    }
    const unkeyedRuns = dripRuns.filter(a => !low(a.lead_email)).length;

    const outbound = comms.filter(c => low(c.direction) === 'outbound');
    const mail     = outbound.filter(isMail).sort((a, b) => ts(b.created_at) - ts(a.created_at));
    const mailBy   = new Map();
    for (const m of mail) {
      const k = low(m.lead_email);
      if (!k) continue;
      (mailBy.get(k) || mailBy.set(k, []).get(k)).push(m);
    }
    const lastMail = mail[0] || null;

    const silenced = comms.filter(c => String(c.message || '').startsWith('[SILENCE-ESCALATED]'));

    const leadByEmail = new Map();
    leads.forEach(l => { const k = low(l.email); if (k && !leadByEmail.has(k)) leadByEmail.set(k, l); });
    roster.forEach(r => { if (!r.name) r.name = leadByEmail.get(r.key)?.name || null; });

    const eligible = leads.filter(l => ['WARM', 'COLD'].includes(String(l.status || '').toUpperCase()) && low(l.email));
    const notEnrolled = eligible.filter(l => !roster.has(low(l.email)));

    /* Enrolments made in this browser session. Recorded only after a 2xx and
       always labelled as our own receipt — it is not a row in audit_log until
       the workflow puts one there. */
    const sent = new Map();

    /* ── Banner ──────────────────────────────────────────────────────────── */
    const evidence = lastMail
      ? `Most recent outbound mail row in communication_logs was logged ${ago(lastMail.created_at)} (${esc(stamp(lastMail.created_at))}).`
      : 'No outbound mail row has ever been logged in communication_logs.';

    bannerHost.innerHTML = `
      <div class="banner hot">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">unsubscribe</span>
        <div>
          <strong>Enrolling works. Sending does not.</strong>
          ${esc(GMAIL_REVOKED)} Read every &ldquo;Enrolled&rdquo; row on this screen as <em>queued</em>, not delivered.
          <div class="cell-sub" style="margin-top:6px">${evidence}</div>
          <div class="cell-sub" style="margin-top:2px">${esc(GMAIL_NOT_PROBED)}</div>
        </div>
      </div>
      ${notes.length ? `<div class="banner warm">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">warning</span>
        <div>${notes.map(esc).join('<br>')}</div></div>` : ''}`;

    /* ── Summary strip ───────────────────────────────────────────────────── */
    const failedRuns = dripRuns.filter(a => ['FAILED', 'REJECTED'].includes(String(a.status || '').toUpperCase())).length;

    strip.innerHTML = [
      kpi('Leads enrolled', num(roster.size),
        roster.size
          ? `${num(dripRuns.length)} drip ${dripRuns.length === 1 ? 'run' : 'runs'} in the audit log`
          : instrumented === false
            ? '<span class="t-warm">The drip workflow does not write to the audit log, so enrolments cannot be counted</span>'
            : '<span class="t-muted">No drip run has ever been logged</span>'),
      kpi('Eligible, not enrolled', num(notEnrolled.length),
        `Of ${num(eligible.length)} warm and cold ${eligible.length === 1 ? 'lead' : 'leads'} with an email address`),
      kpi('Runs failed', num(failedRuns),
        failedRuns
          ? '<span class="t-hot">Logged FAILED or REJECTED by the workflow</span>'
          : dripRuns.length
            ? '<span class="t-ok">Every logged drip run succeeded</span>'
            : '<span class="t-muted">Nothing logged to judge</span>'),
      kpi('Outbound mail logged', num(mail.length),
        lastMail
          ? `Last one ${ago(lastMail.created_at)}`
          : '<span class="t-hot">Nothing recorded — consistent with Gmail being revoked</span>',
        lastMail ? '' : 't-hot'),
      kpi('Silence escalations', num(silenced.length),
        silenced.length
          ? '<span class="t-warm">Twelve hours with no reply</span>'
          : '<span class="t-muted">Nobody has gone quiet</span>'),
    ].join('');

    /* ── Enrol a lead ─────────────────────────────────────────────────────── */
    const blockedGlobal = !N8N_BASE
      ? 'VITE_N8N_BASE_URL is not set in this build, so no n8n workflow can be called from the browser.'
      : null;

    enrolCard.innerHTML = `
      <div class="card-head">
        <div>
          <div class="card-title">Enrol a lead in the 7-day drip</div>
          <div class="card-sub">Day 1 welcome, day 3 follow-up, day 7 final offer — queued by n8n over the following week, never sent by this browser.
            Warm and cold leads that have an email address. Any other lead can be enrolled from the Leads screen.</div>
        </div>
      </div>
      <div class="toolbar">
        <div class="seg" id="cpSeg" role="group" aria-label="Filter leads by enrolment">
          ${FILTERS.map(([k, label], i) => `<button type="button" data-f="${k}" class="${i === 0 ? 'on' : ''}"
            aria-pressed="${i === 0 ? 'true' : 'false'}">${esc(label)}</button>`).join('')}
        </div>
        <div class="grow">
          <label class="sr-only" for="cpQ">Search leads</label>
          <input type="search" id="cpQ" placeholder="Search name, email or vehicle" />
        </div>
        <div class="t-muted num" id="cpCount"></div>
      </div>
      <div id="cpTable"></div>`;

    const qBox   = enrolCard.querySelector('#cpQ');
    const countEl = enrolCard.querySelector('#cpCount');
    const tableHost = enrolCard.querySelector('#cpTable');
    let filter = 'new', q = '';

    const cols = [
      { label:'Lead', strong:true, render: l => `${esc(l.name || 'Unnamed lead')}
          <div class="cell-sub">${esc(l.email)}</div>` },
      { label:'Status', render: l => pill(l.status || 'NEW') },
      { label:'Interest', render: l => `<span class="t-2">${esc(l.vehicle_interest || '—')}</span>` },
      /* budget_aed is NULL for router-created leads. A zero here would understate
         the value of the people being nurtured, so it stays a dash. */
      { label:'Budget', align:'r', render: l => n0(l.budget_aed) == null ? '<span class="t-muted">—</span>' : aed(l.budget_aed) },
      { label:'Score', align:'r', render: l => n0(l.ai_score) == null ? '<span class="t-muted">—</span>' : num(l.ai_score) },
      { label:'Enrolment', render: l => {
          const r = roster.get(low(l.email));
          const mine = sent.get(low(l.email));
          const bits = [];
          if (r) {
            bits.push(`${pill('Enrolled', 'ok')} <span class="cell-sub">${esc(ago(r.first.logged_at))} · ${num(r.runs)} ${r.runs === 1 ? 'run' : 'runs'}</span>`);
            if (r.failures) bits.push(`<div class="cell-sub t-hot">${num(r.failures)} logged as failed</div>`);
          }
          if (mine) bits.push(`<div class="cell-sub t-ok">Queued ${esc(ago(mine))} · this session, not yet in the audit log</div>`);
          if (!bits.length) bits.push('<span class="t-muted">Not enrolled</span>');
          return bits.join('');
        } },
      { label:'', align:'r', render: l => {
          const title = blockedGlobal || GMAIL_REVOKED;
          return `<button class="btn sm" data-enrol="${esc(l.id)}"
            aria-label="Enrol ${esc(l.name || l.email)} in the 7-day drip"
            title="${esc(title)}"${blockedGlobal ? ' disabled' : ''}>Enrol</button>`;
        } },
    ];

    function visible() {
      const base = filter === 'on'  ? eligible.filter(l => roster.has(low(l.email)))
                 : filter === 'new' ? eligible.filter(l => !roster.has(low(l.email)))
                 : eligible;
      if (!q) return base;
      return base.filter(l => `${l.name || ''} ${l.email || ''} ${l.vehicle_interest || ''}`.toLowerCase().includes(q));
    }

    function drawTable() {
      const rows = visible();
      countEl.textContent = `${rows.length} of ${eligible.length} warm & cold leads`;
      tableHost.innerHTML = eligible.length
        ? table(cols, rows, {
            onRow: true,
            empty: stateEmpty(
              q ? 'No lead matches this search' :
              filter === 'new' ? 'Every eligible lead is already enrolled' : 'No eligible lead is enrolled yet',
              q ? 'Try a different search term or another filter.'
                : filter === 'new' ? 'Every warm and cold lead with an email address already has a drip run in the audit log.'
                : 'No warm or cold lead has a drip run recorded against it.',
              q ? 'search_off' : 'campaign'),
          })
        : stateEmpty('No warm or cold leads with an email address',
            'The drip is addressed by email, so a lead needs one to qualify. Every other lead is either HOT, unscored, or has no email on record.',
            'campaign');
      wireRows(tableHost, rows, leadDrawer);
      tableHost.querySelectorAll('button[data-enrol]').forEach(b => b.addEventListener('click', ev => {
        /* The row opens the lead drawer; the action button must not do both. */
        ev.stopPropagation();
        const lead = rows.find(r => String(r.id) === b.dataset.enrol);
        if (lead) confirmEnrol(lead);
      }));
    }

    enrolCard.querySelectorAll('#cpSeg button').forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.f;
      enrolCard.querySelectorAll('#cpSeg button').forEach(x => {
        const on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      drawTable();
    }));
    qBox.addEventListener('input', e => { q = low(e.target.value); drawTable(); });
    drawTable();

    /* One confirm step, then one unambiguous outcome. The dialog stays open on
       failure carrying the error verbatim, because "it didn't work" without the
       reason sends the operator into n8n's execution list to guess. */
    function confirmEnrol(lead) {
      const existing = roster.get(low(lead.email));
      const m = openModal('Enrol in the 7-day drip', `
        <div class="banner hot">
          <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">unsubscribe</span>
          <div>${esc(GMAIL_REVOKED)}</div>
        </div>
        ${existing ? `<div class="banner warm">
          <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">repeat</span>
          <div>This lead is already enrolled — first run logged ${esc(ago(existing.first.logged_at))}, ${num(existing.runs)} ${existing.runs === 1 ? 'run' : 'runs'} in total.
            Enrolling again starts a second sequence; the workflow does not de-duplicate.</div>
        </div>` : ''}
        <p class="t-2" style="margin:0 0 16px">Day 1 welcome, day 3 follow-up, day 7 final offer. The sequence is queued inside n8n over the
          following week — this browser sends nothing and writes nothing to the database.</p>
        <dl class="kv">
          <dt>Lead</dt><dd>${esc(lead.name || '—')}</dd>
          <dt>Email</dt><dd>${esc(lead.email)}</dd>
          <dt>Phone</dt><dd>${esc(lead.phone || '—')}</dd>
          <dt>Vehicle</dt><dd>${esc(lead.vehicle_interest || '—')}</dd>
          <dt>Status</dt><dd>${pill(lead.status || 'NEW')}</dd>
          <dt>AI score</dt><dd>${n0(lead.ai_score) == null ? '<span class="t-muted">Not scored</span>' : num(lead.ai_score)}</dd>
        </dl>`,
        `<button class="btn primary" id="cpGo">${existing ? 'Enrol again' : 'Enrol this lead'}</button>
         <button class="btn" id="cpCancel">Cancel</button>`);

      const goBtn = m.wrap.querySelector('#cpGo');
      const cancel = m.wrap.querySelector('#cpCancel');
      goBtn.focus();
      cancel.addEventListener('click', m.close);
      goBtn.addEventListener('click', async () => {
        const label = goBtn.textContent;
        goBtn.disabled = true; cancel.disabled = true; goBtn.textContent = 'Enrolling…';
        m.msg('<span class="t-muted">Calling the lead-trigger workflow…</span>');
        try {
          /* These three field names are not a free choice. Normalize Lead Input
             inside the workflow reads exactly these, and a dashboard/workflow
             vocabulary mismatch is what kept the drip at zero successful runs
             before — so it is written once, here, and matches what the Leads
             screen posts to the same hook. */
          await n8n(HOOK.warmDrip, {
            lead_email: lead.email,
            lead_name: lead.name || '',
            vehicle_interest: lead.vehicle_interest || '',
          });
          sent.set(low(lead.email), new Date().toISOString());
          goBtn.textContent = 'Enrolled';
          cancel.disabled = false; cancel.textContent = 'Close';
          m.msg('<span class="t-ok">The workflow accepted the enrolment.</span> '
              + `<span class="t-warm">${esc(GMAIL_REVOKED)}</span>`);
          drawTable();
        } catch (e) {
          goBtn.disabled = false; cancel.disabled = false; goBtn.textContent = label;
          m.msg(`<span class="t-hot">Nothing was enrolled — ${esc(e.message)}</span>`);
        }
      });
    }

    /* ── Enrolment roster ─────────────────────────────────────────────────── */
    const rosterRows = [...roster.values()].sort((a, b) => ts(b.last.logged_at) - ts(a.last.logged_at));

    rosterCard.innerHTML = `
      <div class="card-head"><div>
        <div class="card-title">Who is enrolled</div>
        <div class="card-sub">Built from drip runs in <span class="mono">audit_log</span>, newest activity first.
          Mail counted per lead is every outbound mail row logged at or after that lead's first run.</div>
      </div></div>
      <div style="max-height:46vh;overflow-y:auto">${rosterRows.length
        ? rosterRows.map(r => {
            const since = ts(r.first.logged_at);
            const mails = (mailBy.get(r.key) || []).filter(x => ts(x.created_at) >= since);
            return `<div class="list-item" style="cursor:default;align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span style="font-weight:500">${esc(r.name || r.email || 'Unknown contact')}</span>
                  ${pill(r.last.status || 'Unknown')}
                  ${r.failures ? `<span class="chip t-hot">${num(r.failures)} failed</span>` : ''}
                </div>
                <div class="cell-sub">${esc(r.email || 'no email on the audit row')} · enrolled ${esc(ago(r.first.logged_at))} · ${num(r.runs)} ${r.runs === 1 ? 'run' : 'runs'}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div class="num" style="font-weight:500">${num(mails.length)}</div>
                <div class="cell-sub">${mails.length
                  ? 'mail logged since'
                  : '<span class="t-warm">no mail logged</span>'}</div>
              </div>
            </div>`;
          }).join('')
          + (unkeyedRuns ? `<div class="list-item" style="cursor:default">
              <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">info</span>
              <div class="cell-sub" style="white-space:normal">${num(unkeyedRuns)} drip ${unkeyedRuns === 1 ? 'run has' : 'runs have'} no lead_email on the audit row and cannot be attached to anybody.</div>
            </div>` : '')
        : stateEmpty('Nobody is enrolled',
            instrumented === false
              ? 'The registered drip workflow does not write to the audit log, so enrolments cannot be listed here even if leads are mid-sequence. Instrument the workflow to see this roster.'
              : 'No drip run has been logged. Enrol a warm or cold lead above and the workflow writes its first row here.',
            'group_off')}</div>`;

    /* ── What has actually been sent ─────────────────────────────────────── */
    mailCard.innerHTML = `
      <div class="card-head"><div>
        <div class="card-title">Outbound mail logged</div>
        <div class="card-sub">Every outbound row in <span class="mono">communication_logs</span> whose channel mentions mail, newest first.
          The table records no workflow id, so drip mail cannot be separated from other outbound mail.</div>
      </div></div>
      <div style="max-height:46vh;overflow-y:auto">${mail.length
        ? mail.map(msg => `
          <div class="list-item" style="cursor:default;align-items:flex-start">
            <span class="mono t-muted" title="${esc(stamp(msg.created_at))}">${clock(msg.created_at)}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(msg.lead_email || 'No recipient recorded')}</div>
              <div class="cell-sub">${esc(String(msg.message || '').replace(/\s+/g, ' ').trim().slice(0, 160)) || '<span class="t-muted">No message text recorded</span>'}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <span class="chip">${esc(String(msg.channel || '').trim() || 'unrecorded channel')}</span>
              <div class="cell-sub">${ago(msg.created_at)}</div>
            </div>
          </div>`).join('')
        : stateEmpty('No mail has been logged',
            `Nothing outbound on a mail channel exists in the ${num(comms.length)} messages read. With the Gmail credential revoked this is the expected state — enrolments queue, mail does not go out.`,
            'unsubscribe')}</div>`;

    /* ── Silence detector ─────────────────────────────────────────────────── */
    silenceCard.innerHTML = `
      <div class="card-head"><div>
        <div class="card-title">Silence detector</div>
        <div class="card-sub">A lead that has not replied for twelve hours is escalated once, then never again</div>
      </div></div>
      <div style="max-height:40vh;overflow-y:auto">${silenced.length
        ? silenced.map(c => `
          <div class="list-item" style="cursor:default;align-items:flex-start">
            <span class="mono t-muted" title="${esc(stamp(c.created_at))}">${clock(c.created_at)}</span>
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

    /* ── Campaign activity ────────────────────────────────────────────────── */
    activityCard.innerHTML = `
      <div class="card-head"><div>
        <div class="card-title">Campaign activity</div>
        <div class="card-sub">Every drip run in the audit log, newest first${matchedByRegistry ? ' · matched through workflow_registry' : ' · matched on workflow name'}</div>
      </div></div>
      <div style="max-height:40vh;overflow-y:auto">${dripRuns.length
        ? dripRuns.map(x => `
          <div class="list-item" style="cursor:default;align-items:flex-start">
            <span class="mono t-muted" title="${esc(stamp(x.logged_at))}">${clock(x.logged_at)}</span>
            ${pill(x.status || 'Unknown')}
            <div style="flex:1;min-width:0">
              <div style="font-weight:500">${esc(x.lead_name || x.lead_email || x.workflow || 'Unnamed run')}</div>
              <div class="cell-sub">${esc(String(x.summary || '').replace(/\s+/g, ' ').trim().slice(0, 160)) || '<span class="t-muted">No summary recorded</span>'}</div>
            </div>
            <div class="cell-sub">${ago(x.logged_at)}</div>
          </div>`).join('')
        : stateEmpty('No campaign runs logged',
            instrumented === false
              ? 'The registered drip workflow does not write to the audit log, so its runs cannot appear here.'
              : 'The drip workflow writes a row here every time it starts a sequence.',
            'receipt_long')}</div>`;
  }
};

/* ==========================================================================
   S10 · Deals
   Closing a deal is what feeds the RAG memory: the Closed-Won workflow embeds
   the deal and writes it to pgvector so Ask AI can reason over real sales.
   Until now that workflow could only be triggered by hand outside the product.
   ========================================================================== */
