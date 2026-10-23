// public/elad-and-oren/twin-compose.js — the Cleo 2 TWIN composer: the DOM + the ONE sanctioned WRITE. Kept
// SEPARATE from twin-connect.js (which stays read-only) so the read-path no-write invariant holds and the
// write surface is exactly one thing: a DIRECTOR's own message into cleo2-rooms, author-validated by
// firestore.shadow.rules. Her brain (npm run twin) picks it up and drafts a WOULD-SEND reply — never sends.
//
// The injected `firebase` surface must add the write fns the app already imports:
//   { doc, collection, addDoc, setDoc, serverTimestamp? }  (+ the read fns twin-connect uses).
import { TWIN_DEFAULT_ROOM, canPost, directorMessageDoc, roomSeedDoc } from './twin-compose-logic.mjs';
import { shadowRoomSubPath } from './twin-connect-logic.mjs';
import { detectSecretDropSyntax, refuseSecretDropText } from './twin-window-logic.mjs';

// postDirectorMessage — write the director's message into cleo2-rooms/<roomId>/messages on the SHADOW db.
// Ensures the room doc exists first (merge — never clobbers). `author` MUST be the signed-in director's own
// email (the rules reject anything else). Returns the message ref. This is the twin's only write.
export async function postDirectorMessage({ firebase, db, roomId = TWIN_DEFAULT_ROOM, text, author, now = () => Date.now() }) {
  if (!canPost(text)) throw new Error('twin-compose: nothing to post (empty, or a /key drop — refused)');
  const ts = now();
  // (1) ensure the room exists (merge with an idempotent marker only — never re-stamps room state, F9).
  const roomRef = firebase.doc(db, 'cleo2-rooms', roomId);
  await firebase.setDoc(roomRef, roomSeedDoc(), { merge: true });
  // (2) append the director message. Inject the serverTimestamp FACTORY (mods.serverTimestamp) so the
  // stored createdAt is a Firestore server Timestamp — the one message sort key (P4c / ADR-0040) — and the
  // twin transcript interleaves with the kernel's Timestamp brain replies under orderBy('createdAt'). A
  // surface predating serverTimestamp falls back to the logic module's ISO. No numeric `ts` is written.
  const msgs = firebase.collection(db, shadowRoomSubPath(roomId, 'messages'));
  const serverTimestamp = typeof firebase.serverTimestamp === 'function' ? firebase.serverTimestamp : null;
  return firebase.addDoc(msgs, directorMessageDoc({ text, author, now: ts, serverTimestamp }));
}

// renderTwinComposer — a compose box pinned under the twin room view: a text input + an "Ask Cleo 2" button.
// onSend(text) does the write (postDirectorMessage). Additive DOM; disables while sending; clears on success.
export function renderTwinComposer(el, { onSend, doc = document, placeholder = 'Ask Cleo 2 the same thing you asked Cleo 1…' } = {}) {
  if (!el || el.querySelector('.twin-composer')) return null;
  const wrap = doc.createElement('form');
  wrap.className = 'twin-composer';
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px;border-top:2px solid #F59E0B;background:rgba(245,158,11,0.06)';
  // an inline notice — a refused /key drop (F7) or a failed post (F11) is ALWAYS shown, never a silent no-op.
  const notice = doc.createElement('div');
  notice.className = 'twin-composer-notice'; notice.setAttribute('role', 'alert');
  notice.style.cssText = 'display:none;font-size:13px;color:#1a1200;background:rgba(245,158,11,0.22);border:1px solid #F59E0B;border-radius:6px;padding:6px 10px';
  const showNotice = (msg) => { notice.textContent = msg; notice.style.display = 'block'; };
  const clearNotice = () => { notice.textContent = ''; notice.style.display = 'none'; };
  const row = doc.createElement('div'); row.style.cssText = 'display:flex;gap:8px';
  const input = doc.createElement('input');
  input.type = 'text'; input.className = 'twin-composer-input'; input.placeholder = placeholder;
  input.style.cssText = 'flex:1;padding:9px 12px;border-radius:8px;border:1px solid #F59E0B;background:transparent;color:inherit';
  const btn = doc.createElement('button');
  btn.type = 'submit'; btn.textContent = 'Ask Cleo 2';
  btn.style.cssText = 'padding:9px 16px;font-weight:700;cursor:pointer;background:#F59E0B;color:#1a1200;border:0;border-radius:8px';
  row.append(input, btn); wrap.append(notice, row);
  wrap.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value;
    if (detectSecretDropSyntax(text)) { showNotice(refuseSecretDropText()); return; }  // F7 — visible refusal
    if (!canPost(text)) return;                                                          // empty — nothing to do
    clearNotice();
    btn.disabled = true; input.disabled = true; const prev = btn.textContent; btn.textContent = 'Sending…';
    Promise.resolve().then(() => onSend?.(text))
      .then(() => { input.value = ''; })
      .catch((err) => { showNotice('Not posted — ' + ((err && (err.code || err.message)) || 'try again') + '. Retry.'); })  // F11
      .finally(() => { btn.disabled = false; input.disabled = false; btn.textContent = prev; input.focus(); });
  });
  el.appendChild(wrap);
  return wrap;
}
