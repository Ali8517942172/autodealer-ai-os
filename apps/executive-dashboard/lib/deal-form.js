/* NEXUS OS — lib/deal-form.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { HOOK, n8n } from './data.js';
import { $ } from './dom.js';
import { esc } from './format.js';
import { modalError, openModal } from './modal.js';

function dealForm(leads, onDone) {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const f = (id, label, input, hint) => `<div class="field"><label for="${id}">${label}</label>${input}
    ${hint ? `<div class="cell-sub">${hint}</div>` : ''}</div>`;

  const m = openModal('Record a closed-won deal', `
    ${f('dLead', 'Lead', `<select id="dLead">
        <option value="">— pick a lead, or type the details below —</option>
        ${leads.filter(l => l.email).map(l =>
          `<option value="${esc(l.email)}" data-name="${esc(l.name || '')}" data-veh="${esc(l.vehicle_interest || '')}"
            data-budget="${esc(l.budget_aed || '')}">${esc(l.name || l.email)} — ${esc(l.vehicle_interest || 'no vehicle noted')}</option>`).join('')}
      </select>`, 'Picking a lead fills the rest in. You can still edit any field.')}
    <div class="grid g2">
      ${f('dName', 'Customer name', `<input id="dName" placeholder="Vikram Malhotra" />`)}
      ${f('dEmail', 'Email', `<input type="email" id="dEmail" placeholder="name@example.com" />`,
          'Used with the close date to build a stable deal id, so re-recording the same deal updates its vector instead of duplicating it.')}
    </div>
    <div class="grid g2">
      ${f('dVeh', 'Vehicle', `<input id="dVeh" placeholder="Toyota Land Cruiser 2024" />`)}
      ${f('dPhone', 'Phone (optional)', `<input id="dPhone" placeholder="+971…" />`)}
    </div>
    <div class="grid g2">
      ${f('dPrice', 'Sale price (AED)', `<input type="number" min="1" id="dPrice" placeholder="290000" />`)}
      ${f('dDate', 'Closed on', `<input type="date" id="dDate" value="${iso}" max="${iso}" />`)}
    </div>`,
    `<button class="btn primary" id="dSave">Record deal</button>
     <button class="btn" id="dCancel">Cancel</button>`);

  $('dLead').addEventListener('change', e => {
    const o = e.target.selectedOptions[0];
    if (!o || !o.value) return;
    $('dEmail').value = o.value;
    $('dName').value = o.dataset.name || '';
    $('dVeh').value = o.dataset.veh || '';
    if (o.dataset.budget && !$('dPrice').value) $('dPrice').value = o.dataset.budget;
  });

  m.wrap.querySelector('#dCancel').addEventListener('click', m.close);
  m.wrap.querySelector('#dSave').addEventListener('click', async () => {
    const v = {
      lead_email: $('dEmail').value.trim(),
      lead_name: $('dName').value.trim(),
      phone: $('dPhone').value.trim(),
      vehicle: $('dVeh').value.trim(),
      sale_price_aed: $('dPrice').value,
      closed_at: $('dDate').value,
    };
    if (!v.lead_email) return m.msg('<span class="t-hot">An email address is required — the deal id is derived from it.</span>');
    if (!v.lead_name)  return m.msg('<span class="t-hot">A customer name is required.</span>');
    if (!v.vehicle)    return m.msg('<span class="t-hot">A vehicle is required — it is most of what gets embedded.</span>');
    if (!v.sale_price_aed || Number(v.sale_price_aed) <= 0)
      return m.msg('<span class="t-hot">A sale price above zero is required.</span>');
    if (!v.closed_at)  return m.msg('<span class="t-hot">A close date is required.</span>');

    const btn = m.wrap.querySelector('#dSave');
    btn.disabled = true; btn.textContent = 'Recording…';
    try {
      await n8n(HOOK.closedWon, v);
      m.close(); onDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Record deal';
      modalError(m, e);
    }
  });
}

/* ==========================================================================
   S11 · Automation
   ========================================================================== */

export { dealForm };
