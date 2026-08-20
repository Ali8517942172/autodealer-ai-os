/* NEXUS OS — screens/finance.js
   The finance desk.

   One job above all others: a rep types four numbers and reads back an equity
   figure, a finance tier and an APR that they are about to say out loud to a
   customer. Everything on this screen is built around not getting that wrong.

   Three rules this file follows:

   1. The Finance Calc workflow validates hard and rejects with
      `{status:'error', errors:[…]}` and an HTTP 200 — a raw rejection is not an
      error the rep can act on ("lead_email is required" is workflow language,
      not desk language). So the form validates against the same contract
      *before* sending, per field, and a rejection that still comes back is
      rendered as prose rather than as a dump.
   2. Nothing on this screen is computed locally from a quote. Equity, LTV, tier
      and APR are read off the workflow response and off `finance_quotes`; the
      only arithmetic here is counting and averaging rows Postgres returned.
   3. A quote is a promise made to a named person. Attribution (`lead_name`,
      `lead_email`, `quoted_by`) travels with every request — `quoted_by` from
      the session, never from a field a rep can type into.

   The workflow's own limits, mirrored below so the rep sees them before the
   round trip rather than after it: `vehicleValue` must be at least AED 5,000,
   `lead_email` is required and format-checked, and `finance_quotes.credit_score`
   carries a 300–900 CHECK constraint in Postgres. The field names the workflow
   accepts are exactly vehicleValue / loanPayoffAmount / creditScore — it logs a
   REJECTED audit row for anything else, so they are not renamed here. */
import { HOOK, ME, SESSION, db, n8n } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE } from '../lib/env.js';
import { aed, ago, esc, n0, num, pct, pill } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';
import { deriveUnit } from '../lib/unit-form.js';

const MIN_VEHICLE_VALUE = 5000;              // workflow: vehicleValue >= 5000
const SCORE_MIN = 300, SCORE_MAX = 900;      // finance_quotes.credit_score CHECK
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HISTORY_LIMIT = 200;

const NO_N8N = 'VITE_N8N_BASE_URL is not set in this build, so the Finance Calc '
  + 'workflow cannot be reached from the browser. Set it and redeploy.';

/* Averages over rows Postgres returned, reporting how many rows actually
   carried the column so a mean over three quotes never reads like a mean over
   two hundred. */
function mean(rows, key) {
  const xs = rows.map(r => n0(r[key])).filter(v => v != null);
  return { avg: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length };
}
const lower = v => String(v == null ? '' : v).toLowerCase();
const eqTone = s => (lower(s) === 'negative' ? 'hot' : lower(s) === 'positive' ? 'ok' : '');
const eqClass = s => (lower(s) === 'negative' ? 't-hot' : lower(s) === 'positive' ? 't-ok' : '');
const stamp = ts => (ts ? new Date(ts).toLocaleString('en-GB', { hour12: false }) : '—');

SCREENS.finance = async host => {
  /* ── Layout ────────────────────────────────────────────────────────────── */
  const strip = el('div', 'grid g4');
  strip.innerHTML = stateLoading(2);
  host.appendChild(strip);

  const cols = el('div', 'grid g2 top');
  cols.style.marginTop = '16px';
  host.appendChild(cols);

  const leftCol = el('div');
  const rightCol = el('div');
  cols.appendChild(leftCol);
  cols.appendChild(rightCol);

  const histCard = el('div', 'card flush');
  histCard.style.marginTop = '16px';
  host.appendChild(histCard);

  /* ── The quote form ────────────────────────────────────────────────────── */
  const formCard = el('div', 'card');
  leftCol.appendChild(formCard);

  const field = (id, label, input, hint) => `
    <div class="field">
      <label for="${id}">${label}</label>
      ${input}
      ${hint ? `<div class="hint">${hint}</div>` : ''}
      <div class="hint t-hot" id="err-${id}" role="alert"></div>
    </div>`;

  formCard.innerHTML = `
    <div class="card-title" style="margin-bottom:4px">Quote a trade-in</div>
    <div class="card-sub" style="margin-bottom:16px">
      Runs the live Finance Calc workflow, which returns the equity, tier and APR
      and records the quote in <span class="mono">finance_quotes</span>.</div>
    <div class="grid" style="gap:14px">
      ${field('fLead', 'Lead',
        `<select id="fLead" disabled><option value="">Loading leads…</option></select>`,
        'Picking a lead fills in the customer. You can still type the details by hand.')}
      <div id="fLeadCtx"></div>
      <div class="grid g2" style="gap:14px">
        ${field('fVal', 'Trade-in vehicle value (AED)',
          `<input type="number" id="fVal" min="${MIN_VEHICLE_VALUE}" step="1000" inputmode="numeric" placeholder="185000" />`,
          `Minimum ${aed(MIN_VEHICLE_VALUE)} — the workflow rejects anything lower.`)}
        ${field('fPay', 'Outstanding loan payoff (AED)',
          `<input type="number" id="fPay" min="0" step="1000" inputmode="numeric" placeholder="60000" />`,
          'Enter 0 if the customer owns the car outright.')}
      </div>
      ${field('fScore', 'AECB credit score',
        `<input type="number" id="fScore" min="${SCORE_MIN}" max="${SCORE_MAX}" step="1" inputmode="numeric" placeholder="720" />`,
        `${SCORE_MIN}–${SCORE_MAX}. Entered by hand from the customer's AECB report — real-time bureau
         lookups need a licensed financial-institution agreement in the UAE.`)}
      <div class="grid g2" style="gap:14px">
        ${field('fName', 'Customer name', `<input type="text" id="fName" placeholder="Full name" />`)}
        ${field('fEmail', 'Customer email', `<input type="email" id="fEmail" placeholder="name@example.com" />`,
          'Required by the workflow. Without it the quote is stored attached to nobody.')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn primary" id="fGo"${N8N_BASE ? '' : ` disabled title="${esc(NO_N8N)}"`}>
          <span class="material-symbols-outlined">calculate</span> Calculate quote</button>
        <button class="btn ghost" id="fClear">Clear</button>
        <div style="flex:1"></div>
        <span class="cell-sub">Quoted by ${esc(ME?.name || SESSION?.user?.email || 'the signed-in user')}</span>
      </div>
      ${N8N_BASE ? '' : `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">link_off</span>
        <div>${esc(NO_N8N)}</div></div>`}
    </div>`;

  /* ── The result card ───────────────────────────────────────────────────── */
  const resultCard = el('div', 'card flush');
  resultCard.innerHTML = `<div class="card-head"><div>
      <div class="card-title">Quote result</div>
      <div class="card-sub">Straight from the workflow response — nothing here is recalculated in the browser</div>
    </div></div><div class="pbody" id="fOut"></div>`;
  rightCol.appendChild(resultCard);

  const out = () => $('fOut');
  out().innerHTML = stateEmpty('No quote yet',
    'Fill in the trade-in value, the payoff, the credit score and the customer, then calculate.', 'calculate');

  /* ── The commission card ───────────────────────────────────────────────── */
  const commCard = el('div', 'card flush');
  commCard.style.marginTop = '16px';
  commCard.innerHTML = `<div class="card-head"><div>
      <div class="card-title">Commission on a unit</div>
      <div class="card-sub">Recomputed live from acquisition date, list price and cost, the same way Inventory does it</div>
    </div></div>
    <div class="pbody" id="cBody">${stateLoading(3)}</div>`;
  rightCol.appendChild(commCard);

  /* ── Form plumbing ─────────────────────────────────────────────────────── */
  const FIELDS = ['fVal', 'fPay', 'fScore', 'fName', 'fEmail'];
  let touched = false;   // no red text before the rep has tried to submit once

  const read = () => ({
    vehicleValue: $('fVal').value.trim(),
    loanPayoffAmount: $('fPay').value.trim(),
    creditScore: $('fScore').value.trim(),
    lead_name: $('fName').value.trim(),
    lead_email: $('fEmail').value.trim(),
  });

  /* Mirrors the workflow's own validation. Everything caught here is a round
     trip the customer does not wait through, and a REJECTED audit row that
     never gets written. */
  function validate(v) {
    const e = {};
    const val = n0(v.vehicleValue);
    if (!v.vehicleValue) e.fVal = 'Required — the workflow will not price a trade-in without a value.';
    else if (val == null) e.fVal = 'Enter a number.';
    else if (val < MIN_VEHICLE_VALUE) e.fVal = `Must be at least ${aed(MIN_VEHICLE_VALUE)}. The workflow rejects anything lower.`;

    const pay = n0(v.loanPayoffAmount);
    if (v.loanPayoffAmount === '') e.fPay = 'Required — enter 0 if there is no outstanding loan.';
    else if (pay == null) e.fPay = 'Enter a number.';
    else if (pay < 0) e.fPay = 'A payoff cannot be negative.';

    const score = n0(v.creditScore);
    if (!v.creditScore) e.fScore = 'Required.';
    else if (score == null || !Number.isInteger(score)) e.fScore = 'Enter a whole number.';
    else if (score < SCORE_MIN || score > SCORE_MAX) e.fScore = `AECB scores run from ${SCORE_MIN} to ${SCORE_MAX}.`;

    if (!v.lead_name) e.fName = 'Required — a quote with no name on it cannot be traced back to anyone.';
    if (!v.lead_email) e.fEmail = 'Required by the workflow.';
    else if (!EMAIL_RE.test(v.lead_email)) e.fEmail = 'That does not look like an email address.';
    return e;
  }

  function paintErrors(e) {
    FIELDS.forEach(id => {
      const box = $(`err-${id}`);
      const msg = touched ? (e[id] || '') : '';
      box.textContent = msg;
      $(id).setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
    /* Not an error — the two figures are simply the wrong way round, which is a
       real and common situation and produces a negative-equity quote. */
    const v = read();
    const val = n0(v.vehicleValue), pay = n0(v.loanPayoffAmount);
    const warn = $('err-fPay');
    const showWarn = !e.fPay && val != null && pay != null && pay > val;
    warn.classList.toggle('t-hot', !showWarn);
    if (showWarn) warn.textContent = 'Payoff is above the vehicle value, so expect a negative-equity result.';
  }

  FIELDS.forEach(id => $(id).addEventListener('input', () => { if (touched) paintErrors(validate(read())); }));

  $('fClear').addEventListener('click', () => {
    FIELDS.forEach(id => { $(id).value = ''; });
    $('fLead').value = '';
    $('fLeadCtx').innerHTML = '';
    touched = false;
    paintErrors({});
    out().innerHTML = stateEmpty('No quote yet',
      'Fill in the trade-in value, the payoff, the credit score and the customer, then calculate.', 'calculate');
  });

  /* ── Quote history ─────────────────────────────────────────────────────── */
  let rows = [];
  let filter = 'all';
  let query = '';

  histCard.innerHTML = `
    <div class="card-head"><div>
      <div class="card-title">Quote history</div>
      <div class="card-sub">Every calculation is recorded, newest first, with the customer and the rep it belongs to</div>
    </div><div style="flex:1"></div>
    <button class="btn sm" id="fqRefresh"><span class="material-symbols-outlined">refresh</span> Refresh</button></div>
    <div class="toolbar">
      <input class="grow" type="search" id="fqSearch" placeholder="Search customer, tier or rep"
             aria-label="Search quote history" />
      <div class="seg" role="group" aria-label="Filter by equity">
        <button data-f="all" class="on">All</button>
        <button data-f="Positive">Positive equity</button>
        <button data-f="Negative">Negative equity</button>
      </div>
    </div>
    <div id="fqBody">${stateLoading(4)}</div>`;

  const matches = r => {
    if (filter !== 'all' && r.equity_status !== filter) return false;
    if (!query) return true;
    return [r.lead_name, r.lead_email, r.finance_tier, r.quoted_by, r.equity_status]
      .some(v => lower(v).includes(query));
  };

  function drawHistory() {
    const body = $('fqBody');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = stateEmpty('No quotes recorded yet',
        'Every calculation from this screen is stored here, with the customer and the rep it belongs to.', 'receipt_long');
      return;
    }
    const shown = rows.filter(matches);
    body.innerHTML = table([
      { label: 'When', render: r => `<span title="${esc(stamp(r.created_at))}">${ago(r.created_at)}</span>` },
      { label: 'Customer', strong: true, render: r =>
        `${esc(r.lead_name || 'Unnamed')}<div class="cell-sub">${esc(r.lead_email || 'no email recorded')}</div>` },
      { label: 'Score', align: 'r', render: r => num(r.credit_score) },
      { label: 'Value', align: 'r', render: r => aed(r.vehicle_value_aed) },
      { label: 'Payoff', align: 'r', render: r => aed(r.loan_payoff_aed) },
      { label: 'Equity', align: 'r', render: r =>
        `<span class="${eqClass(r.equity_status)}">${aed(r.equity_aed)}</span>` },
      { label: 'LTV', align: 'r', render: r => pct(r.loan_to_value_pct) },
      { label: 'Tier', render: r => (r.finance_tier ? `<span class="chip">${esc(r.finance_tier)}</span>` : '<span class="t-muted">—</span>') },
      { label: 'APR', align: 'r', render: r => pct(r.indicative_apr_pct) },
      { label: 'Quoted by', render: r =>
        `${esc(r.quoted_by || '—')}<div class="cell-sub">${esc(r.source || '')}</div>` },
    ], shown, {
      empty: stateEmpty('Nothing matches that filter',
        'No recorded quote matches the current search or equity filter.', 'filter_alt_off'),
      onRow: quoteDrawer,
    });
    wireRows(body, shown, quoteDrawer);
  }

  function drawStrip() {
    const negative = rows.filter(r => r.equity_status === 'Negative').length;
    const priced = rows.filter(r => r.equity_status).length;
    const apr = mean(rows, 'indicative_apr_pct');
    const ltv = mean(rows, 'loan_to_value_pct');
    const capped = rows.length >= HISTORY_LIMIT;
    strip.innerHTML = [
      kpi('Quotes recorded', num(rows.length),
        rows.length
          ? (capped
            ? `<span class="t-muted">Newest ${num(HISTORY_LIMIT)} shown · latest ${ago(rows[0].created_at)}</span>`
            : `<span class="t-muted">Latest ${ago(rows[0].created_at)}</span>`)
          : '<span class="t-muted">Nothing quoted from this desk yet</span>'),
      kpi('Negative equity', num(negative),
        priced
          ? `<span class="${negative ? 't-hot' : 't-ok'}">${pct(negative / priced * 100)} of ${num(priced)} quotes</span>`
          : '<span class="t-muted">No quote carries an equity status</span>',
        negative ? 't-hot' : ''),
      kpi('Avg indicative APR', pct(apr.avg),
        apr.n ? `<span class="t-muted">Across ${num(apr.n)} quotes with an APR</span>`
              : '<span class="t-muted">No quote carries an APR</span>'),
      kpi('Avg loan to value', pct(ltv.avg),
        ltv.n ? `<span class="t-muted">Across ${num(ltv.n)} quotes with an LTV</span>`
              : '<span class="t-muted">No quote carries an LTV</span>'),
    ].join('');
  }

  async function loadHistory() {
    const body = $('fqBody');
    if (body) body.innerHTML = stateLoading(4);
    strip.innerHTML = stateLoading(2);
    try {
      rows = await db(`finance_quotes?select=*&order=created_at.desc&limit=${HISTORY_LIMIT}`);
      drawStrip();
      drawHistory();
    } catch (e) {
      rows = [];
      strip.innerHTML = stateError('the quote figures', e.message);
      if (body) body.innerHTML = stateError('quote history', e.message);
    }
  }

  $('fqRefresh').addEventListener('click', loadHistory);
  $('fqSearch').addEventListener('input', e => { query = lower(e.target.value).trim(); drawHistory(); });
  histCard.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.f;
    histCard.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
    drawHistory();
  }));

  /* ── One recorded quote, in full ───────────────────────────────────────── */
  function quoteDrawer(q) {
    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1;min-width:0">
          <h2 style="font-size:18px">${esc(q.lead_name || 'Unnamed customer')}</h2>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            ${q.equity_status ? pill(q.equity_status, eqTone(q.equity_status)) : ''}
            ${q.finance_tier ? `<span class="chip">${esc(q.finance_tier)}</span>` : ''}
            ${q.source ? `<span class="chip">${esc(q.source)}</span>` : ''}
          </div>
        </div>
        <button class="btn ghost sm" id="fqClose" aria-label="Close quote">
          <span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section">
          <div class="label-caps">Quote</div>
          <dl class="kv">
            <dt>Equity</dt><dd class="num ${eqClass(q.equity_status)}"><strong>${aed(q.equity_aed)}</strong></dd>
            <dt>Indicative APR</dt><dd class="num">${pct(q.indicative_apr_pct)}</dd>
            <dt>Finance tier</dt><dd>${esc(q.finance_tier || '—')}</dd>
            <dt>Loan to value</dt><dd class="num">${pct(q.loan_to_value_pct)}</dd>
          </dl>
        </div>
        <div class="section">
          <div class="label-caps">Inputs</div>
          <dl class="kv">
            <dt>Vehicle value</dt><dd class="num">${aed(q.vehicle_value_aed)}</dd>
            <dt>Loan payoff</dt><dd class="num">${aed(q.loan_payoff_aed)}</dd>
            <dt>Credit score</dt><dd class="num">${num(q.credit_score)}</dd>
          </dl>
        </div>
        <div class="section">
          <div class="label-caps">Attribution</div>
          <dl class="kv">
            <dt>Customer</dt><dd>${esc(q.lead_name || '—')}</dd>
            <dt>Email</dt><dd>${esc(q.lead_email || '—')}</dd>
            <dt>Quoted by</dt><dd>${esc(q.quoted_by || '—')}</dd>
            <dt>Recorded</dt><dd>${esc(stamp(q.created_at))}</dd>
          </dl>
        </div>
        ${q.disclaimer ? `<div class="section">
          <div class="label-caps">Disclaimer given</div>
          <div class="quote">${esc(q.disclaimer)}</div></div>` : ''}
      </div>
      <div class="drawer-foot">
        <button class="btn" id="fqReuse">
          <span class="material-symbols-outlined">edit_note</span> Load into the calculator</button>
      </div>`);
    $('fqClose').addEventListener('click', closeDrawer);
    $('fqReuse').addEventListener('click', () => {
      $('fVal').value = n0(q.vehicle_value_aed) ?? '';
      $('fPay').value = n0(q.loan_payoff_aed) ?? '';
      $('fScore').value = n0(q.credit_score) ?? '';
      $('fName').value = q.lead_name || '';
      $('fEmail').value = q.lead_email || '';
      if (touched) paintErrors(validate(read()));
      closeDrawer();
      formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('fVal').focus();
    });
  }

  /* ── Calculate ─────────────────────────────────────────────────────────── */
  $('fGo').addEventListener('click', async () => {
    touched = true;
    const v = read();
    const errs = validate(v);
    paintErrors(errs);
    const bad = Object.keys(errs);
    if (bad.length) {
      out().innerHTML = `<div class="banner warm">
        <span class="material-symbols-outlined" style="font-size:20px">edit</span>
        <div>${bad.length === 1 ? 'One field needs fixing' : `${esc(String(bad.length))} fields need fixing`}
        before this can be sent — see the messages on the form.</div></div>`;
      $(bad[0]).focus();
      return;
    }

    const btn = $('fGo');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">hourglass_top</span> Calculating…';
    out().innerHTML = stateLoading(3);

    try {
      const r = await n8n(HOOK.finance, {
        vehicleValue: v.vehicleValue,
        loanPayoffAmount: v.loanPayoffAmount,
        creditScore: v.creditScore,
        lead_name: v.lead_name,
        lead_email: v.lead_email,
        quoted_by: ME?.name || SESSION?.user?.email || null,
      });
      renderQuote(r, v);
    } catch (e) {
      const msg = String(e?.message || e);
      out().innerHTML = /VITE_N8N_BASE_URL/.test(msg)
        ? `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">link_off</span>
             <div>${esc(NO_N8N)}</div></div>`
        : stateError('the quote', msg);
    } finally {
      btn.disabled = !N8N_BASE;
      btn.innerHTML = '<span class="material-symbols-outlined">calculate</span> Calculate quote';
    }
  });

  /* The workflow answers 200 for everything, including its own rejections, so
     the shape of the body is what decides which of the three outcomes this is:
     a rejection, an answer with no quote in it, or a quote. */
  function renderQuote(r, sent) {
    const res = r && typeof r === 'object' ? r : {};
    const listed = Array.isArray(res.errors) ? res.errors.filter(Boolean).map(String) : [];
    const rejected = lower(res.status) === 'error' || (listed.length && lower(res.status) !== 'success');

    if (rejected) {
      const unauth = listed.some(m => /unauthor|forbidden|token|jwt/i.test(m));
      out().innerHTML = `<div class="banner hot">
          <span class="material-symbols-outlined" style="font-size:20px">block</span>
          <div><strong>The finance workflow would not price this.</strong>
            <div style="margin-top:6px">${
              unauth
                ? 'It did not accept this session. Sign out and sign back in, then try again.'
                : (listed.length ? listed.map(esc).join('<br>') : 'It rejected the request without saying why.')
            }</div>
            <div class="cell-sub" style="margin-top:6px;white-space:normal">Nothing was written to the quote history.</div>
          </div></div>`;
      return;
    }

    const hasQuote = n0(res.equity_aed) != null || res.finance_tier || n0(res.indicative_apr_pct) != null;
    if (!hasQuote) {
      out().innerHTML = `<div class="banner warm">
          <span class="material-symbols-outlined" style="font-size:20px">help</span>
          <div><strong>The workflow replied, but with no quote in it.</strong>
            <div style="margin-top:6px">Nothing is shown here rather than a figure that was not returned.
              Check the Finance Calc execution in n8n.</div></div></div>`;
      return;
    }

    const ltv = n0(res.loan_to_value_pct);
    out().innerHTML = `
      <div class="grid g2">
        ${kpi('Equity', `<span class="${eqClass(res.equity_status)}">${aed(res.equity_aed)}</span>`,
          res.equity_status ? pill(res.equity_status, eqTone(res.equity_status)) : '')}
        ${kpi('Indicative APR', pct(res.indicative_apr_pct),
          res.finance_tier ? `<span class="chip">${esc(res.finance_tier)}</span>` : '')}
      </div>
      ${ltv == null ? '' : `<div style="margin-top:16px">
        <div class="label-caps" style="margin-bottom:6px">Loan to value · ${pct(ltv)}</div>
        <div class="bar"><i style="width:${Math.min(100, Math.max(0, ltv))}%;background:var(--${ltv > 80 ? 'hot' : 'primary'})"></i></div>
        ${ltv > 80 ? '<div class="cell-sub t-hot" style="margin-top:6px">Above 80% — most lenders will want a deposit.</div>' : ''}
      </div>`}
      <dl class="kv" style="margin-top:16px">
        <dt>Quoted for</dt><dd>${esc(sent.lead_name)}<div class="cell-sub">${esc(sent.lead_email)}</div></dd>
        <dt>On a value of</dt><dd class="num">${aed(sent.vehicleValue)}</dd>
        <dt>Payoff</dt><dd class="num">${aed(sent.loanPayoffAmount)}</dd>
        <dt>Credit score</dt><dd class="num">${num(sent.creditScore)}</dd>
      </dl>
      ${res.disclaimer ? `<div class="quote" style="margin-top:16px">${esc(res.disclaimer)}</div>` : ''}
      <div class="cell-sub" style="margin-top:12px;white-space:normal">
        Recorded by the workflow in finance_quotes. If it is not in the history below, refresh it.</div>`;

    /* The workflow writes the row; this screen only re-reads it. A failed
       re-read must not make a successful quote look like it failed, so the
       result above stays exactly as it is. */
    loadHistory();
  }

  /* ── Reads ─────────────────────────────────────────────────────────────── */
  await loadHistory();

  db('leads?select=id,name,email,phone,vehicle_interest,budget_aed,status&order=created_at.desc&limit=500')
    .then(leads => {
      const sel = $('fLead');
      if (!sel) return;
      const usable = leads.filter(l => l.email);
      if (!usable.length) {
        sel.innerHTML = '<option value="">No lead has an email address on file</option>';
        sel.disabled = true;
        sel.title = 'The workflow keys a quote on the customer email, and no lead in the database has one.';
        return;
      }
      sel.disabled = false;
      sel.innerHTML = '<option value="">— pick a lead, or type the customer in by hand —</option>'
        + usable.map(l => `<option value="${esc(l.email)}"
             data-name="${esc(l.name || '')}"
             data-veh="${esc(l.vehicle_interest || '')}"
             data-budget="${esc(l.budget_aed == null ? '' : l.budget_aed)}"
             data-status="${esc(l.status || '')}"
           >${esc(l.name || l.email)}${l.vehicle_interest ? ' — ' + esc(l.vehicle_interest) : ''}</option>`).join('');
      sel.addEventListener('change', e => {
        const o = e.target.selectedOptions[0];
        const ctx = $('fLeadCtx');
        if (!o || !o.value) { ctx.innerHTML = ''; return; }
        $('fEmail').value = o.value;
        $('fName').value = o.dataset.name || '';
        if (touched) paintErrors(validate(read()));
        /* Context only. The lead's budget is what they intend to spend on the
           next car — it is not the trade-in's value, so it is never written
           into the value field. */
        ctx.innerHTML = `<div class="quote">
            ${o.dataset.status ? pill(o.dataset.status) + ' ' : ''}
            ${o.dataset.veh ? `Interested in ${esc(o.dataset.veh)}. ` : ''}
            ${o.dataset.budget ? `Budget on file ${aed(o.dataset.budget)}` : 'No budget captured by the router'}
            <div class="cell-sub" style="margin-top:4px">Shown for context — the trade-in value below is a different number.</div>
          </div>`;
      });
    })
    .catch(e => {
      const sel = $('fLead');
      if (!sel) return;
      sel.innerHTML = '<option value="">Lead list unavailable</option>';
      sel.disabled = true;
      sel.title = `Leads could not be loaded (${e.message}). Type the customer name and email in by hand.`;
      $('fLeadCtx').innerHTML = `<div class="hint t-hot">Lead list unavailable — ${esc(e.message)}. Type the customer in by hand.</div>`;
    });

  db('inventory?select=*&order=model')
    .then(inv => {
      const body = $('cBody');
      if (!body) return;
      if (!inv.length) {
        body.innerHTML = stateEmpty('No inventory', 'There is no unit to compute a commission on.', 'directions_car');
        return;
      }
      const units = inv.map(deriveUnit);
      body.innerHTML = `
        <div class="field"><label for="cVeh">Vehicle</label>
          <select id="cVeh">${units.map((u, i) =>
            `<option value="${esc(String(i))}">${esc(u.model || u.id || 'Unnamed unit')}${u.status ? ' · ' + esc(u.status) : ''}</option>`).join('')}
          </select></div>
        <div id="cOut" style="margin-top:16px"></div>`;
      const sel = $('cVeh');
      const draw = () => {
        const u = units[Number(sel.value)] || units[0];
        $('cOut').innerHTML = `
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
            ${u.aging_alert ? pill(u.aging_alert) : ''}
            <span class="chip">${esc(u.id || '—')}</span>
            <span class="chip">${num(u.days_in_stock)} days in stock</span>
          </div>
          <dl class="kv">
            <dt>List price</dt><dd class="num">${aed(u.price_aed)}</dd>
            <dt>Cost</dt><dd class="num">${aed(u.cost_aed)}</dd>
            <dt>Gross margin</dt><dd class="num ${(n0(u.gross_margin) || 0) < 0 ? 't-hot' : ''}">${aed(u.gross_margin)}</dd>
            <dt>Holding cost</dt><dd class="num ${(n0(u.holding_cost_accrued) || 0) > 5000 ? 't-hot' : 't-muted'}">${aed(u.holding_cost_accrued)}</dd>
            <dt>Net margin</dt><dd class="num"><strong class="${(n0(u.net_margin) || 0) < 0 ? 't-hot' : ''}">${aed(u.net_margin)}</strong></dd>
            <dt>VAT</dt><dd class="num">${aed(u.vat_amount)}</dd>
            <dt>Commission</dt><dd class="num" style="font-size:18px;font-weight:600">${aed(u.recommended_commission)}</dd>
          </dl>
          <div class="cell-sub" style="margin-top:10px;white-space:normal">
            Recomputed here from the unit's acquisition date, list price and cost, so it matches Inventory
            even between nightly recomputes.</div>`;
      };
      sel.addEventListener('change', draw);
      draw();
    })
    .catch(e => {
      const body = $('cBody');
      if (body) body.innerHTML = stateError('inventory', e.message);
    });
};
