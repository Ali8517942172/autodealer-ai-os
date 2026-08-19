/* NEXUS OS — screens/finance.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { ME, SESSION, db, n8n } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, esc, n0, pct, pill } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi, table } from '../lib/ui.js';

SCREENS.finance = async host => {
  const grid = el('div', 'grid g2'); host.appendChild(grid);

  const left = el('div', 'card');
  left.innerHTML = `
    <div class="card-title" style="margin-bottom:4px">Trade-in &amp; finance</div>
    <div class="card-sub" style="margin-bottom:16px">Calls the live Finance Calc workflow</div>
    <div class="grid" style="gap:14px">
      <div class="field"><label for="fVal">Vehicle value (AED)</label>
        <input type="number" id="fVal" min="1" placeholder="185000" /></div>
      <div class="field"><label for="fPay">Loan payoff amount (AED)</label>
        <input type="number" id="fPay" min="0" placeholder="60000" /></div>
      <div class="field"><label for="fScore">AECB credit score</label>
        <input type="number" id="fScore" min="300" max="900" placeholder="720" />
        <div class="hint">Entered manually from the customer's AECB report. Real-time bureau lookups require a licensed financial-institution agreement in the UAE.</div></div>
      <div class="field"><label for="fName">Customer name</label>
        <input type="text" id="fName" placeholder="Vikram Malhotra" /></div>
      <div class="field"><label for="fEmail">Customer email</label>
        <input type="email" id="fEmail" placeholder="name@example.com" />
        <div class="hint">A quote is a promise made to a named person. Without this the record cannot be traced back to anyone.</div></div>
      <button class="btn primary" id="fGo">Calculate</button>
    </div>
    <div id="fOut" style="margin-top:18px"></div>`;
  grid.appendChild(left);

  const right = el('div', 'card flush');
  right.innerHTML = `<div class="card-head"><div><div class="card-title">Commission</div>
    <div class="card-sub">From live inventory margins</div></div></div>
    <div style="padding:20px"><div class="field"><label for="cVeh">Vehicle</label><select id="cVeh"></select></div>
    <div id="cOut" style="margin-top:16px"></div></div>`;
  grid.appendChild(right);

  $('fGo').addEventListener('click', async () => {
    const vehicleValue = $('fVal').value, loanPayoffAmount = $('fPay').value, creditScore = $('fScore').value;
    const out = $('fOut');
    out.innerHTML = `<div class="t-muted">Calculating…</div>`;
    try {
      /* Attribution travels with the request. The backend records lead_email,
         lead_name and quoted_by; without these the quote is stored with nobody
         attached to it, which defeats the point of storing it. quoted_by comes
         from the session, never from a field the rep can type into. */
      const r = await n8n('finance-calc', {
        vehicleValue, loanPayoffAmount, creditScore,
        lead_name:  $('fName').value.trim()  || null,
        lead_email: $('fEmail').value.trim() || null,
        quoted_by:  ME?.name || SESSION?.user?.email || null,
      });
      if (r.status === 'error') {
        out.innerHTML = `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span>
          <div>${(r.errors || ['Invalid input']).map(esc).join('<br>')}</div></div>`;
        return;
      }
      const neg = r.equity_status === 'Negative';
      out.innerHTML = `
        <div class="grid g2">
          ${kpi('Equity', `<span class="${neg ? 't-hot' : 't-ok'}">${aed(r.equity_aed)}</span>`, pill(r.equity_status, neg ? 'hot' : 'ok'))}
          ${kpi('Indicative APR', pct(r.indicative_apr_pct), esc(r.finance_tier))}
        </div>
        <div style="margin-top:14px">
          <div class="label-caps" style="margin-bottom:6px">Loan to value · ${pct(r.loan_to_value_pct)}</div>
          <div class="bar"><i style="width:${Math.min(100, n0(r.loan_to_value_pct) || 0)}%;background:var(--${(n0(r.loan_to_value_pct)||0) > 80 ? 'hot' : 'primary'})"></i></div>
        </div>
        <div class="quote" style="margin-top:16px">${esc(r.disclaimer)}</div>`;
    } catch (e) {
      out.innerHTML = stateError('the calculation', e.message);
    }
  });

  /* Quote history. Until today finance_calc wrote nothing anywhere — every
     equity/APR figure a rep quoted a customer vanished with the HTTP response.
     This panel is the record. */
  const hist = el('div', 'card flush');
  hist.style.marginTop = '16px';
  hist.innerHTML = `<div class="card-head"><div><div class="card-title">Recent quotes</div>
    <div class="card-sub">Every calculation is now recorded and attributable</div></div></div>
    <div id="fqBody">${stateLoading(3)}</div>`;
  host.appendChild(hist);

  db('finance_quotes?select=*&order=created_at.desc&limit=50')
    .then(rows => {
      $('fqBody').innerHTML = rows.length ? table([
        { label:'When', render: r => `<span class="t-muted">${ago(r.created_at)}</span>` },
        { label:'Customer', strong:true, render: r => `${esc(r.lead_name || '—')}<div class="cell-sub">${esc(r.lead_email || '')}</div>` },
        { label:'Vehicle value', align:'r', render: r => aed(r.vehicle_value_aed) },
        { label:'Payoff', align:'r', render: r => aed(r.loan_payoff_aed) },
        { label:'Equity', align:'r', render: r => `<span class="${r.equity_status === 'Negative' ? 't-hot' : 't-ok'}">${aed(r.equity_aed)}</span>` },
        { label:'LTV', align:'r', render: r => pct(r.loan_to_value_pct) },
        { label:'Tier', render: r => `<span class="chip">${esc(r.finance_tier)}</span>` },
        { label:'APR', align:'r', render: r => pct(r.indicative_apr_pct) },
        { label:'Quoted by', render: r => esc(r.quoted_by || '—') },
      ], rows) : stateEmpty('No quotes recorded yet',
          'Every calculation from this screen is now stored, with the customer and the rep it belongs to.', 'receipt_long');
    })
    .catch(e => { $('fqBody').innerHTML = stateError('quote history', e.message); });

  try {
    const inv = await db('inventory?select=*&order=model');
    const sel = $('cVeh');
    sel.innerHTML = inv.map(i => `<option value="${esc(i.id)}">${esc(i.model)}</option>`).join('');
    const drawC = () => {
      const u = inv.find(i => i.id === sel.value) || inv[0];
      if (!u) return;
      $('cOut').innerHTML = `<dl class="kv">
        <dt>List price</dt><dd class="num">${aed(u.price_aed)}</dd>
        <dt>Gross margin</dt><dd class="num">${aed(u.gross_margin)}</dd>
        <dt>Holding cost</dt><dd class="num t-${(n0(u.holding_cost_accrued)||0) > 5000 ? 'hot' : 'muted'}">${aed(u.holding_cost_accrued)}</dd>
        <dt>Net margin</dt><dd class="num"><strong>${aed(u.net_margin)}</strong></dd>
        <dt>VAT</dt><dd class="num">${aed(u.vat_amount)}</dd>
        <dt>Commission</dt><dd class="num" style="font-size:18px;font-weight:600">${aed(u.recommended_commission)}</dd>
      </dl>`;
    };
    sel.addEventListener('change', drawC);
    drawC();
  } catch (e) {
    $('cOut').innerHTML = stateError('inventory', e.message);
  }
};

/* ==========================================================================
   S8 · Compliance / KYC
   ========================================================================== */
