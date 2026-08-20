/* NEXUS OS — screens/leads.js
   Split out of the original monolithic app.js on 17 Aug 2026, then reworked on
   19 Aug 2026 into a workable pipeline: filter, sort, search, and the two
   workflow actions a rep actually takes on a row. */
import { HOOK, db, n8n } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE } from '../lib/env.js';
import { aed, ago, esc, n0, num, pill, tone } from '../lib/format.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { openModal } from '../lib/modal.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { table, wireRows } from '../lib/ui.js';

const up  = s => String(s || '').toUpperCase();
const low = s => String(s || '').toLowerCase();
const ts  = v => { const t = new Date(v).getTime(); return Number.isNaN(t) ? 0 : t; };
const when = v => { const t = new Date(v).getTime(); return Number.isNaN(t) ? '' : new Date(t).toLocaleString('en-GB'); };

/* ── The two workflows this screen may trigger ────────────────────────────────
   Both already exist in n8n and both verify the caller's Supabase JWT, which
   n8n() attaches. Nothing here writes to the database: escalation and the drip
   are n8n's job, and the row keeps whatever status and owner it had. The field
   vocabularies below are not free choices — a dashboard/workflow mismatch is
   what kept the drip at zero successful runs before, so `drip` posts exactly
   what the Campaigns screen posts, and `escalate` posts the identity fields the
   Lead Escalation agent resolves its session on (email → lead_email → name)
   plus `reason`, which is the field that routes the alert to
   #escalation-alerts rather than the hot-lead channel. */
const ACTIONS = {
  escalate: {
    key: 'escalate',
    hook: HOOK.escalation,
    label: 'Escalate',
    title: 'Escalate this lead',
    confirm: 'Escalate now',
    done: 'Escalated',
    blurb: 'Hands the lead to the Lead Escalation workflow, which posts a briefing into Slack for a human to pick up. '
         + 'Nothing on this screen changes — the lead keeps its current status and owner.',
    blocker: l => (!l.email && !l.name)
      ? 'This lead has neither a name nor an email address, so the alert would arrive unidentifiable.'
      : null,
    payload: l => ({
      email: l.email || null,
      lead_email: l.email || null,
      name: l.name || null,
      lead_name: l.name || null,
      phone: l.phone || null,
      vehicle_interest: l.vehicle_interest || null,
      lead_score: n0(l.ai_score),
      status: l.status || null,
      reason: 'Escalated by hand from the Leads screen',
    }),
  },
  drip: {
    key: 'drip',
    hook: HOOK.warmDrip,
    label: 'Start drip',
    title: 'Enrol in the 7-day warm drip',
    confirm: 'Start the drip',
    done: 'Drip started',
    blurb: 'Day 1 welcome, day 3 follow-up, day 7 final offer — sent by n8n over the following week, not by this browser. '
         + 'Starting it twice enrols the lead twice.',
    blocker: l => !l.email
      ? 'The drip is addressed by email and this lead has no email address on record.'
      : null,
    payload: l => ({
      lead_email: l.email,
      lead_name: l.name || '',
      vehicle_interest: l.vehicle_interest || '',
    }),
  },
};

const SORTS = {
  new:   'Newest first',
  old:   'Oldest first',
  score: 'Highest AI score',
  low:   'Lowest AI score',
};

/* A 2xx from the webhook is the only thing we actually know. Echo whatever the
   workflow said if it said anything; never dress up silence as a result. */
function replyNote(res) {
  const t = res && typeof res === 'object' ? (res.status || res.message || res.raw) : null;
  return typeof t === 'string' && t.trim()
    ? `The workflow replied: ${t.trim().slice(0, 160)}`
    : 'The workflow accepted the request.';
}

SCREENS.leads = async host => {
  const card = el('div', 'card flush'); host.appendChild(card);
  card.innerHTML = stateLoading(8);

  let all = [];
  try {
    // `users(id,name)` and not `users:assigned_to_id(...)` — the colon form is an
    // alias, not an FK hint, and PostgREST would look for a table called
    // `assigned_to_id`. leads has exactly one FK to users, so this is unambiguous.
    all = await db('leads?select=*,users(id,name)&order=created_at.desc&limit=1000');
  } catch (e) { card.innerHTML = stateError('leads', e.message); return; }

  /* Two secondary reads. Neither is allowed to take the screen down, but a
     failure is not allowed to look like an answer either: with no purchase
     history no VIP badge is shown *and no lead is claimed to be a first-timer*,
     and with no audit log the workflow-history line is withheld rather than
     rendered as "never run". Both say so in a banner. */
  let vipSet = null, hist = null;
  const notes = [];
  try {
    const purchases = await db('purchase_history?select=email');
    vipSet = new Set(purchases.map(p => low(p.email)));
  } catch (e) {
    notes.push(`Purchase history is unavailable (${e.message}), so returning customers are not flagged.`);
  }
  try {
    const audit = await db('audit_log?select=workflow,status,lead_email,logged_at&order=logged_at.desc&limit=1000');
    hist = new Map();
    for (const a of audit) {
      const em = low(a.lead_email); if (!em) continue;
      const slot = /drip/i.test(a.workflow || '') ? 'drip'
                 : /escalat/i.test(a.workflow || '') ? 'escalate' : null;
      if (!slot) continue;
      const cur = hist.get(em) || {};
      if (!cur[slot]) { cur[slot] = a; hist.set(em, cur); }   // rows arrive newest first
    }
  } catch (e) {
    notes.push(`The audit log is unavailable (${e.message}), so previous escalations and drips are not shown.`);
  }

  const sources = [...new Set(all.map(l => l.source).filter(Boolean))].sort();
  const reps = [...new Set(all.map(l => l.users?.name).filter(Boolean))].sort();

  /* Actions fired in this browser session. Recorded only after a 2xx, and
     labelled as this session's doing — it is our own receipt, not a DB row. */
  const sent = new Map();

  const f = { status: 'ALL', q: '', source: 'ALL', rep: 'ALL', sort: 'new' };

  function filtered() {
    return all.filter(l => {
      if (f.status !== 'ALL' && up(l.status) !== f.status) return false;
      if (f.source !== 'ALL' && l.source !== f.source) return false;
      if (f.rep === '__none' && l.assigned_to_id) return false;
      if (f.rep !== 'ALL' && f.rep !== '__none' && l.users?.name !== f.rep) return false;
      if (f.q) {
        const hay = [l.name, l.email, l.phone, l.vehicle_interest].join(' ').toLowerCase();
        if (!hay.includes(f.q.toLowerCase())) return false;
      }
      return true;
    });
  }

  /* Leads with no AI score are not zero-scored — the router simply never scored
     them. They sort to the bottom of both score orders, newest first among
     themselves, rather than pretending to be the worst leads in the pipeline. */
  function sorted(rows) {
    if (f.sort === 'new') return rows.slice().sort((a, b) => ts(b.created_at) - ts(a.created_at));
    if (f.sort === 'old') return rows.slice().sort((a, b) => ts(a.created_at) - ts(b.created_at));
    const dir = f.sort === 'low' ? 1 : -1;
    const scored = rows.filter(r => n0(r.ai_score) != null)
      .sort((a, b) => dir * (Number(a.ai_score) - Number(b.ai_score)));
    const unscored = rows.filter(r => n0(r.ai_score) == null)
      .sort((a, b) => ts(b.created_at) - ts(a.created_at));
    return scored.concat(unscored);
  }

  const count = s => all.filter(l => up(l.status) === s).length;

  card.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="segStatus" role="group" aria-label="Filter by status">
        ${[['ALL', all.length], ['HOT', count('HOT')], ['WARM', count('WARM')], ['COLD', count('COLD')]]
          .map(([k, c], i) => `<button data-v="${k}" class="${i === 0 ? 'on' : ''}">${k === 'ALL' ? 'All' : k} · ${c}</button>`).join('')}
      </div>
      <div class="grow"><input type="search" id="q" aria-label="Search leads"
        placeholder="Search name, email, phone or vehicle" /></div>
      <select id="fSource" aria-label="Filter by source" style="width:auto"><option value="ALL">All sources</option>${sources.map(s => `<option>${esc(s)}</option>`).join('')}</select>
      <select id="fRep" aria-label="Filter by assigned rep" style="width:auto"><option value="ALL">All reps</option><option value="__none">Unassigned</option>${reps.map(s => `<option>${esc(s)}</option>`).join('')}</select>
      <select id="fSort" aria-label="Sort leads" style="width:auto">${Object.entries(SORTS)
        .map(([k, label]) => `<option value="${k}">${esc(label)}</option>`).join('')}</select>
      <div class="t-muted num" id="resultCount"></div>
    </div>
    ${notes.length ? `<div style="padding:14px 20px 0">${notes.map(n => `<div class="banner warm">
      <span class="material-symbols-outlined">warning</span><div>${esc(n)}</div></div>`).join('')}</div>` : ''}
    <div id="leadTable"></div>`;

  function actionCell(r) {
    const buttons = [ACTIONS.escalate, ACTIONS.drip].map(a => {
      const blocked = !N8N_BASE
        ? 'VITE_N8N_BASE_URL is not set in this build, so no n8n workflow can be called from the browser.'
        : a.blocker(r);
      return `<button class="btn sm" data-act="${a.key}" data-id="${esc(r.id)}"
        aria-label="${esc(a.label)} — ${esc(r.name || r.email || 'this lead')}"
        title="${esc(blocked || a.title)}"${blocked ? ' disabled' : ''}>${esc(a.label)}</button>`;
    }).join('');

    const lines = [];
    for (const a of [ACTIONS.escalate, ACTIONS.drip]) {
      const at = sent.get(`${r.id}|${a.key}`);
      if (at) lines.push(`<span class="t-ok">${esc(a.done)} ${ago(at)} · this session</span>`);
      const past = hist?.get(low(r.email))?.[a.key];
      if (past) lines.push(`${esc(past.workflow)} · ${esc(past.status || '')} · ${ago(past.logged_at)}`);
    }
    return `<div style="display:flex;gap:6px;justify-content:flex-end">${buttons}</div>
      ${lines.length ? `<div class="cell-sub" style="text-align:right;margin-top:4px">${lines.join('<br>')}</div>` : ''}`;
  }

  const cols = [
    { label:'Status', render: r => pill(r.status || 'NEW') },
    { label:'Name', strong: true, render: r => `${esc(r.name)}${vipSet?.has(low(r.email)) ? ' <span class="pill vip"><span class="dot"></span>VIP</span>' : ''}` },
    { label:'Contact', render: r => `<div>${esc(r.email || '—')}</div><div class="cell-sub">${esc(r.phone || '—')}</div>` },
    { label:'Vehicle interest', render: r => `<span class="t-2">${esc(r.vehicle_interest || '—')}</span>` },
    /* budget_aed is NULL for router-created leads because the Master Router does
       not capture it. Rendering 0 would understate the pipeline silently. */
    { label:'Budget', align:'r', render: r => n0(r.budget_aed) == null ? '<span class="t-muted">—</span>' : aed(r.budget_aed) },
    { label:'AI score', align:'r', render: r => {
        const s = n0(r.ai_score); if (s == null) return '<span class="t-muted">—</span>';
        const c = tone(r.status) === 'hot' ? 'hot' : tone(r.status) === 'warm' ? 'warm' : 'cold';
        return `<div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
          <div class="bar" style="width:44px"><i style="width:${s}%;background:var(--${c})"></i></div>
          <span style="font-weight:500;min-width:22px;text-align:right">${s}</span></div>`;
      }},
    { label:'Source', render: r => `<span class="chip nowrap" title="${esc(r.source || '')}">${esc(r.source || '—')}</span>` },
    { label:'Assigned', render: r => r.users?.name
        ? esc(r.users.name)
        : `<span class="pill warm"><span class="dot"></span>Unassigned</span>` },
    { label:'Age', render: r => `<span class="t-muted" title="${esc(when(r.created_at))}">${ago(r.created_at)}</span>` },
    { label:'Actions', align:'r', render: actionCell },
  ];

  /* One confirm step, then one unambiguous outcome. The dialog stays open on
     failure with the error verbatim, because "it didn't work" without the
     reason sends the operator to n8n's execution list to guess. */
  function confirmAction(a, lead) {
    const m = openModal(a.title, `
      <p class="t-2" style="margin:0 0 16px">${esc(a.blurb)}</p>
      <dl class="kv">
        <dt>Lead</dt><dd>${esc(lead.name || '—')}</dd>
        <dt>Email</dt><dd>${esc(lead.email || '—')}</dd>
        <dt>Phone</dt><dd>${esc(lead.phone || '—')}</dd>
        <dt>Vehicle</dt><dd>${esc(lead.vehicle_interest || '—')}</dd>
        <dt>Status</dt><dd>${pill(lead.status || 'NEW')}</dd>
        <dt>AI score</dt><dd>${n0(lead.ai_score) == null ? '<span class="t-muted">Not scored</span>' : num(lead.ai_score)}</dd>
      </dl>`,
      `<button class="btn primary" id="actGo">${esc(a.confirm)}</button>
       <button class="btn" id="actCancel">Cancel</button>`);

    const go = m.wrap.querySelector('#actGo');
    const cancel = m.wrap.querySelector('#actCancel');
    go.focus();
    cancel.addEventListener('click', m.close);
    go.addEventListener('click', async () => {
      const label = go.textContent;
      go.disabled = true; cancel.disabled = true; go.textContent = 'Sending…';
      m.msg('<span class="t-muted">Calling the workflow…</span>');
      try {
        const res = await n8n(a.hook, a.payload(lead));
        sent.set(`${lead.id}|${a.key}`, Date.now());
        m.msg(`<span class="t-ok">${esc(a.done)}. ${esc(replyNote(res))}</span>`);
        go.textContent = 'Done';
        cancel.disabled = false; cancel.textContent = 'Close';
        draw();
      } catch (e) {
        go.disabled = false; cancel.disabled = false; go.textContent = label;
        m.msg(`<span class="t-hot">Nothing was sent — ${esc(e.message)}</span>`);
      }
    });
  }

  function draw() {
    card.querySelectorAll('#segStatus button').forEach(b =>
      b.classList.toggle('on', b.dataset.v === f.status));
    const rows = sorted(filtered());
    $('resultCount').textContent = `${rows.length} of ${all.length} leads`;
    const host2 = $('leadTable');
    host2.innerHTML = all.length
      ? table(cols, rows, {
          onRow: true,
          empty: stateEmpty('No leads match these filters', 'Try clearing the search or widening the status filter.', 'search_off'),
        })
      : stateEmpty('No leads yet', 'They appear here the moment the router webhook receives one.', 'inbox');
    wireRows(host2, rows, leadDrawer);
    host2.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', ev => {
      /* The row itself opens the drawer; an action button must not do both. */
      ev.stopPropagation();
      const lead = rows.find(r => String(r.id) === b.dataset.id);
      const a = ACTIONS[b.dataset.act];
      if (lead && a) confirmAction(a, lead);
    }));
  }

  card.querySelectorAll('#segStatus button').forEach(b => b.addEventListener('click', () => {
    f.status = b.dataset.v; draw();
  }));
  $('q').addEventListener('input', e => { f.q = e.target.value; draw(); });
  $('fSource').addEventListener('change', e => { f.source = e.target.value; draw(); });
  $('fRep').addEventListener('change', e => { f.rep = e.target.value; draw(); });
  $('fSort').addEventListener('change', e => { f.sort = e.target.value; draw(); });
  draw();
};
