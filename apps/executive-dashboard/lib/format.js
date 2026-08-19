/* NEXUS OS — lib/format.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { $ } from './dom.js';

function esc(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
const nf = new Intl.NumberFormat('en-AE');
const n0 = v => (v == null || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
const num  = v => { const x = n0(v); return x == null ? '—' : nf.format(Math.round(x)); };
const aed  = v => { const x = n0(v); return x == null ? '—' : 'AED ' + nf.format(Math.round(x)); };
const aedSigned = v => { const x = n0(v); if (x == null) return '—'; return (x < 0 ? '−' : '+') + 'AED ' + nf.format(Math.abs(Math.round(x))); };
const pct  = v => { const x = n0(v); return x == null ? '—' : x.toFixed(1) + '%'; };
const mins = v => {
  const x = n0(v);
  if (x == null) return '—';
  /* Deliberately stays in minutes up to 2 h. The 5-minute rule is the founding
     promise of this product; "73 min" is uncomfortable in a way "1.2 h" is not,
     and that discomfort is the point. */
  if (x < 120) return `${Math.round(x)} min`;
  return `${(x / 60).toFixed(1)} h`;
};

function ago(ts) {
  if (!ts) return '—';
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (Number.isNaN(d)) return '—';
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d/60)} m ago`;
  if (d < 86400) return `${Math.floor(d/3600)} h ago`;
  if (d < 2592000) return `${Math.floor(d/86400)} d ago`;
  /* Stay relative past 30 days. The Age column was switching to an absolute
     date mid-list ("29 d ago" then "7 Jul 2026"), so two rows one day apart
     looked unrelated and could not be compared at a glance. */
  const mo = Math.floor(d / 2592000);
  if (mo < 12) return `${mo} mo ago`;
  return `${Math.floor(mo / 12)} y ago`;
}
const clock = ts => ts ? new Date(ts).toLocaleTimeString('en-GB', { hour12:false }) : '--:--:--';
const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0]).join('').toUpperCase();

const TONE = { HOT:'hot', WARM:'warm', COLD:'cold', GOOD:'ok', OK:'ok', SUCCESS:'ok', APPROVED:'ok',
               FAILED:'hot', REJECTED:'hot', ESCALATED:'warm', PENDING:'warm', CRITICAL:'hot' };
const tone = s => TONE[String(s || '').toUpperCase()] || '';
const pill = (label, t) => `<span class="pill ${t || tone(label)}"><span class="dot"></span>${esc(label)}</span>`;

/* ── States. Every panel has all four; a panel without them is not done. ─── */

export { esc, nf, n0, num, aed, aedSigned, pct, mins, ago, clock, initials, TONE, tone, pill };
