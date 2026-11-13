// tests/yael-faq-chat.test.mjs — Yael's site assistant (yael/site/faq-chat.js) answers in the QUESTION's language,
// whichever page it is on, and the keyword fixes pick the right answer. Drives the real script on a tiny fake page.
// Run: `node --test tests/yael-faq-chat.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../yael/site/faq-chat.js', import.meta.url), 'utf8');

function el(tag) {
  const e = { tag, children: [], style: {}, dataset: {}, classList: { add() {} }, className: '', textContent: '', _q: {},
    appendChild(c) { c.parent = e; e.children.push(c); return c; },
    insertBefore(c) { return e.appendChild(c); },
    remove() { if (e.parent) e.parent.children = e.parent.children.filter(x => x !== e); },
    querySelector(s) { return e._q[s] || (e._q[s] = el(s)); },
    querySelectorAll(s) { return s === 'p' ? [el('p'), el('p')] : []; },
    getAttribute() { return ''; }, set innerHTML(v) {}, get innerHTML() { return ''; } };
  return e;
}

async function page(lang) {
  const doc = el('document');
  doc.documentElement = { lang }; doc.head = el('head'); doc.createElement = el;
  const hero = el('hero');
  doc.querySelector = s => (s === 'header.hero .copy' ? hero : null);
  const ctx = { document: doc, setTimeout: f => f(), Promise, encodeURIComponent, window: {} };
  vm.runInNewContext(SRC, ctx);
  const card = hero.children.find(c => c.tag === '.ya-c');
  const m = card.querySelector('.ya-m'), f = card.querySelector('form'), inp = f.querySelector('input');
  const flush = async () => { for (let i = 0; i < 50; i++) await null; };
  await flush();
  return async q => {
    const from = m.children.length;
    inp.value = q; f.onsubmit({ preventDefault() {} }); await flush();
    return m.children.slice(from + 1).map(c => c.textContent).join(' | ');
  };
}

const cases = [
  ['הבן שלי בן 9 וסובל מחרדות', 'יעל עובדת עם ילדים'],
  ['עברנו לסידני לפני חצי שנה וקשה לי מאוד', 'זה תחום שקרוב ללב'],
  ['כמה עולה פגישה?', 'על המחיר יעל מדברת'],
  ['Where are sessions held?', 'Yael sees people in her Sydney clinic'],
];

test('EN page: each acceptance question gets the right answer, in the question\'s language', async () => {
  const ask = await page('en');
  for (const [q, want] of cases) assert.match(await ask(q), new RegExp(want), q);
});

test('HE page: an English question gets the English answer and English follow-up', async () => {
  const ask = await page('he');
  const out = await ask('Where are sessions held?');
  assert.match(out, /Yael sees people in her Sydney clinic/);
  assert.match(out, /Anything else you'd like to know\?/);
  assert.doesNotMatch(out, /עוד משהו/);
});

test('EN page: an unmatched Hebrew question gets the Hebrew "not sure" reply and Hebrew WhatsApp button', async () => {
  const ask = await page('en');
  const out = await ask('שולחן ירוק');
  assert.match(out, /שאלה טובה/);
  assert.match(out, /לשלוח את השאלה ליעל בוואטסאפ/);
  assert.doesNotMatch(out, /Good question/);
});

test('no letters at all: falls back to the page\'s language', async () => {
  assert.match(await (await page('he'))('???'), /שאלה טובה/);
  assert.match(await (await page('en'))('???'), /Good question/);
});

test('"How many sessions" still gets the duration answer, not the location one', async () => {
  assert.match(await (await page('en'))('How many sessions will I need?'), /differs from person to person/);
});

test('a method Yael does not list goes to Yael, in the question\'s language', async () => {
  const out = await (await page('en'))('את מכירה גם שיטות של היפנוזה?');
  assert.match(out, /שאלה טובה/); assert.match(out, /לשלוח את השאלה ליעל בוואטסאפ/);
  assert.doesNotMatch(out, /משלבת כלים/);
  for (const q of ['Do you do NLP?', 'Can you prescribe medication?', 'Do you offer reiki?'])
    assert.match(await (await page('he'))(q), /Good question/, q);
});

test('her own methods keep the methods answer', async () => {
  for (const q of ['do you use CBT?', 'Do you use art or drawing?'])
    assert.match(await (await page('en'))(q), /combines tools from several approaches/, q);
  assert.match(await (await page('he'))('אתם עובדים עם EMDR?'), /EMDR/);
});

// Page content (13 Nov update): read relative to this file so the test runs from any directory.
const read = f => readFileSync(new URL('../yael/site/' + f, import.meta.url), 'utf8');
const EN = read('index.html'), HE = read('he/index.html');

test('"clients", never "patients", on both pages and in the assistant', () => {
  for (const [f, t] of [['index.html', EN], ['he/index.html', HE], ['faq-chat.js', SRC]])
    assert.doesNotMatch(t, /patient|מטופל/i, f);
});

test('About carries EMDR, soldiers/Swords of Iron, Defence Ministry and remote work since COVID, in both languages', () => {
  for (const re of [/EMDR training \(Level 2\)/, /Ministry of Defence/, /Swords of Iron/, /Since the COVID years/]) assert.match(EN, re);
  for (const re of [/הכשרה ב־EMDR \(שלב 2\)/, /משרד הביטחון/, /חרבות ברזל/, /מאז תקופת הקורונה/]) assert.match(HE, re);
});

test('EN and HE pages stay aligned: same sections, same WhatsApp buttons, one hero, same assistant and analytics', () => {
  const ids = t => [...t.matchAll(/<section[^>]*id="([^"]+)"/g)].map(m => m[1]);
  const wa = t => [...t.matchAll(/data-wa="([^"]+)"[^>]*href="(https:\/\/wa\.me\/\d+)"/g)].map(m => m[1] + m[2]);
  assert.deepEqual(ids(HE), ids(EN));
  assert.deepEqual(wa(HE), wa(EN));
  assert.ok(wa(EN).length > 0);
  for (const t of [EN, HE]) {
    assert.equal((t.match(/<header class="hero">/g) || []).length, 1);
    assert.match(t, /faq-chat\.js/);
    assert.match(t, /G-L2NNW884NK/);
  }
});

test('hero on phones shows the whole sea photo (no side crop), face position unchanged', () => {
  for (const t of [EN, HE]) {
    assert.match(t, /\.hero \.photo\{min-height:0;aspect-ratio:605\/650;order:-1\}/);
    assert.match(t, /hero-sea-wide\.jpg\) center 30%\/cover/);
  }
});

test("Yael's approach quote is in My approach, verbatim, in both languages", () => {
  const sec = t => t.slice(t.indexOf('id="approach"'), t.indexOf('</section>', t.indexOf('id="approach"')));
  assert.match(sec(HE), /<blockquote>״אני עוד מעדיפה לחשוב שהבן אדם מטפל בעצמו, ואני רק נמצאת שם כעדות\.״<\/blockquote>/);
  assert.match(sec(EN), /<blockquote>“I still prefer to think that the person heals themselves, and I am only there as a witness\.”<\/blockquote>/);
});
