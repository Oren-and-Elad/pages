// public/elad-and-oren/twin-window.js — the Cleo 2 TWIN window-distinction treatment (live-parallel-twin.md
// §6/F8), applied to the SECOND app instance (the same Katya app pointed at cleo2-shadow-1). It is the twin
// analogue of shadow-section.js: additive, host-hook driven, and it imports the PURE decisions from
// twin-window-logic.mjs (which CI unit-tests) so this file only wires them into the DOM.
//
// It does three things, all cosmetic-but-safety-critical (the residual F8 names is human mis-read):
//   1. a persistent window banner "CLEO 2 — TWIN · never sends" pinned at the top of the app;
//   2. a body class so every one of Cleo 2's bubbles carries a tint + a "NOT sent" chip on WOULD-SENDs;
//   3. a composer interceptor that DETECTS-AND-REFUSES `/key …` (the no-/key rule — the director is the
//      copier now, so muscle-memory `/key` can land in this window).
//
// NOTE (build session): prepared against the read-only katya-snapshot; the twin app applies + tests it. The
// host hooks it depends on are the same window.__eo surface shadow-section.js uses, plus a composer hook.
import {
  TWIN_BANNER, keyControlVisibleForTwin, detectSecretDropSyntax, refuseSecretDropText,
  isWouldSend, notSentChip, bubbleTintClass,
  WINDOW_IDENTITY, windowIdentity, faviconDataUri, titleWithIdentity,
} from './twin-window-logic.mjs';

// applyWindowIdentity — call ONCE at app bootstrap in BOTH windows (unlike bootTwinWindow, this runs whether
// or not isTwin, so Cleo 1 is C1 and the twin is C2). Makes the two unmistakable side by side on desktop (tab
// favicon + title) AND mobile (favicon + browser-chrome theme-colour + a top accent strip). Purely additive;
// depends on no app CSS. Returns the identity so specs/callers can assert.
export function applyWindowIdentity({ doc = document, isTwin = (window.__eo && window.__eo.isTwin) } = {}) {
  const id = windowIdentity(isTwin);
  const head = doc.head || doc.documentElement;
  // 1) favicon — replace any existing icon link(s) with the C1/C2 badge (desktop + mobile tabs).
  doc.querySelectorAll('link[rel~="icon"]').forEach((l) => l.parentNode && l.parentNode.removeChild(l));
  const icon = doc.createElement('link');
  icon.rel = 'icon'; icon.type = 'image/svg+xml'; icon.href = faviconDataUri(id);
  head.appendChild(icon);
  // 2) theme-colour — colours the mobile browser chrome / PWA status bar (the strongest mobile signal).
  let meta = doc.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = doc.createElement('meta'); meta.setAttribute('name', 'theme-color'); head.appendChild(meta); }
  meta.setAttribute('content', id.color);
  // 3) a fixed top accent strip — an unmissable coloured frame on desktop and mobile alike.
  let strip = doc.getElementById('eo-window-accent');
  if (!strip) {
    strip = doc.createElement('div');
    strip.id = 'eo-window-accent'; strip.setAttribute('aria-hidden', 'true');
    strip.style.cssText = 'position:fixed;top:0;left:0;right:0;height:5px;z-index:2147483647;pointer-events:none';
    doc.body.prepend(strip);
  }
  strip.style.background = id.color;
  // 4) tab-title prefix so the window is named in the tab list too (idempotent).
  doc.title = titleWithIdentity(id, doc.title);
  return id;
}

// bootTwinWindow — call once at app bootstrap in the TWIN app only (never in Cleo 1's app). `isTwin` gates
// everything: false ⇒ ZERO twin DOM (the app is pixel-identical). Returns the banner element (or null when
// inert) so specs can assert.
export function bootTwinWindow({ doc = document, isTwin = (window.__eo && window.__eo.isTwin) } = {}) {
  if (!isTwin) return null;                            // not the twin ⇒ no treatment at all
  doc.body.classList.add('cleo2-twin');               // (2) the body class every bubble tint keys off

  // (1) the persistent banner — pinned, high-contrast, unmissable across two identical windows.
  let banner = doc.getElementById('twin-banner');
  if (!banner) {
    banner = doc.createElement('div');
    banner.id = 'twin-banner';
    banner.className = 'twin-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = TWIN_BANNER;
    // Paint it in the C2 identity colour (amber) inline, so the twin banner is unmistakable regardless of
    // the app's own CSS — it matches the C2 favicon / theme-colour / accent strip.
    banner.style.background = WINDOW_IDENTITY.c2.color;
    banner.style.color = WINDOW_IDENTITY.c2.ink;
    banner.style.fontWeight = '700';
    banner.style.textAlign = 'center';
    banner.style.padding = '6px 10px';
    doc.body.prepend(banner);
  }

  // (3) hide the /key affordance + intercept the composer: detect-and-refuse a secret-drop before it posts.
  const keyCtl = doc.getElementById('key-control');
  if (keyCtl && !keyControlVisibleForTwin()) keyCtl.style.display = 'none';
  return banner;
}

// twinComposerGuard(text) — the composer's pre-send hook. Returns { allow:true } to post, or
// { allow:false, notice } to block a `/key` drop and show the refusal (never posts, never echoes the value).
export function twinComposerGuard(text) {
  if (detectSecretDropSyntax(text)) return { allow: false, notice: refuseSecretDropText() };
  return { allow: true };
}

// decorateTwinBubble(el, msg) — apply the per-bubble tint + append a NOT-sent chip on a WOULD-SEND. Called
// by the message renderer for each of Cleo 2's bubbles. Pure DOM over the logic decisions; no-op for a
// director's own bubble.
export function decorateTwinBubble(el, msg, { doc = document } = {}) {
  const tint = bubbleTintClass(msg);
  if (tint) el.classList.add(...tint.split(' ').filter(Boolean));
  const chip = notSentChip(msg);
  if (chip) {
    const pill = doc.createElement('span');
    pill.className = 'twin-not-sent-chip';
    pill.textContent = chip.label;
    pill.title = chip.title;
    el.appendChild(pill);
  }
  return el;
}

export { isWouldSend };
