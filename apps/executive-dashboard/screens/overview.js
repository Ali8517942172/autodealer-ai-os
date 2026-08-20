/* NEXUS OS — screens/overview.js
   The executive landing screen. Its job is not to mirror the other thirteen
   screens; it is to answer one question — "what needs a human right now?" —
   and then get out of the way with a link into the screen that can fix it.

   Three things are surfaced here that no other screen puts in front of you on
   arrival:
     · leads that have been created and never answered (no outbound message),
     · workflows that have failed inside the 30-day health window,
     · KYC rows whose document was never archived (an audit hole, not a purge).
   Everything below is a number Postgres produced. Nothing is estimated. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, clock, esc, mins, n0, num, pill, tone } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi, panel, table } from '../lib/ui.js';

/* The reply-gap analysis is windowed so it is provably complete rather than
   merely likely: a reply to a lead can only be logged at or after that lead was
   created, so if we read every outbound message inside the window we know the
   true reply state of every lead created inside the same window. Reading
   "the newest N messages" instead would silently mark answered leads as
   unanswered the moment the dealership got busy. */
const WINDOW_DAYS = 30;
const OUTBOUND_LIMIT = 5000;

SCREENS.overview = async host => {
  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);

  const triage = el('div', 'grid g3 top'); triage.style.marginTop = '16px'; host.appendChild(triage);
  const replyHost = el('div'); const flowHost = el('div'); const kycHost = el('div');
  triage.appendChild(replyHost); triage.appendChild(flowHost); triage.appendChild(kycHost);

  const mid = el('div', 'grid g2 top'); mid.style.marginTop = '16px'; host.appendChild(mid);
  const attnHost = el('div'); const feedHost = el('div');
  mid.appendChild(attnHost); mid.appendChild(feedHost);

  const pipeCard = el('div', 'card'); pipeCard.style.marginTop = '16px'; host.appendChild(pipeCard);
  pipeCard.innerHTML = stateLoading(2);

  /* The nav badge counts v_needs_attention plus KYC archive gaps. The reply gap
     and the failing workflows are deliberately NOT added on top: the view
     already emits `sla_breach` and `workflow_failure` rows for the same
     underlying events, and a badge that counts one incident twice is a number
     the database did not produce. */
  const need = { attention: null, kyc: null };
  const setBadge = () => {
    const badge = $('badge-overview');
    if (!badge || need.attention == null) return;
    const n = need.attention + (need.kyc || 0);
    badge.textContent = String(n);
    badge.classList.toggle('hide', n === 0);
  };

  /* ── Core read ──────────────────────────────────────────────────────────
     One fetch feeds the KPI strip, the reply-gap panel and the stage bar, so
     the three cannot disagree with each other. If it fails, every dependent
     surface says so rather than rendering a plausible-looking zero. */
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
  let core = null, coreErr = null;
  try {
    const [leads, inv, metrics, outbound] = await Promise.all([
      db('leads?select=id,name,email,status,ai_score,vehicle_interest,source,budget_aed,response_time_minutes,created_at,assigned_to_id&order=created_at.desc&limit=2000'),
      db('inventory?select=status,days_in_stock,price_aed,holding_cost_accrued,aging_alert&limit=2000'),
      /* daily_metrics is the snapshot table the deltas below are read from. It
         is optional — where it has not been provisioned no delta line renders
         at all, which is the correct outcome. It is never substituted for. */
      db('daily_metrics?select=*&order=snapshot_date.desc&limit=2').catch(() => []),
      db(`communication_logs?select=lead_email,created_at&direction=eq.outbound&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${OUTBOUND_LIMIT}`),
    ]);

    const up = s => String(s || '').toUpperCase();
    const norm = v => String(v || '').trim().toLowerCase();
    const hot = leads.filter(l => up(l.status) === 'HOT').length;
    const warm = leads.filter(l => up(l.status) === 'WARM').length;
    const cold = leads.filter(l => up(l.status) === 'COLD').length;

    const withResp = leads.filter(l => n0(l.response_time_minutes) != null);
    const avgResp = withResp.length ? withResp.reduce((a, l) => a + Number(l.response_time_minutes), 0) / withResp.length : null;
    const withBudget = leads.filter(l => n0(l.budget_aed) != null);
    const pipeline = withBudget.reduce((a, l) => a + Number(l.budget_aed), 0);
    const risk = inv.filter(i => up(i.aging_alert) === 'CRITICAL');
    const holding = inv.reduce((a, i) => a + (n0(i.holding_cost_accrued) || 0), 0);

    const sinceMs = Date.parse(since);
    const answered = new Set(outbound.map(c => norm(c.lead_email)).filter(Boolean));
    const recent = leads.filter(l => Date.parse(l.created_at) >= sinceMs);
    /* A lead with no email cannot be matched against communication_logs, which
       keys on lead_email. Counting those as "unanswered" would invent a queue;
       they are excluded and reported separately so the gap is visible. */
    const unmatchable = recent.filter(l => !norm(l.email)).length;
    const waiting = recent
      .filter(l => norm(l.email) && !answered.has(norm(l.email)))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

    core = { leads, hot, warm, cold, avgResp, withResp, withBudget, pipeline, risk, holding,
             metrics, waiting, unmatchable, recentCount: recent.length,
             outboundCapped: outbound.length >= OUTBOUND_LIMIT };
  } catch (e) {
    coreErr = e;
  }

  /* Dependent panels re-raise the core failure so panel() renders its own error
     card with a working Retry, instead of five cards quietly showing nothing. */
  const requireCore = () => { if (coreErr) throw coreErr; return core; };

  if (coreErr) {
    strip.innerHTML = stateError('the overview', coreErr.message);
    pipeCard.innerHTML = stateError('pipeline by stage', coreErr.message);
  } else {
    const { hot, warm, cold, avgResp, withResp, withBudget, pipeline, risk, holding, metrics, waiting, leads } = core;

    /* Deltas only exist once there are two snapshots. Until then no delta line
       renders at all — an earlier build showed "-18s vs last week" as a
       hardcoded string with nothing behind it. */
    const prev = metrics.length > 1 ? metrics[1] : null;
    const delta = (now, before, fmt, lowerIsBetter) => {
      if (!prev || before == null || now == null) return '';
      const d = Number(now) - Number(before);
      if (!d) return `<span class="t-muted">no change vs ${ago(prev.snapshot_date)}</span>`;
      const good = lowerIsBetter ? d < 0 : d > 0;
      return `<span class="${good ? 't-ok' : 't-hot'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span> <span class="t-muted">vs previous snapshot</span>`;
    };

    const oldestRisk = risk.length ? Math.max(...risk.map(r => n0(r.days_in_stock) || 0)) : null;

    strip.innerHTML = [
      kpi('Open leads', num(leads.length),
        `${pill(`${hot} HOT`, 'hot')} ${pill(`${warm} WARM`, 'warm')} ${pill(`${cold} COLD`, 'cold')}`),
      /* The one number on this screen that maps to a person waiting. */
      kpi('Awaiting first reply', num(waiting.length),
        waiting.length
          ? `<span class="t-hot">Oldest arrived ${ago(waiting[0].created_at)}, still unanswered</span>`
          : `<span class="t-ok">Every lead in the last ${WINDOW_DAYS} days has an outbound message</span>`,
        waiting.length ? 't-hot' : ''),
      kpi('Avg response time', mins(avgResp),
        avgResp == null
          ? '<span class="t-muted">No lead has a recorded response time yet</span>'
          : avgResp > 5
            ? `<span class="t-hot">Breaches the 5-minute rule</span> <span class="t-muted">· from ${num(withResp.length)} leads</span>`
            : delta(avgResp, prev?.avg_response_minutes, v => mins(v), true)),
      kpi('Pipeline value', aed(pipeline),
        withBudget.length < leads.length
          ? `<span class="t-muted">From ${withBudget.length} of ${leads.length} leads · ${leads.length - withBudget.length} ${leads.length - withBudget.length === 1 ? 'has' : 'have'} no budget recorded</span>`
          : delta(pipeline, prev?.pipeline_aed, v => aed(v))),
      kpi('Units at risk', num(risk.length),
        risk.length
          ? `<span class="t-hot">Oldest ${num(oldestRisk)} days in stock</span> <span class="t-muted">· ${aed(holding)} holding cost accrued</span>`
          : `<span class="t-muted">No unit past the aging threshold · ${aed(holding)} holding cost accrued</span>`),
    ].join('');

    const seg = [['HOT', hot, 'var(--hot)'], ['WARM', warm, 'var(--warm)'], ['COLD', cold, 'var(--cold)']];
    const graded = hot + warm + cold;
    pipeCard.innerHTML = graded
      ? `<div class="label-caps" style="margin-bottom:12px">Pipeline by stage</div>
        <div class="stackbar">${seg.map(([, v, c]) => `<i style="width:${(v / graded * 100).toFixed(1)}%;background:${c}"></i>`).join('')}</div>
        <div style="display:flex;gap:20px;margin-top:12px;flex-wrap:wrap">
          ${seg.map(([k, v, c]) => `<div style="display:flex;align-items:center;gap:8px">
            <span style="width:8px;height:8px;border-radius:50%;background:${c}"></span>
            <span style="font-weight:500">${esc(k)}</span><span class="t-muted num">${num(v)} leads</span></div>`).join('')}
          ${graded < leads.length ? `<div class="cell-sub">${num(leads.length - graded)} not yet scored by the router</div>` : ''}
        </div>`
      : stateEmpty('Nothing to chart yet', 'No lead has been scored HOT, WARM or COLD.', 'donut_small');
  }

  /* ── Triage row ─────────────────────────────────────────────────────────── */

  const panels = [];

  /* 1 · Leads nobody has replied to. */
  panels.push(panel(replyHost, {
    title: 'No reply sent',
    sub: `Leads created in the last ${WINDOW_DAYS} days with no outbound message in communication_logs`,
    actions: `<button class="btn sm" data-act="leads">Open Leads</button>`,
    load: async () => requireCore(),
    render: d => {
      const notes = [
        d.unmatchable ? `${num(d.unmatchable)} of the ${num(d.recentCount)} leads in this window have no email address, so communication_logs cannot be matched to them.` : '',
        d.outboundCapped ? `Outbound history was capped at ${num(OUTBOUND_LIMIT)} messages for this window, so this list may be incomplete.` : '',
      ].filter(Boolean);
      const foot = notes.length
        ? `<div class="list-item" style="cursor:default"><span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
             <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}</div></div>`
        : '';
      if (!d.waiting.length) {
        return stateEmpty('Every lead has been answered',
          `No lead created in the last ${WINDOW_DAYS} days is missing an outbound message.`, 'mark_email_read') + foot;
      }
      const shown = d.waiting.slice(0, 8);
      return `<div>${shown.map(l => `
        <div class="list-item" style="cursor:default;align-items:flex-start">
          ${pill(l.status || 'NEW')}
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${esc(l.name || 'Unnamed lead')}</div>
            <div class="cell-sub">${esc(l.vehicle_interest || 'No vehicle recorded')}${l.source ? ' · ' + esc(l.source) : ''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="t-hot">${ago(l.created_at)}</div>
            <div class="cell-sub">${l.assigned_to_id ? 'assigned' : 'unassigned'}</div>
          </div>
        </div>`).join('')}
        ${d.waiting.length > shown.length
          ? `<div class="list-item" style="cursor:default"><div class="cell-sub">${num(d.waiting.length - shown.length)} more waiting — see Leads</div></div>`
          : ''}${foot}</div>`;
    },
  }).then(card => card.querySelector('[data-act]')?.addEventListener('click', () => go('leads'))));

  /* 2 · Workflows that actually failed inside the health window. `health` is
     computed over 30 days, so failures_30d is the column that agrees with it —
     all-time `failures` would keep a long-fixed workflow red forever. */
  panels.push(panel(flowHost, {
    title: 'Workflows degraded',
    sub: 'Any workflow with at least one failure in the last 30 days',
    actions: `<button class="btn sm" data-act="automation">Open Automation</button>`,
    load: () => db('v_workflow_health?select=id,name,category,health,runs_30d,failures_30d,last_failure,is_active&failures_30d=gt.0&order=failures_30d.desc,name.asc&limit=50'),
    render: rows => {
      if (!rows.length) {
        return stateEmpty('No workflow has failed in 30 days',
          'Workflows that do not write to the audit log cannot report health — Automation lists those separately.', 'task_alt');
      }
      return `<div>${rows.map(w => {
        const runs = n0(w.runs_30d), fails = n0(w.failures_30d);
        return `<div class="list-item" style="cursor:default;align-items:flex-start">
          <span class="material-symbols-outlined t-hot" style="font-size:20px">error</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-weight:500">${esc(w.name)}</span>
              ${pill(w.health === 'DEGRADED' ? 'Degraded' : String(w.health || 'Unknown'), w.health === 'DEGRADED' ? 'hot' : '')}
              ${w.is_active === false ? pill('Inactive', 'cold') : ''}
            </div>
            <div class="cell-sub">${esc(w.category || 'Uncategorised')}${w.last_failure ? ' · last failed ' + ago(w.last_failure) : ''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="num t-hot" style="font-weight:500">${num(fails)}</div>
            <div class="cell-sub">${runs == null ? 'failed' : `of ${num(runs)} runs`}</div>
          </div>
        </div>`;
      }).join('')}</div>`;
    },
  }).then(card => card.querySelector('[data-act]')?.addEventListener('click', () => go('automation'))));

  /* 3 · KYC archive gaps. purged_at IS NOT NULL means the file was deleted on
     schedule and is not a problem; storage_path IS NULL with no purge means the
     archive step never wrote the file, and the audit trail has a hole. */
  panels.push(panel(kycHost, {
    title: 'KYC archive gaps',
    sub: 'Audited documents whose file was never stored, and which were not purged on schedule',
    actions: `<button class="btn sm" data-act="compliance">Open Compliance</button>`,
    load: () => db('kyc_documents?select=id,lead_name,lead_email,document_type,verdict,created_at,retain_until&storage_path=is.null&purged_at=is.null&order=created_at.desc&limit=50'),
    render: rows => {
      if (!rows.length) {
        return stateEmpty('Every audited document is archived',
          'No KYC row is missing its stored file. Rows already purged on schedule are not counted here.', 'inventory_2');
      }
      return `<div>${rows.map(d => `
        <div class="list-item" style="cursor:default;align-items:flex-start">
          <span class="material-symbols-outlined t-warm" style="font-size:20px">folder_off</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-weight:500">${esc(d.lead_name || d.lead_email || 'Unknown contact')}</span>
              ${d.verdict ? pill(d.verdict) : ''}
            </div>
            <div class="cell-sub">${esc(d.document_type || 'Unknown document')} · audited ${ago(d.created_at)}${d.retain_until ? ' · retain until ' + esc(d.retain_until) : ''}</div>
          </div>
          <button class="btn sm" disabled
            title="No re-archive endpoint exists. kyc_documents and the private kyc-documents bucket are service-role only, and there is no n8n webhook for re-running the archive step, so the browser cannot repair this row.">Re-archive</button>
        </div>`).join('')}
        <div class="list-item" style="cursor:default">
          <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
          <div class="cell-sub" style="white-space:normal">Repairing these needs a service-role job. The document itself cannot be opened from the browser either — private-bucket files require a short-lived signed URL and there is no helper for that yet.</div>
        </div></div>`;
    },
  }).then(card => {
      card.querySelector('[data-act]')?.addEventListener('click', () => go('compliance'));
      /* One disabled Re-archive button is rendered per gap row, and only for
         gap rows, so this is the row count without re-querying. */
      need.kyc = card.querySelectorAll('.pbody button[disabled]').length;
      setBadge();
    }));

  /* ── Needs attention + the live feed ────────────────────────────────────── */

  panels.push(panel(attnHost, {
    title: 'Needs attention',
    sub: 'Live union of unassigned HOT leads, SLA breaches, aging stock, price undercuts and workflow failures',
    load: () => db('v_needs_attention?select=*&limit=60').then(rows => {
      /* A HOT lead with no owner decays in minutes; a car aging on the lot
         decays over weeks. Severity alone put four parked cars above a lead
         nobody is working. */
      const rank = { lead_unassigned: 0, sla_breach: 1, workflow_failure: 2, undercut: 3, inventory_aging: 4 };
      return rows.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9)
        || new Date(b.at) - new Date(a.at));
    }),
    render: items => {
      if (!items.length) return stateEmpty('Nothing needs you right now', 'No unassigned HOT leads, SLA breaches, aging units, undercuts or failures.', 'task_alt');
      const KIND = { lead_unassigned:'person_alert', sla_breach:'timer', inventory_aging:'directions_car',
                     undercut:'trending_down', workflow_failure:'error' };
      const SCREEN = { lead_unassigned:'leads', sla_breach:'leads', inventory_aging:'inventory',
                       undercut:'competitors', workflow_failure:'automation' };
      return `<div>${items.map(it => `
        <div class="list-item" role="button" tabindex="0" data-goto="${esc(SCREEN[it.kind] || 'overview')}">
          <span class="material-symbols-outlined t-${tone(it.severity)}" style="font-size:20px">${KIND[it.kind] || 'warning'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${esc(it.title)}</div>
            <div class="cell-sub">${esc(it.detail)}</div>
          </div>
          <span class="material-symbols-outlined t-muted" style="font-size:18px">chevron_right</span>
        </div>`).join('')}</div>`;
    },
  }).then(card => {
    /* These rows are keyboard-operable: the row is the only way into the screen
       that can act on the item, so a mouse-only affordance would strand anyone
       navigating by keyboard. */
    card.querySelectorAll('[data-goto]').forEach(n => {
      const jump = () => go(n.dataset.goto);
      n.addEventListener('click', jump);
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
      });
    });
    need.attention = card.querySelectorAll('[data-goto]').length;
    setBadge();
  }));

  panels.push(panel(feedHost, {
    title: 'Live lead feed',
    sub: 'Newest first',
    actions: `<button class="btn sm" data-act="leads">View all</button>`,
    load: () => db('leads?select=id,name,status,ai_score,vehicle_interest,source,created_at&order=created_at.desc&limit=8'),
    render: rows => rows.length ? table([
      { label:'When', render: r => `<div class="t-muted">${ago(r.created_at)}</div><div class="cell-sub mono">${clock(r.created_at)}</div>` },
      { label:'Status',  render: r => pill(r.status || 'NEW') },
      { label:'Name',    strong: true, render: r => esc(r.name) },
      { label:'Interest',render: r => `<span class="t-2">${esc(r.vehicle_interest || '—')}</span>` },
      { label:'Score', align:'r', render: r => num(r.ai_score) },
    ], rows) : stateEmpty('No leads yet', 'They appear here the moment the router webhook receives one.'),
  }).then(card => card.querySelector('[data-act]')?.addEventListener('click', () => go('leads'))));

  await Promise.all(panels);
};

/* ==========================================================================
   S2 · Leads
   ========================================================================== */
