/* NEXUS OS — screens/ask.js
   The RAG console. One question box, one honest thread.

   Ask AI is the least reliable surface in this product and the history of this
   file is the history of that: the webhook has been dead behind CORS, dead
   behind a missing Authorization allow-list, and dead behind three OpenRouter
   models that no longer existed. A single retrieval + model round trip on this
   box has been measured at 8.8 s and the workflow has no upper bound of its own.
   So this screen is built around waiting and failing rather than around the
   happy path:

     · the working state is a live elapsed counter, because a spinner that never
       moves is indistinguishable from a hung tab,
     · a client-side deadline turns "hung forever" into a stated timeout the
       operator can act on — and if the answer arrives afterwards it is still
       rendered, labelled late, because a real answer must never be thrown away,
     · every failure is classified into what actually broke (unreachable host,
       rejected JWT, no webhook registered, workflow error), since "Failed to
       fetch" told nobody anything,
     · the raw payload is one click away on every turn, so an operator can see
       exactly what the workflow returned when it returns something odd.

   Nothing here is fabricated: the answer, the citations, the document count and
   the model name are printed only when the workflow sends them, and the
   knowledge-base counts and the run history come straight from Postgres. */
import { HOOK, db, n8n } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE } from '../lib/env.js';
import { ago, clock, esc, num, pill } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { panel, table } from '../lib/ui.js';

/* Long enough that a slow-but-working retrieval is not called a failure — the
   slowest verified end-to-end run was 8.8 s — short enough that a genuinely
   stuck request stops pretending. The request itself is not cancellable: n8n()
   owns the connection and exposes no abort, so this deadline reports, it does
   not kill. Anything that arrives later is still shown. */
const DEADLINE_MS = 45000;

/* History survives navigating to another screen and back, which is what makes
   it useful — it does not survive a reload, and the UI says so. Nothing is
   written to storage. */
const HISTORY = [];
let SEQ = 0;

const TIMED_OUT = { timedOut: true };
const wait = ms => new Promise(r => setTimeout(r, ms));
const secs = ms => (ms == null ? null : (ms / 1000).toFixed(1) + ' s');

/* ── Reading the workflow's reply ───────────────────────────────────────────
   The Ask-AI workflow has been rewritten more than once and its Format Response
   node has not always used the same key for the same thing. Read the shapes it
   has actually used and print nothing when none of them is present, rather than
   showing an empty bubble that reads like a broken answer. */
function answerText(res) {
  if (!res || typeof res !== 'object') return '';
  for (const k of ['answer', 'output', 'text', 'message', 'raw']) {
    const v = res[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}
function docCount(res) {
  if (!res || typeof res !== 'object') return null;
  for (const k of ['documents_consulted', 'doc_count', 'documents']) {
    const v = res[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}
function sourcesOf(res) {
  const raw = res && Array.isArray(res.sources) ? res.sources
    : res && Array.isArray(res.citations) ? res.citations : [];
  return raw.map(s => {
    if (typeof s === 'string') return { title: s, unknown: false };
    if (!s || typeof s !== 'object') return { unknown: true, blob: String(s) };
    const norm = {
      title:   s.title ?? s.doc_title ?? s.document ?? null,
      section: s.section ?? null,
      page:    s.page_number ?? s.page ?? null,
      file:    s.source_file ?? s.file ?? null,
      snippet: typeof s.content === 'string' ? s.content
             : typeof s.chunk === 'string' ? s.chunk
             : typeof s.text === 'string' ? s.text : null,
    };
    /* An unrecognised citation shape is shown verbatim rather than silently
       dropped — a citation the operator cannot see is a citation they cannot
       check. */
    if (!norm.title && !norm.file && !norm.section) return { unknown: true, blob: JSON.stringify(s) };
    return norm;
  });
}

/* ── Failure classification ─────────────────────────────────────────────────
   db()/n8n() format transport errors as "<status> — <body>", and the browser
   reports a blocked or unreachable request as "Failed to fetch". Each of those
   means something different to whoever has to fix it. */
function diagnose(msg) {
  const m = String(msg || '');
  if (/VITE_N8N_BASE_URL/.test(m))
    return 'This build has no n8n base URL compiled into it, so no workflow can be called from the browser at all.';
  if (/Session expired/i.test(m))
    return 'The Supabase session ended. Sign in again and re-ask.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m))
    return 'The browser never got a reply from the n8n host. That is the request being blocked or the host being unreachable — a CORS allow-list that is missing Authorization has caused exactly this before — not the workflow declining to answer.';
  const code = (m.match(/^(\d{3})\b/) || [])[1];
  if (code === '401' || code === '403')
    return 'The workflow rejected this request as unauthorised. Its JWT guard did not accept the session token this dashboard sent.';
  if (code === '404')
    return 'n8n has no webhook registered at this path right now, which normally means the Ask-AI workflow is not active.';
  if (code === '429')
    return 'The workflow or its model provider is rate-limiting. Wait and re-ask.';
  if (code && code.startsWith('5'))
    return 'The workflow ran and failed inside n8n. The execution log there will name the node that threw.';
  return '';
}

/* ── Answer formatting ──────────────────────────────────────────────────────
   The model returns plain text with paragraphs, bullets and the occasional
   **bold**. Escape first, then re-introduce only that small set of marks — the
   string is model output and is treated as hostile. Deliberately not rendered
   in a .bubble: that class is pre-wrap, which would also honour the whitespace
   in this generated markup. */
function inlineMarks(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<span class="mono">$1</span>');
}
function answerHtml(text) {
  const blocks = String(text).replace(/\r/g, '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  return blocks.map(b => {
    const rows = b.split('\n');
    if (rows.length === 1 && /^#{1,6}\s+/.test(rows[0]))
      return `<div class="label-caps" style="margin:14px 0 6px">${inlineMarks(rows[0].replace(/^#{1,6}\s+/, ''))}</div>`;
    const bulleted = rows.every(r => /^\s*([-*•]|\d+[.)])\s+/.test(r));
    if (bulleted) return `<div style="margin:0 0 10px">${rows.map(r => {
      const marker = r.match(/^\s*(\d+[.)])\s+/);
      const body = r.replace(/^\s*([-*•]|\d+[.)])\s+/, '');
      return `<div style="display:flex;gap:8px;margin-bottom:4px"><span class="t-muted" style="flex-shrink:0">${marker ? esc(marker[1]) : '•'}</span><span>${inlineMarks(body)}</span></div>`;
    }).join('')}</div>`;
    return `<div style="margin:0 0 10px">${inlineMarks(b).replace(/\n/g, '<br>')}</div>`;
  }).join('') || `<div class="t-muted">Empty answer.</div>`;
}

/* ── One turn ───────────────────────────────────────────────────────────── */
function entryBody(e) {
  const head = `<div class="bubble out" style="max-width:100%;margin-bottom:14px">${esc(e.q)}</div>`;

  if (e.status === 'pending') {
    return head + `<div style="display:flex;align-items:center;gap:10px">
        <div class="skeleton" style="width:18px;height:18px;border-radius:50%;flex-shrink:0"></div>
        <div><div>Searching the knowledge base, then asking the model…</div>
        <div class="cell-sub">Waiting <span id="askT${e.id}" class="num">${esc(secs(Date.now() - e.at))}</span> · this workflow has taken 9 s on a good run · giving up at ${Math.round(DEADLINE_MS / 1000)} s</div></div>
      </div>
      <div class="skeleton" style="height:14px;margin-top:16px;width:92%"></div>
      <div class="skeleton" style="height:14px;margin-top:10px;width:78%"></div>`;
  }

  const foot = raw => `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
      <button class="btn sm" data-act="again" data-id="${e.id}">Ask again</button>
      <button class="btn sm ghost" data-act="edit" data-id="${e.id}">Edit question</button>
      ${raw ? `<button class="btn sm ghost" data-act="raw" data-id="${e.id}" aria-expanded="${e.showRaw ? 'true' : 'false'}">${e.showRaw ? 'Hide' : 'Show'} raw response</button>` : ''}
      ${e.answer ? `<button class="btn sm ghost" data-act="copy" data-id="${e.id}">Copy answer</button>` : ''}
    </div>
    ${raw && e.showRaw ? `<div class="mono cell-sub" style="margin-top:12px;padding:12px;background:var(--surface-sunken);border-radius:8px;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto">${esc(raw)}</div>` : ''}`;

  if (e.status === 'error' || e.status === 'timeout') {
    const isTimeout = e.status === 'timeout';
    const hint = isTimeout ? '' : diagnose(e.err);
    return head + `<div class="banner hot" style="margin-bottom:0">
        <span class="material-symbols-outlined" style="font-size:20px">${isTimeout ? 'hourglass_disabled' : 'error'}</span>
        <div><div style="font-weight:500">${isTimeout
            ? `No reply after ${Math.round(DEADLINE_MS / 1000)} seconds`
            : 'The Ask-AI workflow did not answer'}</div>
          <div style="margin-top:4px">${isTimeout
            ? 'The request was not cancelled — this dashboard cannot cancel it. If it lands, the answer will appear here and be marked late.'
            : esc(e.err || 'Unknown error')}</div>
          ${hint ? `<div style="margin-top:6px">${esc(hint)}</div>` : ''}</div>
      </div>
      <div class="cell-sub" style="margin-top:10px">Asked at ${esc(clock(e.at))}${e.ms != null ? (isTimeout ? ' · stopped waiting after ' : ' · failed after ') + esc(secs(e.ms)) : ''}</div>`
      + foot(e.rawText);
  }

  /* Answered. */
  const src = sourcesOf(e.res);
  const dc = docCount(e.res);
  const model = typeof e.res?.model === 'string' ? e.res.model : null;
  const meta = [
    e.ms != null ? `Answered in ${esc(secs(e.ms))}` : null,
    e.late ? '<span class="t-warm">arrived after the timeout</span>' : null,
    `asked at ${esc(clock(e.at))}`,
    dc != null ? `${esc(num(dc))} document section${dc === 1 ? '' : 's'} consulted` : null,
    src.length ? `${esc(num(src.length))} cited` : null,
    model ? `model ${esc(model)}` : null,
  ].filter(Boolean).join(' · ');

  const body = e.answer
    ? answerHtml(e.answer)
    : `<div class="banner warm" style="margin-bottom:0">
         <span class="material-symbols-outlined" style="font-size:20px">help_center</span>
         <div>The workflow replied, but the reply carried no answer text. The raw response below is exactly what it sent.</div></div>`;

  const zeroDocs = dc === 0 ? `<div class="banner warm" style="margin:14px 0 0">
      <span class="material-symbols-outlined" style="font-size:20px">search_off</span>
      <div>Nothing in the knowledge base matched this question, so whatever is above is not grounded in your documents. Asking in a full sentence, with the words the document itself uses, is what makes retrieval fire.</div></div>` : '';

  const sources = src.length ? `<div style="margin-top:18px">
      <div class="label-caps" style="margin-bottom:8px">Sources</div>
      ${src.map((s, i) => s.unknown
        ? `<div class="list-item" style="cursor:default;align-items:flex-start">
             <span class="chip">${i + 1}</span>
             <div class="mono cell-sub" style="flex:1;min-width:0;white-space:normal;word-break:break-word">${esc(s.blob)}</div></div>`
        : `<div class="list-item" style="cursor:default;align-items:flex-start">
             <span class="chip">${i + 1}</span>
             <div style="flex:1;min-width:0">
               <div style="font-weight:500">${esc(s.title || s.file || 'Untitled document')}</div>
               <div class="cell-sub">${[
                  s.section ? esc(s.section) : null,
                  s.page != null ? 'p. ' + esc(s.page) : null,
                  s.file && s.file !== s.title ? esc(s.file) : null,
                ].filter(Boolean).join(' · ') || 'No section recorded'}</div>
               ${s.snippet ? `<div class="cell-sub" style="white-space:normal;margin-top:6px">${esc(s.snippet.length > 320 ? s.snippet.slice(0, 320) + '…' : s.snippet)}</div>` : ''}
             </div></div>`).join('')}
    </div>`
    : (e.answer ? `<div class="cell-sub" style="margin-top:16px">The workflow returned no citation list for this answer, so there is nothing here to check it against.</div>` : '');

  return head + body + zeroDocs + sources
    + `<div class="cell-sub" style="margin-top:14px">${meta}</div>` + foot(e.rawText);
}

SCREENS.ask = async host => {
  const wrap = el('div');
  wrap.style.maxWidth = '900px';
  wrap.style.margin = '0 auto';
  host.appendChild(wrap);

  wrap.innerHTML = `
    <div class="card">
      <div class="card-title" style="margin-bottom:4px">Ask the knowledge base</div>
      <div class="card-sub" id="askKb" style="margin-bottom:14px">Counting indexed documents…</div>
      <div class="field">
        <label for="askQ">Your question</label>
        <textarea id="askQ" rows="3" placeholder="Ask in a full sentence — &quot;what is the trade-in appraisal process?&quot;"></textarea>
        <div class="hint">Retrieval is full-text search over the indexed sections, so the words the document uses find it fastest. Enter sends, Shift+Enter adds a line. Questions under three characters return nothing by design.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px">
        <button class="btn primary" id="askGo"><span class="material-symbols-outlined">send</span>Ask</button>
        <button class="btn ghost" id="askReset">Clear box</button>
        <div style="flex:1"></div>
        <button class="btn ghost sm" id="askWipe" title="Discards this session's questions and answers from the screen.">Clear history</button>
      </div>
      <div id="askChips" style="margin-top:16px">${stateLoading(1)}</div>
    </div>
    <div id="askThread" style="margin-top:16px"></div>
    <div id="askRuns" style="margin-top:16px"></div>`;

  const thread = $('askThread');
  const box = $('askQ');
  const goBtn = $('askGo');

  /* ── Availability. A control that cannot work is disabled and says why. ── */
  let blocked = N8N_BASE
    ? ''
    : 'VITE_N8N_BASE_URL is not set in this build, so the ask-ai webhook cannot be called from the browser.';

  function syncControls() {
    const inFlight = HISTORY.some(e => e.status === 'pending');
    goBtn.disabled = !!blocked || inFlight || !box.value.trim();
    goBtn.title = blocked
      || (inFlight ? 'A question is already running. This workflow is answered one at a time so the answers cannot interleave.' : 'Send this question to the ask-ai workflow');
    const wipe = $('askWipe');
    wipe.disabled = HISTORY.length === 0;
    $('askReset').disabled = !box.value;
  }

  /* ── Thread painting ─────────────────────────────────────────────────────
     Each turn owns one card. Repainting a turn never touches the composer, so
     the operator can type the next question while one is still running. */
  const tickers = new Map();
  function stopTicker(id) {
    const t = tickers.get(id);
    if (t) { clearInterval(t); tickers.delete(id); }
  }
  function paint(e) {
    const node = document.getElementById(`askE${e.id}`);
    stopTicker(e.id);
    if (!node) return;
    node.innerHTML = entryBody(e);
    if (e.status === 'pending') {
      tickers.set(e.id, setInterval(() => {
        const t = document.getElementById(`askT${e.id}`);
        if (!t) { stopTicker(e.id); return; }
        t.textContent = secs(Date.now() - e.at);
      }, 500));
    }
    node.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => onEntryAct(b, e)));
    syncControls();
  }
  function onEntryAct(btn, e) {
    const act = btn.dataset.act;
    if (act === 'raw') { e.showRaw = !e.showRaw; paint(e); return; }
    if (act === 'edit') { box.value = e.q; box.focus(); syncControls(); return; }
    if (act === 'again') { box.value = e.q; syncControls(); submit(); return; }
    if (act === 'copy') {
      const clip = navigator.clipboard;
      if (!clip || typeof clip.writeText !== 'function') {
        btn.disabled = true;
        btn.title = 'This browser exposes no clipboard API to the page.';
        return;
      }
      clip.writeText(e.answer || '').then(
        () => { btn.textContent = 'Copied'; },
        () => { btn.textContent = 'Copy blocked'; btn.title = 'The browser refused clipboard access for this page.'; });
    }
  }
  function renderThread() {
    if (!HISTORY.length) {
      thread.innerHTML = `<div class="card">${stateEmpty('Nothing asked yet',
        'Answers appear here newest first and stay for as long as this tab is open. They are not saved anywhere.',
        'auto_awesome')}</div>`;
      return;
    }
    thread.innerHTML = HISTORY.map(e => `<div class="card" id="askE${e.id}" style="margin-bottom:14px"></div>`).join('');
    HISTORY.forEach(paint);
  }

  /* ── Asking ─────────────────────────────────────────────────────────────── */
  async function submit() {
    if (blocked) return;
    const q = box.value.trim();
    if (!q) return;
    if (HISTORY.some(e => e.status === 'pending')) return;

    const e = { id: ++SEQ, q, at: Date.now(), status: 'pending', ms: null, showRaw: false };
    HISTORY.unshift(e);
    box.value = '';
    renderThread();
    syncControls();

    const call = n8n(HOOK.askAi, { question: q });
    const settle = call.then(r => ({ ok: true, r }), err => ({ ok: false, err }));
    const finish = out => {
      e.ms = Date.now() - e.at;
      if (out.ok) {
        e.status = 'ok';
        e.res = out.r;
        e.answer = answerText(out.r);
        e.rawText = (() => { try { return JSON.stringify(out.r, null, 2); } catch { return String(out.r); } })();
      } else {
        e.status = 'error';
        e.err = out.err?.message || String(out.err);
        e.rawText = '';
      }
      paint(e);
      syncControls();
    };

    const winner = await Promise.race([settle, wait(DEADLINE_MS).then(() => TIMED_OUT)]);
    if (winner !== TIMED_OUT) { finish(winner); return; }

    e.status = 'timeout';
    e.ms = DEADLINE_MS;
    paint(e);
    syncControls();
    /* The connection is still open. If it lands, the turn is rewritten with the
       real answer and flagged late — an answer that arrived is an answer. */
    settle.then(out => { e.late = true; finish(out); });
  }

  goBtn.addEventListener('click', submit);
  box.addEventListener('input', syncControls);
  box.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); submit(); }
  });
  $('askReset').addEventListener('click', () => { box.value = ''; box.focus(); syncControls(); });
  $('askWipe').addEventListener('click', () => {
    /* A running turn is kept — dropping it would leave a request in flight with
       nowhere to land. */
    const keep = HISTORY.filter(x => x.status === 'pending');
    HISTORY.length = 0;
    keep.forEach(k => HISTORY.push(k));
    renderThread();
    syncControls();
  });

  renderThread();
  syncControls();

  /* ── What the knowledge base actually contains ──────────────────────────
     The chips are not invented example questions: every one names a document
     that is really indexed, so a chip can never ask about something the
     retrieval cannot find. */
  try {
    const docs = await db('rag_documents?select=doc_title,section,source_file&order=doc_title');
    const titles = [...new Set(docs.map(d => d.doc_title).filter(Boolean))];
    $('askKb').innerHTML = docs.length
      ? `${esc(num(docs.length))} indexed section${docs.length === 1 ? '' : 's'} across ${esc(num(titles.length))} document${titles.length === 1 ? '' : 's'} · answers are drawn only from these`
      : 'No documents are indexed';
    if (!docs.length) {
      blocked = 'rag_documents is empty, so the ask-ai workflow has nothing to answer from. Add a document to the knowledge base first.';
      $('askChips').innerHTML = stateEmpty('The knowledge base is empty',
        'Ask AI answers only from indexed documents, and there are none. Settings lists what is indexed.', 'description');
    } else if (titles.length) {
      $('askChips').innerHTML = `<div class="label-caps" style="margin-bottom:8px">Start from an indexed document</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${titles.slice(0, 8).map(t =>
          `<button class="btn sm" data-chip="${esc(t)}" title="Ask about ${esc(t)}">${esc(t)}</button>`).join('')}
        </div>`;
      $('askChips').querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => {
        box.value = `What does the ${b.dataset.chip} say?`;
        box.focus();
        syncControls();
      }));
    } else {
      $('askChips').innerHTML = `<div class="cell-sub">${esc(num(docs.length))} indexed section${docs.length === 1 ? '' : 's'}, none of them titled, so there is nothing to offer as a starting point.</div>`;
    }
    syncControls();
  } catch (err) {
    /* A failed read here says nothing about whether the workflow works, so the
       Ask button is deliberately left enabled. */
    $('askKb').textContent = 'Could not read the knowledge base index';
    $('askChips').innerHTML = stateError('the knowledge base index', err.message);
  }

  /* ── This workflow's own track record ───────────────────────────────────
     Only n8n writes audit_log, and it writes one row per Ask-AI run. When the
     endpoint is having a bad day this panel is where that is visible, instead
     of the operator concluding it from their own two failed questions. */
  panel($('askRuns'), {
    title: 'Ask-AI run history',
    sub: 'Rows the workflow itself wrote to audit_log — the dashboard cannot write these',
    load: () => db('audit_log?select=workflow,status,summary,intent,logged_at&workflow=ilike.*ask*ai*&order=logged_at.desc&limit=25'),
    render: rows => {
      if (!rows.length) {
        return stateEmpty('No Ask-AI runs recorded',
          'No audit_log row matches an Ask-AI workflow yet. Runs appear here once the workflow logs them.', 'history');
      }
      const ok = rows.filter(r => String(r.status || '').toUpperCase() === 'SUCCESS').length;
      const head = `<div class="cell-sub" style="padding:14px 20px 0">${esc(num(ok))} of the last ${esc(num(rows.length))} logged runs succeeded${rows[0]?.logged_at ? ' · most recent ' + esc(ago(rows[0].logged_at)) : ''}</div>`;
      return head + table([
        { label: 'When', render: r => `<span class="t-muted">${esc(ago(r.logged_at))}</span>` },
        { label: 'Status', render: r => pill(r.status || 'UNKNOWN') },
        { label: 'Workflow', render: r => esc(r.workflow || '—') },
        { label: 'Summary', render: r => `${esc(r.summary || '—')}${r.intent ? `<div class="cell-sub">${esc(r.intent)}</div>` : ''}` },
      ], rows);
    },
  });
};

/* ==========================================================================
   S7 · Finance Desk
   ========================================================================== */
