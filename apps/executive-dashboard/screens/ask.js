/* NEXUS OS — screens/ask.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db, n8n } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { esc, num } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { stateError } from '../lib/states.js';

SCREENS.ask = async host => {
  const wrap = el('div');
  wrap.style.maxWidth = '820px'; wrap.style.margin = '0 auto';
  host.appendChild(wrap);

  const docs = await db('rag_documents?select=doc_title').catch(() => []);
  const titles = [...new Set(docs.map(d => d.doc_title).filter(Boolean))];

  wrap.innerHTML = `
    <div id="askThread"></div>
    <div class="card" style="margin-top:16px">
      <div style="display:flex;gap:10px">
        <input type="text" id="askQ" placeholder="Ask anything about your dealership" />
        <button class="btn primary" id="askGo"><span class="material-symbols-outlined">send</span></button>
      </div>
    </div>`;

  const thread = $('askThread');
  function landing() {
    thread.innerHTML = `<div class="card"><div class="state">
      <span class="material-symbols-outlined">auto_awesome</span>
      <h3>Ask anything about your dealership</h3>
      <p>Answers come only from your ${docs.length} indexed document sections, and always cite the source.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
        ${titles.map(t => `<button class="btn sm" data-chip="${esc(t)}">${esc(t)}</button>`).join('')}
      </div></div></div>`;
    thread.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => {
      $('askQ').value = `What does the ${b.dataset.chip} say?`; ask();
    }));
  }
  landing();

  async function ask() {
    const q = $('askQ').value.trim();
    if (!q) return;
    thread.innerHTML = `<div class="card">
      <div class="bubble out" style="max-width:100%;margin-bottom:12px">${esc(q)}</div>
      <div class="bubble in" style="max-width:100%"><span class="t-muted">Searching your documents…</span></div></div>`;
    $('askQ').value = '';
    try {
      /* Path is just the webhook node's `path`, NOT `{webhookId}/{path}`.
         n8n's editor displays the longer form, but webhook_entity on the server
         registers only `ask-ai` — the longer URL returns "Cannot POST". */
      const r = await n8n('ask-ai', { question: q });
      const sources = Array.isArray(r.sources) ? r.sources : [];
      thread.innerHTML = `<div class="card">
        <div class="bubble out" style="max-width:100%;margin-bottom:12px">${esc(q)}</div>
        <div class="bubble in" style="max-width:100%">${esc(r.answer || 'No answer returned.')}</div>
        ${r.documents_consulted === 0 ? `<div class="banner warm" style="margin-top:14px">
            <span class="material-symbols-outlined" style="font-size:20px">search_off</span>
            <div>No documents in the knowledge base matched this question, so the answer is not grounded in your data.</div></div>` : ''}
        ${sources.length ? `<div style="margin-top:16px">
          <div class="label-caps" style="margin-bottom:8px">Sources</div>
          <div class="grid g3">${sources.map(s => `<div class="card" style="padding:12px">
            <div style="font-weight:500;font-size:13px">${esc(s.title || 'Document')}</div>
            <div class="cell-sub">${esc(s.section || '—')}${s.page_number != null ? ' · p. ' + esc(s.page_number) : ''}</div>
          </div>`).join('')}</div></div>` : ''}
        <div class="cell-sub" style="margin-top:14px">
          Answered from ${num(r.documents_consulted)} document${r.documents_consulted === 1 ? '' : 's'}${r.model ? ' · model ' + esc(r.model) : ''}
        </div></div>`;
    } catch (e) {
      thread.innerHTML = `<div class="card">${stateError('an answer', e.message)}</div>`;
    }
  }
  $('askGo').addEventListener('click', ask);
  $('askQ').addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
};

/* ==========================================================================
   S7 · Finance Desk
   ========================================================================== */
