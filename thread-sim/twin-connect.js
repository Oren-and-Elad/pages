// public/elad-and-oren/twin-connect.js — the Cleo 2 TWIN app's CONNECTION to the SHADOW project
// (OBL-TWIN-APP-CONNECT · live-parallel-twin.md §3/§7 · Fable A24 F6). This is the refresh of the stale
// `2.0-shadow-app-section/shadow-section.js` (which subscribed cleo2-rooms on the general-4686c handle —
// wrong project since isolation v2). It initialises a SECOND Firebase app for `cleo2-shadow-1`, signs it in
// in its own right (`signInWithCredential`, reusing the director's Google credential), and subscribes
// `cleo2-rooms` (+ a room's messages/turns/cards) on the SHADOW handle — READ-ONLY.
//
// It imports the PURE decisions from twin-connect-logic.mjs (CI-tested) and only wires them into the DOM +
// the Firebase SDK. The SDK functions are INJECTED (the app passes its already-imported v9 modular fns) so
// this file has no hard import of a gstatic URL and stays testable/portable.
//
// READ + DISTINCTION ONLY — this file wires NO write path (no setDoc/addDoc/updateDoc/deleteDoc/writeBatch).
// The `no-write` unit spec asserts that by grepping this source. Distinction (banner/tint/NOT-sent/no-/key)
// is composed on top by twin-window.js.
//
// NOTE (build session): prepared against the read-only katya-snapshot; the twin app applies + tests it (see
// PR-DESCRIPTION.md). The host hooks are the same window.__eo surface the other twin/shadow modules use.
import {
  SHADOW_APP_NAME, SHADOW_ROOMS_COLLECTION, SHADOW_ROOM_SUBCOLLECTIONS, shadowRoomSubPath,
  validateShadowConfig, classifyShadowAuth, connectionMessage, isConnected, AUTH_TIMEOUT_MS,
  shouldOfferConnect, CONNECT_BUTTON_LABEL,
} from './twin-connect-logic.mjs';

// signInTwinOwn — the twin signs into the shadow project with its OWN Google popup, independent of the
// primary app's credential. The RELIABLE path: a persisted primary session yields no reusable credential
// (getCredential()→null), which strands credential-reuse at 'no-credential'. A popup (a user gesture, fired
// by the Connect button) always yields a fresh sign-in, after which onAuthStateChanged connects the twin.
// Requires `signInWithPopup` + `GoogleAuthProvider` in the injected firebase surface. Auth only — no write.
export function signInTwinOwn({ firebase, auth }) {
  return Promise.resolve().then(() => firebase.signInWithPopup(auth, new firebase.GoogleAuthProvider()));
}

// initShadowApp — the SECOND Firebase app for cleo2-shadow-1. `firebase` is the injected SDK surface:
//   { initializeApp, getAuth, getFirestore, initializeFirestore?, collection, onSnapshot,
//     GoogleAuthProvider, signInWithCredential, onAuthStateChanged }.
// Throws (loudly, never silently) if the config is not the shadow project — a mis-pointed twin is a bug we
// refuse to boot, not a blank pane.
export function initShadowApp({ firebase, fbConfig, appName = SHADOW_APP_NAME }) {
  const v = validateShadowConfig(fbConfig);
  if (!v.ok) throw new Error(`twin-connect: invalid shadow firebase config — ${v.errors.join('; ')}`);
  const app = firebase.initializeApp(fbConfig, appName); // NAMED second instance — never the default app
  const auth = firebase.getAuth(app);
  // Long-polling for the same reason index.html forces it on the primary (WebChannel assertion crash).
  let db;
  try { db = firebase.initializeFirestore ? firebase.initializeFirestore(app, { experimentalForceLongPolling: true }) : firebase.getFirestore(app); }
  catch { db = firebase.getFirestore(app); }
  return { app, auth, db };
}

// connectShadow — sign the shadow app in, watchdog the silent-iOS failure, and (only once connected)
// subscribe the room list READ-ONLY. Every state transition is pushed to `onState(status, message)` so the
// caller renders the pane; `message` is connectionMessage(status) — non-null for every non-connected state,
// so the pane is NEVER blank (F6).
//   getCredential() — returns the reusable Google credential (firebase.GoogleAuthProvider.credential(idToken,
//     accessToken)) captured at the director's primary sign-in, or null if none is available (iOS redirect).
//   onRooms(docs) — receives the cleo2-rooms snapshot docs (read-only) once connected.
// Returns a handle { stop() } that cancels the watchdog and the room subscription.
export function connectShadow({ firebase, auth, db, getCredential, onState, onRooms, timeoutMs = AUTH_TIMEOUT_MS, now = () => Date.now() }) {
  const start = now();
  let settled = false, watchdog = null, unsubAuth = null, unsubRooms = null;
  const emit = (status) => { try { onState?.(status, connectionMessage(status)); } catch { /* rendering must never throw into auth */ } };

  emit(classifyShadowAuth({ elapsedMs: 0, timeoutMs })); // 'connecting' — a visible pane from t=0

  const succeed = (user) => {
    if (settled) return; settled = true;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    emit(classifyShadowAuth({ user }));
    subscribeShadowRooms({ firebase, db, onRooms }).then((u) => { unsubRooms = u; }).catch(() => {});
  };
  const fail = (partial) => {
    if (settled) return; settled = true;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    emit(classifyShadowAuth(partial)); // { error } | { credential:null } | { elapsedMs>=timeout }
  };

  // (1) the watchdog — the ONLY thing standing between an iOS-PWA silent hang and a blank pane.
  watchdog = setTimeout(() => fail({ elapsedMs: now() - start, timeoutMs }), timeoutMs);

  // (2) react to the shadow auth state. The FIRST callback fires once on init with the RESTORED persisted
  //     user (or null). A restored user means we're already signed in — no popup needed. So we must NOT
  //     declare 'no-credential' until auth has confirmed there is genuinely no user (Fable F5: otherwise a
  //     signed-in twin demands a popup on every reload — exactly the iOS-PWA path that fails).
  let firstAuthFired = false, credResolved = false, hasCred = false;
  const failIfTrulyNoCred = () => { if (firstAuthFired && credResolved && !hasCred) fail({ credential: null }); };
  unsubAuth = firebase.onAuthStateChanged(auth, (user) => {
    firstAuthFired = true;
    if (user) succeed(user);
    else failIfTrulyNoCred();
  });

  // (3) drive the sign-in with the reused Google credential — but if there is none, WAIT for the auth
  //     state to restore a persisted user rather than failing synchronously. The watchdog bounds the wait.
  Promise.resolve()
    .then(() => getCredential())
    .then((credential) => {
      credResolved = true;
      if (!credential) { failIfTrulyNoCred(); return; }       // wait for a restored session
      hasCred = true;
      return firebase.signInWithCredential(auth, credential); // onAuthStateChanged handles success
    })
    .catch((error) => fail({ error }));

  return {
    stop() {
      if (watchdog) clearTimeout(watchdog);
      try { unsubAuth?.(); } catch { /* */ }
      try { unsubRooms?.(); } catch { /* */ }
    },
  };
}

// subscribeShadowRooms — READ-ONLY onSnapshot of the cleo2-rooms list on the SHADOW handle. Returns the
// unsubscribe fn. (No write verb anywhere in this file — read + distinction only.)
export function subscribeShadowRooms({ firebase, db, onRooms }) {
  return Promise.resolve().then(() => firebase.onSnapshot(
    firebase.collection(db, SHADOW_ROOMS_COLLECTION),
    (snap) => { onRooms?.(snap.docs.filter((d) => !d.data().archived)); },
    (err) => { onRooms?.([], err); }, // an error surfaces as an explicit empty+error, never a silent hang
  ));
}

// subscribeShadowRoom — READ-ONLY streams for ONE open room's messages/turns/cards on the SHADOW handle.
// `onSub(sub, docs)` receives each subcollection's docs. Returns an unsubscribe-all fn.
export function subscribeShadowRoom({ firebase, db, roomId, onSub }) {
  const unsubs = SHADOW_ROOM_SUBCOLLECTIONS.map((sub) => firebase.onSnapshot(
    firebase.collection(db, shadowRoomSubPath(roomId, sub)),
    (snap) => onSub?.(sub, snap.docs),
  ));
  return () => { for (const u of unsubs) { try { u(); } catch { /* */ } } };
}

// renderConnectionPane — write the connection status into a pane element. Called on every onState. On a
// non-connected state it shows the loud message; on connected it clears the message so the room list shows.
// Never leaves the pane blank on a failure (F6).
export function renderConnectionPane(el, status, message, { doc = document, onConnect = null } = {}) {
  if (!el) return;
  el.querySelector('.twin-conn-msg')?.remove();
  if (isConnected(status) || !message) return;
  const box = doc.createElement('div');
  box.className = `twin-conn-msg twin-conn-${message.level}`;
  box.setAttribute('role', message.level === 'error' ? 'alert' : 'status');
  const h = doc.createElement('strong'); h.textContent = message.title;
  const p = doc.createElement('div'); p.textContent = message.body;
  box.append(h, p);
  // The "Connect Cleo 2" button — the twin signs itself in (own Google popup) on any auth-failed state, so a
  // persisted primary session (no reusable credential) is one click from connected. Needs a user gesture.
  if (onConnect && shouldOfferConnect(status)) {
    const btn = doc.createElement('button');
    btn.className = 'twin-connect-btn'; btn.type = 'button'; btn.textContent = CONNECT_BUTTON_LABEL;
    btn.style.cssText = 'margin-top:12px;padding:8px 18px;font-weight:700;cursor:pointer;background:#F59E0B;color:#1a1200;border:0;border-radius:8px';
    btn.addEventListener('click', () => {
      btn.disabled = true; btn.textContent = 'Connecting…';
      Promise.resolve().then(onConnect).catch(() => { btn.disabled = false; btn.textContent = CONNECT_BUTTON_LABEL; });
    });
    box.append(btn);
  }
  el.prepend(box);
}
