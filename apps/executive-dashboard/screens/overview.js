/* NEXUS OS — screens/overview.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, clock, esc, mins, n0, num, pill, tone } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi, panel, table } from '../lib/ui.js';

SCREENS.overview = async host => {
  const strip = el('div', 'grid g5'); host.appendChild(strip);
  strip.innerHTML = stateLoading(2);

  const lower = el('div', 'grid g2'); lower.style.marginTop = '16px'; host.appendChild(lower);
  const feedHost = el('div'); const attnHost = el('div');
  lower.appendChild(attnHost); lower.appendChild(feedHost);

  try {
    const [leads, inv, metrics] = await Promise.all([
      db('leads?select=status,ai_score,budget_aed,response_time_minutes,created_at,assigned_to_id&limit=2000'),
      db('inventory?select=status,days_in_stock,price_aed,holding_cost_accrued,aging_alert&limit=2000'),
      db('daily_metrics?select=*&order=snapshot_date.desc&limit=2'),
    ]);

    const up = s => String(s || '').toUpperCase();
    const hot = leads.filter(l => up(l.status) === 'HOT').length;
    const warm = leads.filter(l => up(l.status) === 'WARM').length;
    const cold = leads.filter(l => up(l.status) === 'COLD').length;
    const withResp = leads.filter(l => n0(l.response_time_minutes) != null);
    const avgResp = withResp.length ? withResp.reduce((a, l) => a + Number(l.response_time_minutes), 0) / withResp.length : null;
    const withBudget = leads.filter(l => n0(l.budget_aed) != null);
    const pipeline = withBudget.reduce((a, l) => a + Number(l.budget_aed), 0);
    const risk = inv.filter(i => up(i.aging_alert) === 'CRITICAL');
    const holding = inv.reduce((a, i) => a + (n0(i.holding_cost_accrued) || 0), 0);

    /* Deltas only exist once there are two snapshots. Until then no delta line
       renders at all — the previous build showed "-18s vs last week" as a
       hardcoded string with nothing behind it. */
    const prev = metrics.length > 1 ? metrics[1] : null;
    const delta = (now, before, fmt, lowerIsBetter) => {
      if (!prev || before == null || now == null) return '';
      const d = Number(now) - Number(before);
      if (!d) return `<span class="t-muted">no change vs ${ago(prev.snapshot_date)}</span>`;
      const good = lowerIsBetter ? d < 0 : d > 0;
      return `<span class="${good ? 't-ok' : 't-hot'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span> <span class="t-muted">vs previous snapshot</span>`;
    };

    strip.innerHTML = [
      kpi('Open leads', num(leads.length),
        `${pill(`${hot} HOT`,'hot')} ${pill(`${warm} WARM`,'warm')} ${pill(`${cold} COLD`,'cold')}`),
      kpi('Avg response time', mins(avgResp),
        avgResp != null && avgResp > 5
          ? `<span class="t-hot">Breaches the 5-minute rule</span>`
          : delta(avgResp, prev?.avg_response_minutes, v => mins(v), true)),
      kpi('Pipeline value', aed(pipeline),
        withBudget.length < leads.length
          ? `<span class="t-muted">From ${withBudget.length} of ${leads.length} leads · ${leads.length - withBudget.length} ${leads.length - withBudget.length === 1 ? 'has' : 'have'} no budget recorded</span>`
          : delta(pipeline, prev?.pipeline_aed, v => aed(v))),
      kpi('Units at risk', num(risk.length),
        risk.length ? `<span class="t-hot">Oldest ${num(Math.max(...risk.map(r => n0(r.days_in_stock) || 0)))} days in stock</span>` : 'No unit past the aging threshold'),
      kpi('Holding cost accrued', aed(holding), `Across ${num(inv.length)} units`),
    ].join('');

    await panel(attnHost, {
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
          <div class="list-item" data-goto="${esc(SCREEN[it.kind] || 'overview')}">
            <span class="material-symbols-outlined t-${tone(it.severity)}" style="font-size:20px">${KIND[it.kind] || 'warning'}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:500">${esc(it.title)}</div>
              <div class="cell-sub">${esc(it.detail)}</div>
            </div>
            <span class="material-symbols-outlined t-muted" style="font-size:18px">chevron_right</span>
          </div>`).join('')}</div>`;
      },
    }).then(card => {
      card.querySelectorAll('[data-goto]').forEach(n => n.addEventListener('click', () => go(n.dataset.goto)));
      const count = card.querySelectorAll('.list-item').length;
      const badge = $('badge-overview');
      if (badge && count) { badge.textContent = String(count); badge.classList.remove('hide'); }
    });

    await panel(feedHost, {
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
    }).then(card => card.querySelector('[data-act]')?.addEventListener('click', () => go('leads')));

    const pipeCard = el('div', 'card'); pipeCard.style.marginTop = '16px'; host.appendChild(pipeCard);
    const seg = [['HOT', hot, 'var(--hot)'], ['WARM', warm, 'var(--warm)'], ['COLD', cold, 'var(--cold)']];
    const total = hot + warm + cold || 1;
    pipeCard.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Pipeline by stage</div>
      <div class="stackbar">${seg.map(([, v, c]) => `<i style="width:${(v/total*100).toFixed(1)}%;background:${c}"></i>`).join('')}</div>
      <div style="display:flex;gap:20px;margin-top:12px;flex-wrap:wrap">
        ${seg.map(([k, v, c]) => `<div style="display:flex;align-items:center;gap:8px">
          <span style="width:8px;height:8px;border-radius:50%;background:${c}"></span>
          <span style="font-weight:500">${esc(k)}</span><span class="t-muted num">${num(v)} leads</span></div>`).join('')}
      </div>`;
  } catch (e) {
    strip.innerHTML = stateError('the overview', e.message);
  }
};

/* ==========================================================================
   S2 · Leads
   ========================================================================== */
