/* NEXUS OS — lib/states.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { esc } from './format.js';

const stateEmpty = (title, body, icon = 'inbox') =>
  `<div class="state"><span class="material-symbols-outlined">${icon}</span><h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
const stateError = (what, err, retry) =>
  `<div class="state err"><span class="material-symbols-outlined">error</span><h3>Couldn't load ${esc(what)}</h3>
   <p>${esc(err)}</p>${retry ? `<button class="btn" data-retry="${esc(retry)}">Retry</button>` : ''}</div>`;
const stateLoading = (rows = 5) =>
  `<div style="padding:20px">${Array.from({length:rows}, (_,i) =>
    `<div class="skeleton" style="height:16px;margin-bottom:12px;width:${95 - i*7}%"></div>`).join('')}</div>`;
const noSource = msg =>
  `<div class="state"><span class="material-symbols-outlined">link_off</span><h3>No data source yet</h3><p>${esc(msg)}</p></div>`;

/* ── Data access ─────────────────────────────────────────────────────────── */

export { stateEmpty, stateError, stateLoading, noSource };
