// dashboard.js — the directors' dashboard page (Oren, 20 Oct 2026). One shared doc, elad-oren-config/dashboard; the
// grid arithmetic is dashboard-logic.mjs (unit-tested). Opening this page runs nothing: the relay runs each card once
// a day at its time; "Run" only stamps runRequestedAt, which the relay picks up on its next minute beat.
import { initializeApp } from './fb/firebase-app.js';
import { getAuth, onAuthStateChanged } from './fb/firebase-auth.js';
import { initializeFirestore, doc, getDoc, onSnapshot, runTransaction, addDoc, collection, serverTimestamp } from './fb/firebase-firestore.js';
import { GRID_COLS, ROW_PX, SEED_CARDS, cardsOf, applyOp, gridDelta, moveCard, resizeCard, editCard, addCard, deleteCard, requestRun, cardStatus, isHtmlResult, cardDoc, CARD_SANDBOX, tileOf, tileOrder, boardSummary } from './dashboard-logic.mjs';
import { UI_REQUEST_ROOM, elementDescriptor, describeTarget, contextMenuChoice, dashboardFeedbackMessage } from './logic.js';

const fb = initializeApp({
  apiKey: 'AIzaSyBHs-CAjmEtccqlzAaQ0zpgEKv32RX76Ko', authDomain: 'cleo2-1812b.firebaseapp.com', projectId: 'cleo2-1812b',
  storageBucket: 'cleo2-1812b.firebasestorage.app', messagingSenderId: '333138022489', appId: '1:333138022489:web:754cafbfba335a0f856148',
});
const db = initializeFirestore(fb, { experimentalForceLongPolling: true }); // same transport as index.html
const ref = doc(db, 'elad-oren-config', 'dashboard');
const grid = document.getElementById('grid');
const msg = document.getElementById('msg');
let cards = SEED_CARDS.map((c) => ({ ...c }));
let latest = null; // the newest snapshot's cards; held while a drag is in progress and shown when it ends
let editing = null; // the id whose form is open
let editBox = null; // its DOM: kept across snapshots so half-typed text survives until Save or Cancel
let dragging = false;
// Tiles first (Oren, 23 Oct 2026: "one small visual per card, little text; everything clickable to dive in"): the page
// opens as one tile per card; a tap opens that card's full answer (`open`), whose links go into the threads. "⊞" switches
// to the free grid, where cards are moved and resized; the choice is kept on this device.
let view = localStorage.getItem('dash-view') === 'grid' ? 'grid' : 'tiles';
let open = null; // the id of the card opened from its tile
const sum = document.getElementById('sum');
const viewBtn = document.getElementById('view');

// Every change is an op applied twice: at once on screen, and inside a transaction to the FRESH doc, so the console never
// writes back a stale result/lastRunAt (a second paid run) or another director's change (Fable's review of #871).
const save = (op) => {
  cards = op(cards); render();
  runTransaction(db, async (t) => { const s = await t.get(ref); t.set(ref, { cards: applyOp(s.data(), op) }, { merge: true }); })
    .catch((e) => { msg.textContent = `Not saved: ${e.message}`; });
};
const closeEdit = () => { editing = null; editBox = null; };
const el = (tag, props = {}, kids = []) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

// The top line: red and orange tiles counted, and when the cards last ran (Sydney).
function renderSummary() {
  const { bad, warn, checkedAt } = boardSummary(cards);
  const at = checkedAt ? new Date(checkedAt).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '—';
  sum.className = bad ? 'bad' : warn ? 'warn' : 'ok';
  sum.textContent = `${bad ? `✕ ${bad} בעיות` : warn ? `! ${warn} לבדוק` : '✓ הכל בסדר'} · נבדק ${at}`;
  viewBtn.textContent = view === 'grid' ? '▦ Tiles' : '⊞ Layout';
}

// One card's box: its bar (title, run, edit, delete), then its answer or its edit form. `fixed` = the free grid.
function cardBox(c, colPx, fixed) {
  if (editing === c.id && editBox) { // the open form is not rebuilt: what he is typing stays
    if (fixed) Object.assign(editBox.style, { left: `${c.x * colPx}px`, top: `${c.y * ROW_PX}px`, width: `${c.w * colPx - 10}px` });
    return editBox;
  }
  const box = el('div', { className: `${editing === c.id ? 'card editing' : 'card'}${fixed ? '' : ' detail'}` });
  if (fixed) Object.assign(box.style, { left: `${c.x * colPx}px`, top: `${c.y * ROW_PX}px`, width: `${c.w * colPx - 10}px`, height: `${c.h * ROW_PX - 10}px` });
  const bar = el('div', { className: 'bar', title: fixed ? 'Drag to move' : '' }, [
    ...(fixed ? [] : [el('button', { textContent: '‹', title: 'Back to the tiles', onclick: () => { open = null; closeEdit(); render(); } })]),
    el('b', { textContent: c.title, dir: 'auto' }),
    el('button', { textContent: '▶', title: 'Run now', onclick: () => save((cs) => requestRun(cs, c.id, Date.now())) }),
    el('button', { textContent: '✎', title: 'Edit the prompt and the time', onclick: () => { if (editing === c.id) closeEdit(); else { editing = c.id; editBox = null; } render(); } }),
    el('button', { textContent: '✕', title: 'Delete this card', onclick: () => { if (confirm(`Delete "${c.title}"?`)) { if (editing === c.id) closeEdit(); if (open === c.id) open = null; save((cs) => deleteCard(cs, c.id)); }; } }),
  ]);
  box.append(bar);
  if (editing === c.id) {
    const title = el('input', { value: c.title, dir: 'auto' });
    const time = el('input', { type: 'time', value: c.time });
    const prompt = el('textarea', { value: c.prompt, dir: 'auto' });
    box.append(el('form', { onsubmit: (e) => { e.preventDefault(); closeEdit(); const f = { title: title.value, prompt: prompt.value, time: time.value }; save((cs) => editCard(cs, c.id, f)); } },
      [title, prompt, el('label', {}, ['Runs daily at (Sydney) ', time]), el('button', { textContent: 'Save' }), el('button', { type: 'button', textContent: 'Cancel', onclick: () => { closeEdit(); render(); } })]));
    editBox = box;
  } else {
    const body = isHtmlResult(c.result)
      ? el('iframe', { className: 'body html', sandbox: CARD_SANDBOX, srcdoc: cardDoc(c.result), title: c.title }) // locked: see cardDoc; a console link moves the whole tab
      : el('div', { className: c.result ? 'body' : 'body empty', dir: 'auto', textContent: c.result || 'Waiting for its first run.' });
    box.append(body, el('div', { className: 'foot', textContent: cardStatus(c, Date.now()) }));
  }
  if (fixed) {
    const grip = el('div', { className: 'grip', title: 'Drag to enlarge or shrink' });
    box.append(grip);
    drag(bar, box, (dx, dy) => save((cs) => moveCard(cs, c.id, dx, dy)));
    drag(grip, box, (dw, dh) => save((cs) => resizeCard(cs, c.id, dw, dh)), true);
  }
  return box;
}

function render() {
  renderSummary();
  const colPx = grid.clientWidth / GRID_COLS;
  grid.replaceChildren();
  if (open && !cards.some((c) => c.id === open)) open = null;
  if (view === 'tiles') {
    grid.className = open ? 'one' : 'tiles'; grid.style.height = '';
    if (open) { grid.append(cardBox(cards.find((c) => c.id === open), colPx, false)); return; }
    for (const c of tileOrder(cards)) {
      const t = tileOf(c);
      grid.append(el('button', { type: 'button', className: `tile s-${t.status}`, title: c.title, onclick: () => { open = c.id; render(); scrollTo(0, 0); } }, [
        el('span', { className: 'ic', textContent: t.icon }), el('span', { className: 'v', textContent: t.value, dir: 'auto' }), el('span', { className: 'l', textContent: t.label, dir: 'auto' }),
      ]));
    }
    return;
  }
  grid.className = '';
  grid.style.height = `${cards.reduce((m, c) => Math.max(m, c.y + c.h), 0) * ROW_PX + 20}px`;
  for (const c of cards) grid.append(cardBox(c, colPx, true));
}

// One pointer drag: the box follows the finger; on release the pixel delta becomes a grid delta and is saved once.
function drag(handle, box, done, resize = false) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.tagName === 'BUTTON') return; // a right-click opens 🎯 feedback, never a drag
    e.preventDefault(); handle.setPointerCapture(e.pointerId); dragging = true;
    const sx = e.clientX; const sy = e.clientY; const r = { l: box.offsetLeft, t: box.offsetTop, w: box.offsetWidth, h: box.offsetHeight };
    const mv = (m) => { const dx = m.clientX - sx; const dy = m.clientY - sy; if (resize) { box.style.width = `${r.w + dx}px`; box.style.height = `${r.h + dy}px`; } else { box.style.left = `${r.l + dx}px`; box.style.top = `${r.t + dy}px`; } };
    const up = (u) => { handle.removeEventListener('pointermove', mv); dragging = false; if (latest) { cards = latest; latest = null; } const g = gridDelta(u.clientX - sx, u.clientY - sy, grid.clientWidth / GRID_COLS); if (g.dx || g.dy) done(g.dx, g.dy); else render(); };
    handle.addEventListener('pointermove', mv);
    handle.addEventListener('pointerup', up, { once: true });
  });
}

document.getElementById('add').onclick = () => { const at = Date.now(); const op = (cs) => addCard(cs, at); const next = op(cards); if (next.length === cards.length) { msg.textContent = 'The dashboard is full.'; return; } editing = next.at(-1).id; editBox = null; if (view === 'tiles') open = editing; save(op); };
viewBtn.onclick = () => { view = view === 'grid' ? 'tiles' : 'grid'; open = null; closeEdit(); localStorage.setItem('dash-view', view); render(); };
addEventListener('resize', render);
let me = null; // { user, name } — the signed-in director, for the 🎯 feedback message
onAuthStateChanged(getAuth(fb), (user) => {
  me = null;
  if (user) getDoc(doc(db, 'elad-oren-config', 'app')).then((s) => { const name = { 'oren001@gmail.com': 'Oren', ...(s.data()?.directors || {}) }[user.email]; if (name) me = { user, name }; }).catch(() => {});
  if (!user) { msg.innerHTML = 'Not signed in. <a href="./index.html#dashboard" target="_top">Open the console</a> to sign in.'; return; }
  onSnapshot(ref, (s) => { const next = cardsOf(s.data()); if (dragging) { latest = next; return; } cards = next; if (editing && !cards.some((c) => c.id === editing)) closeEdit(); render(); },
    (e) => { msg.textContent = `Cannot read the dashboard: ${e.message}`; });
});
render();

// ── 🎯 Feedback (Oren, 21 Oct: "there is no feedback button inside the dashboard") ──────────────────────────────
// The console's own 🎯 request: the header button (the whole dashboard) or a right-click on any card (that element; the
// browser keeps its menu in a field, on a selection, on a touch screen — logic.js contextMenuChoice) opens a small form;
// Send posts ONE director message into Boss (UI_REQUEST_ROOM), the text logic.js dashboardFeedbackMessage builds.
const $ = (id) => document.getElementById(id);
function chip(text, isErr) {
  $('fb-chip')?.remove();
  const c = el('div', { id: 'fb-chip', className: isErr ? 'err' : '', textContent: text });
  c.setAttribute('role', isErr ? 'alert' : 'status');
  if (isErr) c.append(' ', el('button', { type: 'button', textContent: '✕', title: 'Dismiss', onclick: () => c.remove() }));
  else setTimeout(() => c.remove(), 4000);
  document.body.append(c);
}
function closeFeedback() { $('fb-pop')?.remove(); document.querySelector('.fb-target')?.classList.remove('fb-target'); }
function openFeedback(target) {
  closeFeedback(); closeMenu();
  const d = elementDescriptor(target);
  if (target !== grid) target.classList.add('fb-target');
  const ta = el('textarea', { dir: 'auto', placeholder: 'What should change here?' });
  const send = el('button', { type: 'button', className: 'primary', textContent: 'Send to Cleo', disabled: true });
  ta.addEventListener('input', () => { send.disabled = !ta.value.trim(); });
  send.onclick = () => {
    const text = dashboardFeedbackMessage({ ask: ta.value, descriptor: d, screen: location.pathname });
    if (!text) return;
    closeFeedback();
    if (!me) { chip('✗ Not sent — sign in to the console first.', true); return; }
    chip('Sent ✓ to Boss');
    addDoc(collection(db, 'elad-oren-rooms', UI_REQUEST_ROOM, 'messages'), {
      type: 'text', from: me.name, text, images: [], relayed: false, createdAt: serverTimestamp(),
      ...(me.user.email ? { fromUid: me.user.uid, fromEmail: me.user.email } : {}), // the console's verified stamp (ADR-2610030330rq)
    }).catch((e) => chip(`✗ NOT sent to Boss — ${e.message}. Try again, or paste it in Boss.`, true));
  };
  const pop = el('div', { id: 'fb-pop' }, [
    el('div', { className: 'what', textContent: target === grid ? '🎯 Feedback on the dashboard' : `🎯 Change ${describeTarget(d)}` }), ta,
    el('div', { className: 'row' }, [el('button', { type: 'button', textContent: 'Cancel', onclick: closeFeedback }), send]),
  ]);
  pop.setAttribute('role', 'dialog');
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFeedback();
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !send.disabled) send.click();
  });
  document.body.append(pop);
  const r = (target === grid ? $('feedback') : target).getBoundingClientRect(); const p = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - p.width - 8))}px`;
  pop.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - p.height - 8))}px`;
  ta.focus();
}
function closeMenu() { $('fb-menu')?.remove(); }
$('feedback').onclick = () => openFeedback(grid);
document.addEventListener('pointerdown', (e) => { if (e.button !== 2 && !e.target.closest?.('#fb-menu')) closeMenu(); }, true);
document.addEventListener('contextmenu', (e) => {
  const t = e.target instanceof Element ? e.target : e.target?.parentElement;
  const choice = contextMenuChoice({
    handled: e.defaultPrevented || !t || !!t.closest('#fb-pop'),
    editable: !!t?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'),
    hasSelection: !!String(getSelection?.() || '').trim(), menuOpen: !!$('fb-menu'), picking: false,
    finePointer: !!matchMedia?.('(pointer: fine)').matches, signedIn: !!me,
  });
  closeMenu();
  if (choice !== 'feedback') return;
  e.preventDefault();
  const menu = el('div', { id: 'fb-menu' }, [
    el('button', { type: 'button', textContent: '🎯 Feedback on this', onclick: () => openFeedback(t) }),
    el('div', { className: 'hint', textContent: 'Right-click again for the browser menu' }),
  ]);
  document.body.append(menu);
  menu.style.left = `${Math.max(4, Math.min(e.clientX, innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(e.clientY, innerHeight - menu.offsetHeight - 4))}px`;
});
