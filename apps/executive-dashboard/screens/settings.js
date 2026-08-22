/* NEXUS OS — screens/settings.js
   Settings and diagnostics. Rebuilt on 20 Aug 2026.

   This screen exists to answer, without hedging, four questions an operator or
   an on-call engineer asks when something looks wrong:

     · Who am I signed in as, and what does the database think my role is?
     · Which Supabase project and which n8n instance is THIS bundle talking to?
     · Are those two reachable right now, from this browser, at this moment?
     · What is Ask AI actually allowed to answer from?

   Three rules it holds itself to:

     · No secret is rendered, not even partially. There is no masked key, no
       first-four-last-four, no truncated token. Only presence — configured or
       not — is ever stated. A masked key still confirms which key is installed,
       and a dashboard that can show a key is a dashboard that can leak one.
     · Nothing here is a guess. The environment panel prints the exact values
       compiled into the bundle; the knowledge-base panel prints the columns
       rag_documents really returned, and where a column it would like does not
       exist it says so rather than showing a plausible zero.
     · Webhook endpoints are listed but never probed. Firing lead-trigger to see
       whether it answers would enrol a real customer in a real drip campaign.
       The connectivity panel probes only what is free and side-effect-free;
       everything else is named, not called. */
import { HOOK, ME, SESSION, db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE, SUPABASE_URL, envErrors } from '../lib/env.js';
import { ago, clock, esc, n0, num } from '../lib/format.js';
import { renderIntegrations } from '../lib/integrations.js';
import { SCREENS } from '../lib/nav.js';
import { applyDensity } from '../lib/prefs.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, openDrawer, table, wireRows } from '../lib/ui.js';

/* Bounded read of the knowledge base. Where the cap is hit the panel says so —
   a KB listing that looks complete but is a window would understate what Ask AI
   can reach, which is the opposite of what this panel is for. */
const KB_LIMIT = 1000;
const PREVIEW_CHARS = 400;

/* rag_documents is populated by the ingestion workflow rather than by a
   migration this repo owns, so its exact column names are not guaranteed here.
   The panel discovers them from one probe row instead of assuming: asking
   PostgREST for a column that does not exist returns a 400 and would collapse
   the whole panel into an error for a cosmetic reason. First match wins. */
const TITLE_KEYS = ['doc_title', 'title', 'document_title', 'doc_name', 'name'];
const TEXT_KEYS  = ['content', 'chunk', 'chunk_text', 'text', 'body', 'page_content', 'section_text'];
const META_KEYS  = ['section', 'source_file', 'page_number', 'category', 'doc_type', 'created_at', 'updated_at', 'inserted_at', 'id'];
const DATE_KEYS  = ['updated_at', 'created_at', 'inserted_at'];
/* An embedding is 1536 floats per row. Selecting it would turn a listing of a
   few hundred sections into a multi-megabyte download for no visible benefit. */
const HEAVY_KEYS = ['embedding', 'embeddings', 'vector'];

const NO_PERSIST =
  'Density applies to this session only. lib/prefs.js exports applyDensity(), which reads the saved preference, but no setter — and a screen may not write to browser storage directly — so this choice cannot be saved from here yet.';

const NO_KB_EDIT =
  'Editing the knowledge base is not built. rag_documents is written by the ingestion workflow and no endpoint accepts a document from the browser.';

const low = s => String(s || '').trim().toLowerCase();
const pickKey = (cols, list) => list.find(k => cols.includes(k)) || null;
const charText = c => c == null ? '—' : `${num(c)} char${c === 1 ? '' : 's'}`;

/* Session expiry as a number the operator can act on. supabase-js refreshes in
   the background, so a small figure here is normal — it is a negative one that
   explains a screen full of 401s. */
function expiryText(expiresAt) {
  const ms = Number(expiresAt) * 1000;
  if (!expiresAt || !Number.isFinite(ms)) return null;
  const left = Math.round((ms - Date.now()) / 60000);
  const at = new Date(ms).toLocaleTimeString('en-GB', { hour12: false });
  if (left <= 0) return { text: `expired at ${at} — the next request will sign you out`, bad: true };
  return { text: `valid until ${at}, ${left} min from now`, bad: false };
}

/* ── S14 · Settings ───────────────────────────────────────────────────────── */
SCREENS.settings = async host => {
  const top = el('div', 'grid g2 top'); host.appendChild(top);

  /* ── Identity ───────────────────────────────────────────────────────────
     SESSION comes from Supabase Auth; ME is the matching row in `users`. They
     are separate sources and can disagree — a signed-in account with no users
     row has no role at all, which is worth stating rather than printing an em
     dash and letting the operator assume the role is merely blank. */
  const email = SESSION?.user?.email || null;
  const exp = expiryText(SESSION?.expires_at);
  const noMeRow = !!SESSION && !ME;

  const prof = el('div', 'card');
  prof.innerHTML = `<div class="card-title" style="margin-bottom:4px">Signed in</div>
    <div class="card-sub" style="margin-bottom:14px">Identity as Supabase Auth and the <span class="mono">users</span> table each see it</div>
    ${noMeRow ? `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">person_alert</span>
      <div>No row in <span class="mono">users</span> matches ${esc(email || 'this account')}. The account can sign in, but it has no name, role or status on record, so anything keyed on role treats it as unassigned.</div></div>` : ''}
    <dl class="kv">
      <dt>Email</dt><dd>${esc(email || 'unknown')}</dd>
      <dt>Name</dt><dd>${ME?.name ? esc(ME.name) : '<span class="t-muted">not set in users</span>'}</dd>
      <dt>Role</dt><dd>${ME?.role ? esc(ME.role) : '<span class="t-muted">no role on record</span>'}</dd>
      <dt>Account status</dt><dd>${ME?.status ? esc(ME.status) : '<span class="t-muted">not set</span>'}</dd>
      <dt>Auth user id</dt><dd class="mono">${esc(SESSION?.user?.id || 'unknown')}</dd>
      <dt>Access token</dt><dd>${exp
        ? `<span class="${exp.bad ? 't-hot' : ''}">${esc(exp.text)}</span>`
        : '<span class="t-muted">no expiry on the session object</span>'}</dd>
    </dl>
    <div class="cell-sub" style="margin-top:14px">Passwords, email changes and account creation are handled by Supabase Auth, not by this dashboard. Roles are edited on the Team screen.</div>`;
  top.appendChild(prof);

  /* ── Environment ────────────────────────────────────────────────────────
     Exactly what this bundle was built against. "Which project am I actually
     looking at?" is the first question of every incident where staging data
     turns up in production, and until now it could only be answered by opening
     the deploy configuration. */
  let sbHost = null;
  try { sbHost = new URL(SUPABASE_URL).host; } catch { sbHost = null; }
  const projectRef = sbHost ? sbHost.split('.')[0] : null;
  const mode = import.meta.env.MODE || null;
  const hooks = Object.values(HOOK);

  const envCard = el('div', 'card');
  envCard.innerHTML = `<div class="card-title" style="margin-bottom:4px">Environment</div>
    <div class="card-sub" style="margin-bottom:14px">What this build points at — configuration values only, never secrets</div>
    ${envErrors.length ? `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span>
      <div>${envErrors.map(e => esc(e)).join('<br>')}</div></div>` : ''}
    ${!N8N_BASE ? `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">link_off</span>
      <div><span class="mono">VITE_N8N_BASE_URL</span> is not set, so every workflow call is disabled: Ask AI, Finance Desk, drip enrolment and the ERP sync will refuse outright rather than fail halfway.</div></div>` : ''}
    <dl class="kv">
      <dt>Supabase project</dt><dd class="mono">${projectRef ? esc(projectRef) : '<span class="t-hot">could not be parsed</span>'}</dd>
      <dt>Supabase URL</dt><dd class="mono">${esc(SUPABASE_URL || 'not set')}</dd>
      <dt>Anon key</dt><dd>${envErrors.length
        ? '<span class="t-hot">missing or malformed — see above</span>'
        : 'configured <span class="t-muted">· never shown here, in full or masked</span>'}</dd>
      <dt>n8n base</dt><dd class="mono">${N8N_BASE ? esc(N8N_BASE) : '<span class="t-hot">not set</span>'}</dd>
      <dt>Build mode</dt><dd class="mono">${mode ? esc(mode) : '<span class="t-muted">unknown</span>'}</dd>
      <dt>Served from</dt><dd class="mono">${esc(location.origin)}</dd>
    </dl>
    <div class="banner info" style="margin-top:16px;margin-bottom:0">
      <span class="material-symbols-outlined" style="font-size:20px">lock</span>
      <div>API keys, service-role keys and webhook secrets are never displayed or accepted on this screen, masked or otherwise. They live in n8n and in the server environment.</div>
    </div>`;
  top.appendChild(envCard);

  /* ── Connectivity ───────────────────────────────────────────────────────
     renderIntegrations owns the probes themselves — a one-row Supabase read,
     the n8n /healthz endpoint, and a free finance-calc round trip. It is the
     same helper the Automation screen uses, so the two screens cannot disagree
     about what "reachable" means. */
  const conn = el('div', 'card'); conn.style.marginTop = '16px'; host.appendChild(conn);
  conn.innerHTML = `<div class="card-head" style="padding:0 0 14px">
      <div><div class="card-title">Connectivity</div>
        <div class="card-sub" id="setConnSub">Live checks against ${esc(projectRef || 'Supabase')} and the n8n health endpoint</div></div>
      <div style="flex:1"></div>
      <button class="btn sm" id="setRecheck">Re-run checks</button>
    </div>
    <div id="setIntg">${stateLoading(2)}</div>
    <div style="margin-top:18px">
      <div class="label-caps" style="margin-bottom:8px">Workflow endpoints this build will call</div>
      ${N8N_BASE
        ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${hooks
            .map(p => `<span class="chip mono">${esc(N8N_BASE)}/webhook/${esc(p)}</span>`).join('')}</div>`
        : `<div class="cell-sub t-hot">No base URL is configured, so none of these can be called: ${
            hooks.map(p => esc(p)).join(', ')}.</div>`}
      <div class="cell-sub" style="margin-top:8px">These are listed, not probed. Calling them to see whether they answer would do real work — <span class="mono">lead-trigger</span> enrols a customer in a drip campaign and <span class="mono">ask-ai</span> spends tokens — so a green dot here would cost more than it is worth. What they actually did is on the Automation screen, which reads what they logged.</div>
    </div>`;

  const runChecks = () => {
    const sub = $('setConnSub');
    if (sub) sub.textContent = `Checks started ${clock(new Date().toISOString())} — each tile stamps its own result`;
    renderIntegrations($('setIntg'));
  };
  $('setRecheck').addEventListener('click', runChecks);
  runChecks();

  /* ── Knowledge base ─────────────────────────────────────────────────────
     The documents Ask AI is permitted to answer from. Sections are the unit
     actually retrieved, so both counts are shown: an operator who sees "6
     documents" and gets a thin answer needs to know whether those six were
     chunked into 400 sections or into 6. */
  const kb = el('div', 'card flush'); kb.style.marginTop = '16px'; host.appendChild(kb);

  const kbShell = (sub, body) => {
    kb.innerHTML = `<div class="card-head">
        <div><div class="card-title">Knowledge base</div><div class="card-sub">${sub}</div></div>
        <div style="flex:1"></div>
        <button class="btn ghost sm" id="kbReload" aria-label="Reload the knowledge base">
          <span class="material-symbols-outlined">refresh</span></button>
      </div><div id="kbBody">${body}</div>`;
    $('kbReload').addEventListener('click', loadKb);
  };

  async function loadKb() {
    kbShell('What Ask AI is allowed to answer from', stateLoading(4));
    try {
      /* One probe row to learn the shape, then a targeted select. Two round
         trips is the price of not guessing a column name. */
      const probe = await db('rag_documents?select=*&limit=1');
      if (!probe.length) {
        kbShell('What Ask AI is allowed to answer from',
          stateEmpty('No documents indexed',
            'rag_documents is empty, so Ask AI has nothing to retrieve and nothing to cite. A document has to be ingested before it can answer anything.',
            'description'));
        return;
      }
      const cols = Object.keys(probe[0]);
      const titleKey = pickKey(cols, TITLE_KEYS);
      const textKey  = pickKey(cols, TEXT_KEYS);
      const dateKey  = pickKey(cols, DATE_KEYS);
      let sel = [...new Set([titleKey, textKey, ...META_KEYS].filter(k => k && cols.includes(k)))];
      if (!sel.length) sel = cols.filter(c => !HEAVY_KEYS.includes(c));

      const rows = await db(`rag_documents?select=${sel.join(',')}${titleKey ? `&order=${titleKey}` : ''}&limit=${KB_LIMIT}`);
      renderKb({
        rows, cols, titleKey, textKey, dateKey,
        hasPage: cols.includes('page_number'),
        hasSrc:  cols.includes('source_file'),
        hasSect: cols.includes('section'),
        capped:  rows.length >= KB_LIMIT,
        readAt:  new Date().toISOString(),
      });
    } catch (e) {
      kbShell('What Ask AI is allowed to answer from', stateError('the knowledge base', e.message));
    }
  }

  function renderKb(d) {
    const { rows, cols, titleKey, textKey, dateKey, hasPage, hasSrc, hasSect, capped, readAt } = d;

    /* Group sections into documents. A section with no title cannot be
       attributed to one, so it is bucketed explicitly and counted — folding
       those into the first real document would overstate that document. */
    const groups = new Map();
    let untitled = 0;
    for (const r of rows) {
      const raw = titleKey ? String(r[titleKey] ?? '').trim() : '';
      if (!raw) untitled++;
      const key = raw || ' untitled';
      let g = groups.get(key);
      if (!g) {
        g = { title: raw, secs: [], chars: textKey ? 0 : null, sources: new Set(), pages: [], last: null };
        groups.set(key, g);
      }
      g.secs.push(r);
      if (textKey) g.chars += String(r[textKey] ?? '').length;
      if (hasSrc && r.source_file) g.sources.add(String(r.source_file));
      if (hasPage) { const p = n0(r.page_number); if (p != null) g.pages.push(p); }
      if (dateKey && r[dateKey]) {
        const t = Date.parse(r[dateKey]);
        if (!Number.isNaN(t) && (g.last == null || t > g.last)) g.last = t;
      }
    }
    const docs = [...groups.values()];
    const totalChars = textKey ? docs.reduce((a, g) => a + g.chars, 0) : null;

    const sub = `${num(docs.length)} document${docs.length === 1 ? '' : 's'} · ${num(rows.length)} retrievable section${rows.length === 1 ? '' : 's'}${
      totalChars != null ? ` · ${charText(totalChars)} indexed` : ''} · read ${esc(clock(readAt))}`;

    kbShell(sub, `
      ${capped ? `<div class="banner warm" style="margin:16px 16px 0"><span class="material-symbols-outlined" style="font-size:20px">filter_alt</span>
        <div>Showing the first ${num(KB_LIMIT)} sections only. The knowledge base is larger than this listing, so the totals above are a floor rather than a count.</div></div>` : ''}
      ${untitled ? `<div class="banner warm" style="margin:16px 16px 0"><span class="material-symbols-outlined" style="font-size:20px">help</span>
        <div>${num(untitled)} section${untitled === 1 ? ' has' : 's have'} no <span class="mono">${esc(titleKey || 'title')}</span> value, so ${untitled === 1 ? 'it cannot' : 'they cannot'} be attributed to a document. Ask AI can still retrieve ${untitled === 1 ? 'it' : 'them'}, but a citation will have nothing to name.</div></div>` : ''}
      ${!titleKey ? `<div class="banner warm" style="margin:16px 16px 0"><span class="material-symbols-outlined" style="font-size:20px">info</span>
        <div>rag_documents has no recognised title column, so sections cannot be grouped by document. Columns returned: <span class="mono">${esc(cols.join(', '))}</span>.</div></div>` : ''}
      <div class="toolbar">
        <div class="seg" id="kbSeg" role="group" aria-label="Sort documents">
          <button type="button" data-s="name" class="on" aria-pressed="true">By name</button>
          <button type="button" data-s="size" aria-pressed="false">${textKey ? 'Largest first' : 'Most sections'}</button>
        </div>
        <div class="grow">
          <label class="sr-only" for="kbQ">Search the knowledge base</label>
          <input type="search" id="kbQ" placeholder="Search document, section or source file" />
        </div>
      </div>
      <div id="kbList"></div>`);

    const f = { sort: 'name', q: '' };

    const draw = () => {
      const q = low(f.q);
      const list = docs.filter(g => !q
        || low(g.title).includes(q)
        || [...g.sources].some(s => low(s).includes(q))
        || (hasSect && g.secs.some(r => low(r.section).includes(q))));

      list.sort((a, b) => f.sort === 'size'
        ? (textKey ? b.chars - a.chars : b.secs.length - a.secs.length)
        : String(a.title || 'zzzz').localeCompare(String(b.title || 'zzzz')));

      const tcols = [
        { label: 'Document', strong: true, render: g => `
          <div>${g.title ? esc(g.title) : '<span class="t-muted">Untitled sections</span>'}</div>
          ${g.sources.size
            ? `<div class="cell-sub">${esc([...g.sources].slice(0, 2).join(', '))}${g.sources.size > 2 ? ` +${g.sources.size - 2} more` : ''}</div>`
            : hasSrc ? '<div class="cell-sub t-muted">no source file recorded</div>' : ''}` },
        { label: 'Sections', align: 'r', render: g => num(g.secs.length) },
      ];
      if (textKey) tcols.push({ label: 'Size', align: 'r', render: g => charText(g.chars) });
      if (hasPage) tcols.push({ label: 'Pages', align: 'r', render: g => {
        if (!g.pages.length) return '<span class="t-muted">—</span>';
        const lo = Math.min(...g.pages), hi = Math.max(...g.pages);
        return esc(lo === hi ? String(lo) : `${lo}–${hi}`);
      } });
      if (dateKey) tcols.push({ label: 'Indexed', align: 'r', render: g =>
        g.last ? esc(ago(new Date(g.last).toISOString())) : '<span class="t-muted">—</span>' });

      const listHost = $('kbList');
      listHost.innerHTML = table(tcols, list, {
        empty: stateEmpty('No document matches', 'Nothing in the knowledge base matches that search.', 'search_off'),
        onRow: true,
      });
      wireRows(listHost, list, openDoc);
    };

    function openDoc(g) {
      const secs = g.secs.slice().sort((a, b) => (n0(a.page_number) ?? 0) - (n0(b.page_number) ?? 0));
      openDrawer(`
        <div class="drawer-head">
          <div style="flex:1">
            <h2 style="font-size:18px">${g.title ? esc(g.title) : 'Untitled sections'}</h2>
            <div class="cell-sub">${num(g.secs.length)} retrievable section${g.secs.length === 1 ? '' : 's'}${
              textKey ? ` · ${charText(g.chars)}` : ''}</div>
          </div>
          <button class="btn ghost sm" id="kbClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="drawer-body">
          <div class="section">
            <div class="label-caps">Document</div>
            <dl class="kv" style="margin-top:10px">
              <dt>Source files</dt><dd>${g.sources.size ? esc([...g.sources].join(', ')) : '<span class="t-muted">none recorded</span>'}</dd>
              <dt>Sections</dt><dd>${num(g.secs.length)}</dd>
              ${textKey ? `<dt>Indexed size</dt><dd>${charText(g.chars)}</dd>` : ''}
              ${hasPage ? `<dt>Pages</dt><dd>${g.pages.length
                ? esc(`${Math.min(...g.pages)}–${Math.max(...g.pages)}`)
                : '<span class="t-muted">not recorded</span>'}</dd>` : ''}
              ${dateKey ? `<dt>Last indexed</dt><dd>${g.last
                ? esc(ago(new Date(g.last).toISOString()))
                : '<span class="t-muted">not recorded</span>'}</dd>` : ''}
            </dl>
          </div>
          <div class="section" style="margin-top:20px">
            <div class="label-caps">Sections as stored</div>
            ${secs.map((r, i) => {
              const body = textKey ? String(r[textKey] ?? '') : '';
              const meta = [
                hasPage && n0(r.page_number) != null ? `page ${n0(r.page_number)}` : null,
                hasSrc && r.source_file ? String(r.source_file) : null,
                textKey ? charText(body.length) : null,
              ].filter(Boolean);
              return `<div class="list-item" style="cursor:default;align-items:flex-start;flex-direction:column;gap:4px">
                <div style="font-weight:500">${hasSect && r.section ? esc(r.section) : `Section ${i + 1}`}</div>
                <div class="cell-sub">${meta.length ? esc(meta.join(' · ')) : '<span class="t-muted">no section metadata</span>'}</div>
                ${textKey
                  ? (body
                      ? `<div class="cell-sub" style="white-space:pre-wrap;margin-top:4px">${esc(body.slice(0, PREVIEW_CHARS))}${body.length > PREVIEW_CHARS ? '…' : ''}</div>`
                      : '<div class="cell-sub t-muted" style="margin-top:4px">This section is stored empty, so retrieving it returns nothing.</div>')
                  : ''}
              </div>`;
            }).join('')}
          </div>
          ${!textKey ? `<div class="cell-sub" style="margin-top:14px">rag_documents returned no recognised text column, so section contents and sizes cannot be shown. Columns available: <span class="mono">${esc(cols.join(', '))}</span>.</div>` : ''}
        </div>
        <div class="drawer-foot">
          <button class="btn ghost" id="kbClose2">Close</button>
          <div style="flex:1"></div>
          <button class="btn" disabled title="${esc(NO_KB_EDIT)}">Edit document</button>
        </div>`);
      $('kbClose').addEventListener('click', closeDrawer);
      $('kbClose2').addEventListener('click', closeDrawer);
    }

    const seg = $('kbSeg');
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      f.sort = b.dataset.s;
      seg.querySelectorAll('button').forEach(x => {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      draw();
    }));
    $('kbQ').addEventListener('input', e => { f.q = e.target.value; draw(); });
    draw();
  }

  loadKb();

  /* ── Appearance ─────────────────────────────────────────────────────────
     applyDensity() reads the saved preference and puts the `compact` class on
     <body>. It is the only thing lib/prefs.js exports. Calling it first means
     the control below starts on whatever was actually saved, read back off the
     body class rather than out of storage — a screen may not touch storage
     directly, and reimplementing the read here would let the two disagree.
     Changing the setting therefore lasts for this session only, which the panel
     states outright rather than quietly forgetting the choice on reload. */
  applyDensity();
  const savedCompact = document.body.classList.contains('compact');
  const DENSITIES = [
    { id: 'comfortable', label: 'Comfortable', hint: 'Roomier rows, easier to scan across a wide table.' },
    { id: 'compact',     label: 'Compact',     hint: 'More rows per screen, for long registers like Compliance and Automation.' },
  ];
  const isOn = id => (id === 'compact') === savedCompact;

  const look = el('div', 'card'); look.style.marginTop = '16px'; host.appendChild(look);
  look.innerHTML = `<div class="card-title" style="margin-bottom:4px">Appearance</div>
    <div class="card-sub" style="margin-bottom:14px">How tightly tables are packed</div>
    <div class="seg" id="setDensity" role="group" aria-label="Table density">
      ${DENSITIES.map(d => `<button type="button" data-d="${d.id}" class="${isOn(d.id) ? 'on' : ''}"
        aria-pressed="${isOn(d.id) ? 'true' : 'false'}">${esc(d.label)}</button>`).join('')}
    </div>
    <div class="cell-sub" id="setDensityHint" style="margin-top:10px">${
      esc(DENSITIES.find(d => isOn(d.id)).hint)}</div>
    <div class="banner info" style="margin-top:16px;margin-bottom:0">
      <span class="material-symbols-outlined" style="font-size:20px">info</span>
      <div>${esc(NO_PERSIST)}</div>
    </div>`;

  const dseg = $('setDensity');
  dseg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    document.body.classList.toggle('compact', b.dataset.d === 'compact');
    dseg.querySelectorAll('button').forEach(x => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
    });
    $('setDensityHint').textContent = DENSITIES.find(d => d.id === b.dataset.d).hint;
  }));
};
