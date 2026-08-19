/* NEXUS OS — lib/integrations.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db, n8n } from './data.js';
import { $ } from './dom.js';
import { N8N_BASE } from './env.js';
import { esc } from './format.js';

async function renderIntegrations(node) {
  const checks = [
    { name: 'Supabase', probe: async () => { await db('leads?select=id&limit=1'); return 'Connected'; } },
    { name: 'n8n', probe: async () => {
        if (!N8N_BASE) throw new Error('VITE_N8N_BASE_URL not set');
        const r = await fetch(`${N8N_BASE}/healthz`).catch(() => null);
        if (!r) throw new Error('Unreachable from the browser');
        return r.ok ? 'Reachable' : `HTTP ${r.status}`;
      }},
    /* Finance Calc is pure JavaScript inside n8n — probing it is free, so it
       runs automatically. Ask AI is NOT probed on load: every call spends
       OpenRouter tokens, and a health dot is not worth paying for on every
       page view. It gets a manual Test button instead. */
    { name: 'Finance Calc', probe: async () => { const r = await n8n('finance-calc', { vehicleValue: 1, loanPayoffAmount: 0, creditScore: 700 }); return r.status === 'success' ? 'Responding' : 'Reachable'; } },
  ];
  const manual = [
    { name: 'Ask AI (RAG)', run: async () => { const r = await n8n('ask-ai', { question: 'ping' }); return r.answer ? `Responding · ${r.documents_consulted} docs` : 'No answer'; } },
  ];
  const unprobed = ['WhatsApp (WAHA)', 'Bitrix24', 'Slack', 'Gmail', 'OpenRouter'];

  node.innerHTML = `<div class="grid g4">${checks.map((c, i) =>
    `<div class="card" style="padding:14px" id="ig${i}">
       <div style="font-weight:500">${esc(c.name)}</div>
       <div class="cell-sub">Checking…</div></div>`).join('')}
    ${manual.map((m, i) => `<div class="card" style="padding:14px" id="mg${i}">
       <div style="font-weight:500">${esc(m.name)}</div>
       <div class="cell-sub">Costs tokens — not auto-checked</div>
       <button class="btn sm" data-manual="${i}" style="margin-top:8px">Test</button></div>`).join('')}</div>
    <div style="margin-top:14px">
      <div class="label-caps" style="margin-bottom:8px">Not probed from the browser</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${unprobed.map(u => `<span class="chip">${esc(u)}</span>`).join('')}
      </div>
      <div class="cell-sub" style="margin-top:8px">These run server-side inside n8n and have no browser-reachable health endpoint. Their real status is visible in the activity log above — a green dot here would be decoration, not a check.</div>
    </div>`;

  node.querySelectorAll('[data-manual]').forEach(btn => btn.addEventListener('click', async () => {
    const i = Number(btn.dataset.manual), box = $(`mg${i}`);
    btn.disabled = true; btn.textContent = 'Testing…';
    try {
      const msg = await manual[i].run();
      box.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:var(--ok)"></span>
        <span style="font-weight:500">${esc(manual[i].name)}</span></div><div class="cell-sub">${esc(msg)}</div>`;
    } catch (e) {
      box.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:var(--hot)"></span>
        <span style="font-weight:500">${esc(manual[i].name)}</span></div><div class="cell-sub t-hot">${esc(String(e.message).slice(0,90))}</div>`;
    }
  }));

  checks.forEach(async (c, i) => {
    const box = $(`ig${i}`);
    try {
      const msg = await c.probe();
      box.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:var(--ok)"></span>
        <span style="font-weight:500">${esc(c.name)}</span></div><div class="cell-sub">${esc(msg)} · ${new Date().toLocaleTimeString('en-GB',{hour12:false})}</div>`;
    } catch (e) {
      box.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:var(--hot)"></span>
        <span style="font-weight:500">${esc(c.name)}</span></div><div class="cell-sub t-hot">${esc(String(e.message).slice(0,90))}</div>`;
    }
  });
}

/* ==========================================================================
   S10 · Customer 360
   ========================================================================== */

export { renderIntegrations };
