// katya-pr/2.0-twin-app/twin-connect-logic.mjs — the PURE connection/auth decisions for the Cleo 2 TWIN
// app's link to the SHADOW project (OBL-TWIN-APP-CONNECT · live-parallel-twin.md §3/§7 · Fable A24 F6).
// Zero DOM, zero Firebase, zero window — node-importable so CI unit-tests these guarantees; the DOM glue
// (twin-connect.js) imports THIS and only wires it into the app.
//
// WHY THIS EXISTS (F6): the stale `2.0-shadow-app-section/` subscribes `cleo2-rooms` on the SINGLE
// general-4686c handle — but isolation v2 MOVED that namespace to `cleo2-shadow-1`. So the twin window must
// init a SECOND Firebase app for the shadow project, authenticate it in its own right
// (`signInWithCredential`, reusing the director's Google credential), and subscribe `cleo2-rooms` on the
// SHADOW handle. The load-bearing risk F6 names is the SILENT iOS-standalone-PWA auth failure: on iOS PWAs
// Firebase Auth persistence (IndexedDB) can fail with neither a thrown error nor an auth-state change — the
// pane would sit BLANK forever, read as "Cleo 2 had nothing to say". This module's state machine makes that
// failure EXPLICIT and VISIBLE (never a blank pane).
//
// READ + DISTINCTION ONLY. The twin window wires NO send path. This module exposes read-subscription
// descriptors and NO write verb; the `no-write` unit spec greps twin-connect.js for write calls.

// ── project identity — the twin points at the SHADOW project, never Cleo 1's ─────────────────────────────
export const SHADOW_PROJECT_ID = 'cleo2-shadow-1';
export const PRIMARY_PROJECT_ID = 'general-4686c';
// The named SECOND Firebase app instance. A DISTINCT name is mandatory: initializeApp with the default name
// twice throws, and — more importantly — a distinct instance keeps the shadow app's auth/persistence from
// colliding with Cleo 1's app on general-4686c (two projects, two auth states in one browser).
export const SHADOW_APP_NAME = 'cleo2-twin';

// ── the READ-ONLY subscription surface (wire NO send path) ───────────────────────────────────────────────
// The room list is `cleo2-rooms`; opening a room streams these subcollections. All READ-ONLY (onSnapshot).
export const SHADOW_ROOMS_COLLECTION = 'cleo2-rooms';
export const SHADOW_ROOM_SUBCOLLECTIONS = Object.freeze(['messages', 'turns', 'cards']);
// shadowRoomSubPath — the read path for one room's subcollection. Pure; the DOM glue passes it to
// collection()/onSnapshot. Throws on an unknown subcollection so a typo can never widen the read surface.
export function shadowRoomSubPath(roomId, sub) {
  if (!roomId || typeof roomId !== 'string') throw new Error('shadowRoomSubPath: roomId required');
  if (!SHADOW_ROOM_SUBCOLLECTIONS.includes(sub)) throw new Error(`shadowRoomSubPath: ${sub} is not a read subcollection (${SHADOW_ROOM_SUBCOLLECTIONS.join('|')})`);
  return `${SHADOW_ROOMS_COLLECTION}/${roomId}/${sub}`;
}

// ── shadow Firebase config validation ────────────────────────────────────────────────────────────────────
// The twin's config MUST be the shadow project, complete, and NOT the primary (a copy-paste of Cleo 1's
// config here would point the "twin" window straight back at general-4686c — the exact stale-package bug).
// `fbConfig` is a FIREBASE web config (apiKey/authDomain/projectId/appId), NOT cleo.config.json — named so
// the M1 config-schema sweep never mistakes these Firebase keys for top-level cleo config keys.
const REQUIRED_CONFIG_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];
export function validateShadowConfig(fbConfig) {
  const errors = [];
  if (!fbConfig || typeof fbConfig !== 'object') return { ok: false, errors: ['shadow firebase config is missing'] };
  for (const k of REQUIRED_CONFIG_KEYS) if (!fbConfig[k]) errors.push(`missing ${k}`);
  const pid = fbConfig.projectId;
  if (pid && pid === PRIMARY_PROJECT_ID) {
    errors.push(`projectId is ${PRIMARY_PROJECT_ID} — that is Cleo 1's project; the twin must point at ${SHADOW_PROJECT_ID}`);
  } else if (pid && pid !== SHADOW_PROJECT_ID) {
    errors.push(`projectId is ${pid} — expected the shadow project ${SHADOW_PROJECT_ID}`);
  }
  return { ok: errors.length === 0, errors };
}

// ── the auth state machine (F6 — the silent-iOS-PWA failure made explicit) ───────────────────────────────
// AUTH_TIMEOUT_MS: how long we wait for a shadow user before we DECLARE the silent failure. iOS-PWA auth
// that is going to succeed produces a user in well under this; a hang past it is the failure we must surface.
export const AUTH_TIMEOUT_MS = 8000;

// classifyShadowAuth — the single decision the DOM glue polls. Inputs (all optional):
//   user       — the shadow app's currentUser (truthy ⇒ connected)
//   error      — a thrown/rejected auth error ({ code?, message? })
//   credential — the reusable Google credential fed to signInWithCredential. `null` = the primary sign-in
//                yielded no reusable credential (the iOS redirect-flow case); `undefined` = not yet resolved
//   elapsedMs / timeoutMs — the watchdog: no user, no error, past the timeout ⇒ the SILENT failure
// Returns { state: 'connected'|'connecting'|'auth-failed', reason?, code? }. `auth-failed` is NEVER blank —
// connectionMessage() turns each reason into visible text.
export function classifyShadowAuth({ user = null, error = null, credential = undefined, elapsedMs = 0, timeoutMs = AUTH_TIMEOUT_MS } = {}) {
  if (user) return { state: 'connected' };
  if (error) return { state: 'auth-failed', reason: 'error', code: error.code || null };
  if (credential === null) return { state: 'auth-failed', reason: 'no-credential' };
  if (elapsedMs >= timeoutMs) return { state: 'auth-failed', reason: 'silent-timeout' };
  return { state: 'connecting' };
}

// connectionMessage — the VISIBLE pane text for a classifyShadowAuth status. Returns null ONLY when
// connected (rooms render, no banner needed); for every other state it returns { level, title, body } so
// the pane is NEVER blank (F6). The `auth-failed` copy names the cause and a concrete remedy, and always
// reassures that Cleo 1 is unaffected.
const AUTH_FAILED_CAUSE = {
  'silent-timeout': 'Sign-in to the shadow project did not complete. This is the known iOS standalone-PWA Firebase Auth failure — auth persistence can fail silently with no error.',
  'no-credential': 'The main-app Google sign-in returned no reusable credential (the iOS redirect flow). The twin cannot sign in to the shadow project without it.',
  'error': 'Shadow-project sign-in failed.',
};
export function connectionMessage(status = {}) {
  switch (status.state) {
    case 'connected':
      return null;
    case 'connecting':
      return { level: 'info', title: 'Cleo 2 (twin) — connecting…', body: `Signing in to the shadow project (${SHADOW_PROJECT_ID}).` };
    case 'auth-failed': {
      const cause = AUTH_FAILED_CAUSE[status.reason] || 'Shadow-project sign-in failed.';
      const code = status.reason === 'error' && status.code ? ` (${status.code})` : '';
      return {
        level: 'error',
        title: 'Cleo 2 (twin) — NOT connected',
        body: `${cause}${code} Cleo 1 is unaffected. Retry, or open the twin in Safari rather than the installed PWA (Add to Home Screen). The room list below is empty because the twin is not connected — not because Cleo 2 is silent.`,
      };
    }
    default:
      // An unknown state is itself surfaced loudly — never a blank pane.
      return { level: 'error', title: 'Cleo 2 (twin) — unknown state', body: `Unexpected connection state "${status.state}". Reload the twin.` };
  }
}

// isConnected / isFailure — tiny predicates for the DOM glue's branch (kept here so the state vocabulary
// has ONE source of truth).
export function isConnected(status) { return status && status.state === 'connected'; }
export function isFailure(status) { return status && status.state === 'auth-failed'; }

// shouldOfferConnect(status) — true when the pane should show a "Connect Cleo 2" button. EVERY auth-failed
// state (no reusable credential, silent-timeout, or error) is recoverable by the twin signing ITSELF in with
// its own Google popup — independent of whether the primary session yielded a reusable credential. This is
// the reliable path: a persisted primary session hands over no credential, so credential-reuse alone strands
// the twin at 'no-credential'; a user-gesture popup always yields a fresh sign-in.
export function shouldOfferConnect(status) { return !!status && status.state === 'auth-failed'; }
export const CONNECT_BUTTON_LABEL = 'Connect Cleo 2';
