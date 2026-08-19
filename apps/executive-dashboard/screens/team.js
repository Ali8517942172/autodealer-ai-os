/* NEXUS OS — screens/team.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db } from '../lib/data.js';
import { el } from '../lib/dom.js';
import { aed, esc, initials, mins, n0, num, pct, pill } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { stateError } from '../lib/states.js';
import { kpi, table } from '../lib/ui.js';

SCREENS.team = async host => {
  let team = [], leads = [];
  try {
    [team, leads] = await Promise.all([
      db('v_team_performance?select=*&order=leads_assigned.desc'),
      db('leads?select=id,response_time_minutes,assigned_to_id'),
    ]);
  } catch (e) { host.innerHTML = stateError('team performance', e.message); return; }

  const pending = team.filter(t => t.status === 'pending_invite');
  if (pending.length) {
    const b = el('div', 'banner warm');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">info</span>
      <div><strong>${pending.length} team member${pending.length > 1 ? 's have' : ' has'} no account yet.</strong>
      These names were recovered from lead assignments; their email addresses are unknown, so they are marked pending invite rather than being given invented addresses.</div>`;
    host.appendChild(b);
  }

  const unassigned = leads.filter(l => !l.assigned_to_id);
  const withResp = leads.filter(l => n0(l.response_time_minutes) != null);
  const avg = withResp.length ? withResp.reduce((a, l) => a + Number(l.response_time_minutes), 0) / withResp.length : null;
  const withinSla = withResp.filter(l => Number(l.response_time_minutes) <= 5).length;

  const strip = el('div', 'grid g4'); host.appendChild(strip);
  strip.innerHTML = [
    kpi('Team members', num(team.length), `${team.filter(t => t.status === 'online').length} with an account`),
    kpi('Avg response time', mins(avg),
      avg != null && avg > 5 ? '<span class="t-hot">The 5-minute rule is the founding promise of this product</span>' : '<span class="t-ok">Within SLA</span>'),
    kpi('Within the 5-minute rule', `${num(withinSla)} / ${num(withResp.length)}`, pct(withResp.length ? withinSla / withResp.length * 100 : 0)),
    kpi('Unassigned leads', num(unassigned.length), unassigned.length ? '<span class="t-hot">Nobody owns these</span>' : ''),
  ].join('');

  const card = el('div', 'card flush'); card.style.marginTop = '16px'; host.appendChild(card);
  card.innerHTML = `<div class="card-head"><div class="card-title">Roster &amp; performance</div></div><div id="tt"></div>`;
  card.querySelector('#tt').innerHTML = table([
    { label:'Name', strong:true, render: t => `<div style="display:flex;align-items:center;gap:10px">
        <div class="avatar">${esc(initials(t.name))}</div><div>${esc(t.name)}
        <div class="cell-sub">${esc(t.email || 'no email on file')}</div></div></div>` },
    { label:'Role', render: t => `<span class="chip">${esc(t.role || '—')}</span>` },
    { label:'Account', render: t => t.status === 'online' ? pill('Active','ok') : pill('Pending invite','warm') },
    { label:'Leads', align:'r', render: t => num(t.leads_assigned) },
    { label:'HOT', align:'r', render: t => num(t.hot_leads) },
    { label:'Avg response', align:'r', render: t => `<span class="${(n0(t.avg_response_minutes)||0) > 5 ? 't-hot' : 't-ok'}">${mins(t.avg_response_minutes)}</span>` },
    { label:'Within SLA', align:'r', render: t => `${num(t.within_sla)} / ${num((t.within_sla||0)+(t.breached_sla||0))}` },
    { label:'Pipeline', align:'r', render: t => aed(t.pipeline_aed) },
  ], team);

  const dist = el('div', 'card'); dist.style.marginTop = '16px'; host.appendChild(dist);
  const b = [[0,5,'Under 5 min','ok'],[6,15,'5–15 min','cold'],[16,60,'15–60 min','warm'],[61,99999,'Over 60 min','hot']];
  const counts = b.map(([lo,hi]) => withResp.filter(l => Number(l.response_time_minutes) >= lo && Number(l.response_time_minutes) <= hi).length);
  const tot = withResp.length || 1;
  dist.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Response-time distribution</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${b.map(([,, label, c], i) => `<div style="display:flex;align-items:center;gap:12px">
        <div style="width:110px;font-size:13px">${label}</div>
        <div class="bar" style="flex:1;height:10px"><i style="width:${(counts[i]/tot*100).toFixed(1)}%;background:var(--${c})"></i></div>
        <div class="num t-muted" style="width:40px;text-align:right">${counts[i]}</div>
      </div>`).join('')}
    </div>
    <div class="cell-sub" style="margin-top:12px">${withResp.length} of ${leads.length} leads have a recorded response time.</div>`;
};

/* ==========================================================================
   S12 · Settings
   ========================================================================== */
