/* NEXUS OS — screens/team.js
   The roster and the per-rep scoreboard.

   Two facts drive every decision on this screen.

   1. The roster and the scoreboard are different tables. `users` owns who exists,
      what role they hold and whether their account is live; `v_team_performance`
      owns what they did. They are read separately and joined here, so a rep who
      has never touched a lead still appears (with an honest "no activity yet"
      rather than a fabricated zero), and a performance row that matches nobody
      in the directory is shown as exactly that instead of being dropped.

   2. A user is never deletable from this screen. `leads.assigned_to_id`
      references `users.id`; removing a row silently orphans every lead that
      person owned, and an orphaned lead has no owner, no escalation path and no
      one the 5-minute rule applies to. The drawer states the count that would be
      orphaned instead of offering the button.

   Three users sit at status `pending_invite`. There is no endpoint that can
   invite them — `users` is service-role only from the browser and none of the
   deployed n8n webhooks sends an invitation — so the invite control is built,
   surfaced prominently as outstanding work, and left disabled with the reason
   on it. Nothing here is estimated: every number comes off a row, and a panel
   whose table failed to load says so rather than showing a plausible blank. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, esc, initials, mins, n0, num, pct, pill } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';

/* Leads are read only to answer three questions the view cannot: who owns
   nothing, which assignments point at a user that no longer exists, and what a
   given rep is actually holding. The read is capped, and where a count depends
   on the cap the screen says the cap was hit rather than letting a windowed
   number read as a total. */
const LEAD_LIMIT = 1000;

const NO_INVITE =
  'No invite endpoint exists yet. The users table is service-role only from the browser, so RLS would reject the write, and none of the deployed n8n webhooks (ask-ai, finance-calc, lead-trigger, deals/closed-won, audit-kyc, erp-sync, lead-escalation) sends an invitation. Creating the account and emailing the link has to be built before this button can do anything.';
const NO_ROLE_WRITE =
  'Changing a role means writing to the users table, which is service-role only — the browser would be rejected by RLS — and no workflow accepts a role change either.';
const NO_DELETE =
  'Removing a user is deliberately not offered anywhere on this screen: leads.assigned_to_id points at users.id, so deleting the row would leave their leads with an owner that does not exist.';

const low = v => String(v ?? '').trim().toLowerCase();
const valOf = r => (r.status === 'fulfilled' ? r.value : null);
const errOf = r => (r.status === 'rejected' ? (r.reason?.message || 'Unknown error') : null);

/* Sum a column across rows, returning null — not 0 — when no row carries it.
   "AED 0 of pipeline" and "the view does not report pipeline" are different
   statements and only one of them is true. */
function sumOf(rows, key) {
  let total = null;
  rows.forEach(r => { const x = n0(r?.[key]); if (x != null) total = (total ?? 0) + x; });
  return total;
}

/* ── One rep, as this screen sees them ───────────────────────────────────── */
const perfNum = (r, k) => n0(r.perf?.[k]);
const leadsAssigned = r => perfNum(r, 'leads_assigned');
const hotLeads      = r => perfNum(r, 'hot_leads');
const avgResponse   = r => perfNum(r, 'avg_response_minutes');
const withinSla     = r => perfNum(r, 'within_sla');
const breachedSla   = r => perfNum(r, 'breached_sla');
const pipelineOf    = r => perfNum(r, 'pipeline_aed');
/* Measured = the leads this rep was actually timed on. Null when neither
   counter exists, which is not the same as having been timed on none. */
const measured = r => {
  const w = withinSla(r), b = breachedSla(r);
  return (w == null && b == null) ? null : (w ?? 0) + (b ?? 0);
};
const slaRate = r => {
  const m = measured(r), w = withinSla(r);
  return (!m || w == null) ? null : (w / m) * 100;
};

const isPending    = r => low(r.status) === 'pending_invite';
const hasAccount   = r => !!r.status && !isPending(r);
const statusLabel  = r => {
  if (!r.status) return 'No status on file';
  if (isPending(r)) return 'Pending invite';
  return String(r.status).replace(/_/g, ' ');
};
const statusPill = r => {
  if (!r.status) return `<span class="t-muted">No status on file</span>`;
  if (isPending(r)) return pill('Pending invite', 'warm');
  return pill(statusLabel(r), hasAccount(r) ? 'ok' : undefined);
};

/* ── Screen ──────────────────────────────────────────────────────────────── */
SCREENS.team = async host => {
  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const banners = el('div'); banners.style.marginTop = '16px'; host.appendChild(banners);
  const body = el('div'); body.style.marginTop = '16px'; host.appendChild(body);

  /* allSettled, not catch(() => []): a directory that failed to read and a
     directory with nobody in it are opposite answers, and on this screen the
     second one would quietly imply the dealership has no staff. */
  const [usersR, perfR, leadsR] = await Promise.allSettled([
    db('users?select=id,name,email,role,status&order=name.asc'),
    db('v_team_performance?select=*'),
    db(`leads?select=id,name,status,ai_score,lead_score,budget_aed,vehicle_interest,assigned_to_id,created_at&order=created_at.desc&limit=${LEAD_LIMIT}`),
  ]);

  const users = valOf(usersR), usersErr = errOf(usersR);
  const perf  = valOf(perfR),  perfErr  = errOf(perfR);
  const leads = valOf(leadsR), leadsErr = errOf(leadsR);

  /* ── Join the directory to the scoreboard ──────────────────────────────── */
  /* The view's key column is not guaranteed, so the match is tried on user id,
     then on email, then on name — in that order, because a name is the only one
     of the three two people can share. Unmatched rows on either side are kept
     and labelled; none is invented and none is thrown away. */
  const perfById = new Map(), perfByEmail = new Map(), perfByName = new Map();
  (perf || []).forEach(p => {
    const id = low(p.user_id ?? p.id); if (id && !perfById.has(id)) perfById.set(id, p);
    const em = low(p.email);           if (em && !perfByEmail.has(em)) perfByEmail.set(em, p);
    const nm = low(p.name);            if (nm && !perfByName.has(nm)) perfByName.set(nm, p);
  });
  const matched = new Set();
  const matchPerf = u => {
    const p = perfById.get(low(u.id)) || perfByEmail.get(low(u.email)) || perfByName.get(low(u.name)) || null;
    if (p) matched.add(p);
    return p;
  };

  const fromUsers = (users || []).map(u => ({
    id: u.id, name: u.name, email: u.email, role: u.role, status: u.status,
    perf: matchPerf(u), unlinked: false,
  }));
  const fromView = (perf || []).filter(p => !matched.has(p)).map(p => ({
    id: p.user_id ?? p.id ?? null, name: p.name, email: p.email, role: p.role, status: p.status,
    perf: p, unlinked: !!users,
  }));
  const roster = fromUsers.concat(fromView);

  /* ── What the leads table says about ownership ─────────────────────────── */
  const byOwner = new Map();
  (leads || []).forEach(l => {
    const k = low(l.assigned_to_id);
    if (!k) return;
    if (!byOwner.has(k)) byOwner.set(k, []);
    byOwner.get(k).push(l);
  });
  const ownedBy = r => (r.id ? (byOwner.get(low(r.id)) || []) : []);
  const unassigned = (leads || []).filter(l => !l.assigned_to_id);
  const rosterIds = new Set(roster.map(r => low(r.id)).filter(Boolean));
  /* An assignment pointing at an id nobody on the roster holds is the exact
     damage the missing delete button prevents. Only claimed when both sides
     were readable, otherwise it is an artefact of a failed read. */
  const orphaned = (leads && users)
    ? (leads || []).filter(l => l.assigned_to_id && !rosterIds.has(low(l.assigned_to_id)))
    : [];
  const leadsCapped = !!leads && leads.length >= LEAD_LIMIT;

  const pending = roster.filter(isPending);
  const withAccount = roster.filter(hasAccount);

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  if (!users && !perf) {
    strip.classList.remove('grid', 'g5');
    strip.innerHTML = stateError('the team', usersErr || perfErr);
  } else {
    const withinTot   = sumOf(roster.map(r => r.perf).filter(Boolean), 'within_sla');
    const breachedTot = sumOf(roster.map(r => r.perf).filter(Boolean), 'breached_sla');
    const measuredTot = (withinTot == null && breachedTot == null) ? null : (withinTot ?? 0) + (breachedTot ?? 0);
    const pipelineTot = sumOf(roster.map(r => r.perf).filter(Boolean), 'pipeline_aed');
    const withPipeline = roster.filter(r => (pipelineOf(r) ?? 0) > 0).length;

    /* One team-wide response figure, weighted by how many leads each rep was
       actually timed on. An unweighted mean of per-rep means would let someone
       with a single fast lead cancel out someone carrying forty slow ones. */
    let weightSum = 0, weighted = 0;
    roster.forEach(r => {
      const a = avgResponse(r), m = measured(r);
      if (a != null && m) { weighted += a * m; weightSum += m; }
    });
    const teamAvg = weightSum ? weighted / weightSum : null;

    strip.innerHTML = [
      kpi('Team members', num(roster.length),
        usersErr
          ? '<span class="t-warm">Directory unreadable — counted from the performance view</span>'
          : `${num(withAccount.length)} with an account · ${num(pending.length)} pending invite`),
      kpi('Awaiting an invite', num(pending.length),
        pending.length
          ? '<span class="t-warm">No account, and nothing here can send one yet</span>'
          : '<span class="t-ok">Everyone on the roster has an account</span>',
        pending.length ? 't-warm' : ''),
      kpi('Within the 5-minute rule',
        measuredTot ? `${num(withinTot ?? 0)} / ${num(measuredTot)}` : '—',
        measuredTot
          ? `${pct((withinTot ?? 0) / measuredTot * 100)} · weighted average ${mins(teamAvg)}`
          : '<span class="t-muted">No rep row carries a response measurement</span>',
        measuredTot && (withinTot ?? 0) / measuredTot < 0.5 ? 't-hot' : ''),
      kpi('Pipeline in rep hands', pipelineTot == null ? '—' : aed(pipelineTot),
        pipelineTot == null
          ? '<span class="t-muted">The performance view reports no pipeline figure</span>'
          : `Held by ${num(withPipeline)} of ${num(roster.length)} on the roster`),
      kpi('Unassigned leads', leads ? num(unassigned.length) : '—',
        !leads
          ? `<span class="t-muted">Leads could not be read</span>`
          : unassigned.length
            ? '<span class="t-hot">Nobody owns these</span>'
            : '<span class="t-ok">Every lead read here has an owner</span>',
        leads && unassigned.length ? 't-hot' : ''),
    ].join('');
  }

  /* ── Banners: the outstanding actions, each with the exact set behind it ── */
  let focusRoster = () => {};

  if (usersErr && perf) {
    const b = el('div', 'banner warm'); b.style.marginBottom = '12px';
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">person_off</span>
      <div>The user directory could not be read (${esc(usersErr)}), so roles and account status below are whatever
      <span class="mono">v_team_performance</span> carries. Anyone with no leads at all is missing from this page entirely.</div>`;
    banners.appendChild(b);
  }

  if (pending.length) {
    const names = pending.map(p => p.name).filter(Boolean);
    const b = el('div', 'banner warm'); b.style.marginBottom = '12px';
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">mark_email_unread</span>
      <div style="flex:1"><strong>${num(pending.length)} team member${pending.length === 1 ? ' has' : 's have'} no account yet.</strong>
        ${names.length ? esc(names.join(', ')) + ' ' : ''}sit${names.length === 1 ? 's' : ''} at
        <span class="mono">pending_invite</span>, so they cannot sign in, cannot be alerted and cannot own a lead.
        Sending the invitation is not built yet, so this stays outstanding until the endpoint exists.</div>
      <button class="btn sm" id="tShowPending">Show ${pending.length === 1 ? 'them' : 'all ' + pending.length}</button>
      <button class="btn sm" disabled title="${esc(NO_INVITE)}">Send invite${pending.length === 1 ? '' : 's'}</button>`;
    banners.appendChild(b);
    b.querySelector('#tShowPending').addEventListener('click', () => focusRoster('PENDING'));
  }

  if (orphaned.length) {
    const b = el('div', 'banner hot'); b.style.marginBottom = '12px';
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">link_off</span>
      <div><strong>${num(orphaned.length)} lead${orphaned.length === 1 ? ' points' : 's point'} at a user who is not on the roster.</strong>
        Their <span class="mono">assigned_to_id</span> matches no row in <span class="mono">users</span>, so nobody is on the hook for
        ${orphaned.length === 1 ? 'it' : 'them'}. This is what deleting a user does, which is why this screen never offers it.</div>`;
    banners.appendChild(b);
  }

  if (leads && unassigned.length) {
    const b = el('div', 'banner warm'); b.style.marginBottom = '12px';
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">person_add_disabled</span>
      <div style="flex:1"><strong>${num(unassigned.length)} lead${unassigned.length === 1 ? ' has' : 's have'} no owner.</strong>
        The newest arrived ${esc(ago(unassigned[0].created_at))}. Assignment happens on the lead itself.</div>
      <button class="btn sm" id="tGoLeads">Open leads</button>`;
    banners.appendChild(b);
    b.querySelector('#tGoLeads').addEventListener('click', () => go('leads'));
  }

  if (!users && !perf) return;   /* the strip already carries the failure */

  /* ── Roster & performance ──────────────────────────────────────────────── */
  const card = el('div', 'card flush'); body.appendChild(card);

  const noActivity = r => !r.perf
    || (!(leadsAssigned(r) > 0) && !(hotLeads(r) > 0) && !(measured(r) > 0)
        && !(pipelineOf(r) > 0) && ownedBy(r).length === 0);

  const VIEWS = {
    ALL:      { label: 'All',              match: () => true },
    ACCOUNT:  { label: 'With an account',  match: hasAccount },
    PENDING:  { label: 'Pending invite',   match: isPending },
    QUIET:    { label: 'No activity yet',  match: noActivity },
  };
  const VIEW_KEYS = Object.keys(VIEWS);

  /* Sorting. Every key sinks the rows it cannot speak about to the bottom
     regardless of direction — a rep the view never reported on is not the
     fastest responder on the team, and putting them at the top of an ascending
     response sort would say exactly that. */
  const SORTS = {
    name:     { type: 'text', get: r => r.name,          dir: 1  },
    role:     { type: 'text', get: r => r.role,          dir: 1  },
    account:  { type: 'text', get: r => statusLabel(r),  dir: 1  },
    leads:    { type: 'num',  get: leadsAssigned,        dir: -1 },
    hot:      { type: 'num',  get: hotLeads,             dir: -1 },
    response: { type: 'num',  get: avgResponse,          dir: -1 },
    sla:      { type: 'num',  get: slaRate,              dir: 1  },
    pipeline: { type: 'num',  get: pipelineOf,           dir: -1 },
  };
  const f = { view: 'ALL', q: '', sort: 'leads', dir: SORTS.leads.dir };

  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
  function sortRows(rows) {
    const s = SORTS[f.sort];
    if (s.type === 'text') {
      const has = r => !!String(s.get(r) ?? '').trim();
      return rows.filter(has)
        .sort((a, b) => f.dir * String(s.get(a)).localeCompare(String(s.get(b))) || byName(a, b))
        .concat(rows.filter(r => !has(r)).sort(byName));
    }
    return rows.filter(r => s.get(r) != null)
      .sort((a, b) => f.dir * (s.get(a) - s.get(b)) || byName(a, b))
      .concat(rows.filter(r => s.get(r) == null).sort(byName));
  }

  const notReported = '<span class="t-muted">Not reported</span>';
  const cols = [
    { label: 'Name', strong: true, sort: 'name', render: r => `<div style="display:flex;align-items:center;gap:10px">
        <div class="avatar">${esc(initials(r.name))}</div>
        <div><div>${esc(r.name || 'Unnamed')}</div>
          <div class="cell-sub">${esc(r.email || 'No email on file')}</div>
          ${r.unlinked ? '<div class="cell-sub t-warm">Not in the user directory</div>' : ''}
        </div></div>` },
    { label: 'Role', sort: 'role', render: r => r.role
        ? `<span class="chip">${esc(r.role)}</span>`
        : '<span class="t-muted">No role set</span>' },
    { label: 'Account', sort: 'account', render: r => statusPill(r) },
    { label: 'Leads', align: 'r', sort: 'leads', render: r => {
        const n = leadsAssigned(r);
        if (n == null) return notReported;
        const owned = ownedBy(r).length;
        return `${num(n)}${owned && owned !== n ? `<div class="cell-sub">${num(owned)} in the leads read</div>` : ''}`;
      } },
    { label: 'HOT', align: 'r', sort: 'hot', render: r => {
        const n = hotLeads(r);
        return n == null ? notReported : `<span class="${n > 0 ? 't-hot' : 't-muted'}">${num(n)}</span>`;
      } },
    { label: 'Avg response', align: 'r', sort: 'response', render: r => {
        const a = avgResponse(r);
        if (a == null) return '<span class="t-muted">Not measured</span>';
        return `<span class="${a > 5 ? 't-hot' : 't-ok'}">${mins(a)}</span>`;
      } },
    { label: 'Within SLA', align: 'r', sort: 'sla', render: r => {
        const m = measured(r), w = withinSla(r);
        if (!m) return '<span class="t-muted">Nothing measured</span>';
        const rate = slaRate(r);
        return `${num(w ?? 0)} / ${num(m)}<div class="cell-sub ${rate != null && rate < 50 ? 't-hot' : ''}">${pct(rate)}</div>`;
      } },
    { label: 'Pipeline', align: 'r', sort: 'pipeline', render: r => {
        const p = pipelineOf(r);
        return p == null ? notReported : aed(p);
      } },
    { label: 'Invite', align: 'r', render: r => isPending(r)
        ? `<button class="btn sm" disabled aria-label="Send an invite to ${esc(r.name || 'this team member')}"
             title="${esc(NO_INVITE)}">Invite</button>`
        : '<span class="t-muted">—</span>' },
  ];

  const counts = {};
  VIEW_KEYS.forEach(k => { counts[k] = roster.filter(VIEWS[k].match).length; });

  card.innerHTML = `<div class="card-head"><div>
      <div class="card-title">Roster &amp; performance</div>
      <div class="card-sub">Who exists comes from <span class="mono">users</span>; what they did comes from
        <span class="mono">v_team_performance</span>. Sort by any column header. Click a row for the full record.
        ${perfErr ? `<span class="t-warm">The performance view could not be read (${esc(perfErr)}), so only the roster is shown.</span>` : ''}</div>
    </div></div>
    <div class="toolbar">
      <div class="seg" id="tSegView" role="group" aria-label="Filter the roster">
        ${VIEW_KEYS.map((k, i) => `<button data-v="${esc(k)}" class="${i === 0 ? 'on' : ''}">${esc(VIEWS[k].label)} · ${num(counts[k])}</button>`).join('')}
      </div>
      <div class="grow"><input type="search" id="tq" aria-label="Search the roster" placeholder="Search name, email or role" /></div>
      <div class="t-muted num" id="tCount"></div>
    </div>
    <div id="tTable"></div>`;

  const th = card.querySelector('#tTable');
  const countEl = card.querySelector('#tCount');

  const visible = () => {
    const q = f.q.trim().toLowerCase();
    return roster.filter(r => {
      if (!VIEWS[f.view].match(r)) return false;
      if (!q) return true;
      return [r.name, r.email, r.role, r.status].some(v => low(v).includes(q));
    });
  };

  /* table() escapes its column labels, so the sort affordance is attached after
     render: each sortable header becomes a real button (keyboard reachable,
     with its own label) that inherits the header's own type, and the th carries
     aria-sort so a screen reader is told the order it is reading. */
  function decorateHeaders() {
    const cells = th.querySelectorAll('thead th');
    cells.forEach((cell, i) => {
      const col = cols[i];
      if (!col?.sort) return;   /* the invite column is not a measure of anything */
      const active = f.sort === col.sort;
      const asc = f.dir === 1;
      const icon = active ? (asc ? 'arrow_upward' : 'arrow_downward') : 'unfold_more';
      cell.setAttribute('aria-sort', active ? (asc ? 'ascending' : 'descending') : 'none');
      cell.innerHTML = `<button type="button" data-sort="${esc(col.sort)}"
        aria-label="Sort by ${esc(col.label)}${active ? (asc ? ', currently ascending' : ', currently descending') : ''}"
        style="background:none;border:0;padding:0;margin:0;font:inherit;color:inherit;letter-spacing:inherit;
               text-transform:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:4px">
        ${esc(col.label)}<span class="material-symbols-outlined ${active ? '' : 't-muted'}"
          style="font-size:14px;opacity:${active ? 1 : .5}">${icon}</span></button>`;
      cell.querySelector('button').addEventListener('click', () => {
        if (f.sort === col.sort) f.dir = -f.dir;
        else { f.sort = col.sort; f.dir = SORTS[col.sort].dir; }
        draw();
      });
    });
  }

  function draw() {
    if (!roster.length) {
      countEl.textContent = '';
      th.innerHTML = stateEmpty('Nobody on the team yet',
        'The users table has no rows and the performance view returned none either, so there is no roster to report on.', 'groups');
      return;
    }
    const rows = sortRows(visible());
    countEl.textContent = `${rows.length} of ${roster.length}`;
    th.innerHTML = table(cols, rows, {
      onRow: true,
      /* The empty state names the reason it is empty. "Everyone has activity" is
         only true when the quiet slice itself is empty — say it while a search
         box is also filtering and it is a claim about the wrong set. */
      empty: (f.view === 'QUIET' && !f.q.trim())
        ? stateEmpty('Everyone has activity',
            'Every person on the roster has leads, a measured response or pipeline against their name.', 'task_alt')
        : stateEmpty('Nobody matches these filters',
            'Clear the search or pick another slice of the roster.', 'filter_alt_off'),
    });
    decorateHeaders();
    wireRows(th, rows, openRep);
  }

  card.querySelectorAll('#tSegView button').forEach(b => b.addEventListener('click', () => {
    card.querySelectorAll('#tSegView button').forEach(x => x.classList.toggle('on', x === b));
    f.view = b.dataset.v; draw();
  }));
  card.querySelector('#tq').addEventListener('input', e => { f.q = e.target.value; draw(); });

  /* The pending-invite banner hands over the exact set it counted, search
     cleared, so the list under the toolbar can never disagree with the number
     in the banner above it. */
  focusRoster = view => {
    f.view = view; f.q = '';
    card.querySelector('#tq').value = '';
    card.querySelectorAll('#tSegView button').forEach(x => x.classList.toggle('on', x.dataset.v === view));
    draw();
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  draw();

  /* ── Workload and the 5-minute rule ────────────────────────────────────── */
  const pair = el('div', 'grid g2'); pair.style.marginTop = '16px'; body.appendChild(pair);

  const workload = el('div', 'card'); pair.appendChild(workload);
  const carrying = roster.filter(r => (leadsAssigned(r) ?? 0) > 0)
    .sort((a, b) => leadsAssigned(b) - leadsAssigned(a));
  if (perfErr) {
    workload.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Workload by rep</div>
      ${stateError('the performance view', perfErr)}`;
  } else if (!carrying.length) {
    workload.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Workload by rep</div>
      ${stateEmpty('No leads assigned to anyone',
        'The performance view reports no assigned leads against a single person on the roster.', 'person_off')}`;
  } else {
    const top = leadsAssigned(carrying[0]) || 1;
    const totalAssigned = carrying.reduce((a, r) => a + leadsAssigned(r), 0);
    workload.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Workload by rep</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${carrying.map(r => {
          const n = leadsAssigned(r);
          const hot = hotLeads(r);
          return `<div style="display:flex;align-items:center;gap:12px">
            <div style="width:120px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name || 'Unnamed')}</div>
            <div class="bar" style="flex:1;height:10px"><i style="width:${(n / top * 100).toFixed(1)}%"></i></div>
            <div class="num t-muted" style="width:88px;text-align:right">${num(n)}${hot ? ` · <span class="t-hot">${num(hot)} hot</span>` : ''}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="cell-sub" style="margin-top:12px;white-space:normal">
        ${num(totalAssigned)} assigned lead${totalAssigned === 1 ? '' : 's'} across ${num(carrying.length)} of ${num(roster.length)} on the roster.
        ${leads ? `${num(unassigned.length)} more ${unassigned.length === 1 ? 'is' : 'are'} unassigned${leadsCapped ? ` within the ${num(LEAD_LIMIT)} most recent leads read` : ''}.` : 'Leads could not be read, so unassigned leads are not counted here.'}
      </div>`;
  }

  const sla = el('div', 'card'); pair.appendChild(sla);
  const timed = roster.filter(r => (measured(r) ?? 0) > 0);
  if (perfErr) {
    sla.innerHTML = `<div class="label-caps" style="margin-bottom:12px">The 5-minute rule</div>
      ${stateError('the performance view', perfErr)}`;
  } else if (!timed.length) {
    sla.innerHTML = `<div class="label-caps" style="margin-bottom:12px">The 5-minute rule</div>
      ${stateEmpty('No response times measured yet',
        'No row in the performance view carries a within_sla or breached_sla count, so nobody can be scored against the 5-minute rule.', 'timer')}`;
  } else {
    const w = timed.reduce((a, r) => a + (withinSla(r) ?? 0), 0);
    const m = timed.reduce((a, r) => a + measured(r), 0);
    const breach = m - w;
    const worst = timed.filter(r => (breachedSla(r) ?? 0) > 0)
      .sort((a, b) => breachedSla(b) - breachedSla(a)).slice(0, 5);
    sla.innerHTML = `<div class="label-caps" style="margin-bottom:12px">The 5-minute rule · ${num(m)} measured lead${m === 1 ? '' : 's'}</div>
      <div class="stackbar">
        <i style="width:${(w / m * 100).toFixed(1)}%;background:var(--ok)"></i>
        <i style="width:${(breach / m * 100).toFixed(1)}%;background:var(--hot)"></i>
      </div>
      <div style="display:flex;gap:20px;margin-top:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--ok)"></span>
          <span style="font-weight:500">Answered within 5 min</span><span class="t-muted num">${num(w)} · ${pct(w / m * 100)}</span></div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--hot)"></span>
          <span style="font-weight:500">Breached</span><span class="t-muted num">${num(breach)} · ${pct(breach / m * 100)}</span></div>
      </div>
      ${worst.length ? `<div class="label-caps" style="margin:16px 0 8px">Most breaches</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${worst.map(r => `<div style="display:flex;align-items:center;gap:12px">
            <div style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name || 'Unnamed')}</div>
            <div class="cell-sub">${mins(avgResponse(r))} average</div>
            <div class="num t-hot" style="width:64px;text-align:right">${num(breachedSla(r))}</div>
          </div>`).join('')}
        </div>` : '<div class="cell-sub" style="margin-top:12px">Nobody on the roster has a breach against their name.</div>'}
      <div class="cell-sub" style="margin-top:12px;white-space:normal">
        ${num(timed.length)} of ${num(roster.length)} on the roster have been timed on a lead. The rest carry no measurement,
        which is not the same as being fast.</div>`;
  }

  /* ── One rep, in full ──────────────────────────────────────────────────── */
  function openRep(r) {
    const owned = ownedBy(r);
    const m = measured(r), w = withinSla(r), b = breachedSla(r);
    /* What a delete would strand, stated from both sources rather than one.
       The view's figure is all-time; the leads read here is a capped window, so
       quoting only the window would let "0 leads would be stranded" appear next
       to a rep the view credits with nine. */
    const strandBits = [];
    if (leadsAssigned(r) != null) {
      strandBits.push(`${num(leadsAssigned(r))} lead${leadsAssigned(r) === 1 ? '' : 's'} against their name in the performance view`);
    }
    if (leads && r.id) {
      strandBits.push(`${num(owned.length)} of the ${num(leads.length)} most recent leads read here pointing at their id${leadsCapped ? ', and that read is capped so there may be more' : ''}`);
    }

    const leadList = !leads
      ? `<div class="cell-sub">Leads could not be read (${esc(leadsErr || 'unknown error')}), so this rep's book cannot be listed.</div>`
      : !r.id
        ? '<div class="cell-sub">This person has no user id on the roster, so no lead can be matched to them.</div>'
        : !owned.length
          ? stateEmpty('No leads on this rep',
              leadsCapped
                ? `Nothing in the ${LEAD_LIMIT} most recent leads is assigned to them; older leads are not on this page.`
                : 'No lead in the table names them as owner.', 'person_search')
          : `<div>${owned.slice(0, 10).map(l => `<div class="list-item" style="cursor:default">
              <div style="flex:1;min-width:0">
                <div style="font-weight:500">${esc(l.name || 'Unnamed lead')}</div>
                <div class="cell-sub">${esc(l.vehicle_interest || 'No vehicle noted')} · ${esc(ago(l.created_at))}</div>
              </div>
              ${l.status ? pill(l.status) : ''}
              <div class="num cell-sub">${n0(l.budget_aed) == null ? '' : aed(l.budget_aed)}</div>
            </div>`).join('')}
            ${owned.length > 10 ? `<div class="cell-sub" style="padding:8px 0">and ${num(owned.length - 10)} more.</div>` : ''}</div>`;

    openDrawer(`
      <div class="drawer-head">
        <div class="avatar">${esc(initials(r.name))}</div>
        <div style="flex:1">
          <h2 style="font-size:18px">${esc(r.name || 'Unnamed')}</h2>
          <div class="cell-sub">${esc(r.role || 'No role set')} · ${esc(r.email || 'No email on file')}</div>
          <div class="cell-sub mono">${esc(r.id ?? 'no user id')}</div>
        </div>
        <button class="btn ghost sm" id="tClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section">
          <div class="label-caps">Account</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${statusPill(r)}${r.unlinked ? pill('Not in the user directory', 'warm') : ''}
          </div>
          ${isPending(r) ? `<div class="banner warm" style="margin-top:12px">
            <span class="material-symbols-outlined">mark_email_unread</span>
            <div>This person cannot sign in, cannot be alerted and cannot be assigned a lead until the account exists.
            Sending the invitation is not built yet.</div></div>` : ''}
          ${r.unlinked ? `<div class="cell-sub" style="margin-top:12px;white-space:normal">
            This row came from <span class="mono">v_team_performance</span> and matched nobody in <span class="mono">users</span> by id,
            email or name. They have activity against their name but no account record.</div>` : ''}
        </div>

        <div class="section">
          <div class="label-caps">Performance</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Leads assigned</dt><dd class="num">${leadsAssigned(r) == null ? notReported : num(leadsAssigned(r))}</dd>
            <dt>HOT leads</dt><dd class="num">${hotLeads(r) == null ? notReported : num(hotLeads(r))}</dd>
            <dt>Avg response</dt><dd class="num">${avgResponse(r) == null ? '<span class="t-muted">Not measured</span>' : `<span class="${avgResponse(r) > 5 ? 't-hot' : 't-ok'}">${mins(avgResponse(r))}</span>`}</dd>
            <dt>Within 5 min</dt><dd class="num">${m ? `${num(w ?? 0)} / ${num(m)} · ${pct(slaRate(r))}` : '<span class="t-muted">Nothing measured</span>'}</dd>
            <dt>Breached</dt><dd class="num">${b == null ? notReported : `<span class="${b > 0 ? 't-hot' : ''}">${num(b)}</span>`}</dd>
            <dt>Pipeline</dt><dd class="num">${pipelineOf(r) == null ? notReported : aed(pipelineOf(r))}</dd>
          </dl>
          ${!r.perf ? `<div class="cell-sub" style="margin-top:12px;white-space:normal">
            ${perfErr ? `The performance view could not be read (${esc(perfErr)}).`
                      : 'The performance view has no row for this person, so nothing has been recorded against them yet.'}</div>` : ''}
        </div>

        <div class="section">
          <div class="label-caps">Their leads</div>
          <div style="margin-top:8px">${leadList}</div>
        </div>

        <div class="section">
          <div class="label-caps">Why there is no delete</div>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">
            ${esc(NO_DELETE)}${strandBits.length
              ? ` They have ${strandBits.join(' and ')} — every one of those would be left ownerless.`
              : ''}
          </div>
        </div>
      </div>
      <div class="drawer-foot">
        <button class="btn primary" disabled title="${esc(NO_INVITE)}">${isPending(r) ? 'Send invite' : 'Resend invite'}</button>
        <button class="btn" disabled title="${esc(NO_ROLE_WRITE)}">Change role</button>
        <button class="btn ghost" id="tGoLeadsDrawer">Open the leads screen</button>
      </div>`);
    $('tClose').addEventListener('click', closeDrawer);
    $('tGoLeadsDrawer').addEventListener('click', () => go('leads'));
  }
};
