/* NEXUS OS — screens/conversations.js
   Rebuilt on 19 Aug 2026 from the read-only message dump into an inbox.

   communication_logs is a flat message table: one row per message, keyed to a
   contact only by `lead_email`. Everything on this screen is derived from those
   rows plus the matching `leads` row — there is no thread table, no read
   receipt and no delivery state in the database, so nothing here claims one.

   Two consequences worth stating plainly, because they shape the whole screen:

     · "Reply due" is not an unread flag. Postgres cannot tell us what a human
       has looked at. It means the newest message in the thread is inbound and
       no outbound message has been logged after it — which is the thing a sales
       manager actually needs to see, and it is provable from the data.
     · Sending is impossible. n8n exposes no WAHA send webhook, and
       communication_logs is service-role only, so the browser can neither send
       a message nor record one. The composer is rendered and disabled rather
       than hidden, so the gap is visible instead of merely absent. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { ago, esc, initials, num, pill } from '../lib/format.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi } from '../lib/ui.js';

/* The newest N messages, not all of them. A dealership that has been running
   for a year has more history than an inbox needs to render, and an unbounded
   select is how a screen starts timing out in production. Where the cap is hit
   it is said out loud, because a truncated inbox that looks complete is a lie
   about how many people are waiting. */
const LIMIT = 1000;

const low = s => String(s || '').trim().toLowerCase();
const ts  = v => { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; };
const stamp = v => { const t = Date.parse(v); return Number.isNaN(t) ? 'no timestamp recorded' : new Date(t).toLocaleString('en-GB'); };

/* Why every send control on this screen is dead. Written once and attached to
   each disabled control so the reason travels with the button. */
const NO_SEND = 'Sending is not wired up. n8n exposes ask-ai, finance-calc, lead-trigger, '
  + 'deals/closed-won, audit-kyc, erp-sync and lead-escalation — none of them sends a WhatsApp '
  + 'or email message — and communication_logs is service-role only, so the browser can neither '
  + 'deliver a reply nor record one. This needs a WAHA send webhook in n8n first.';

const dayLabel = v => {
  const t = Date.parse(v);
  if (Number.isNaN(t)) return 'Undated';
  const d = new Date(t), now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= midnight) return 'Today';
  if (t >= midnight - 86400000) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

const preview = m => {
  const text = String(m.message == null ? '' : m.message).replace(/\s+/g, ' ').trim();
  if (!text) return '<span class="t-muted">No message text recorded</span>';
  return esc(text.length > 72 ? text.slice(0, 72) + '…' : text);
};

SCREENS.conversations = async host => {
  const strip = el('div', 'grid g4');
  const wrap  = el('div', 'card flush');
  wrap.style.marginTop = '16px';
  host.appendChild(strip);
  host.appendChild(wrap);

  await boot();

  async function boot() {
    strip.innerHTML = stateLoading(2);
    wrap.style.display = 'block';
    wrap.style.minHeight = '';
    wrap.innerHTML = stateLoading(8);

    /* ── Read ────────────────────────────────────────────────────────────
       The messages are the screen; if they fail, the screen fails and says
       so with a Retry. The leads table is enrichment — a name, a status, a
       vehicle — so its failure degrades the labels to raw email addresses
       and is reported, never silently swallowed and never filled in. */
    let logs;
    try {
      logs = await db(`communication_logs?select=id,lead_email,direction,message,channel,created_at&order=created_at.desc&limit=${LIMIT}`);
    } catch (e) {
      strip.innerHTML = stateError('the inbox summary', e.message);
      wrap.innerHTML = stateError('conversations', e.message, 'reload');
      wrap.querySelector('[data-retry]')?.addEventListener('click', boot);
      return;
    }

    let leadNote = '';
    let leads = [];
    try {
      leads = await db('leads?select=*,users(id,name)&order=created_at.desc&limit=1000');
    } catch (e) {
      leadNote = `The leads table could not be read (${e.message}), so threads are labelled by email address and no lead status is shown.`;
    }
    const leadByEmail = new Map();
    leads.forEach(l => { const k = low(l.email); if (k && !leadByEmail.has(k)) leadByEmail.set(k, l); });

    /* ── Group into threads ──────────────────────────────────────────────
       lead_email is the only key that links two messages to one person.
       Rows without it are NOT swept into a shared "unknown" thread: that
       would stitch strangers into one conversation and put words in a
       customer's mouth. They are counted and reported instead. */
    const byKey = new Map();
    const threads = [];
    const channels = new Map();
    let orphans = 0;

    for (const m of logs) {
      const ch = String(m.channel || '').trim() || 'unrecorded channel';
      channels.set(ch, (channels.get(ch) || 0) + 1);
      const k = low(m.lead_email);
      if (!k) { orphans++; continue; }
      let t = byKey.get(k);
      if (!t) {
        t = { key: k, email: m.lead_email, msgs: [], inbound: 0, outbound: 0, channels: new Map() };
        byKey.set(k, t);
        threads.push(t);
      }
      t.msgs.push(m);
      const dir = low(m.direction);
      if (dir === 'inbound') t.inbound++;
      else if (dir === 'outbound') t.outbound++;
      t.channels.set(ch, (t.channels.get(ch) || 0) + 1);
    }

    threads.forEach(t => {
      t.msgs.sort((a, b) => ts(a.created_at) - ts(b.created_at));   // newest last, as a thread reads
      t.last  = t.msgs[t.msgs.length - 1];
      t.first = t.msgs[0];
      t.lead  = leadByEmail.get(t.key) || null;
      t.name  = t.lead?.name || t.email;
      t.awaiting = low(t.last.direction) === 'inbound';
      t.oneSided = t.inbound === 0 || t.outbound === 0;
      t.haystack = `${t.name} ${t.email} ${t.msgs.map(m => m.message == null ? '' : m.message).join(' ')}`.toLowerCase();
    });
    threads.sort((a, b) => ts(b.last.created_at) - ts(a.last.created_at));

    const awaiting  = threads.filter(t => t.awaiting);
    const unanswered = threads.filter(t => t.outbound === 0);
    const oldestWait = awaiting.length
      ? awaiting.reduce((a, t) => (ts(t.last.created_at) < ts(a.last.created_at) ? t : a))
      : null;
    const capped = logs.length >= LIMIT;

    const capNote = capped
      ? `Only the newest ${num(LIMIT)} messages were read, so older threads are missing from this list.`
      : '';
    const orphanNote = orphans
      ? `${num(orphans)} ${orphans === 1 ? 'message has' : 'messages have'} no lead_email and cannot be attached to a thread.`
      : '';

    /* ── Summary strip ───────────────────────────────────────────────────
       Four counts, each a count of rows that exist. No rates, no targets. */
    const chanChips = [...channels.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `<span class="chip">${esc(c)} · ${num(n)}</span>`)
      .join(' ');

    strip.innerHTML = [
      kpi('Conversations', num(threads.length),
        `${num(logs.length)} ${logs.length === 1 ? 'message' : 'messages'} in history${capped ? ' <span class="t-warm">(capped)</span>' : ''}`),
      kpi('Reply due', num(awaiting.length),
        awaiting.length
          ? `<span class="t-hot">Oldest waiting since ${ago(oldestWait.last.created_at)}</span>`
          : threads.length
            ? '<span class="t-ok">Every thread ends with a message we sent</span>'
            : '<span class="t-muted">No threads yet</span>',
        awaiting.length ? 't-hot' : ''),
      kpi('Never answered', num(unanswered.length),
        unanswered.length
          ? '<span class="t-warm">No outbound message exists in this history</span>'
          : '<span class="t-muted">Every thread has at least one outbound message</span>'),
      kpi('Last message', threads.length ? ago(threads[0].last.created_at) : '—',
        chanChips || '<span class="t-muted">No channel recorded on any message</span>'),
    ].join('');

    if (!threads.length) {
      wrap.innerHTML = stateEmpty(
        logs.length ? 'No message can be grouped into a thread' : 'No messages yet',
        logs.length
          ? `All ${num(logs.length)} logged messages are missing lead_email, which is the only field that links a message to a contact.`
          : 'Conversations appear here once the WhatsApp BDC agent writes its first row to communication_logs.',
        'forum');
      return;
    }

    /* ── Shell ───────────────────────────────────────────────────────────── */
    wrap.style.display = 'grid';
    wrap.style.gridTemplateColumns = '340px minmax(0,1fr)';
    wrap.style.minHeight = '640px';
    wrap.innerHTML = `
      <div style="border-right:1px solid var(--border);display:flex;flex-direction:column;min-width:0">
        <div class="toolbar" style="border-bottom:1px solid var(--border-subtle)">
          <div class="grow">
            <label class="sr-only" for="cvQ">Search conversations</label>
            <input type="search" id="cvQ" placeholder="Search names, emails, message text" />
          </div>
        </div>
        <div class="toolbar" style="padding-top:0;border-bottom:1px solid var(--border-subtle)">
          <div class="seg" role="group" aria-label="Filter conversations">
            <button type="button" data-f="all" class="on" aria-pressed="true">All ${num(threads.length)}</button>
            <button type="button" data-f="await" aria-pressed="false"
              title="Threads whose newest message is inbound and has no outbound message after it. communication_logs has no read state, so this is derived from direction, not from what anyone has opened.">Reply due ${num(awaiting.length)}</button>
            <button type="button" data-f="one" aria-pressed="false"
              title="Threads with messages in one direction only — either we have never replied, or nothing inbound was ever captured.">One-sided ${num(threads.filter(t => t.oneSided).length)}</button>
          </div>
        </div>
        <div id="cvList" style="overflow-y:auto;flex:1"></div>
      </div>
      <div style="display:flex;flex-direction:column;min-width:0" id="cvPane"></div>`;

    let q = '', filter = 'all', selected = null;

    const visible = () => threads.filter(t => {
      if (filter === 'await' && !t.awaiting) return false;
      if (filter === 'one' && !t.oneSided) return false;
      return !q || t.haystack.includes(q);
    });

    function drawList() {
      const rows = visible();
      const foot = [leadNote, capNote, orphanNote].filter(Boolean);
      const footHtml = foot.length
        ? `<div class="list-item" style="cursor:default;align-items:flex-start">
             <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
             <div class="cell-sub" style="white-space:normal">${foot.map(esc).join('<br>')}</div>
           </div>`
        : '';

      $('cvList').innerHTML = (rows.length
        ? rows.map(t => `
          <div class="list-item${t.key === selected ? ' on' : ''}" role="button" tabindex="0"
               data-k="${esc(t.key)}" aria-current="${t.key === selected ? 'true' : 'false'}">
            <div class="avatar">${esc(initials(t.name))}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.name)}</div>
              <div class="cell-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px"
                      aria-hidden="true">${low(t.last.direction) === 'inbound' ? 'south_west' : 'north_east'}</span>
                ${preview(t.last)}
              </div>
            </div>
            <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              <span class="cell-sub" title="${esc(stamp(t.last.created_at))}">${ago(t.last.created_at)}</span>
              ${t.awaiting ? pill('Reply due', 'hot') : `<span class="cell-sub">${num(t.msgs.length)} msg</span>`}
            </div>
          </div>`).join('')
        : stateEmpty('No conversation matches',
            filter === 'all' ? 'Try a different search term.' : 'Try a different search term or filter.',
            'search_off')) + footHtml;

      $('cvList').querySelectorAll('[data-k]').forEach(node => {
        node.addEventListener('click', () => openThread(node.dataset.k));
        /* The row is the only route into a thread, so it has to work from the
           keyboard as well as the mouse. Arrow keys walk the list the way an
           inbox is expected to behave. */
        node.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openThread(node.dataset.k); return; }
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          const all = [...$('cvList').querySelectorAll('[data-k]')];
          const next = all[all.indexOf(node) + (e.key === 'ArrowDown' ? 1 : -1)];
          if (next) { next.focus(); openThread(next.dataset.k); }
        });
      });
    }

    function openThread(key) {
      const t = threads.find(x => x.key === key);
      if (!t) return;
      selected = key;
      $('cvList').querySelectorAll('[data-k]').forEach(n => {
        const on = n.dataset.k === key;
        n.classList.toggle('on', on);
        n.setAttribute('aria-current', on ? 'true' : 'false');
      });

      const lead = t.lead;
      const chips = [...t.channels.entries()].map(([c, n]) => `<span class="chip">${esc(c)} · ${num(n)}</span>`).join(' ');

      /* Banners describe the shape of the record, not the state of the
         customer. "Only outbound messages exist" is a statement about
         communication_logs; it does not mean the customer never replied. */
      const banners = [];
      if (t.awaiting) {
        banners.push(`<div class="banner warm">
          <span class="material-symbols-outlined" style="font-size:20px">schedule</span>
          <div>The newest message is inbound, logged ${esc(ago(t.last.created_at))}, and no outbound message has been recorded after it.</div>
        </div>`);
      }
      if (t.inbound === 0) {
        banners.push(`<div class="banner info">
          <span class="material-symbols-outlined" style="font-size:20px">info</span>
          <div>Only outbound messages exist for this contact. Inbound capture is not writing to <span class="mono">communication_logs</span>, so this thread shows one side of the conversation.</div>
        </div>`);
      } else if (t.outbound === 0) {
        banners.push(`<div class="banner hot">
          <span class="material-symbols-outlined" style="font-size:20px">mark_email_unread</span>
          <div>No outbound message has ever been logged for this contact — every message in this thread came from them.</div>
        </div>`);
      }

      $('cvPane').innerHTML = `
        <div class="card-head">
          <div class="avatar">${esc(initials(t.name))}</div>
          <div style="min-width:0">
            <div class="card-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.name)}</div>
            <div class="card-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.email)}${lead?.vehicle_interest ? ' · ' + esc(lead.vehicle_interest) : ''}</div>
          </div>
          <div style="flex:1"></div>
          ${lead ? pill(lead.status || 'NEW') : `<span class="chip" title="No row in the leads table has this email address.">No lead record</span>`}
          ${lead
            ? `<button class="btn sm" id="cvLead">Open lead</button>`
            : `<button class="btn sm" disabled title="No row in the leads table matches ${esc(t.email)}, so there is no lead record to open.">Open lead</button>`}
        </div>
        <div style="flex:1;overflow-y:auto" id="cvScroll">
          ${banners.length ? `<div style="padding:16px 20px 0">${banners.join('')}</div>` : ''}
          <div class="thread">
            ${t.msgs.map((m, i) => {
              const inbound = low(m.direction) === 'inbound';
              const day = dayLabel(m.created_at);
              const sep = (i === 0 || day !== dayLabel(t.msgs[i - 1].created_at))
                ? `<div class="label-caps" style="text-align:center;margin-top:6px">${esc(day)}</div>` : '';
              const text = String(m.message == null ? '' : m.message).trim();
              return `${sep}<div class="bubble ${inbound ? 'in' : 'out'}">${text ? esc(text) : '<span class="t-muted">No message text recorded</span>'}
                <div class="bubble-meta">
                  <span class="chip">${esc(String(m.channel || '').trim() || 'unrecorded channel')}</span>
                  <span>${esc(low(m.direction) || 'direction not recorded')}</span>
                  <span title="${esc(stamp(m.created_at))}">${ago(m.created_at)}</span>
                </div>
              </div>`;
            }).join('')}
          </div>
          <div class="cell-sub" style="padding:0 20px 16px;text-align:center">
            ${num(t.msgs.length)} ${t.msgs.length === 1 ? 'message' : 'messages'} · ${num(t.inbound)} inbound · ${num(t.outbound)} outbound · first logged ${esc(ago(t.first.created_at))}
            ${chips ? '<div style="margin-top:8px">' + chips + '</div>' : ''}
          </div>
        </div>
        <div style="padding:16px 20px;border-top:1px solid var(--border-subtle)">
          <div style="display:flex;gap:10px;align-items:flex-start">
            <label class="sr-only" for="cvMsg">Reply to ${esc(t.name)}</label>
            <textarea id="cvMsg" rows="2" disabled title="${esc(NO_SEND)}"
              placeholder="Replying from the dashboard is not available yet"></textarea>
            <button class="btn primary" disabled title="${esc(NO_SEND)}" style="flex-shrink:0">
              <span class="material-symbols-outlined">send</span>Send</button>
          </div>
          <div class="cell-sub" style="margin-top:8px">
            Replies still go out from WhatsApp itself. This composer stays disabled until an n8n send webhook exists — until then the dashboard cannot deliver a message or write it to <span class="mono">communication_logs</span>.
          </div>
        </div>`;

      $('cvLead')?.addEventListener('click', () => leadDrawer(lead));
      /* A thread reads newest-last, so it opens where the conversation
         currently is rather than at a message from three weeks ago. */
      const scroller = $('cvScroll');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    }

    $('cvQ').addEventListener('input', e => { q = low(e.target.value); drawList(); });
    wrap.querySelectorAll('.seg button').forEach(b => {
      b.addEventListener('click', () => {
        filter = b.dataset.f;
        wrap.querySelectorAll('.seg button').forEach(x => {
          const on = x === b;
          x.classList.toggle('on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        drawList();
      });
    });

    drawList();
    /* Open the thread that is waiting longest if anything is waiting, else the
       most recent one. Landing on an empty pane wastes the first click. */
    openThread((oldestWait || threads[0]).key);
  }
};

/* ── Modal ───────────────────────────────────────────────────────────────────
   The drawer is the read view; a modal is the write view. Keeping them separate
   means a form can never be half-covered by a detail panel. */
