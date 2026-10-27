// The voice simulator: talk to Cleo inside the existing console, no new screen.
// Long-press + → speak → release = a new thread. Inside a thread: long-press its send button → a reply there.
// Slide up = lock (hands-free), slide sideways = cancel. The mic level is real and stays in this page (no network);
// the words are scripted, and they advance only while the mic hears a voice.
import { S, write, Timestamp } from './fb/firebase-firestore.js';

const LONG_MS = 350, LOCK_DY = 60, CANCEL_DX = 80, UNDO_S = 5;
const room = () => (location.hash.slice(1).split('/')[0]) || 'hq2';
const msgPaths = () => new Set([...S.keys()].filter((p) => p.startsWith(`elad-oren-rooms/${room()}/messages/`)));
const buzz = () => { try { navigator.vibrate && navigator.vibrate(15); } catch {} };

// ── what "Oren" says, sentence by sentence, and what Cleo understood so far ─────────────────────────────────────────
const NEW_THREAD = [
  { s: ['תבדקי מה קורה עם הכרטיסים שאישרתי אתמול', 'ותגידי לי מה מהם עדיין תקוע.'],
    g: ['לבדוק את הכרטיסים שאישרת אתמול', 'לבדוק את הכרטיסים שאישרת אתמול ולהגיד מה עדיין תקוע'],
    r: 'בודקת את 12 הכרטיסים שאישרת אתמול. אחזור כאן עם מה שתקוע ולמה.' },
  { s: ['תפתחי לי חדר חדש לבדיקת הקלדה קולית', 'ותזמני לי פגישה עם אלעד ביום חמישי בבוקר.'],
    g: ['חדר חדש: בדיקת הקלדה קולית', 'חדר חדש לבדיקת הקלדה קולית + פגישה עם אלעד, חמישי בבוקר'],
    r: 'פתחתי את החדר. לפגישה עם אלעד אשלח לך כרטיס עם שעה מוצעת.' },
];
const IN_THREAD = [
  { s: ['כן זה טוב,', 'רק תוסיפי גם את מה שנסגר אתמול בערב.'],
    g: ['מאשר', 'מאשר, ולהוסיף גם את מה שנסגר אתמול בערב'],
    r: 'הוספתי. הסיכום המעודכן כאן למעלה.' },
];
let nNew = 0, nIn = 0;

// ── style: everything sits inside the composer / the thread's reply box ─────────────────────────────────────────────
document.head.insertAdjacentHTML('beforeend', `<style>
#fab-new,#plus-btn,#send,.t-reply-send{touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.vs-bar{direction:rtl;display:flex;flex-direction:column;gap:3px;padding:6px 12px 4px;font-size:12.5px;color:var(--dim)}
.vs-row{display:flex;align-items:center;gap:8px}
.vs-chip{display:inline-flex;align-items:center;gap:4px;padding:0 8px;line-height:22px;border-radius:999px;border:1px solid var(--border);background:var(--panel);color:var(--text);white-space:nowrap}
.vs-meter{flex:1;height:4px;border-radius:2px;background:var(--elevated);overflow:hidden}
.vs-meter i{display:block;height:100%;width:0;background:var(--accent);border-radius:2px;transition:width 80ms linear}
.vs-hint{color:var(--faint);white-space:nowrap}
.vs-x{border:0;background:none;color:var(--dim);font-size:16px;cursor:pointer;padding:0 4px}
.vs-got{color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vs-got b{color:var(--dim);font-weight:600}
.vs-live{flex:1;min-height:38px;max-height:40vh;overflow:auto;direction:rtl;text-align:right;padding:8px 10px;border-radius:12px;
  border:1.5px solid var(--accent);background:var(--panel);color:var(--text);font:inherit;font-size:15px;line-height:1.45}
.vs-live .f{color:var(--faint)}
.vs-live .cur{display:inline-block;width:2px;height:1em;background:var(--accent);vertical-align:-2px;margin-inline-start:2px;animation:vsb 1s steps(1) infinite}
@keyframes vsb{50%{opacity:0}}
.vs-on #plus-btn,.vs-on #send,.t-reply.vs-on .t-reply-send{background:var(--accent);color:#fff;border-color:var(--accent)}
.vs-undo{direction:rtl;display:flex;align-items:center;gap:10px;padding:6px 12px;font-size:13px;color:var(--dim)}
.vs-float{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(92px + env(safe-area-inset-bottom,0px));z-index:30;background:var(--panel);border:1px solid var(--border);border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.15);white-space:nowrap}
.vs-undo button{border:1px solid var(--border);background:var(--panel);color:var(--accent);border-radius:999px;padding:2px 12px;font:inherit;font-weight:600;cursor:pointer}
#sim{position:fixed;left:16px;bottom:16px;z-index:9999;width:270px;background:var(--panel,#fff);border:1px solid var(--border);border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.18);font-size:13px;direction:rtl;overflow:hidden}
#sim .h{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border);font-weight:700;cursor:pointer}
#sim .h small{font-weight:400;color:var(--faint);margin-inline-start:auto}
#sim .b{padding:10px 12px;line-height:1.7}#sim.min .b{display:none}
#sim ol{margin:0;padding-inline-start:18px}
#sim button{width:100%;border-radius:9px;padding:7px;margin-top:8px;font:inherit;cursor:pointer;border:1px solid var(--accent);background:var(--accent);color:#fff;font-weight:600}
@media (max-width:640px){#sim{left:8px;right:8px;width:auto;top:calc(env(safe-area-inset-top,0px) + 62px);bottom:auto}}
</style>`);

// ── the real mic: a level, and "is someone speaking" — nothing is recorded or sent ──────────────────────────────────
let mic = null; // { stream, an, buf, label, headset }
const HEADSET = /head|bluetooth|bt|hands-?free|airpods|buds|earphone|wired|usb audio|jabra|bose|sony|jbl/i;
async function openMic() {
  if (mic) return mic;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser(); an.fftSize = 1024; ctx.createMediaStreamSource(stream).connect(an);
    const label = stream.getAudioTracks()[0]?.label || '';
    mic = { stream, ctx, an, buf: new Float32Array(an.fftSize), label, headset: HEADSET.test(label), floor: 0.01 };
  } catch { mic = { none: true }; }
  return mic;
}
function level() {
  if (!mic || mic.none) return { lv: 0.25 + 0.2 * Math.sin(Date.now() / 180), talking: true };
  if (mic.ctx.state === 'suspended') mic.ctx.resume();
  mic.an.getFloatTimeDomainData(mic.buf);
  let s = 0; for (const x of mic.buf) s += x * x; const rms = Math.sqrt(s / mic.buf.length);
  mic.floor = Math.min(mic.floor * 1.002 + 0.00002, Math.max(rms, 0.002)); // a slowly rising noise floor that snaps down
  return { lv: Math.min(1, rms * 9), talking: rms > Math.max(0.012, mic.floor * 2.2) };
}

// ── one listening session ───────────────────────────────────────────────────────────────────────────────────────────
let cur = null;
function targetOf(btn) {
  if (btn.id === 'fab-new' || btn.id === 'plus-btn') return { kind: 'new', host: $('composer'), wrap: $('composer').querySelector('.wrap'), ta: $('input'), send: $('send') };
  const box = btn.closest('.t-reply');
  return { kind: 'in', host: box, wrap: box, ta: box.querySelector('textarea'), send: btn, threadId: box.dataset.threadId };
}
function $(id) { return document.getElementById(id); }

const sheet = (on) => { $('composer').classList.toggle('sheet-open', on); document.body.classList.toggle('sheet-active', on); };
async function start(btn) {
  const t = targetOf(btn); buzz();
  if (t.kind === 'new') sheet(true); // the existing new-thread sheet, without the keyboard
  const script = t.kind === 'new' ? NEW_THREAD[nNew++ % NEW_THREAD.length] : IN_THREAD[nIn++ % IN_THREAD.length];
  const words = script.s.map((x) => x.split(' '));
  cur = { t, btn, script, words, si: 0, wi: 0, locked: false, last: 0 };
  t.host.classList.add('vs-on');
  const bar = document.createElement('div'); bar.className = 'vs-bar';
  bar.innerHTML = `<div class="vs-row"><span class="vs-chip">…</span><span class="vs-meter"><i></i></span><span class="vs-hint">↑ לנעילה · ↔ לביטול</span><button class="vs-x" title="ביטול">✕</button></div><div class="vs-got"><b>הבנתי:</b> <span>…</span></div>`;
  t.wrap.parentNode.insertBefore(bar, t.wrap);
  bar.querySelector('.vs-x').onclick = (e) => { e.stopPropagation(); cancel(); };
  const live = document.createElement('div'); live.className = 'vs-live';
  t.ta.style.display = 'none'; t.ta.insertAdjacentElement('afterend', live);
  cur.bar = bar; cur.live = live;
  const m = await openMic();
  if (!cur) return;
  bar.querySelector('.vs-chip').textContent = m.none ? '🎙️ סימולציה בלי מיקרופון' : m.headset ? `🎧 אוזניות` : '📱 מיקרופון הטלפון';
  if (!m.none) bar.querySelector('.vs-chip').title = m.label;
  tick();
}
function text(c = cur) {
  const done = c.words.slice(0, c.si).map((w) => w.join(' '));
  const forming = c.si < c.words.length ? c.words[c.si].slice(0, c.wi).join(' ') : '';
  return { done: done.join(' '), forming };
}
function paint() {
  const c = cur, { done, forming } = text();
  c.live.innerHTML = `${done ? `<span>${done}</span> ` : ''}${forming ? `<span class="f">${forming}</span>` : ''}<span class="cur"></span>`;
  c.live.scrollTop = c.live.scrollHeight;
  const g = c.si > 0 ? c.script.g[Math.min(c.si, c.script.g.length) - 1] : (c.wi > 2 ? 'מקשיבה…' : '…');
  c.bar.querySelector('.vs-got span').textContent = g;
}
function tick() {
  if (!cur) return;
  const c = cur, { lv, talking } = level(), now = Date.now();
  c.bar.querySelector('.vs-meter i').style.width = `${Math.round(lv * 100)}%`;
  if (talking && now - c.last > 230 && c.si < c.words.length) {
    c.last = now; c.wi++;
    if (c.wi >= c.words[c.si].length) { c.si++; c.wi = 0; } // the sentence is committed: grey → black
    paint();
  } else if (!c.live.innerHTML) paint();
  c.raf = requestAnimationFrame(tick);
}
function stop() {
  const c = cur; if (!c) return null; cur = null;
  cancelAnimationFrame(c.raf); c.bar.remove(); c.live.remove(); c.t.ta.style.display = ''; c.t.host.classList.remove('vs-on');
  if (c.t.kind === 'new') sheet(false);
  return c;
}
function cancel() { const c = stop(); if (!c) return; buzz(); flash(c.t, 'בוטל'); }
function lock() { if (!cur || cur.locked) return; cur.locked = true; buzz(); cur.bar.querySelector('.vs-hint').textContent = '🔒 נעול · לחצו שוב לשליחה'; }

async function finish() {
  const c = stop(); if (!c) return; buzz();
  const { done, forming } = text(c);
  const said = [done, forming].filter(Boolean).join(' ').trim();
  if (!said) { flash(c.t, 'לא נשמע כלום'); return; }
  const before = msgPaths();
  c.t.ta.value = said; c.t.ta.dispatchEvent(new Event('input', { bubbles: true }));
  if (c.t.kind === 'new') sheet(true);
  bypass = true; c.t.send.click(); bypass = false;
  setTimeout(() => document.activeElement?.blur?.(), 50); // a voice send never pops the keyboard
  if (c.t.kind === 'new') setTimeout(() => sheet(false), 150);
  let path = null;
  for (let i = 0; i < 20 && !path; i++) { await new Promise((r) => setTimeout(r, 100)); path = [...msgPaths()].find((p) => !before.has(p)); }
  undoStrip(c, said, path);
}
// a new thread's composer sheet closes on send, so its notes float above the +; a thread's notes sit on its reply box
const place = (t, d) => { if (t.kind === 'new') { d.classList.add('vs-float'); document.body.appendChild(d); } else t.wrap.parentNode.insertBefore(d, t.wrap); };
function flash(t, msg) { const d = document.createElement('div'); d.className = 'vs-undo'; d.textContent = msg; place(t, d); setTimeout(() => d.remove(), 1500); }
function undoStrip(c, said, path) {
  const d = document.createElement('div'); d.className = 'vs-undo';
  let n = UNDO_S; const draw = () => { d.innerHTML = `<span>✓ נשלח${c.t.kind === 'new' ? ' כשרשור חדש' : ' בשרשור'}</span><button>בטל (${n})</button>`; d.querySelector('button').onclick = undo; };
  const iv = setInterval(() => { n--; if (n <= 0) { clearInterval(iv); d.remove(); reply(c, path); } else draw(); }, 1000);
  function undo(e) {
    e.stopPropagation(); clearInterval(iv); d.remove();
    if (path) write(path, null, 'delete');
    if (c.t.kind === 'new') sheet(true);
    const ta = c.t.kind === 'new' ? $('input') : document.querySelector(`.t-reply[data-thread-id="${c.t.threadId}"] textarea`) || c.t.ta;
    ta.value = said; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus();
  }
  draw(); place(c.t, d);
}
function reply(c, path) {
  if (!path || !S.get(path)) return;
  const sent = S.get(path), threadId = sent.threadId || path.split('/').pop();
  const ms = Date.now() + 1500;
  setTimeout(() => write(`elad-oren-rooms/${room()}/messages/v${ms}`, { from: 'brain', text: c.script.r, threadId, createdAt: Timestamp.fromMillis(ms), ts: ms }), 1500);
}

// ── the gesture: long-press on + or on a thread's send; a short tap keeps its normal job ────────────────────────────
let press = null, bypass = false, swallowClick = false;
const pressable = (el) => el && el.closest && el.closest('#fab-new, #plus-btn, .t-reply-send');
document.addEventListener('pointerdown', (e) => {
  const btn = pressable(e.target);
  if (cur && cur.locked) { if (btn === cur.btn || e.target.closest('#send') || btn) { e.preventDefault(); swallowClick = true; finish(); } return; }
  if (!btn) return;
  press = { btn, x: e.clientX, y: e.clientY, id: e.pointerId, timer: setTimeout(() => { press && (press.long = true, start(btn)); }, LONG_MS) };
}, true);
document.addEventListener('pointermove', (e) => {
  if (!press || e.pointerId !== press.id) return;
  const dx = e.clientX - press.x, dy = e.clientY - press.y;
  if (!press.long) { if (Math.hypot(dx, dy) > 12) { clearTimeout(press.timer); press = null; } return; }
  if (Math.abs(dx) > CANCEL_DX) { press = null; swallowClick = true; cancel(); }
  else if (dy < -LOCK_DY) lock();
}, true);
const up = (e) => {
  if (!press || e.pointerId !== press.id) return;
  clearTimeout(press.timer);
  if (press.long) { swallowClick = true; if (cur && !cur.locked) finish(); }
  press = null;
};
document.addEventListener('pointerup', up, true);
document.addEventListener('pointercancel', up, true);
document.addEventListener('click', (e) => { if (bypass) return; if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
document.addEventListener('contextmenu', (e) => { if (pressable(e.target)) e.preventDefault(); }, true);

// ── the guide ───────────────────────────────────────────────────────────────────────────────────────────────────────
const panel = document.createElement('div'); panel.id = 'sim';
panel.innerHTML = `<div class="h">🎙️ סימולציה: לדבר עם קליאו <small>להקטין</small></div><div class="b"><ol>
<li>לחיצה ארוכה על ה־<b>+</b> הכתום ולדבר. משחררים = נשלח כשרשור חדש.</li>
<li>תוך כדי לחיצה: החלקה למעלה נועלת, אפשר לעזוב את הכפתור.</li>
<li>החלקה הצידה מבטלת.</li>
<li>בתוך שרשור פתוח: לחיצה ארוכה על כפתור השליחה שלו.</li></ol>
<div style="color:var(--faint);margin-top:6px">המילים כתובות מראש. פס הקול והמיקרופון אמיתיים, ושום דבר לא נשלח מהדף.</div>
<button id="vs-mic">הפעלת מיקרופון</button></div>`;
document.body.appendChild(panel);
panel.querySelector('.h').onclick = () => panel.classList.toggle('min');
panel.querySelector('#vs-mic').onclick = async (e) => { const m = await openMic(); e.target.textContent = m.none ? 'אין גישה למיקרופון: הסימולציה תרוץ בלי' : m.headset ? '🎧 שומעת דרך האוזניות' : '📱 שומעת דרך מיקרופון הטלפון'; e.target.disabled = true; };
