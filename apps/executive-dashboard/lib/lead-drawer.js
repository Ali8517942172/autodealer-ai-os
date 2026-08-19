/* NEXUS OS — lib/lead-drawer.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db, dbWrite } from './data.js';
import { $, el } from './dom.js';
import { aed, ago, esc, initials, mins, n0, pill, tone } from './format.js';
import { go } from './nav.js';
import { stateEmpty, stateLoading } from './states.js';
import { closeDrawer, openDrawer } from './ui.js';

async function leadDrawer(lead) {
  const email = String(lead.email || '').toLowerCase();
  openDrawer(`
    <div class="drawer-head">
      <div class="avatar">${esc(initials(lead.name))}</div>
      <div style="flex:1;min-width:0">
        <h2 style="font-size:18px">${esc(lead.name)}</h2>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${pill(lead.status || 'NEW')}
          ${n0(lead.ai_score) != null ? `<span class="chip">AI score ${lead.ai_score}</span>` : ''}</div>
      </div>
      <button class="btn ghost sm" id="dClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
    </div>
    <div class="drawer-body">
      <div class="section">
        <div class="label-caps">Contact</div>
        <dl class="kv">
          <dt>Email</dt><dd>${esc(lead.email || '—')}</dd>
          <dt>Phone</dt><dd>${esc(lead.phone || '—')}</dd>
          <dt>Source</dt><dd>${esc(lead.source || '—')}</dd>
          <dt>Vehicle</dt><dd>${esc(lead.vehicle_interest || '—')}</dd>
          <dt>Budget</dt><dd>${n0(lead.budget_aed) == null ? '<span class="t-muted">Not captured by the router</span>' : aed(lead.budget_aed)}</dd>
          <dt>Assigned to</dt><dd>${esc(lead.users?.name || 'Unassigned')}</dd>
          <dt>Response time</dt><dd>${n0(lead.response_time_minutes) == null ? '—' :
            `${mins(lead.response_time_minutes)} ${Number(lead.response_time_minutes) > 5 ? '<span class="t-hot">· breaches the 5-minute rule</span>' : '<span class="t-ok">· within SLA</span>'}`}</dd>
          <dt>Created</dt><dd>${ago(lead.created_at)}</dd>
        </dl>
      </div>
      <div class="section" id="dVip"></div>
      <div class="section">
        <div class="label-caps">Activity</div>
        <div id="dTimeline">${stateLoading(3)}</div>
      </div>
    </div>
    <div class="drawer-foot">
      <button class="btn" id="dWhats"><span class="material-symbols-outlined">chat</span>Open conversation</button>
      <button class="btn" id="dAssign">Assign to…</button>
    </div>`);

  $('dClose').addEventListener('click', closeDrawer);
  $('dWhats').addEventListener('click', () => { closeDrawer(); go('conversations'); });
  $('dAssign').addEventListener('click', () => assignDialog(lead));

  const [purch, comms, audit] = await Promise.all([
    db(`purchase_history?select=*&email=eq.${encodeURIComponent(lead.email || '')}`).catch(() => []),
    db(`communication_logs?select=*&lead_email=eq.${encodeURIComponent(lead.email || '')}&order=created_at.desc&limit=30`).catch(() => []),
    db(`audit_log?select=*&lead_email=eq.${encodeURIComponent(lead.email || '')}&order=logged_at.desc&limit=30`).catch(() => []),
  ]);

  const vipBox = $('dVip');
  if (vipBox) {
    vipBox.innerHTML = purch.length
      ? `<div class="label-caps">Purchase history · returning customer</div>
         ${purch.map(p => `<div class="quote" style="margin-top:8px">
            <strong>${esc(p.vehicle)}</strong> · ${aed(p.amount_aed)}
            <div class="cell-sub">${esc(p.purchase_date || '')}</div></div>`).join('')}`
      : '';
  }

  const events = [
    ...comms.map(c => ({ at: c.created_at, kind: c.channel, dir: c.direction, text: c.message })),
    ...audit.map(a => ({ at: a.logged_at, kind: a.workflow, dir: a.status, text: a.summary })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  $('dTimeline').innerHTML = events.length ? `<div class="timeline">${events.map(e => `
    <div class="tl-item">
      <span class="tl-dot" style="background:var(--${tone(e.dir) ? tone(e.dir).replace('ok','ok') : 'neutral'})"></span>
      <div class="tl-body">
        <div class="tl-meta"><span class="chip">${esc(e.kind)}</span> ${ago(e.at)}</div>
        <div style="margin-top:4px;white-space:pre-wrap">${esc(String(e.text || '').slice(0, 400))}</div>
      </div>
    </div>`).join('')}</div>`
    : stateEmpty('No activity recorded', 'Nothing has been logged against this email address yet.', 'history');
}

async function assignDialog(lead) {
  const users = await db('users?select=id,name,status&order=name').catch(() => []);
  const body = $('drawer').querySelector('.drawer-body');
  if (!body) return;
  body.scrollTop = 0;
  const box = el('div', 'card');
  box.style.marginBottom = '16px';
  box.innerHTML = `<div class="label-caps" style="margin-bottom:10px">Assign this lead</div>
    <select id="assignSel">${users.map(u => `<option value="${esc(u.id)}" ${u.id === lead.assigned_to_id ? 'selected' : ''}>${esc(u.name)}${u.status === 'pending_invite' ? ' (pending invite)' : ''}</option>`).join('')}</select>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn primary" id="assignGo">Save</button>
    <button class="btn" id="assignCancel">Cancel</button></div>
    <div class="cell-sub" id="assignMsg" style="margin-top:8px"></div>`;
  body.prepend(box);
  box.querySelector('#assignCancel').addEventListener('click', () => box.remove());
  box.querySelector('#assignGo').addEventListener('click', async () => {
    const id = box.querySelector('#assignSel').value;
    const name = users.find(u => u.id === id)?.name || null;
    try {
      await dbWrite('PATCH', `leads?id=eq.${lead.id}`, { assigned_to_id: id, assigned_to: name });
      box.querySelector('#assignMsg').innerHTML = '<span class="t-ok">Saved. Reopen the screen to see it in the table.</span>';
    } catch (e) {
      box.querySelector('#assignMsg').innerHTML = `<span class="t-hot">${esc(e.message)}</span>`;
    }
  });
}

/* ==========================================================================
   S3 · Conversations
   ========================================================================== */

export { leadDrawer, assignDialog };
