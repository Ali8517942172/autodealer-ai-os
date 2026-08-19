/* NEXUS OS — screens/conversations.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { ago, esc, initials, pill } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';

SCREENS.conversations = async host => {
  const wrap = el('div', 'card flush');
  wrap.style.display = 'grid';
  wrap.style.gridTemplateColumns = '320px minmax(0,1fr)';
  wrap.style.minHeight = '640px';
  wrap.innerHTML = stateLoading(6);
  host.appendChild(wrap);

  let logs = [];
  try { logs = await db('communication_logs?select=*&order=created_at.desc&limit=500'); }
  catch (e) { wrap.innerHTML = stateError('conversations', e.message); return; }

  if (!logs.length) {
    wrap.style.display = 'block';
    wrap.innerHTML = stateEmpty('No messages yet', 'Conversations appear once the WhatsApp BDC agent sends or receives its first message.', 'forum');
    return;
  }

  const byEmail = new Map();
  logs.forEach(l => {
    const k = l.lead_email || 'unknown';
    if (!byEmail.has(k)) byEmail.set(k, []);
    byEmail.get(k).push(l);
  });
  const threads = [...byEmail.entries()].map(([email, msgs]) => ({
    email, msgs: msgs.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    last: msgs[0],
    inbound: msgs.filter(m => m.direction === 'inbound').length,
  })).sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));

  const leads = await db('leads?select=id,name,email,phone,status,ai_score,vehicle_interest,budget_aed').catch(() => []);
  const leadByEmail = new Map(leads.map(l => [String(l.email || '').toLowerCase(), l]));

  wrap.innerHTML = `
    <div style="border-right:1px solid var(--border);display:flex;flex-direction:column">
      <div class="toolbar" style="border-bottom:1px solid var(--border-subtle)">
        <div class="grow"><input type="search" id="tq" placeholder="Search conversations" /></div>
      </div>
      <div id="threadList" style="overflow-y:auto;flex:1"></div>
    </div>
    <div style="display:flex;flex-direction:column;min-width:0" id="threadPane"></div>`;

  function drawList(q = '') {
    const list = threads.filter(t => !q || (t.email + ' ' + (leadByEmail.get(t.email.toLowerCase())?.name || '')).toLowerCase().includes(q.toLowerCase()));
    $('threadList').innerHTML = list.length ? list.map((t, i) => {
      const lead = leadByEmail.get(t.email.toLowerCase());
      return `<div class="list-item" data-i="${threads.indexOf(t)}">
        <div class="avatar">${esc(initials(lead?.name || t.email))}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(lead?.name || t.email)}</div>
          <div class="cell-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(String(t.last.message || '').replace(/\s+/g, ' ').slice(0, 60))}</div>
        </div>
        <div class="cell-sub">${ago(t.last.created_at)}</div>
      </div>`;
    }).join('') : stateEmpty('No conversations match', 'Try a different search.', 'search_off');
    $('threadList').querySelectorAll('.list-item').forEach(n =>
      n.addEventListener('click', () => openThread(Number(n.dataset.i))));
  }

  function openThread(i) {
    const t = threads[i];
    $('threadList').querySelectorAll('.list-item').forEach(n => n.classList.toggle('on', Number(n.dataset.i) === i));
    const lead = leadByEmail.get(t.email.toLowerCase());
    const onlyOutbound = t.inbound === 0;
    $('threadPane').innerHTML = `
      <div class="card-head">
        <div><div class="card-title">${esc(lead?.name || t.email)}</div>
        <div class="card-sub">${esc(t.email)}${lead ? ' · ' + esc(lead.vehicle_interest || '') : ''}</div></div>
        <div style="flex:1"></div>
        ${lead ? pill(lead.status || 'NEW') : ''}
      </div>
      <div style="flex:1;overflow-y:auto">
        ${onlyOutbound ? `<div class="banner info" style="margin:16px 20px 0">
          <span class="material-symbols-outlined" style="font-size:20px">info</span>
          <div>Only outbound messages are recorded for this contact. Inbound capture is not yet writing to <span class="mono">communication_logs</span>, so this thread shows one side of the conversation.</div>
        </div>` : ''}
        <div class="thread">${t.msgs.map(m => `
          <div class="bubble ${m.direction === 'inbound' ? 'in' : 'out'}">${esc(m.message)}
            <div class="bubble-meta"><span class="chip">${esc(m.channel || 'unknown')}</span>
              <span>${esc(m.direction)}</span><span>${ago(m.created_at)}</span></div>
          </div>`).join('')}</div>
      </div>
      <div style="padding:16px 20px;border-top:1px solid var(--border-subtle);display:flex;gap:10px">
        <input type="text" placeholder="Sending from the dashboard is not wired to WAHA yet" disabled />
        <button class="btn" disabled>Send</button>
      </div>`;
  }

  $('tq').addEventListener('input', e => drawList(e.target.value));
  drawList();
  openThread(0);
};

/* ── Modal ───────────────────────────────────────────────────────────────────
   The drawer is the read view; a modal is the write view. Keeping them separate
   means a form can never be half-covered by a detail panel. */
