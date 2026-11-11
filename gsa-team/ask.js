// GSA's own chat page (Oren, 5 Nov 2026, #hq2): moved out of Cleo's console (cleo2 app/console/public/elad-and-oren/ask.*)
// into GSA's pages folder, owned end to end by #gsa and its builder; https://oren-and-elad.github.io/pages/gsa-chat/ —
// the old link cleo2.pages.dev/elad-and-oren/ask.html#gsa-chat forwards here. Same Firebase project, sign-in and access
// code; answers still come from GSA's own server on 21160 through the relay. See README.md in this folder.
// ask.js — an answerer room's own page, `ask.html#<room>` (ADR-2610281312jh). Signed in as a director (the console's
// sign-in, same origin), it shows that ONE room's questions and answers in its client's look and posts a typed question
// there as a director message; the relay answers from the room's loopback answerer (kernel2/answerer-logic.mjs). Nothing
// else of the console is on screen. A room ask-logic.mjs ASK_ROOMS does not name is refused. A room with `prepared` shows
// its prepared answers as tabs first (fetched from the static page, decrypted here with its access code — no sign-in and
// no Mac needed) and "Ask a question" as the last tab.
// A chat room (`chat: true`, ADR-2611030930gc — the GSA chat) is a conversation instead: oldest at the top, the box at
// the bottom, a follow-up sent in the same thread, "New conversation" for a fresh one. It signs in on the page itself
// (a guest: the email and password they were given; a director: Google), and a guest — `elad-oren-guests/{email}`
// listing the room, not off, before its end, the room not `guestsOff` — may ask there too (ask-logic.mjs guestAccess);
// firestore.rules is what actually lets them, and lets a guest read only their own side: what they asked (fromUid) and
// what answers them (askerUid), through two listeners. A guest rates each answer and sends general feedback; the relay
// posts it to #gsa naming the login and the question (ADR-2611030930gc).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import { initializeFirestore, doc, getDoc, updateDoc, onSnapshot, addDoc, collection, query, where, limit, orderBy, limitToLast, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { renderLive, renderChat, newUi, renderJobs } from './ask-view.js';
import { LINK } from './link.mjs';
import { FIREBASE } from './firebase-config.mjs';
import { linkOpen, LINK_CLOSED_LINE, ASK_ROOMS, roomOfLocation, guestAccess, askMessage, feedbackMessage, mergeRows, chatThreads, ownKey, ownThreads, addOwn, chatTabs, CLOSED_LINE, DENIED_LINE, wrongLinkLine, cssVars, conversation, preparedBlobOf, preparedTabs, preparedScope, preparedDoc, stepOrder, feedbackText, PREPARED_SANDBOX, inventoryOf, trustLine, presenterSteps, presenterTurn, cleanName, nameKey, savedName, boardOf, boardView, readAssign, assignJob, BOARD_KEY, boardMessage, pipelineView, widerWindow } from './ask-logic.mjs';

// the sign-in project's web settings are written into each built link by web/build.mjs (never kept in this repo)
// each link keeps its own sign-in: both links share one site, so a shared default app let one link's login take over the other
const fb = initializeApp(FIREBASE, LINK.name || '[DEFAULT]');
const db = initializeFirestore(fb, { experimentalForceLongPolling: true }); // same transport as index.html
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

const roomId = roomOfLocation(location.hash, location.search);
const open = linkOpen(LINK, Date.now());   // a link past its end date shows one closed line and nothing else
const room = roomId && open ? ASK_ROOMS[roomId] : null;
if (!room) {
  $('msg').textContent = open ? 'This page is not available.' : LINK_CLOSED_LINE;
} else {
  for (const [k, v] of Object.entries(cssVars(room))) document.documentElement.style.setProperty(k, v);
  document.title = room.title; $('title').textContent = room.title;
  $('logo').src = room.logo; $('logo').alt = room.by;
  $('q').placeholder = room.placeholder;
  if (room.chat) { document.body.classList.add('chat'); $('topbar').insertBefore($('fbgo'), $('signout')); } // Feedback beside Sign out, never over Send
}
const auth = getAuth(fb);

let me = null; let directors = []; let rows = [];
// the live answers (ask-view.js): the newest question and its answer first; a new one scrolls the page back to the top
const ui = newUi(); let newest = '';
function render() {
  if (room?.chat) { renderChatRoom(); return; }
  const items = conversation(rows, directors);
  renderLive($('list'), items, ui, { redraw: render, examples: room?.examples || [], ask: (x) => { $('q').value = x; $('ask').requestSubmit(); }, scope: inv });
  const top = items.filter((x) => x.kind === 'a').pop()?.id || items.filter((x) => x.kind === 'q').pop()?.id || '';
  if (top !== newest) { newest = top; if (tab === 'live' && !pres.on) scrollTo(0, 0); }
  if (pres.on && cur()?.kind === 'ask') renderLive($('pans'), presenterTurn(items, pres.qid), ui, { redraw: render, scope: inv });
}

onAuthStateChanged(auth, async (user) => {
  if (!room) return;
  $('signin').hidden = true; $('signout').hidden = !(user && room.chat);
  if (!user && room.chat) { $('msg').textContent = ''; $('signin').hidden = false; return; }
  if (!user) { $('msg').innerHTML = 'Not signed in. <a href="./index.html">Sign in</a>, then open this page again.'; return; }
  try {
    const named = { 'oren001@gmail.com': 'Oren', ...((await getDoc(doc(db, 'elad-oren-config', 'app'))).data()?.directors || {}) };
    directors = [...new Set(Object.values(named))];
    if (named[user.email]) me = { user, name: named[user.email], guest: false };
  } catch { /* a guest cannot read the directors' list; asking needs a name */ }
  // the room doc (its job list for the trust line, and its `guestsOff` switch); a guest the rules refuse it to is closed
  let roomDoc = null;
  try { roomDoc = (await getDoc(doc(db, 'elad-oren-rooms', roomId))).data() || {}; } catch { roomDoc = null; }
  if (!me && room.chat) {
    // a guest of this chat: their own doc, by their verified email (a read that fails is no access)
    let g = null;
    try { g = user.emailVerified && user.email ? (await getDoc(doc(db, 'elad-oren-guests', user.email.toLowerCase()))).data() || null : null; } catch { g = null; }
    const access = guestAccess(g, roomId, Date.now(), roomDoc || { guestsOff: true });
    if (access === 'ask') { me = { user, name: g.name.trim(), guest: true }; me.realName = await askName(user, g); }
    else { $('msg').textContent = access === 'closed' ? CLOSED_LINE : (wrongLinkLine(g, roomId) || DENIED_LINE); return; }
  }
  if (!me) { $('msg').textContent = room.chat ? DENIED_LINE : 'This account cannot ask here.'; return; }
  showInventory(inventoryOf(roomDoc || {}));
  $('ask').hidden = false; $('q').focus(); $('fbgo').hidden = !room.feedback || me.guest;
  if (room.chat) { $('newchat').hidden = false; $('gfbgo').hidden = !me.guest; }
  if (room.chat && room.tabs) { drawChatTabs(); chatTab('chat'); roomCode = typeof roomDoc?.preparedCode === 'string' ? roomDoc.preparedCode.trim() : ''; tryRoomCode(); }
  const msgs = collection(db, 'elad-oren-rooms', roomId, 'messages');
  if (room.chat && room.tabs) watchShared();
  const failed = (e) => { $('msg').textContent = me.guest ? CLOSED_LINE : `Cannot read this room: ${e.message}`; };
  if (me.guest) {
    // a guest's own side only (firestore.rules guestOwnsMsg): equality queries, no orderBy, so no composite index
    const part = { asked: [], answered: [] };
    const take = (k) => (all) => { part[k] = all; rows = mergeRows(part.asked, part.answered); $('msg').textContent = ''; render(); };
    watchWindow((n) => query(msgs, where('fromUid', '==', me.user.uid), limit(n)), 500, take('asked'), failed);
    watchWindow((n) => query(msgs, where('askerUid', '==', me.user.uid), limit(n)), 500, take('answered'), failed);
  } else {
    watchWindow((n) => query(msgs, orderBy('createdAt'), limitToLast(n)), 600, (all) => { rows = all.filter((r) => !r.board); $('msg').textContent = ''; render(); }, failed);
  }
});
// watchWindow — a messages listener whose window widens (widerWindow) when board calls crowd out the chat lines
function watchWindow(q, n, onRows, failed) {
  let stop = null;
  const sub = (size) => { if (stop) stop(); stop = onSnapshot(q(size), (s) => {
    const all = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const next = widerWindow(size, all.length, all.filter((r) => !r.board).length);
    if (next > size) sub(next); else onRows(all);
  }, failed); };
  sub(n);
}

// askName — a guest's first sign-in asks "Your name" once per username (ask-logic.mjs savedName); later sign-ins skip it
async function askName(user, g) {
  const key = nameKey(user.email);
  let stored = ''; try { stored = localStorage.getItem(key) || ''; } catch { /* private mode */ }
  const have = savedName(g, stored);
  if (have) return have;
  $('nameform').hidden = false; $('yourname').focus();
  const name = await new Promise((done) => $('nameform').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const n = cleanName($('yourname').value);
    if (n) done(n); else $('nameerr').textContent = 'Please type your name.';
  }));
  $('nameform').hidden = true;
  try { localStorage.setItem(key, name); } catch { /* private mode */ }
  try { await updateDoc(doc(db, 'elad-oren-guests', user.email.toLowerCase()), { displayName: name }); } catch { /* kept on this device */ }
  return name;
}

// the console's own message shape (index.html sendMsg), with the verified identity firestore.rules binds (ask-logic.mjs
// askMessage); a chat follow-up carries its conversation's threadId. The new id.
const send = async (text, threadId) => (await addDoc(collection(db, 'elad-oren-rooms', roomId, 'messages'), { ...askMessage({ name: me.name,
  uid: me.user.uid, email: me.user.email, text, threadId, guest: me.guest }), createdAt: serverTimestamp() })).id;
$('ask').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const text = $('q').value.trim();
  if (!text || !me) return;
  $('go').disabled = true;
  try {
    if (room.chat) { const id = await send(text, chat.thread || undefined); if (!chat.thread) { chat.thread = id; chat.fresh = false; ownSave(id); } chat.follow = true; render(); }
    else await send(text);
    $('q').value = '';
  } catch (e) { $('msg').textContent = `Not sent: ${e.message}`; } finally { $('go').disabled = false; $('q').focus(); }
});

// ── prepared answers (Oren, 2 Nov 2026): tabs, one locked frame each; the live question is the last tab ──
let prep = null; let tab = 'live';
function show(k) {
  tab = k;
  $('live').hidden = k !== 'live'; $('ask').style.display = k === 'live' ? '' : 'none';
  $('prepared').hidden = k === 'live';
  for (const b of $('tabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.k === k);
  const i = steps.indexOf(k);
  $('cur').textContent = `${i + 1}. ${names[k]?.label ?? ''}`; $('curg').textContent = names[k]?.group ? `· ${names[k].group}` : '';
  $('next').hidden = i < 0 || i === steps.length - 1;
  if (k !== 'live' && prep) {
    $('prepared').replaceChildren(el('iframe', { sandbox: PREPARED_SANDBOX, srcdoc: preparedDoc(prep, k), title: k })); // locked: see preparedDoc
  }
  scrollTo(0, 0);
}
// Design A (Oren's card, 2 Nov 2026): a side menu, one section per group (its title first, the lead group framed);
// "Ask a question" is its own section right under the lead group, outside it, so it never looks like one of Halina's.
let names = {}; let steps = [];
function tabs(list) {
  names = Object.fromEntries(list.map((x) => [x.k, x])); steps = stepOrder(list);
  const numbered = (k, text) => [el('span', { className: 'n', textContent: String(steps.indexOf(k) + 1) }), text];
  const rows = [];
  for (const { k, label, group, lead } of list) {
    if (k === 'live') continue;
    const key = group ?? '';
    if (!rows.length || rows[rows.length - 1].key !== key) {
      rows.push({ key, row: el('div', { className: lead ? 'g lead' : 'g' }, ...(key ? [el('span', { className: 'gt', textContent: key })] : [])) });
    }
    const b = el('button', { type: 'button', onclick: () => show(k) }, ...numbered(k, label));
    b.dataset.k = k; rows[rows.length - 1].row.append(b);
  }
  const els = rows.map((r) => r.row);
  const live = list.find((x) => x.k === 'live');
  if (live) {
    const b = el('button', { type: 'button', className: 'live', onclick: () => show('live') }, ...numbered('live', live.label));
    b.dataset.k = 'live';
    els.splice(list.some((x) => x.lead) ? Math.min(1, els.length) : 0, 0, el('div', { className: 'g ask' }, el('span', { className: 'gt', textContent: 'Ask' }), b));
  }
  $('tabs').replaceChildren(...els);
  $('tabs').hidden = false; document.body.classList.add('side');
}
// The menu folds away like any SaaS side bar (Oren, 2 Nov 2026), and stays folded on this browser; Next walks the steps.
const fold = (on) => { document.body.classList.toggle('folded', on); $('fold').setAttribute('aria-expanded', String(!on)); try { localStorage.setItem('ask:folded', on ? '1' : ''); } catch { /* storage blocked: it folds, just not remembered */ } };
$('fold').onclick = () => fold(!document.body.classList.contains('folded'));
try { fold(localStorage.getItem('ask:folded') === '1'); } catch { /* storage blocked: the menu starts open */ }
$('next').onclick = () => { const i = steps.indexOf(tab); if (i >= 0 && i < steps.length - 1) show(steps[i + 1]); };
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// decryptPrepared — the prepared page's answers, opened in the browser with its access code (both pages use it)
async function decryptPrepared(blob, code) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(blob.salt), iterations: blob.iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.iv) }, key, b64(blob.ct))));
}
async function openPrepared(blob, code) {
  const d = await decryptPrepared(blob, code);
  const list = preparedTabs(d);
  if (!list.length) throw new Error('no answers');
  prep = d; sessionStorage.setItem(`prep:${roomId}`, code);
  if (!inv) { const scope = preparedScope(d); $('scope').textContent = scope; $('scope').hidden = !scope; }
  tabs([...list, { k: 'live', label: 'Ask a question' }]);
  show(steps[0]);
  pres.steps = presenterSteps(room, Object.fromEntries(list.map((x) => [x.k, x.label])));
  $('present').hidden = !pres.steps.length;
  if (pres.steps.length && sessionStorage.getItem(`present:${roomId}`)) present(Number(sessionStorage.getItem(`present:${roomId}`)) || 0);
}
if (room?.prepared && !room.chat) {
  fetch(room.prepared, { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))).then((html) => {
    const blob = preparedBlobOf(html);
    if (!blob) throw new Error('not a prepared page');
    tabs([{ k: 'prep', label: 'Prepared answers' }, { k: 'live', label: 'Ask a question' }]); show(steps[0]);
    $('gate').onsubmit = (e) => { e.preventDefault(); $('gerr').textContent = 'Opening…';
      openPrepared(blob, $('code').value.trim()).catch(() => { $('gerr').textContent = 'Wrong code.'; }); };
    const c0 = sessionStorage.getItem(`prep:${roomId}`);
    if (c0) openPrepared(blob, c0).catch(() => sessionStorage.removeItem(`prep:${roomId}`)); else $('code').focus();
  }).catch(() => { /* no prepared answers reachable: the page is the live question alone, as before */ });
}

// ── what's in this demo (Oren, 3 Nov 2026, #gsa): the trust line names every job and document the search covers and
// opens them as a table (the room's record `inventory`, read like its answers, by a signed-in director only) ──
let inv = null; const invSt = { sort: 'job', dir: 1, q: '' };
function drawJobs() { const n = renderJobs($('invt'), inv, invSt, drawJobs); $('invn').textContent = `Showing ${n} of ${inv.jobs.length}`; }
function showInventory(x) {
  if (!x) return;
  inv = x;
  $('scope').textContent = `${trustLine(inv)} · What's in this demo ›`; $('scope').classList.add('inv'); $('scope').hidden = false;
  $('invsub').textContent = `${inv.jobs.length} GSA jobs from 2025 and their ${inv.documents} documents. Every question searches all of them.`;
  if (pres.on && cur()?.kind === 'inv') present(pres.i);
}
$('scope').onclick = () => { if (!inv) return; invSt.q = $('invq').value = ''; drawJobs(); $('inv').showModal(); $('invq').focus(); };
$('invq').oninput = () => { invSt.q = $('invq').value; drawJobs(); };
$('invclose').onclick = () => $('inv').close();

// ── feedback (Oren, 3 Nov 2026, #gsa): right-click any part of the page, or tap Feedback and then the part (a phone has
// no right-click); a short note goes to the room's feedback room as the director's own message, with what it is about ──
let fbOn = null;
const fbMark = (t) => { document.querySelector('.fb-on')?.classList.remove('fb-on'); fbOn = t; t?.classList.add('fb-on'); };
function fbOpen(t) {
  fbMark(t); document.body.classList.remove('picking');
  // a prepared answer is a locked frame (no script): a tap on it lands on #prepared and the note is about that step
  $('fbon').textContent = ((t.id === 'prepared' && $('cur').textContent) || (t.dataset.k && names[t.dataset.k]?.label) || t.innerText || t.title || t.tagName).replace(/\s+/g, ' ').trim().slice(0, 140);
  $('fbnote').value = ''; $('fberr').textContent = ''; $('fb').showModal(); $('fbnote').focus();
}
const fbPart = (t) => t.closest('.card, .echo, .ans h2, .cov, .lead, .strip, .bar, .tools, .earlier, .ans, nav#tabs button, #topbar, #scope, #prepared, header, form#ask, #list') || t;
if (room?.feedback) {
  $('fbgo').onclick = (e) => { e.stopPropagation(); document.body.classList.toggle('picking'); };
  document.addEventListener('contextmenu', (e) => {
    if (!me || e.target.closest('dialog')) return;
    e.preventDefault();
    if (me.guest) guestOnPart(fbPart(e.target)); else fbOpen(fbPart(e.target));
  });
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('picking') || !me || me.guest || e.target.closest('dialog, #fbgo')) return;
    e.preventDefault(); e.stopPropagation(); fbOpen(fbPart(e.target));
  }, true);
  $('fbcancel').onclick = () => $('fb').close();
  $('fb').addEventListener('close', () => fbMark(null)); // Esc too
  $('fbform').onsubmit = async (e) => {
    e.preventDefault();
    if (me?.guest) { guestSend(); return; }
    const q = fbOn?.closest('.ans')?.dataset.q;
    const text = feedbackText({ note: $('fbnote').value, page: `ask.html#${roomId}`, step: $('cur').textContent || names[tab]?.label,
      on: $('fbon').textContent, question: q });
    if (!text || !me || me.guest) { $('fberr').textContent = me ? 'Write a note first.' : 'Sign in first.'; return; }
    $('fbsend').disabled = true;
    try {
      await addDoc(collection(db, 'elad-oren-rooms', room.feedback, 'messages'), { type: 'text', from: me.name, text, images: [], relayed: false,
        createdAt: serverTimestamp(), fromUid: me.user.uid, fromEmail: me.user.email });
      $('fb').close(); $('fbgo').textContent = `✓ Sent to #${room.feedback}`; setTimeout(() => { $('fbgo').textContent = '✎ Feedback'; }, 4000);
    } catch (err) { $('fberr').textContent = `Not sent: ${err.message}`; } finally { $('fbsend').disabled = false; }
  };
}

// ── the presenter mode (Oren, 3 Nov 2026, #gsa: "like slide clicks", desktop only): one screen at a time — what's in the
// demo, Halina's two questions prefilled word for word, George's own question in an empty box, the office views, the
// pricing (ask-logic.mjs presenterSteps). Next → or the → key moves on; Enter asks; an earlier answer is never on screen.
// The screen it is on is kept for this tab, so a reload comes back to it. Exit returns to the normal page as it was.
const pres = { on: false, i: 0, steps: [], qid: '' };
const cur = () => (pres.on ? pres.steps[pres.i] : null);
const invPres = { sort: 'job', dir: 1, q: '' };
function present(i) {
  const s = pres.steps[i];
  if (!s) return;
  pres.on = true; pres.i = i; pres.qid = '';
  try { sessionStorage.setItem(`present:${roomId}`, String(i)); } catch { /* storage blocked: a reload opens the normal page */ }
  document.body.classList.add('presenting');
  $('plogo').src = room.logo; $('plogo').alt = room.by;
  $('pcount').textContent = `${s.n}/${s.of}`; $('ptitle').textContent = s.title;
  $('pnext').hidden = i >= pres.steps.length - 1;
  $('pask').hidden = s.kind !== 'ask'; $('pans').replaceChildren(); ui.open.clear();
  const body = $('pbody');
  if (s.kind === 'inv') {
    if (!inv) body.replaceChildren(el('p', { className: 'sub', textContent: 'Loading the list of jobs…' }));
    else {
      const box = el('div');
      const draw = () => renderJobs(box, inv, invPres, draw);
      draw();
      body.replaceChildren(el('p', { className: 'sub', textContent: $('invsub').textContent }), box);
    }
  } else if (s.kind === 'prep') {
    body.replaceChildren(el('iframe', { id: 'pframe', sandbox: PREPARED_SANDBOX, srcdoc: preparedDoc(prep, s.k), title: s.title }));
  } else {
    body.replaceChildren();
    $('pq').value = s.q; $('pq').focus(); $('pq').setSelectionRange(s.q.length, s.q.length);
  }
  if (s.kind !== 'ask') $('pnext').focus();
  scrollTo(0, 0);
}
function unpresent() {
  pres.on = false; document.body.classList.remove('presenting');
  try { sessionStorage.removeItem(`present:${roomId}`); } catch { /* nothing kept */ }
  show(tab);
}
$('present').onclick = () => present(0);
$('pexit').onclick = unpresent;
$('pnext').onclick = () => present(pres.i + 1);
$('pask').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('pq').value.trim();
  if (!text || !me) return;
  $('pgo').disabled = true;
  try { pres.qid = await send(text); render(); } catch (err) { $('pans').replaceChildren(el('p', { className: 'wait', textContent: `Not sent: ${err.message}` })); } finally { $('pgo').disabled = false; }
};
document.addEventListener('keydown', (e) => {
  if (!pres.on || e.altKey || e.ctrlKey || e.metaKey || document.querySelector('dialog[open]')) return;
  const inBox = e.target === $('pq');
  if (e.key === 'ArrowRight' && (!inBox || $('pq').selectionStart === $('pq').value.length)) { e.preventDefault(); if (pres.i < pres.steps.length - 1) present(pres.i + 1); }
  else if (e.key === 'Enter' && !e.shiftKey && cur()?.kind === 'ask' && (inBox || e.target === document.body)) { e.preventDefault(); $('pask').requestSubmit(); }
});

// ── a guest's feedback (ADR-2611030930gc) ──
let gfb = { rating: 'note', about: '' };
// a guest's right-click (Halina, 9 Nov 2026: it did nothing on her link): the same note, about the part she clicked
function guestOnPart(t) {
  const on = (t.innerText || t.title || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  guestOpen('note', null); gfb.on = on; fbMark(t);
  if (on) $('fbon').textContent = `Your feedback on: “${on}”`;
}
function guestOpen(rating, a) {
  gfb = { rating, about: a?.id || '', on: '' };
  $('fbon').textContent = rating === 'note' ? 'Your feedback on this trial chat' : `${rating === 'up' ? '👍 Useful' : '👎 Not useful'}${a?.answer ? `: “${String(a.answer).split('\n')[0].slice(0, 120)}”` : ''}`;
  $('fbnote').placeholder = rating === 'note' ? 'What worked, what did not, what you would like it to do' : 'Anything to add? (optional)';
  $('fbnote').value = ''; $('fberr').textContent = ''; $('fb').showModal(); $('fbnote').focus();
}
async function guestSend() {
  const msg = me?.guest ? feedbackMessage({ name: me.name, uid: me.user.uid, email: me.user.email, rating: gfb.rating, note: gfb.on && $('fbnote').value.trim() ? `On “${gfb.on}”: ${$('fbnote').value}` : $('fbnote').value, about: gfb.about, realName: me.realName }) : null;
  if (!msg) { $('fberr').textContent = 'Write a note first.'; return; }
  $('fbsend').disabled = true;
  try {
    await addDoc(collection(db, 'elad-oren-rooms', roomId, 'messages'), { ...msg, createdAt: serverTimestamp() });
    $('fb').close();
    if (gfb.about) { ui.rated.add(gfb.about); render(); } else { $('gfbgo').textContent = '✓ Thank you'; setTimeout(() => { $('gfbgo').textContent = '✎ Send feedback'; }, 4000); }
  } catch (err) { $('fberr').textContent = `Not sent: ${err.message}`; } finally { $('fbsend').disabled = false; }
}

// ── the chat (ADR-2611030930gc): one conversation on screen, oldest at the top; the box under it sends a follow-up in the
// same thread (threadId = the conversation's first question); "New conversation" starts a fresh one; "Earlier
// conversations" lists this account's others (a director sees everyone's) ──
const chat = { thread: '', fresh: false, follow: true, list: false };
// this person's own conversations, in this browser (ask-logic.mjs ownThreads): a guest sees only the ones they started
const ownLoad = () => { try { return JSON.parse(localStorage.getItem(ownKey(me?.user?.email, me?.realName)) || '[]'); } catch { return []; } };
const ownSave = (id) => { if (!me?.guest) return; try { localStorage.setItem(ownKey(me.user.email, me.realName), JSON.stringify(addOwn(ownLoad(), id))); } catch { /* private mode */ } };
function renderChatRoom() {
  const items = conversation(rows, directors, { chat: true });
  const threads = ownThreads(chatThreads(items, { mine: me && me.guest ? me.user.email : '' }), me?.guest ? ownLoad() : null);
  if (!chat.thread && !chat.fresh && threads.length) chat.thread = [...threads].sort((a, b) => b.at - a.at)[0].id; // resume the latest
  const t = threads.find((x) => x.id === chat.thread);
  const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 80;
  renderChat($('list'), t ? t.items : [], ui, { redraw: render, examples: room.examples || [], ask: (x) => { $('q').value = x; $('ask').requestSubmit(); }, scope: inv, flat: room.flat === true,
    rate: me?.guest ? (a, rating) => guestOpen(rating, a) : null });
  const others = threads.filter((x) => x.id !== chat.thread).sort((a, b) => b.at - a.at);
  $('chats').hidden = !others.length;
  $('chats').textContent = chat.list ? 'Hide earlier conversations' : `Earlier conversations (${others.length})`;
  $('chatlist').hidden = !chat.list || !others.length;
  $('chatlist').replaceChildren(...others.map((x) => el('button', { type: 'button', textContent: x.title, dir: 'auto',
    onclick: () => { chat.thread = x.id; chat.list = false; chat.follow = true; render(); } })));
  // never while another tab is showing: it would scroll that tab, not the chat (quick review of #1191)
  if ((chat.follow || atEnd) && !$('live').hidden) { chat.follow = false; requestAnimationFrame(() => scrollTo(0, document.documentElement.scrollHeight)); }
}
if (room?.chat) {
  $('live').append($('ask')); // the box under the conversation, like a chat app
  $('q').placeholder = room.placeholder;
  $('newchat').onclick = () => { chat.thread = ''; chat.fresh = true; chat.list = false; render(); $('q').focus(); };
  $('chats').onclick = () => { chat.list = !chat.list; render(); };
  $('signout').onclick = () => signOut(auth).then(() => location.reload());
  // sign-in on the page itself: a guest with the email and password they were given (Firebase email/password; the
  // accounts are made by tools/guests.mjs login, already verified); a director with Google
  const say = (t) => { $('signmsg').textContent = t; };
  $('google').onclick = () => { say(''); signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => say(e?.code === 'auth/popup-blocked'
    ? 'The sign-in window was blocked. Please allow pop-ups for this page.' : (e?.code === 'auth/popup-closed-by-user' ? '' : 'Signing in did not work. Please try again.'))); };
  $('pwform').onsubmit = (e) => {
    e.preventDefault();
    const email = $('email').value.trim().toLowerCase(); const pw = $('pw').value;
    if (!email || !pw) return;
    $('pwgo').disabled = true; say('Signing in…');
    signInWithEmailAndPassword(auth, email, pw)
      .then(() => { say(''); $('pw').value = ''; })
      .catch((err) => say(err?.code === 'auth/too-many-requests' ? 'Too many tries. Please wait a few minutes and try again.' : 'That email and password did not match. Please check them and try again.'))
      .finally(() => { $('pwgo').disabled = false; });
  };
  // a guest's feedback (ADR-2611030930gc): 👍 / 👎 under an answer, or "Send feedback" for the chat in general; both
  // open the note box (optional for a thumb) and go into this room as one feedback message, which the relay posts to
  // #gsa naming this login and the question. Never shown back in the chat.
  $('gfbgo').onclick = () => guestOpen('note', null);
}

// ── the three tabs (Oren + Elad, 5 Nov 2026, #gsa: "chat first, then the job board, then pricing"): the page opens on
// the chat; the job board (J1) and pricing (PR) are the demo's own prepared answers, the same encrypted page and the same
// access code gate as gsa-demo, drawn in the same locked frame (preparedDoc). The code is remembered for this browser tab
// like the demo's; a room doc carrying `preparedCode` opens them with no typing. ask-logic.mjs chatTabs ──
let ctab = 'chat'; let cblob = null; let roomCode = ''; const gate = $('gate');
const tryRoomCode = () => { if (cblob && roomCode && !prep) openChatPrepared(roomCode).catch(() => { roomCode = ''; }); };
function drawChatTabs() {
  $('ctabs').replaceChildren(...chatTabs(room, prep).map(({ k, label }) => {
    const b = el('button', { type: 'button', textContent: label, onclick: () => chatTab(k) }); b.dataset.k = k; return b;
  }));
  $('ctabs').hidden = false;
}
function chatTab(k) {
  ctab = k;
  $('prepared').hidden = k === 'chat'; $('live').hidden = k !== 'chat';
  for (const b of $('ctabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.k === k);
  if (k === 'chat') { chat.follow = true; render(); $('q').focus(); return; }
  if (prep && k === 'J1' && boardOf(prep.bodies?.J1)) drawBoard();
  else if (prep) $('prepared').replaceChildren(el('iframe', { sandbox: PREPARED_SANDBOX, srcdoc: preparedDoc(prep, k), title: k })); // locked: see preparedDoc
  else { $('prepared').replaceChildren(gate); $('gerr').textContent = cblob ? '' : 'Loading…'; $('code').focus(); }
  scrollTo(0, 0);
}
// the job board, drawn here from the J1 answer's own data (6 Nov 2026; ask-logic.mjs boardOf/boardView): tap a planner
// to see only their jobs, drag a job onto a planner to assign it (this browser only, like the menu fold), Reset to undo
let bplanner = '';
const loadAssign = () => { try { return readAssign(localStorage.getItem(BOARD_KEY)); } catch { return {}; } };
const saveAssign = (m) => { try { localStorage.setItem(BOARD_KEY, JSON.stringify(m)); } catch { /* storage blocked: kept until reload */ } };
function drawBoard() {
  const cards = boardOf(prep.bodies.J1); const assign = loadAssign();
  const v = boardView(cards, { planner: bplanner, assign });
  const orig = Object.fromEntries(cards.map((c) => [c.job, c.planner]));
  const chip = (p) => {
    const b = el('button', { type: 'button', className: `pl${p.on ? ' on' : ''}`, title: `Show only ${p.planner}'s jobs; drop a job here to assign it`,
      onclick: () => { bplanner = p.on ? '' : p.planner; drawBoard(); } }, el('i', { style: `background:${p.colour || '#888'}` }), `${p.planner} · ${p.n}`);
    b.dataset.planner = p.planner;
    b.ondragover = (e) => { e.preventDefault(); b.classList.add('drop'); };
    b.ondragleave = () => b.classList.remove('drop');
    b.ondrop = (e) => { e.preventDefault(); const job = e.dataTransfer.getData('text/plain');
      if (job) { saveAssign(assignJob(loadAssign(), job, p.planner, orig[job])); drawBoard(); } };
    return b;
  };
  const card = (c) => {
    const d = el('div', { className: `bc${c.moved ? ' moved' : ''}`, draggable: true },
      el('span', { className: 'pb', style: `background:${c.colour || '#888'}`, title: c.hint || '' }, c.planner || '?'),
      el('b', {}, `Job ${c.job}`), el('div', {}, c.where), ...(c.reviewer ? [el('div', { className: 'muted' }, `Reviewed by ${c.reviewer}`)] : []),
      ...(c.moved ? [el('div', { className: 'muted' }, 'Assigned here, in this browser')] : []));
    d.ondragstart = (e) => { e.dataTransfer.setData('text/plain', c.job); e.dataTransfer.effectAllowed = 'move'; };
    return d;
  };
  const col = (c) => el('div', { className: 'bcol' }, el('h3', {}, `${c.stage} · ${c.n}`),
    ...(c.years ? c.years.map((y) => el('div', { className: 'yr' }, el('h4', {}, `${y.year} · ${y.cards.length}`), ...y.cards.map(card))) : c.cards.map(card)));
  const moved = Object.keys(assign).length;
  $('prepared').replaceChildren(el('div', { id: 'jboard' },
    el('div', { className: 'pls' }, el('span', { className: 'muted' }, 'Planners:'), ...v.planners.map(chip),
      ...(bplanner ? [el('button', { type: 'button', className: 'clr', onclick: () => { bplanner = ''; drawBoard(); } }, `✕ Show everyone`)] : []),
      ...(moved ? [el('button', { type: 'button', className: 'clr', onclick: () => { saveAssign({}); drawBoard(); } }, `Reset ${moved} assignment${moved > 1 ? 's' : ''}`)] : [])),
    el('p', { className: 'muted' }, `${v.total} jobs${bplanner ? ` for ${bplanner}` : ''}. Drag a job onto a planner to assign it; this is kept in this browser only.`),
    el('div', { className: 'bcols' }, ...v.columns.map(col)), drawPipeline(v.planners.map((p) => p.planner))));
}
// the shared potential-jobs board (11 Nov 2026, Michelle's idea via Halina): everyone on both links sees the same copy,
// kept on GSA's server; a change is a room message Cleo's relay passes on (no model call), its result written back on it
let shared = null; let sharedNote = ''; let openNotes = new Set();
function watchShared() {
  let asked = false;
  onSnapshot(doc(db, 'elad-oren-rooms', roomId, 'board', 'current'), (s) => {
    try { shared = s.exists() ? JSON.parse(s.data().json) : shared; } catch { /* a bad copy: keep the last */ }
    if (!s.exists() && !asked) { asked = true; boardCall('get'); } // ask the server only when there is no shared copy yet
    if (ctab === 'J1' && prep) drawBoard();
  }, () => { sharedNote = 'The shared board cannot be read right now.'; if (ctab === 'J1' && prep) drawBoard(); });
}
const BOARD_WAIT_MS = 30000;
async function boardCall(kind, change) {
  try {
    const ref = await addDoc(collection(db, 'elad-oren-rooms', roomId, 'messages'), { ...boardMessage({ name: me.name, realName: me.realName,
      uid: me.user.uid, email: me.user.email, guest: me.guest }, kind, change), createdAt: serverTimestamp() });
    if (kind === 'get') return;
    sharedNote = 'Saving…'; if (ctab === 'J1' && prep) drawBoard();
    const late = setTimeout(() => { stop(); sharedNote = 'No answer from the server yet; refresh in a minute to see if it saved.';
      if (ctab === 'J1' && prep) drawBoard(); }, BOARD_WAIT_MS); // never leave 'Saving…' up for good
    const stop = onSnapshot(ref, (s) => { const r = s.data()?.boardResult; if (!r) return; clearTimeout(late); stop();
      sharedNote = r.ok ? '' : (r.error === 'busy' ? 'Too many changes this hour; try again later.' : r.error === 'closed' ? CLOSED_LINE : `Not saved: ${r.error}`);
      if (ctab === 'J1' && prep) drawBoard(); }, () => {});
  } catch (e) { sharedNote = `Not saved: ${e.message}`; if (ctab === 'J1' && prep) drawBoard(); }
}
function drawPipeline(plannerNames) {
  const v = pipelineView(shared, bplanner);
  const inp = (ph, w) => el('input', { placeholder: ph, style: `width:${w}` });
  const f = { client: inp('Client', '22%'), address: inp('Address', '26%'), architect: inp('Architect', '20%'), text: inp('First note (optional)', '24%') };
  const add = el('form', { className: 'padd', onsubmit: (e) => { e.preventDefault();
    const c = Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value.trim()]));
    if (!c.client && !c.address) { sharedNote = 'Please fill in the client or the address.'; drawBoard(); return; }
    boardCall('change', { op: 'add', ...c, planner: bplanner }); } }, ...Object.values(f), el('button', { type: 'submit' }, '+ Add enquiry'));
  const when = (t) => new Date(t * 1000).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const card = (j) => {
    const sel = el('select', { onchange: () => boardCall('change', { op: 'assign', job: j.id, planner: sel.value }) },
      el('option', { value: '' }, 'Unallocated'), ...[...new Set([...plannerNames, j.planner].filter(Boolean))].map((p) => el('option', { value: p, selected: p === j.planner }, p)));
    const moves = { potential: [['loi', 'LOI sent'], ['engaged', 'Engaged'], ['lost', 'Not proceeding']], loi: [['engaged', 'Engaged'], ['lost', 'Not proceeding'], ['potential', 'Back to potential']],
      engaged: [['potential', 'Back to potential']], lost: [['potential', 'Reopen']] }[j.stage] || [];
    const note = el('input', { placeholder: 'Add a status note…' });
    const all = openNotes.has(j.id); j.notes = j.notes || []; const shown = all ? j.notes : j.notes.slice(-2);
    return el('div', { className: 'bc' },
      el('b', {}, j.client || j.address), ...(j.client && j.address ? [el('div', {}, j.address)] : []),
      ...(j.architect ? [el('div', { className: 'muted' }, `Architect: ${j.architect}`)] : []), el('div', {}, 'Planner: ', sel),
      el('div', { className: 'pn' }, ...shown.map((n) => el('div', {}, el('span', { className: 'muted' }, `${when(n.at)} ${n.by}: `), n.text)),
        ...(j.notes.length > 2 ? [el('a', { href: '#', onclick: (e) => { e.preventDefault(); all ? openNotes.delete(j.id) : openNotes.add(j.id); drawBoard(); } }, all ? 'Show less' : `All ${j.notes.length} notes`)] : [])),
      el('form', { onsubmit: (e) => { e.preventDefault(); if (note.value.trim()) boardCall('change', { op: 'note', job: j.id, text: note.value.trim() }); } }, note),
      el('div', { className: 'pmv' }, ...moves.map(([s, label]) => el('button', { type: 'button', onclick: () => boardCall('change', { op: 'stage', job: j.id, stage: s }) }, label))));
  };
  const arch = v.architects.filter((a) => a.architect !== '(no architect)');
  return el('div', { className: 'pipe' },
    el('h3', {}, `Potential jobs${bplanner ? ` · ${bplanner}` : ''}`),
    el('p', { className: 'muted' }, shared ? 'Shared with everyone in the office: a change here shows for all.' : 'Loading the shared board…'),
    ...(sharedNote ? [el('p', { className: 'muted' }, sharedNote)] : []), add,
    el('div', { className: 'bcols' }, ...v.stages.map((s) => el('div', { className: 'bcol' }, el('h3', {}, `${s.name} · ${s.jobs.length}`), ...s.jobs.map(card)))),
    ...(arch.length ? [el('h3', {}, 'Where the work comes from'), el('table', { className: 'parch' },
      el('tr', {}, ...['Architect', 'Enquiries', 'LOIs', 'Engaged', 'Not proceeding', 'Open'].map((h) => el('th', {}, h))),
      ...arch.map((a) => el('tr', {}, el('td', {}, a.architect, ...(a.loi_never_proceed ? [el('span', { className: 'muted' }, ' · asks for LOIs, has not proceeded')] : [])),
        ...[a.enquiries, a.loi, a.engaged, a.lost, a.open].map((n) => el('td', {}, String(n))))))] : []));
}
async function openChatPrepared(code) {
  const d = await decryptPrepared(cblob, code);
  if (!chatTabs(room, d).some((t) => t.k !== 'chat')) throw new Error('no answers');
  prep = d; try { sessionStorage.setItem(`prep:${roomId}`, code); } catch { /* storage blocked: asked again next load */ }
  drawChatTabs(); chatTab(chatTabs(room, d).some((t) => t.k === ctab) ? ctab : 'chat');
}
if (room?.chat && room.prepared) {
  fetch(room.prepared, { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))).then((html) => {
    cblob = preparedBlobOf(html);
    if (!cblob) throw new Error('not a prepared page');
    if (ctab !== 'chat') $('gerr').textContent = '';
    gate.onsubmit = (e) => { e.preventDefault(); $('gerr').textContent = 'Opening…';
      openChatPrepared($('code').value.trim()).catch(() => { $('gerr').textContent = 'Wrong code.'; }); };
    let c0 = ''; try { c0 = sessionStorage.getItem(`prep:${roomId}`) || ''; } catch { /* none kept */ }
    if (c0) openChatPrepared(c0).catch(() => { try { sessionStorage.removeItem(`prep:${roomId}`); } catch { /* none kept */ } tryRoomCode(); });
    else tryRoomCode();
  }).catch(() => { $('gerr').textContent = 'These tabs cannot be opened right now.'; });
}
