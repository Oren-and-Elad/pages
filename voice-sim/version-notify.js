// version-notify.js — "new version → refresh, silently" for the elad-and-oren console.
//
// Self-contained on purpose: one module, one <script> include. index.html / logic.js may be rewritten by a
// concurrent redesign, so this file weaves into NOTHING — it reads the baked version from a <meta> tag and
// version.json (both produced by stamp-version.mjs), makes one PURE decision (exported + unit-tested), and owns
// every side effect itself (reload, the one-reload guard). Any fetch/parse error ⇒ do nothing; the
// page is never broken by an update check.
//
// No "What's new" popup (removed 2 Oct 2026): it showed a version id and raw commit subjects (ADR ids, PR
// numbers, code words) to a director on every refresh. A director needs the latest page, not a release note;
// what changed is told in plain words in the thread that asked for it. The decision
// (imported by tests/unit/version-notify-logic.spec.mjs):
//   shouldReload(baked, live, alreadyReloaded) — the live deploy is newer than the shell we're running AND
//       we haven't already burned our one reload for this exact live version (loop guard). Dev shells
//       (baked === null) never reload.

// ── pure decisions (no DOM, no storage, no fetch — safe to import under node:test) ───────────────────────

export function shouldReload(baked, live, alreadyReloaded = false) {
  if (!live) return false;           // no / failed version.json → nothing to compare against
  if (!baked) return false;          // unstamped dev shell → never self-reload
  if (live === baked) return false;  // already on the live version
  if (alreadyReloaded) return false; // one reload per live version per tab — never loop
  return true;
}

// ── everything below is browser-only; guarded so importing this module in node is a no-op ────────────────
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const RELOAD_GUARD = (v) => 'cleo-reloaded-' + v; // sessionStorage: burned our one reload for version v
  const get = (key) => { try { return window.sessionStorage?.getItem(key); } catch { return null; } };
  const set = (key, val) => { try { window.sessionStorage?.setItem(key, val); } catch { /* private mode */ } };

  function bakedVersion() {
    const meta = document.querySelector('meta[name="app-version"]');
    const v = meta && meta.getAttribute('content');
    if (!v || v.indexOf('__') === 0) return null; // unstamped placeholder → dev shell
    return v;
  }

  async function run() {
    let live;
    try {
      // cache:'no-store' + a cache-buster: the service worker passes non-navigate GETs straight through, so
      // this always sees the freshly deployed version.json.
      const r = await fetch('./version.json?_=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      live = (await r.json()).version || null;
    } catch { return; } // offline / not deployed / bad JSON → do nothing, never break the page

    if (shouldReload(bakedVersion(), live, get(RELOAD_GUARD(live)) === '1')) {
      set(RELOAD_GUARD(live), '1'); // set BEFORE reload so the reloaded tab won't loop
      location.reload();
    }
  }

  // Run once the DOM (and the <meta>) is ready.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}
