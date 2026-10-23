// The simulator: a story you step through, and the thread-hierarchy pieces drawn onto the real console.
import { S, write, Timestamp, onSnapshot, query, collection, db } from './fb/firebase-firestore.js';
const P = (room, id) => `elad-oren-rooms/${room}/messages/${id}`;
const nowTs = () => { const ms = Date.now(); return { createdAt: Timestamp.fromMillis(ms), ts: ms }; };
let seq = 0;
const say = (room, thread, text, extra = {}) => write(P(room, `s${Date.now()}${seq++}`), { from: 'brain', text, threadId: thread, ...extra, ...nowTs() });
const root = (room, id, d) => write(P(room, id), { from: 'Cleo', ...d, ...nowTs() });
const goal = (room, id, state) => write(P(room, id), { goal: { state } }, 'update');
const get = (room, id) => S.get(P(room, id));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the hierarchy, read from the store ──────────────────────────────────────────────────────────────────────────
const ROOMNAME = (r) => S.get(`elad-oren-rooms/${r}`)?.name || r;
const roots = () => [...S.entries()].filter(([p, d]) => /^elad-oren-rooms\/[^/]+\/messages\/[^/]+$/.test(p) && !d.threadId && !d.type).map(([p, d]) => ({ room: p.split('/')[1], id: p.split('/')[3], d }));
const kidsOf = (ref) => roots().filter((r) => r.d.parent === ref);
const STATE = (d) => ({ working: 'working', waiting: 'waiting', question: 'waiting', done: 'done', dropped: 'done' }[d?.goal?.state] || 'working');
const chip = (ref, faded) => { const [room, id] = ref.split('/'); const d = get(room, id); if (!d) return ''; return `<a class="hx-chip${faded ? ' faded' : ''}" href="#${room}/${id}" title="${ROOMNAME(room)}"><span class="hx-dot s-${STATE(d)}"></span><span dir="rtl">${d.title || ''}</span></a>`; };
document.head.insertAdjacentHTML('beforeend', `<style>
.hx-chip{display:inline-flex;align-items:center;gap:5px;padding:0 8px;border:1px solid var(--border);border-radius:999px;background:var(--elevated,#fff);color:var(--text);font-size:12.5px;line-height:20px;text-decoration:none;white-space:nowrap;vertical-align:middle}
.hx-chip:hover{border-color:var(--accent)}.hx-chip.faded{opacity:.5}
.hx-dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:none}
.s-working{background:var(--accent);animation:pulse-dot 1.3s ease-in-out infinite}.s-waiting{background:var(--amber)}.s-done{background:var(--dim)}.s-stuck{background:var(--red)}
.hx-ini{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;font-size:9.5px;font-weight:700;margin-inline-end:6px;vertical-align:middle}
.hx-ini.o{background:color-mix(in srgb,#3b6fd1 18%,transparent);color:#2c56a8}.hx-ini.e{background:color-mix(in srgb,#8a4fd1 18%,transparent);color:#6b3aa8}
.hx-up{margin-inline-end:6px;color:var(--faint);font-size:12px;display:inline-flex;align-items:center;gap:3px}
.hx-up .hx-chip{font-size:11.5px;line-height:17px;padding:0 6px}
.hx-kids{margin-inline-start:8px;display:inline-flex;gap:3px;align-items:center}
.hx-strip{display:flex;gap:6px;flex-wrap:wrap;padding:6px 14px 2px}
.hx-line{font-size:12px;color:var(--faint);padding:4px 14px 6px;display:flex;gap:6px;align-items:center;direction:ltr}
.hx-foot{padding:6px 14px 12px}
.hx-no{color:var(--red)}
#sim{position:fixed;left:16px;bottom:16px;z-index:9999;width:270px;background:var(--elevated,#fff);border:1px solid var(--border);border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.18);font-size:13px;direction:rtl;overflow:hidden}
#sim .h{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border);font-weight:700;cursor:pointer}
#sim .h small{font-weight:400;color:var(--faint);margin-inline-start:auto}
#sim .b{padding:10px 12px}#sim.min .b{display:none}
#sim .t{color:var(--muted,#8a8580);line-height:1.6;margin-bottom:9px;min-height:40px}
#sim button{width:100%;border-radius:9px;padding:7px;margin-bottom:6px;font:inherit;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text)}
#sim button.p{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
#sim button:disabled{opacity:.45;cursor:default}
@media (max-width:640px){#sim{left:8px;right:8px;width:auto;bottom:8px}#sim .t{min-height:0}}
</style>`);
const TOK = /\{\{(?:<bdi>)?([\w-]+\/\w+)(?:<\/bdi>)?\}\}/, TOKG = new RegExp(TOK.source, 'g');
let busy = false;
function decorate() {
  if (busy) return; busy = true;
  try {
    const room = (location.hash.slice(1).split('/')[0]) || 'hq2';
    for (const th of document.querySelectorAll('#msgs .task-thread[data-mid]')) {
      const id = th.dataset.mid, d = get(room, id), head = th.querySelector('.task-head'); if (!d || !head) continue;
      const ref = `${room}/${id}`, kids = kidsOf(ref), sig = JSON.stringify([STATE(d), kids.map((k) => STATE(k.d)), th.classList.contains('open')]);
      if (th.dataset.hx === sig && head.querySelector('.hx-mark')) continue;
      th.querySelectorAll('.hx-x').forEach((e) => e.remove()); th.dataset.hx = sig;
      const row = head.querySelector('.task-row');
      if ((d.parent || kids.length) && row) row.className = row.className.replace(/\b(done|working|waiting|stuck|on-hold|pending|replied-awaiting|fyi|notpicked)\b/g, '').trim() + ' ' + STATE(d);
      head.insertAdjacentHTML('beforeend', '<span class="hx-mark hx-x" hidden></span>');
      if (!d.parent && /^(Oren|Elad)$/.test(d.from)) head.querySelector('.task-title')?.insertAdjacentHTML('afterbegin', `<span class="hx-ini hx-x ${d.from === 'Oren' ? 'o' : 'e'}" title="Opened by ${d.from}">${d.from[0]}</span>`);
      if (d.parent) head.querySelector('.task-sub')?.insertAdjacentHTML('afterbegin', `<span class="hx-up hx-x">↳ ${chip(d.parent)}</span>`);
      if (kids.length) head.querySelector('.task-line2')?.insertAdjacentHTML('beforeend', `<span class="hx-kids hx-x" title="${kids.length} sub-threads">${kids.map((k) => `<span class="hx-dot s-${STATE(k.d)}"></span>`).join('')}</span>`);
      if (!th.classList.contains('open')) continue;
      if (kids.length) head.insertAdjacentHTML('afterend', `<div class="hx-strip hx-x">${kids.map((k) => chip(`${k.room}/${k.id}`, STATE(k.d) === 'done')).join('')}</div>`);
      if (d.parent) { const rw = th.querySelector('.t-reply-wrap'); if (rw) { rw.style.display = 'none'; rw.insertAdjacentHTML('afterend', `<div class="hx-line hx-foot hx-x">Replies go through ${chip(d.parent)}</div>`); } }
    }
    for (const el of document.querySelectorAll('#msgs .t-row-text')) if (TOK.test(el.innerHTML)) el.innerHTML = el.innerHTML.replace(TOKG, (_, r) => chip(r));
    for (const el of document.querySelectorAll('#msgs .task-sub')) if (TOK.test(el.innerHTML)) el.innerHTML = el.innerHTML.replace(TOKG, (_, r) => { const [rm, id] = r.split('/'); return get(rm, id)?.title || ''; });
  } finally { busy = false; }
}
let tmr; const later = () => { clearTimeout(tmr); tmr = setTimeout(decorate, 60); };
new MutationObserver(() => { if (!busy) later(); }).observe(document.body, { childList: true, subtree: true });
window.addEventListener('sim-store', later); window.addEventListener('hashchange', later);

// ── the story ───────────────────────────────────────────────────────────────────────────────────────────────────
const STEPS = [
  { label: 'השיחה היומית פותחת 3 תתי שרשורים בחדרי הלקוחות', async run() {
    root('brickwise', 'quote', { title: 'הצעת מחיר לשלב 2', text: 'להכין הצעה לשלב 2 לפי מה שסוכם בשיחה היומית.', parent: 'hq2/daily', goal: { state: 'working' } });
    root('book-generator', 'ch3', { title: 'טיוטת פרק 3', text: 'לכתוב את פרק 3 לפי ההערות מהשיחה היומית.', parent: 'hq2/daily', goal: { state: 'working' } });
    root('tabs', 'sum', { title: 'סיכום פגישה ל־TABS', text: 'לכתוב סיכום של הפגישה עם Cindy.', parent: 'hq2/daily', goal: { state: 'working' } });
    await wait(50);
    for (const [r, id] of [['brickwise', 'quote'], ['book-generator', 'ch3'], ['tabs', 'sum']]) say(r, id, 'מתחילה.');
    say('hq2', 'daily', 'מהשיחה יצאו 3 משימות, כל אחת בחדר של הלקוח שלה. אני אחראית עליהן ומעדכנת אותך כאן.');
    return 'בשורה של השיחה היומית הופיעו 3 נקודות, ובתוכה שורה עם שלושת השמות. לחץ על אחד מהם כדי להציץ, וחזור.';
  } },
  { label: 'תת־שרשור שואל שאלה', async run() {
    say('brickwise', 'quote', 'טיוטת ההצעה מוכנה. לא ברור אם לכלול את שלב ההתקנה. שולחת את השאלה ל־{{hq2/daily}}.'); goal('brickwise', 'quote', 'waiting');
    say('hq2', 'daily', '{{brickwise/quote}} שואל אם לכלול את שלב ההתקנה. מהשיחה זה לא ברור, אז אני שואלת אותך.');
    write(P('hq2', 'q1'), { from: 'brain', type: 'question', status: 'pending', for: 'Oren', text: 'לכלול את שלב ההתקנה בהצעה של Brickwise?', options: ['כן, לכלול', 'לא'], threadId: 'daily', ...nowTs() });
    goal('hq2', 'daily', 'question'); location.hash = 'hq2/daily';
    return 'השאלה הגיעה אליך בשיחה היומית, לא בחדר של Brickwise. ענה בכרטיס כדי להמשיך.';
  }, blockedUntil: () => get('hq2', 'q1')?.status !== 'pending' },
  { label: 'תת־שרשור נתקע', async run() {
    goal('book-generator', 'ch3', 'waiting');
    setTimeout(() => {
      say('book-generator', 'ch3', '↻ {{hq2/daily}} הפעיל אותי מחדש. ממשיכה.'); goal('book-generator', 'ch3', 'working');
      say('hq2', 'daily', '{{book-generator/ch3}} לא זז 40 דקות. בדקתי: הוא נתקע בהורדת התמונות. הפעלתי אותו מחדש, והוא עובד.');
      note('השיחה היומית טיפלה בזה לבד ורק דיווחה לך. הנקודה חזרה לצבע של עבודה.');
    }, 2500);
    return 'הנקודה של פרק 3 הפכה כתומה. אתה לא צריך לעשות כלום. חכה רגע…';
  } },
  { label: 'תת־שרשור פותח תת־שרשור משלו (בנייה)', async run() {
    root('brickwise-build', 'build', { title: 'בנייה: עמוד ההצעה באתר', text: 'לבנות את עמוד ההצעה באתר של Brickwise.', parent: 'brickwise/quote', goal: { state: 'working' } });
    await wait(50); say('brickwise-build', 'build', 'בונה.');
    say('brickwise', 'quote', 'פתחתי תת־שרשור לבנייה: {{brickwise-build/build}}');
    return 'ההצעה ב־Brickwise פתחה תת־שרשור בחדר הבנייה. זו רמה שנייה, והיא אחראית עליו. בשיחה היומית לא השתנה כלום.';
  } },
  { label: 'סיכום TABS מסתיים', async run() {
    say('tabs', 'sum', 'הסיכום כתוב. מדווחת למעלה.'); goal('tabs', 'sum', 'done');
    say('hq2', 'daily', '✓ {{tabs/sum}} הסתיים: הסיכום מוכן. הוא לא נשלח ל־Cindy בלי האישור שלך.');
    return 'אחת הנקודות הפכה אפורה, והתוצאה הגיעה לשיחה היומית. נסה עכשיו לסגור את השיחה היומית.';
  } },
  { label: 'כל השאר מסתיימים', async run() {
    say('brickwise-build', 'build', 'נבנה ונבדק.'); goal('brickwise-build', 'build', 'done');
    say('brickwise', 'quote', '✓ {{brickwise-build/build}} הסתיים. ההצעה מוכנה, כולל שלב ההתקנה.'); goal('brickwise', 'quote', 'done');
    say('book-generator', 'ch3', 'הפרק מוכן.'); goal('book-generator', 'ch3', 'done');
    say('hq2', 'daily', '✓ {{brickwise/quote}} הסתיים: ההצעה והעמוד מוכנים.\n✓ {{book-generator/ch3}} הסתיים: הפרק מוכן.\nכל מה שיצא מהשיחה טופל.');
    return 'הכל הסתיים מלמטה למעלה. עכשיו אפשר לסגור את השיחה היומית.';
  } },
];
let i = 0;
const box = document.createElement('div'); box.id = 'sim';
box.innerHTML = '<div class="h">🎛 סימולטור <small>נתונים מומצאים</small></div><div class="b"><div class="t"></div><button class="p">▶ הצעד הבא</button><button class="c">נסה לסגור את השיחה היומית</button><button class="r">↺ מההתחלה</button></div>';
const T = box.querySelector('.t'), N = box.querySelector('.p');
const note = (s) => { T.textContent = s; };
function refresh() {
  const s = STEPS[i], prev = STEPS[i - 1];
  const blocked = prev && prev.blockedUntil && !prev.blockedUntil();
  N.disabled = !s || blocked;
  N.textContent = s ? `▶ ${s.label}` : '▶ הסיפור נגמר';
}
N.onclick = async () => { const s = STEPS[i++]; N.disabled = true; note(await s.run()); refresh(); };
box.querySelector('.c').onclick = () => {
  location.hash = 'hq2/daily';
  const open = kidsOf('hq2/daily').flatMap((k) => [k, ...kidsOf(`${k.room}/${k.id}`)]).filter((k) => STATE(k.d) !== 'done');
  if (STATE(get('hq2', 'daily')) === 'done') return note('השיחה היומית כבר סגורה.');
  if (!kidsOf('hq2/daily').length) return note('עוד אין תתי שרשורים. לחץ "הצעד הבא".');
  if (open.length) { say('hq2', 'daily', `✋ אי אפשר לסגור: ${open.length} תתי שרשורים עדיין פתוחים: ${open.map((k) => `{{${k.room}/${k.id}}}`).join(' ')}`); return note('הסגירה נחסמה, כי שרשור לא נסגר כל עוד משהו שהוא פתח עדיין רץ.'); }
  say('hq2', 'daily', 'כל המשימות מהשיחה הסתיימו. סוגרת את השרשור.'); goal('hq2', 'daily', 'done');
  note('השיחה היומית נסגרה, אחרי שכל תתי השרשורים שלה הסתיימו.');
};
box.querySelector('.r').onclick = () => { location.hash = 'hq2/daily'; location.reload(); };
box.querySelector('.h').onclick = () => box.classList.toggle('min');
document.body.appendChild(box);
note('אתה בקונסול עם נתונים מומצאים, בשיחה היומית שפתחת בחדר Boss. לחץ על הצעד הבא. אפשר לגלוש בחדרים ובשרשורים כרגיל.');
refresh(); window.addEventListener('sim-store', refresh);
// a director's reply anywhere gets a short simulated answer
const seen = new Set();
onSnapshot(query(collection(db, 'elad-oren-rooms/hq2/messages')), () => {});
window.addEventListener('sim-store', () => {
  for (const [p, d] of S) {
    if (d.type === 'question' && d.status === 'answered' && !seen.has(p + ':a')) { seen.add(p + ':a'); answerFlow(d.answer); }
    if (seen.has(p) || !/\/messages\//.test(p)) continue; seen.add(p);
    if (d.threadId && /^(Oren|Elad|director)$/i.test(d.from || '') && d.ts > Date.now() - 5000) { const room = p.split('/')[1]; setTimeout(() => say(room, d.threadId, 'קיבלתי. (בסימולטור אין תשובות אמיתיות.)'), 900); }
  }
});
for (const p of S.keys()) seen.add(p);
function answerFlow(ans) {
  goal('hq2', 'daily', 'working');
  say('hq2', 'daily', `העברתי את התשובה ל־{{brickwise/quote}}.`);
  say('brickwise', 'quote', `↓ תשובה מ־{{hq2/daily}}: ${ans}. מעדכנת את ההצעה.`); goal('brickwise', 'quote', 'working');
  note('ענית בשיחה היומית, והתשובה ירדה לבד לתת־השרשור. הנקודה שלו חזרה לצבע של עבודה.');
  setTimeout(refresh, 50);
}
