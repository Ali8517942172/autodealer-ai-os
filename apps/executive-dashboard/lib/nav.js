/* NEXUS OS — lib/nav.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { $, el } from './dom.js';
import { esc } from './format.js';
import { stateError } from './states.js';
import { closeDrawer } from './ui.js';

const NAV = [
  { group: 'Work', items: [
    { id:'overview',      title:'Overview',        icon:'dashboard' },
    { id:'leads',         title:'Leads',           icon:'person_search' },
    { id:'conversations', title:'Conversations',   icon:'forum' },
    { id:'compliance',    title:'Compliance',      icon:'verified_user' },
  ]},
  { group: 'Assets', items: [
    { id:'inventory',   title:'Inventory',   icon:'directions_car' },
    { id:'competitors', title:'Competitors', icon:'trending_up' },
  ]},
  { group: 'Intelligence', items: [
    { id:'ask',      title:'Ask AI',        icon:'auto_awesome' },
    { id:'finance',  title:'Finance Desk',  icon:'calculate' },
    { id:'customers',title:'Customer 360',  icon:'contacts' },
  ]},
  { group: 'Operations', items: [
    { id:'campaigns',  title:'Campaigns', icon:'campaign' },
    { id:'deals',      title:'Deals',     icon:'handshake' },
    { id:'automation', title:'Automation', icon:'account_tree' },
    { id:'team',       title:'Team',       icon:'groups' },
  ]},
  { group: '', items: [
    { id:'settings', title:'Settings', icon:'settings' },
  ]},
];
const SCREENS = {};
const flatNav = () => NAV.flatMap(g => g.items);

let current = 'overview';

function buildNav() {
  const nav = $('nav');
  nav.innerHTML = '';
  NAV.forEach(group => {
    const wrap = el('div', 'nav-group');
    if (group.group) wrap.appendChild(el('div', 'nav-group-label', esc(group.group)));
    group.items.forEach(item => {
      const b = el('button', 'nav-item', `<span class="material-symbols-outlined">${item.icon}</span><span>${esc(item.title)}</span><span class="nav-badge hide" id="badge-${item.id}"></span>`);
      b.dataset.screen = item.id;
      b.addEventListener('click', () => go(item.id));
      wrap.appendChild(b);
    });
    nav.appendChild(wrap);
  });
}

function go(id) {
  if (!SCREENS[id]) id = 'overview';
  current = id;
  location.hash = id;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.screen === id));
  $('pageTitle').textContent = flatNav().find(i => i.id === id)?.title || 'NEXUS OS';
  closeDrawer();
  const host = $('screen');
  host.innerHTML = '';
  Promise.resolve(SCREENS[id](host)).catch(e => { host.innerHTML = stateError('this screen', e.message); });
}

/* ── Drawer ──────────────────────────────────────────────────────────────── */

export { NAV, SCREENS, flatNav, current, buildNav, go };
