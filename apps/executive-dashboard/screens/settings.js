/* NEXUS OS — screens/settings.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { ME, SESSION, db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { esc } from '../lib/format.js';
import { renderIntegrations } from '../lib/integrations.js';
import { SCREENS } from '../lib/nav.js';
import { applyDensity } from '../lib/prefs.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';

SCREENS.settings = async host => {
  const grid = el('div', 'grid g2'); host.appendChild(grid);

  const prof = el('div', 'card');
  prof.innerHTML = `<div class="card-title" style="margin-bottom:12px">Profile</div>
    <dl class="kv">
      <dt>Signed in as</dt><dd>${esc(SESSION?.user?.email || '—')}</dd>
      <dt>Name</dt><dd>${esc(ME?.name || '—')}</dd>
      <dt>Role</dt><dd>${esc(ME?.role || '—')}</dd>
      <dt>User id</dt><dd class="mono">${esc(SESSION?.user?.id || '—')}</dd>
    </dl>
    <div class="cell-sub" style="margin-top:12px">Password changes are handled by Supabase Auth, not by this dashboard.</div>`;
  grid.appendChild(prof);

  const integ = el('div', 'card');
  integ.innerHTML = `<div class="card-title" style="margin-bottom:4px">Integrations</div>
    <div class="card-sub" style="margin-bottom:12px">Credentials live in n8n and the server environment</div>
    <div id="setIntg">${stateLoading(2)}</div>
    <div class="banner info" style="margin-top:16px">
      <span class="material-symbols-outlined" style="font-size:20px">lock</span>
      <div>API keys are never displayed or accepted here, masked or otherwise. A dashboard that can show a key is a dashboard that can leak one.</div>
    </div>`;
  grid.appendChild(integ);

  const kb = el('div', 'card flush'); kb.style.marginTop = '16px'; host.appendChild(kb);
  kb.innerHTML = `<div class="card-head"><div><div class="card-title">Knowledge base</div>
    <div class="card-sub">What Ask AI is allowed to answer from</div></div></div><div id="kbBody">${stateLoading(3)}</div>`;

  const prefs = el('div', 'card'); prefs.style.marginTop = '16px'; host.appendChild(prefs);
  prefs.innerHTML = `<div class="card-title" style="margin-bottom:12px">Appearance</div>
    <div class="field" style="max-width:280px"><label for="density">Table density</label>
      <select id="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div>`;
  const dsel = $('density');
  dsel.value = localStorage.getItem('nexus.density') || 'comfortable';
  applyDensity();
  dsel.addEventListener('change', () => { localStorage.setItem('nexus.density', dsel.value); applyDensity(); });

  renderIntegrations($('setIntg'));

  try {
    const docs = await db('rag_documents?select=doc_title,section,source_file,page_number&order=doc_title');
    const byTitle = docs.reduce((m, d) => { (m[d.doc_title] ||= []).push(d); return m; }, {});
    $('kbBody').innerHTML = Object.keys(byTitle).length ? Object.entries(byTitle).map(([t, secs]) => `
      <div class="list-item" style="cursor:default;align-items:flex-start">
        <span class="material-symbols-outlined t-muted" style="font-size:20px">description</span>
        <div style="flex:1"><div style="font-weight:500">${esc(t)}</div>
          <div class="cell-sub">${secs.length} section${secs.length === 1 ? '' : 's'} · ${esc(secs[0].source_file || 'no source file')}</div></div>
      </div>`).join('') : stateEmpty('No documents indexed', 'Ask AI has nothing to answer from until a document is added.', 'description');
  } catch (e) { $('kbBody').innerHTML = stateError('the knowledge base', e.message); }
};
