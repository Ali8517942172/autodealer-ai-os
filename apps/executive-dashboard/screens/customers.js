/* NEXUS OS — screens/customers.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, esc, initials, num, pill, tone } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { noSource, stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi } from '../lib/ui.js';

SCREENS.customers = async host => {
  const grid = el('div', 'card flush');
  grid.style.display = 'grid'; grid.style.gridTemplateColumns = '340px minmax(0,1fr)'; grid.style.minHeight = '620px';
  grid.innerHTML = stateLoading(6); host.appendChild(grid);

  let people = [];
  try { people = await db('v_customer_360?select=*&order=lifetime_value_aed.desc,lead_count.desc&limit=500'); }
  catch (e) { grid.innerHTML = stateError('customers', e.message); return; }

  if (!people.length) { grid.style.display = 'block'; grid.innerHTML = stateEmpty('No customers yet', 'Customers appear once a lead or a purchase is recorded.', 'contacts'); return; }

  grid.innerHTML = `
    <div style="border-right:1px solid var(--border);display:flex;flex-direction:column">
      <div class="toolbar"><div class="grow"><input type="search" id="cq" placeholder="Search customers" /></div></div>
      <div id="custList" style="overflow-y:auto;flex:1"></div>
    </div>
    <div id="custPane" style="overflow-y:auto"></div>`;

  function list(q = '') {
    const f = people.filter(p => !q || `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase()));
    $('custList').innerHTML = f.length ? f.map(p => `
      <div class="list-item" data-e="${esc(p.email)}">
        <div class="avatar">${esc(initials(p.name))}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name || p.email)}
            ${p.is_vip ? '<span class="pill vip"><span class="dot"></span>VIP</span>' : ''}</div>
          <div class="cell-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.email)}</div>
        </div>
        <div class="cell-sub num">${p.lifetime_value_aed ? aed(p.lifetime_value_aed) : ''}</div>
      </div>`).join('') : stateEmpty('No match', 'Try a different search.', 'search_off');
    $('custList').querySelectorAll('.list-item').forEach(n => n.addEventListener('click', () => open(n.dataset.e)));
  }

  async function open(email) {
    $('custList').querySelectorAll('.list-item').forEach(n => n.classList.toggle('on', n.dataset.e === email));
    const p = people.find(x => x.email === email);
    const pane = $('custPane');
    pane.innerHTML = stateLoading(5);
    const [leads, purch, comms] = await Promise.all([
      db(`leads?select=*&email=ilike.${encodeURIComponent(email)}&order=created_at.desc`).catch(() => []),
      db(`purchase_history?select=*&email=ilike.${encodeURIComponent(email)}&order=purchase_date.desc`).catch(() => []),
      db(`communication_logs?select=*&lead_email=ilike.${encodeURIComponent(email)}&order=created_at.desc&limit=50`).catch(() => []),
    ]);

    pane.innerHTML = `
      <div class="card-head">
        <div class="avatar" style="width:40px;height:40px;font-size:14px">${esc(initials(p.name))}</div>
        <div style="flex:1"><div class="card-title">${esc(p.name || email)}
          ${p.is_vip ? '<span class="pill vip"><span class="dot"></span>Returning customer</span>' : ''}</div>
          <div class="card-sub">${esc(email)}${p.phone ? ' · ' + esc(p.phone) : ''}</div></div>
      </div>
      <div style="padding:20px">
        <div class="grid g4">
          ${kpi('Lifetime value', aed(p.lifetime_value_aed), `${num(p.purchase_count)} purchase${p.purchase_count === 1 ? '' : 's'}`)}
          ${kpi('Leads', num(p.lead_count), p.latest_status ? pill(p.latest_status) : '')}
          ${kpi('Best AI score', num(p.best_ai_score), '')}
          ${kpi('Messages', num(p.message_count), p.last_contact_at ? 'Last ' + ago(p.last_contact_at) : 'Never contacted')}
        </div>

        <div class="section" style="margin-top:24px">
          <div class="label-caps">Purchase history</div>
          ${purch.length ? purch.map(x => `<div class="quote" style="margin-top:8px">
            <strong>${esc(x.vehicle)}</strong> · ${aed(x.amount_aed)}
            <div class="cell-sub">${esc(x.purchase_date || '')}</div></div>`).join('')
            : `<div class="cell-sub" style="margin-top:8px">No purchases recorded.</div>`}
        </div>

        <div class="section">
          <div class="label-caps">Leads</div>
          ${leads.length ? `<div class="timeline" style="margin-top:8px">${leads.map(l => `
            <div class="tl-item"><span class="tl-dot" style="background:var(--${tone(l.status) || 'neutral'})"></span>
            <div class="tl-body"><div class="tl-meta">${ago(l.created_at)} · ${esc(l.source || '')}</div>
            <div>${esc(l.vehicle_interest || '—')} ${pill(l.status || 'NEW')}</div></div></div>`).join('')}</div>`
            : `<div class="cell-sub" style="margin-top:8px">No leads recorded.</div>`}
        </div>

        <div class="section">
          <div class="label-caps">Engagement</div>
          ${(p.total_emails != null || p.total_slack_messages != null)
            ? `<dl class="kv" style="margin-top:8px"><dt>Emails</dt><dd class="num">${num(p.total_emails)}</dd>
               <dt>Slack messages</dt><dd class="num">${num(p.total_slack_messages)}</dd></dl>`
            : noSource('The Customer 360 aggregation workflow runs nightly at 02:00 but has produced 0 rows. Email and Slack counts stay empty until it is fixed — the rest of this profile is live.')}
        </div>

        <div class="section">
          <div class="label-caps">Recent messages</div>
          ${comms.length ? `<div class="timeline" style="margin-top:8px">${comms.slice(0, 10).map(c => `
            <div class="tl-item"><span class="tl-dot"></span><div class="tl-body">
            <div class="tl-meta"><span class="chip">${esc(c.channel)}</span> ${esc(c.direction)} · ${ago(c.created_at)}</div>
            <div style="white-space:pre-wrap">${esc(String(c.message || '').slice(0, 240))}</div></div></div>`).join('')}</div>`
            : `<div class="cell-sub" style="margin-top:8px">No messages recorded.</div>`}
        </div>
      </div>`;
  }

  $('cq').addEventListener('input', e => list(e.target.value));
  list();
  open(people[0].email);
};

/* ==========================================================================
   S11 · Team
   ========================================================================== */
