/* NEXUS OS — screens/automation.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { ago, clock, esc, num, pct, pill } from '../lib/format.js';
import { renderIntegrations } from '../lib/integrations.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi } from '../lib/ui.js';

SCREENS.automation = async host => {
  const strip = el('div', 'grid g4'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const grid = el('div', 'grid g2 top'); grid.style.marginTop = '16px'; host.appendChild(grid);

  let health = [], log = [];
  try {
    [health, log] = await Promise.all([
      db('v_workflow_health?select=*&order=runs.desc,name.asc'),
      db('audit_log?select=*&order=logged_at.desc&limit=100'),
    ]);
  } catch (e) { strip.innerHTML = stateError('automation health', e.message); return; }

  const runs = health.reduce((a, w) => a + (w.runs || 0), 0);
  const fails = health.reduce((a, w) => a + (w.failures || 0), 0);
  const instrumented = health.filter(w => w.writes_audit_log).length;

  strip.innerHTML = [
    kpi('Workflows', num(health.length), `${health.filter(w => w.is_active).length} active`),
    kpi('Logged runs', num(runs), `Only ${instrumented} of ${health.length} workflows write to the audit log`),
    kpi('Failures', num(fails), fails ? '<span class="t-hot">Needs investigation</span>' : '<span class="t-ok">All clean</span>'),
    kpi('Success rate', runs ? pct((runs - fails) / runs * 100) : '—', 'Across logged runs only'),
  ].join('');

  const wCard = el('div', 'card flush'); grid.appendChild(wCard);
  const HEALTH = {
    HEALTHY:          ['ok',   'Healthy'],
    DEGRADED:         ['hot',  'Failing'],
    NEVER_RAN:        ['',     'No runs logged yet'],
    /* "0 runs" is ambiguous — a workflow can fire perfectly and simply have no
       Audit Log node. Only 4 of 13 write to audit_log. Saying "never ran" for
       the other 9 would be wrong. */
    NOT_INSTRUMENTED: ['',     'Not logged'],
  };
  const maxRuns = Math.max(1, ...health.map(w => w.runs || 0));
  wCard.innerHTML = `<div class="card-head"><div><div class="card-title">All workflows</div>
    <div class="card-sub">Audit logging was added to all 13 today — counts build up from the next run of each</div></div></div>
    <div>${health.map(w => {
      const [t, lbl] = HEALTH[w.health] || ['', w.health];
      return `<div class="list-item" style="cursor:default;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-weight:500">${esc(w.name)}</span>${pill(lbl, t)}
            <span class="chip">${esc(w.category)}</span>
            <span class="chip">${esc(w.trigger_type)}${w.trigger_detail ? ' · ' + esc(w.trigger_detail) : ''}</span>
          </div>
          <div class="cell-sub" style="margin-top:4px;white-space:normal">${esc(w.description || '')}</div>
          ${w.runs ? `<div class="bar" style="margin-top:8px;max-width:220px">
            <i style="width:${(w.runs / maxRuns * 100).toFixed(1)}%;background:var(--${w.failures ? 'hot' : 'primary'})"></i></div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div class="num" style="font-weight:500">${num(w.runs)}</div>
          <div class="cell-sub">${w.failures ? `<span class="t-hot">${w.failures} failed</span>` : 'runs'}</div>
          <div class="cell-sub">${w.last_run ? ago(w.last_run) : ''}</div>
        </div>
      </div>`;
    }).join('')}</div>`;

  const lCard = el('div', 'card flush'); grid.appendChild(lCard);
  lCard.innerHTML = `<div class="card-head"><div class="card-title">Activity log</div>
    <div class="card-sub">Newest first · ${log.length} entries</div></div>
    <div style="max-height:70vh;overflow-y:auto">${log.length ? log.map(a => `
      <div class="list-item" style="cursor:default">
        <span class="mono t-muted">${clock(a.logged_at)}</span>
        ${pill(a.status)}
        <div style="flex:1;min-width:0">
          <div style="font-weight:500">${esc(a.workflow)}</div>
          <div class="cell-sub">${esc(String(a.summary || '').slice(0, 160))}${a.lead_name ? ' · ' + esc(a.lead_name) : ''}</div>
        </div>
      </div>`).join('') : stateEmpty('No runs logged', 'Workflows with an Audit Log node write here.', 'receipt_long')}</div>`;

  const intg = el('div', 'card'); intg.style.marginTop = '16px'; host.appendChild(intg);
  intg.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Integration status</div><div id="intgRow">${stateLoading(1)}</div>`;
  renderIntegrations($('intgRow'));
};

/* Real probes only. A hardcoded green dot next to a dead WhatsApp session is
   the one component on this screen that can cause a worse outcome than having
   no screen at all. Anything we cannot probe says so. */
