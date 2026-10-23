// katya-pr/2.0-twin-app/twin-window-logic.mjs — the PURE window-distinction + no-/key decisions for the
// Cleo 2 TWIN app (live-parallel-twin.md §6/F8). Zero DOM, zero window — node-importable so CI unit-tests
// these guarantees; the DOM boot (twin-window.js) imports THIS and only wires it into the app.
//
// WHY (F8, the retained paired-shadow guarantees the twin does NOT dissolve): two PIXEL-IDENTICAL apps sit
// side by side — Cleo 1 sends, Cleo 2 (this window) NEVER does. The whole residual is human mis-read across
// two identical windows, plus the muscle-memory `/key` paste landing in the wrong app. So the twin window
// carries a persistent distinction treatment and refuses `/key` in its composer.

// TWIN_BANNER — the persistent window banner. States the two facts a director must never mis-read: this is
// the TWIN, and it never sends.
export const TWIN_BANNER = 'CLEO 2 — TWIN · never sends';
export function twinBannerText() { return TWIN_BANNER; }

// keyControlVisibleForTwin — the /key composer affordance is ALWAYS hidden in the twin app (no-/key rule).
// Unlike the paired-shadow section (hidden per-room), the ENTIRE twin app hides it.
export function keyControlVisibleForTwin() { return false; }

// detectSecretDropSyntax(text) — true iff the composer text is a `/key …` secret-drop command (the
// muscle-memory hazard: the director is now the copier, so a `/key` meant for Cleo 1 lands here). Matched on
// the `/key` command form the sidecar's parseKeyCommand consumes — leading whitespace tolerated, case-
// insensitive. Detect → REFUSE (never post it): a `/key` typed into a twin room is plaintext-at-rest in
// cleo2-shadow-1 + her next-turn context, and the secret belongs out-of-band under the cleo2-own store.
export function detectSecretDropSyntax(text) {
  return typeof text === 'string' && /^\s*\/key\b/i.test(text);
}

// refuseSecretDropText — the composer refusal shown when detectSecretDropSyntax fires. Names the correct
// path (out-of-band, cleo2-own store) and never echoes the typed value.
export function refuseSecretDropText() {
  return '🔒 Secret drops are disabled in the Cleo 2 twin. Provision credentials out-of-band under the cleo2 user’s own store (~/.cleo2-secrets) — never /key here.';
}

// isWouldSend(msg) — a surfaced client draft that was NOT put on the wire (kernel/shadow-send.mjs writes
// these as type:'would-send' with wouldSend:true). The twin marks each with a NOT-sent chip.
export function isWouldSend(msg) {
  return !!msg && (msg.wouldSend === true || msg.type === 'would-send');
}

// notSentChip(msg) — the chip descriptor for a WOULD-SEND bubble (null for anything else). Rendered by the
// DOM boot as a small "NOT sent" pill so a confident draft is never mistaken for a real client send.
export function notSentChip(msg) {
  if (!isWouldSend(msg)) return null;
  return { label: 'NOT sent', title: 'A draft surfaced for review — nothing left the twin (this window never sends).' };
}

// bubbleTintClass(msg) — the per-bubble tint class(es). Cleo 2's own messages (from:'brain'/'cleo') get the
// twin tint; a WOULD-SEND additionally gets the would-send tint. A director's own message gets neither (so
// the tint reads as "the twin produced this", the thing that must not be mis-read as a real action).
export function bubbleTintClass(msg) {
  const from = msg && msg.from;
  const hers = from === 'brain' || from === 'cleo';
  const parts = [];
  if (hers) parts.push('twin-bubble');
  if (isWouldSend(msg)) parts.push('twin-would-send');
  return parts.join(' ');
}

// ── Window identity (C1 / C2) — the two-window "which one am I looking at" distinction ──────────────────
// Running two PIXEL-IDENTICAL apps side by side, the fastest tell — especially on mobile, where you switch
// by tab thumbnail and the browser chrome is the biggest coloured surface — is a per-window IDENTITY: a
// colour, a labelled favicon, and the mobile theme-colour. UNLIKE the twin-only banner/tint, this applies to
// BOTH windows: Cleo 1 = C1 (blue), the Cleo 2 twin = C2 (amber). Pure here; twin-window.js paints it.
export const WINDOW_IDENTITY = {
  c1: { key: 'C1', label: 'C1', name: 'Cleo 1',        color: '#2563EB', ink: '#ffffff' }, // blue — the live one
  c2: { key: 'C2', label: 'C2', name: 'Cleo 2 · TWIN', color: '#F59E0B', ink: '#1a1200' }, // amber — the draft twin
};

// windowIdentity(isTwin) — the identity for this window. Amber C2 for the twin, blue C1 otherwise.
export function windowIdentity(isTwin) { return isTwin ? WINDOW_IDENTITY.c2 : WINDOW_IDENTITY.c1; }

// faviconSvg(id) — a self-contained SVG favicon: a rounded square in the identity colour with the C1/C2
// label. Raw markup (the DOM boot encodes it into a data: URI). Scales crisply in desktop + mobile tabs.
export function faviconSvg(id) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
    + `<rect width="64" height="64" rx="14" fill="${id.color}"/>`
    + `<text x="32" y="45" font-family="system-ui,-apple-system,Segoe UI,Arial,sans-serif" `
    + `font-size="33" font-weight="700" text-anchor="middle" fill="#ffffff">${id.label}</text></svg>`;
}

// faviconDataUri(id) — faviconSvg as a data: URI ready for a <link rel="icon" type="image/svg+xml">.
export function faviconDataUri(id) { return 'data:image/svg+xml;utf8,' + encodeURIComponent(faviconSvg(id)); }

// titleWithIdentity(id, title) — prefix the tab title with the identity key ("C1 · …"), idempotently, so the
// window is named in the tab list too. Never double-prefixes.
export function titleWithIdentity(id, title) {
  const base = String(title || 'Cleo').replace(/^C[12] · /, '');
  return `${id.key} · ${base}`;
}

// resolveIsTwin({ search, storage }) — is THIS window the twin? Reads `?twin=1`, but makes it STICKY per tab.
// WHY: the app's version-check reloads with a cache-bust `location.href = …?reload=<ts>…`, which OVERWRITES
// the query string — so a plain `?twin=1` read reverts to C1 after the first auto-reload (observed live).
// Fix: once we've seen twin=1, remember it in sessionStorage (scoped to THIS tab, survives reloads + same-
// origin navigations). A separate Cleo 1 tab — no `?twin=1`, no flag — stays C1. `storage` is injected so
// this is unit-testable; pass `sessionStorage` (never localStorage — that would leak twin mode across tabs).
export const TWIN_STICKY_KEY = 'eo-twin';
export function resolveIsTwin({ search = '', storage = null } = {}) {
  let fromQuery = false;
  try { fromQuery = new URLSearchParams(search).get('twin') === '1'; } catch { fromQuery = false; }
  let fromStore = false;
  try { fromStore = !!storage && storage.getItem(TWIN_STICKY_KEY) === '1'; } catch { fromStore = false; }
  const isTwin = fromQuery || fromStore;
  if (isTwin && storage) { try { storage.setItem(TWIN_STICKY_KEY, '1'); } catch { /* private-mode: fall back to query */ } }
  return isTwin;
}
