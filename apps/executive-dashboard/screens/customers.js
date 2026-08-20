/* NEXUS OS — screens/customers.js
   Customer 360. Two sources sit behind this screen and they are deliberately
   kept distinguishable rather than blended:

     · v_customer_360        — assembled live from leads / purchase_history /
                               communication_logs. Always current.
     · customer_360_profiles — written by the nightly aggregation job at 02:00.
                               It is the ONLY source of the email and Slack
                               touch counts and of last_synced_at, and it has
                               only just started producing rows.

   That second fact is the whole reason this screen is shaped the way it is. A
   contact with no profile row is not an error and must never look like one, so
   the sync coverage is stated as a number up front and every unsynced contact
   says which parts of its profile are live and which are waiting on the job.
   Nothing here is estimated or filled in — a count the database did not return
   renders as an em dash. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, esc, initials, n0, num, pill, tone } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { noSource, stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi } from '../lib/ui.js';

const PROFILE_COLS = 'customer_id,name,email,phone,total_emails,total_slack_messages,last_synced_at';
const VIEW_LIMIT = 500;
const PROFILE_LIMIT = 1000;
const MSG_LIMIT = 50;

const norm = v => String(v || '').trim().toLowerCase();

/* Neither source can be triggered or repaired from the browser. Spelled out
   once and reused so the disabled control and the empty state agree. */
const NO_SYNC_HOOK =
  'customer_360_profiles is written by the nightly aggregation job and is service-role only. ' +
  'lib/data.js exposes no webhook for that job, so the browser cannot start a re-sync — this button ' +
  'stays disabled until one exists.';

/* v_customer_360 is one row per customer, but two rows can still land on the
   same email address. Everything downstream (leads, purchases, messages) keys
   on email, so those rows are collapsed — and the fact that they were is
   reported rather than hidden. Rows with no email at all are kept, since
   dropping a customer is worse than showing one we cannot cross-reference. */
function merge(viewRows, profileRows) {
  const byKey = new Map();
  let collapsed = 0;
  viewRows.forEach((r, i) => {
    const key = norm(r.email) || `view:${i}`;
    if (byKey.has(key)) { collapsed++; return; }
    byKey.set(key, { key, email: r.email || '', view: r, profile: null });
  });
  profileRows.forEach((p, i) => {
    const key = norm(p.email) || `profile:${i}`;
    const hit = byKey.get(key);
    if (hit) { if (!hit.profile) hit.profile = p; return; }
    byKey.set(key, { key, email: p.email || '', view: null, profile: p });
  });
  return { people: [...byKey.values()], collapsed };
}

const nameOf  = p => p.view?.name  || p.profile?.name  || p.email || 'Unnamed contact';
const phoneOf = p => p.view?.phone || p.profile?.phone || '';

/* Touch counts belong to the aggregation. Where the view republishes them the
   profile row still wins, so a stale copy in the view can never contradict the
   job's own output — and the provenance travels with the number. */
function touch(person, field) {
  const fromProfile = n0(person.profile?.[field]);
  if (fromProfile != null) return { value: fromProfile, src: 'customer_360_profiles' };
  const fromView = n0(person.view?.[field]);
  if (fromView != null) return { value: fromView, src: 'v_customer_360' };
  return { value: null, src: null };
}

/* A rejected sub-fetch must reach the section that needed it, not vanish into
   an empty list that reads as "this customer has no purchases". */
const grab = promise => promise.then(rows => ({ rows }), e => ({ err: e.message }));

SCREENS.customers = async host => {
  const strip = el('div', 'grid g4');
  strip.innerHTML = stateLoading(2);
  host.appendChild(strip);

  const noteHost = el('div');
  noteHost.style.marginTop = '16px';
  host.appendChild(noteHost);

  const grid = el('div', 'card flush');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '340px minmax(0,1fr)';
  grid.style.minHeight = '620px';
  grid.innerHTML = stateLoading(6);
  host.appendChild(grid);

  /* Read both sources independently. The aggregation failing is not the same
     event as the live view failing, and the screen stays useful under either. */
  const [viewRes, profileRes] = await Promise.all([
    grab(db(`v_customer_360?select=*&order=lifetime_value_aed.desc,lead_count.desc&limit=${VIEW_LIMIT}`)),
    grab(db(`customer_360_profiles?select=${PROFILE_COLS}&order=last_synced_at.desc.nullslast&limit=${PROFILE_LIMIT}`)),
  ]);

  const profiles = profileRes.rows || [];
  const viewRows = viewRes.rows || [];

  /* ── Aggregation health strip ─────────────────────────────────────────── */
  if (profileRes.err) {
    strip.style.display = 'block';
    strip.innerHTML = stateError('the Customer 360 aggregation', profileRes.err);
  } else {
    const synced = profiles.map(p => p.last_synced_at).filter(Boolean).sort();
    const newest = synced.length ? synced[synced.length - 1] : null;
    const oldest = synced.length ? synced[0] : null;
    const sum = field => {
      const vals = profiles.map(p => n0(p[field])).filter(v => v != null);
      return { total: vals.length ? vals.reduce((a, b) => a + b, 0) : null, rows: vals.length };
    };
    const emails = sum('total_emails');
    const slack = sum('total_slack_messages');
    const contacts = new Set([...viewRows.map((r, i) => norm(r.email) || `view:${i}`)]);
    const matched = profiles.filter(p => contacts.has(norm(p.email))).length;

    strip.innerHTML = [
      kpi('Unified profiles', num(profiles.length),
        profiles.length
          ? `<span class="t-muted">${num(matched)} of ${num(contacts.size)} contacts in v_customer_360 have one</span>`
          : '<span class="t-warm">The nightly job has not written a row yet</span>',
        profiles.length ? '' : 't-warm'),
      kpi('Last aggregation run', ago(newest),
        newest
          ? `<span class="t-muted">Newest last_synced_at${oldest && oldest !== newest ? ` · oldest ${ago(oldest)}` : ''}</span>`
          : '<span class="t-muted">No profile carries a last_synced_at value</span>'),
      kpi('Email touches', num(emails.total),
        emails.rows
          ? `<span class="t-muted">Across ${num(emails.rows)} profile${emails.rows === 1 ? '' : 's'} reporting a count</span>`
          : '<span class="t-muted">No profile has recorded an email count</span>'),
      kpi('Slack messages', num(slack.total),
        slack.rows
          ? `<span class="t-muted">Across ${num(slack.rows)} profile${slack.rows === 1 ? '' : 's'} reporting a count</span>`
          : '<span class="t-muted">No profile has recorded a Slack count</span>'),
    ].join('');
  }

  /* ── The live view ────────────────────────────────────────────────────── */
  if (viewRes.err) {
    grid.style.display = 'block';
    grid.innerHTML = stateError('customers', viewRes.err);
    return;
  }

  const { people, collapsed } = merge(viewRows, profiles);

  if (!people.length) {
    grid.style.display = 'block';
    grid.innerHTML = stateEmpty(
      'No customers yet',
      'Nothing in v_customer_360 and no row in customer_360_profiles. A contact appears here as soon as a lead ' +
      'or a purchase is recorded; the nightly aggregation then adds the email and Slack touch counts on its next run.',
      'contacts');
    return;
  }

  const withProfile = people.filter(p => p.profile).length;
  const awaiting = people.length - withProfile;

  /* The distinction this screen exists to make: "no touch counts" because the
     job has not reached this contact yet, versus "no data". */
  if (!profileRes.err && !profiles.length) {
    noteHost.innerHTML = `<div class="banner info">
      <span class="material-symbols-outlined">schedule</span>
      <div>The nightly Customer 360 aggregation has not produced any rows yet, so email and Slack touch counts
      and last_synced_at are empty for every contact below. Everything else on this screen — identity, leads,
      purchases and logged messages — is read live and is current.</div></div>`;
  } else if (!profileRes.err && awaiting) {
    noteHost.innerHTML = `<div class="banner info">
      <span class="material-symbols-outlined">schedule</span>
      <div>${esc(String(awaiting))} of ${esc(String(people.length))} contacts have no row in customer_360_profiles yet — the nightly
      aggregation only just started producing them. Those profiles show every live field and leave the touch
      counts blank rather than guessing at them.</div></div>`;
  }

  grid.innerHTML = `
    <div style="border-right:1px solid var(--border);display:flex;flex-direction:column;min-width:0">
      <div class="toolbar">
        <div class="grow">
          <label class="sr-only" for="cq">Search customers</label>
          <input type="search" id="cq" placeholder="Search name, email or phone" />
        </div>
      </div>
      <div class="toolbar" style="padding-top:0">
        <div class="seg" id="cSegSync" role="group" aria-label="Filter by aggregation state">
          <button type="button" data-f="all" class="on" aria-pressed="true">All ${num(people.length)}</button>
          <button type="button" data-f="synced" aria-pressed="false"
            title="Contacts that have a row in customer_360_profiles, so their email and Slack touch counts are populated.">In aggregation ${num(withProfile)}</button>
          <button type="button" data-f="pending" aria-pressed="false"
            title="Contacts the nightly aggregation has not written a profile row for yet. Their live fields still render.">Awaiting sync ${num(awaiting)}</button>
        </div>
        <button class="btn sm" disabled title="${esc(NO_SYNC_HOOK)}">Re-run sync</button>
      </div>
      <div id="custList" style="overflow-y:auto;flex:1"></div>
    </div>
    <div id="custPane" style="overflow-y:auto;min-width:0"></div>`;

  let q = '', filter = 'all', selected = null;

  const visible = () => people.filter(p => {
    if (filter === 'synced' && !p.profile) return false;
    if (filter === 'pending' && p.profile) return false;
    if (!q) return true;
    return `${nameOf(p)} ${p.email} ${phoneOf(p)}`.toLowerCase().includes(q);
  });

  function drawList() {
    const rows = visible();
    const foot = collapsed
      ? `<div class="list-item" style="cursor:default;align-items:flex-start">
           <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
           <div class="cell-sub" style="white-space:normal">${esc(String(collapsed))} further
           ${collapsed === 1 ? 'row' : 'rows'} in v_customer_360 shared an email address with a contact above and
           ${collapsed === 1 ? 'was' : 'were'} collapsed into it, because leads, purchases and messages are all keyed on email.</div>
         </div>`
      : '';

    $('custList').innerHTML = (rows.length
      ? rows.map(p => {
          const ltv = n0(p.view?.lifetime_value_aed);
          return `<div class="list-item${p.key === selected ? ' on' : ''}" role="button" tabindex="0" data-k="${esc(p.key)}">
            <div class="avatar">${esc(initials(nameOf(p)))}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nameOf(p))}
                ${p.view?.is_vip ? '<span class="pill vip"><span class="dot"></span>VIP</span>' : ''}</div>
              <div class="cell-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.email || 'No email recorded')}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div class="cell-sub num">${ltv == null ? '' : aed(ltv)}</div>
              <div class="cell-sub">${p.profile
                ? `synced ${esc(ago(p.profile.last_synced_at))}`
                : '<span class="t-muted">not synced</span>'}</div>
            </div>
          </div>`;
        }).join('')
      : stateEmpty('No match', 'No contact matches this search and filter.', 'search_off')) + foot;

    $('custList').querySelectorAll('[data-k]').forEach(n => {
      const openIt = () => open(n.dataset.k);
      n.addEventListener('click', openIt);
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt(); }
      });
    });
  }

  /* ── Detail pane ──────────────────────────────────────────────────────── */
  async function open(key) {
    const p = people.find(x => x.key === key);
    if (!p) return;
    selected = key;
    $('custList').querySelectorAll('[data-k]').forEach(n => n.classList.toggle('on', n.dataset.k === key));

    const pane = $('custPane');
    pane.innerHTML = stateLoading(5);
    const email = p.email;

    /* Every linked read keys on lead_email / email. A contact with no email is
       reachable in the list but cannot be cross-referenced, and saying so is
       the only honest option. */
    const q = email ? encodeURIComponent(email) : null;
    const [leads, purch, comms] = email
      ? await Promise.all([
          grab(db(`leads?select=id,name,status,ai_score,vehicle_interest,budget_aed,source,created_at&email=ilike.${q}&order=created_at.desc`)),
          grab(db(`purchase_history?select=*&email=ilike.${q}&order=purchase_date.desc`)),
          grab(db(`communication_logs?select=channel,direction,message,created_at&lead_email=ilike.${q}&order=created_at.desc&limit=${MSG_LIMIT}`)),
        ])
      : [{ rows: null }, { rows: null }, { rows: null }];

    /* Guard against a slower earlier click landing after a newer one. */
    if (selected !== key) return;

    const v = p.view || {};
    const noEmailNote = '<div class="cell-sub" style="margin-top:8px">This contact has no email address, and leads, purchases and messages are all keyed on email — so none of them can be matched to it.</div>';
    const section = (title, res, empty, body) => {
      if (res.err) return `<div class="section"><div class="label-caps">${esc(title)}</div>${stateError(title.toLowerCase(), res.err, 'x')}</div>`;
      if (res.rows == null) return `<div class="section"><div class="label-caps">${esc(title)}</div>${noEmailNote}</div>`;
      if (!res.rows.length) return `<div class="section"><div class="label-caps">${esc(title)}</div><div class="cell-sub" style="margin-top:8px">${esc(empty)}</div></div>`;
      return `<div class="section"><div class="label-caps">${esc(title)}</div>${body(res.rows)}</div>`;
    };

    const emailTouch = touch(p, 'total_emails');
    const slackTouch = touch(p, 'total_slack_messages');
    const purchTotal = purch.rows?.length
      ? purch.rows.map(x => n0(x.amount_aed)).filter(x => x != null).reduce((a, b) => a + b, 0)
      : null;

    pane.innerHTML = `
      <div class="card-head">
        <div class="avatar" style="width:40px;height:40px;font-size:14px">${esc(initials(nameOf(p)))}</div>
        <div style="flex:1;min-width:0">
          <div class="card-title">${esc(nameOf(p))}
            ${v.is_vip ? '<span class="pill vip"><span class="dot"></span>Returning customer</span>' : ''}
            ${p.profile ? '' : '<span class="chip">Awaiting nightly sync</span>'}</div>
          <div class="card-sub">${esc(p.email || 'No email recorded')}${phoneOf(p) ? ' · ' + esc(phoneOf(p)) : ''}</div>
        </div>
        ${leads.rows?.length ? '<button class="btn sm" data-act="leads">Open in Leads</button>' : ''}
      </div>
      <div style="padding:20px">
        <div class="grid g4">
          ${kpi('Lifetime value', aed(v.lifetime_value_aed),
            n0(v.purchase_count) == null
              ? '<span class="t-muted">No purchase count in the view</span>'
              : `${num(v.purchase_count)} purchase${Number(v.purchase_count) === 1 ? '' : 's'} recorded`)}
          ${kpi('Leads', num(v.lead_count), v.latest_status ? pill(v.latest_status) : '<span class="t-muted">No status on the latest lead</span>')}
          ${kpi('Best AI score', num(v.best_ai_score),
            n0(v.best_ai_score) == null ? '<span class="t-muted">No lead scored by the router yet</span>' : '<span class="t-muted">Highest score across this contact’s leads</span>')}
          ${kpi('Messages logged', num(v.message_count),
            v.last_contact_at ? `<span class="t-muted">Last contact ${esc(ago(v.last_contact_at))}</span>` : '<span class="t-muted">Never contacted</span>')}
        </div>

        <div class="section" style="margin-top:24px">
          <div class="label-caps">Unified profile · customer_360_profiles</div>
          ${p.profile
            ? `<dl class="kv" style="margin-top:8px">
                 <dt>Customer ID</dt><dd class="mono">${esc(p.profile.customer_id ?? '—')}</dd>
                 <dt>Email touches</dt><dd class="num">${num(emailTouch.value)}</dd>
                 <dt>Slack messages</dt><dd class="num">${num(slackTouch.value)}</dd>
                 <dt>Last synced</dt><dd>${esc(ago(p.profile.last_synced_at))}${p.profile.last_synced_at ? '' : ' <span class="t-muted">(the row exists but carries no timestamp)</span>'}</dd>
                 <dt>Name on profile</dt><dd>${esc(p.profile.name || '—')}</dd>
                 <dt>Phone on profile</dt><dd>${esc(p.profile.phone || '—')}</dd>
               </dl>
               ${p.view ? '' : `<div class="cell-sub" style="margin-top:10px">This contact exists only in customer_360_profiles — v_customer_360 has no row for it, so there is no lead or purchase behind it yet.</div>`}`
            : (emailTouch.value != null || slackTouch.value != null)
              ? `<dl class="kv" style="margin-top:8px">
                   <dt>Email touches</dt><dd class="num">${num(emailTouch.value)}</dd>
                   <dt>Slack messages</dt><dd class="num">${num(slackTouch.value)}</dd>
                 </dl>
                 <div class="cell-sub" style="margin-top:10px">These come from v_customer_360. There is no matching row in customer_360_profiles, so there is no last_synced_at to report.</div>`
              : noSource('The nightly Customer 360 aggregation has not written a row for this contact yet, so there are no email or Slack touch counts and no last_synced_at. This is a job that has only just started producing rows — not a failure. Identity, leads, purchases and logged messages below are read live and are current.')}
        </div>

        ${section('Purchase history', purch, 'No purchase recorded for this contact.', rows => `
          ${rows.map(x => `<div class="quote" style="margin-top:8px">
            <strong>${esc(x.vehicle || 'Vehicle not recorded')}</strong>${n0(x.amount_aed) == null ? '' : ' · ' + aed(x.amount_aed)}
            <div class="cell-sub">${esc(x.purchase_date || 'No purchase date recorded')}</div></div>`).join('')}
          ${purchTotal == null ? '' : `<div class="cell-sub num" style="margin-top:10px">${esc(String(rows.length))} purchase${rows.length === 1 ? '' : 's'} · ${aed(purchTotal)} total</div>`}`)}

        ${section('Leads', leads, 'No lead recorded for this contact.', rows => `
          <div class="timeline" style="margin-top:8px">${rows.map(l => `
            <div class="tl-item"><span class="tl-dot" style="background:var(--${tone(l.status) || 'neutral'})"></span>
              <div class="tl-body">
                <div class="tl-meta">${esc(ago(l.created_at))}${l.source ? ' · ' + esc(l.source) : ''}${n0(l.ai_score) == null ? '' : ' · score ' + num(l.ai_score)}</div>
                <div>${esc(l.vehicle_interest || 'No vehicle recorded')} ${pill(l.status || 'NEW')}</div>
                ${n0(l.budget_aed) == null ? '' : `<div class="cell-sub">Budget ${aed(l.budget_aed)}</div>`}
              </div></div>`).join('')}</div>`)}

        ${section('Recent messages', comms, 'No message logged for this contact.', rows => `
          <div class="timeline" style="margin-top:8px">${rows.slice(0, 10).map(c => `
            <div class="tl-item"><span class="tl-dot"></span><div class="tl-body">
              <div class="tl-meta"><span class="chip">${esc(c.channel || 'unknown channel')}</span> ${esc(c.direction || '')} · ${esc(ago(c.created_at))}</div>
              <div style="white-space:pre-wrap">${esc(String(c.message || '').slice(0, 240))}</div></div></div>`).join('')}</div>
          ${rows.length > 10 ? `<div class="cell-sub" style="margin-top:10px">Showing the newest 10 of ${esc(String(rows.length))} messages read${rows.length >= MSG_LIMIT ? ` (capped at ${esc(String(MSG_LIMIT))})` : ''} — the full thread is on Conversations.</div>` : ''}`)}
      </div>`;

    pane.querySelector('[data-act="leads"]')?.addEventListener('click', () => go('leads'));
    /* stateError() renders its own Retry; re-running open() is exactly the
       retry, since each section re-reads on every open. */
    pane.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => open(key)));
  }

  $('cq').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); drawList(); });
  $('cSegSync').querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      filter = b.dataset.f;
      $('cSegSync').querySelectorAll('button').forEach(x => {
        const on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', String(on));
      });
      drawList();
    });
  });

  drawList();
  await open(people[0].key);
};

/* ==========================================================================
   S11 · Team
   ========================================================================== */
