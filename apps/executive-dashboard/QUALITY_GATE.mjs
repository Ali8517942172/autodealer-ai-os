/* Quality gate for the enhanced screens.
 *
 * This is NOT the earlier equivalence test — the screens are supposed to differ
 * now. This checks the things that must stay true no matter what an agent did:
 *   1. the bundle builds
 *   2. the app boots and still registers all 14 screens
 *   3. every screen renders with zero page errors
 *   4. every screen produces real content, and none collapses into its error state
 *   5. nobody invented data or reached outside the helper contract
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const SCREEN_IDS = ['overview', 'leads', 'conversations', 'compliance', 'inventory',
                    'competitors', 'ask', 'finance', 'customers', 'campaigns',
                    'deals', 'automation', 'team', 'settings'];

// ---------- 5. static lint over the source, before we even build --------------
const BANNED = [
  [/Math\.random\s*\(/,                 'Math.random() — invented data'],
  [/\bfetch\s*\(/,                      'raw fetch() — must go through db/dbWrite/n8n'],
  [/<style[\s>]/i,                      'inline <style> block — styles.css owns styling'],
  [/localStorage\./,                    'direct localStorage — lib/prefs.js owns that'],
  [/from\s+['"]https?:/,                'remote import'],
];
const lint = [];
const dir = new URL('./screens/', import.meta.url).pathname;
for (const f of (await readdir(dir)).filter(f => f.endsWith('.js'))) {
  const src = await readFile(join(dir, f), 'utf8');
  // strip comments so a rule named in a comment is not a false positive
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  for (const [re, why] of BANNED) if (re.test(code)) lint.push(`${f}: ${why}`);
  if (!/SCREENS\.\w+\s*=/.test(code)) lint.push(`${f}: no SCREENS.<id> registration`);
}

function serve(root, port) {
  return new Promise(res => {
    const s = createServer(async (req, rq) => {
      const p = join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      try {
        const b = await readFile(p);
        rq.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
        rq.end(b);
      } catch { rq.writeHead(404); rq.end('nope'); }
    });
    s.listen(port, () => res(s));
  });
}

const ROW = {
  id: '00000000-0000-4000-8000-000000000001', customer_id: '25',
  name: 'Test Row', lead_name: 'Test Row', full_name: 'Test Row',
  email: 'ali@example.com', lead_email: 'ali@example.com', phone: '+971500000000',
  role: 'senior_rep', status: 'HOT', verdict: 'APPROVED', health: 'DEGRADED',
  direction: 'inbound', message: 'hello there', channel: 'whatsapp',
  ai_score: 88, lead_score: 88, confidence_score: 91, success_rate: 64.8,
  runs: 71, failures: 25, runs_30d: 71, failures_30d: 25,
  budget_aed: 280000, list_price_aed: 115000, cost_price_aed: 95000,
  sale_price_aed: 275000, price_aed: 120000, net_margin: 12000,
  holding_cost_accrued: 2400, days_in_stock: 130, aging_alert: 'CRITICAL',
  make: 'Toyota', model: 'Land Cruiser', year: 2024, stock_id: 'ST-001',
  vehicle: '2024 Toyota Land Cruiser', vehicle_interest: '2024 Toyota Land Cruiser',
  title: 'Refund policy', category: 'Lead', trigger_type: 'webhook',
  is_active: true, writes_audit_log: true, workflow: 'WhatsApp BDC Agent',
  summary: 'Completed', total_emails: 3, total_slack_messages: 1,
  storage_path: 'kyc/x/2026/08/a.jpg', retain_until: '2033-08-17', purged_at: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  logged_at: '2026-08-01T00:00:00Z', last_run: '2026-08-17T00:00:00Z',
  last_failure: '2026-08-17T00:00:00Z', acquired_at: '2026-04-01T00:00:00Z',
  last_synced_at: '2026-08-18T00:00:00Z', snapshot_date: '2026-08-19',
};

async function run(port) {
  /* This container ships a prebuilt Chromium at a fixed path; a normal checkout
     uses whatever `npx playwright install chromium` put where Playwright expects
     it. Honour an explicit override, fall back to the container's copy when it
     is there, otherwise let Playwright resolve its own. */
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH
    || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
  const browser = await chromium.launch(explicit ? { executablePath: explicit } : {});
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text());
  });
  await page.route('https://fonts.googleapis.com/**', r =>
    r.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await page.route('https://example.supabase.co/auth/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: 'u1', email: 'ali@example.com', role: 'authenticated' }) }));
  await page.route('https://example.supabase.co/rest/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([ROW, ROW]) }));
  await page.route('https://example.invalid/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ output: 'stubbed answer', sources: [] }) }));
  await page.addInitScript(() => {
    localStorage.setItem('sb-example-auth-token', JSON.stringify({
      access_token: 'stub.jwt.token', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
      user: { id: 'u1', email: 'ali@example.com', aud: 'authenticated',
              app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const loggedIn = await page.evaluate(() =>
    !document.getElementById('app').classList.contains('hide'));
  const nav = await page.evaluate(() => document.querySelectorAll('.nav-item').length);

  const screens = {};
  for (const id of SCREEN_IDS) {
    const before = errs.length;
    await page.evaluate(i => { location.hash = i; window.dispatchEvent(new HashChangeEvent('hashchange')); }, id);
    await page.waitForTimeout(700);
    screens[id] = await page.evaluate(() => {
      const h = document.getElementById('screen').innerHTML;
      return {
        len: h.length,
        cards: document.querySelectorAll('#screen .card').length,
        buttons: document.querySelectorAll('#screen button').length,
        stuckLoading: document.querySelectorAll('#screen .skeleton').length > 0,
        errored: /Couldn.t load/.test(h),
      };
    });
    screens[id].newErrors = errs.length - before;
  }
  await browser.close();
  return { loggedIn, nav, screens, errs };
}

const srv = await serve(new URL('./dist/', import.meta.url).pathname, 8071);
const r = await run(8071);
srv.close();

console.log('=== static lint ===');
console.log(lint.length ? lint.map(l => '  FAIL ' + l).join('\n') : '  clean');
console.log(`\n=== boot ===\n  loggedIn=${r.loggedIn}  navItems=${r.nav}  totalPageErrors=${r.errs.length}`);
if (r.errs.length) console.log(r.errs.slice(0, 12).map(e => '  ' + e.slice(0, 160)).join('\n'));

console.log('\nscreen           chars  cards  btns  stuck  errState  newErrs');
let bad = 0;
for (const id of SCREEN_IDS) {
  const s = r.screens[id];
  const fail = s.len < 200 || s.errored || s.newErrors > 0 || s.stuckLoading;
  if (fail) bad++;
  console.log(
    `${id.padEnd(15)} ${String(s.len).padStart(6)} ${String(s.cards).padStart(6)}` +
    ` ${String(s.buttons).padStart(5)} ${String(s.stuckLoading).padStart(6)}` +
    ` ${String(s.errored).padStart(9)} ${String(s.newErrors).padStart(8)}` +
    (fail ? '   <-- FAIL' : ''));
}
console.log(`\nscreens failing: ${bad}/${SCREEN_IDS.length}   lint failures: ${lint.length}`);
process.exit(bad === 0 && lint.length === 0 && r.loggedIn && r.nav === 14 ? 0 : 1);
