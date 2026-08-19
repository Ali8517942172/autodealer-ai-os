/* NEXUS OS — lib/prefs.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */

function applyDensity() {
  document.body.classList.toggle('compact', (localStorage.getItem('nexus.density') || 'comfortable') === 'compact');
}

/* ==========================================================================
   Auth + boot
   ========================================================================== */

export { applyDensity };
