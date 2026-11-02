// tests/ai-vision.test.mjs — renders ai-vision/ (from disk, file://, no server of any kind) in a real headless
// Chrome and checks the one-picture deck (Sir, 2 Nov 2026): eight scenes over one picture of the whole system, the
// camera fitting each scene's part of the picture, detail shown only when zoomed in, the "play a question" flow
// down to the governed data layer (never the sources) and back, data flowing into that layer on the data scene,
// every slice under its own wire, the milestones (Retail done, then the Retail agent + Merch, then every function),
// the night run (the proactive engine briefs the chief of staff; the plan goes to the right head), the lab beside the
// functions, every caption fitting the screen at common sizes, phone width, self-containment
// and dark mode.
// Same harness as tests/ai-blueprint.test.mjs: plain Node, Chrome driven over its DevTools protocol on loopback
// (127.0.0.1 only, closed at the end of the run) — no tunnel, no web server.
// Run: `node --test tests/ai-vision.test.mjs` (skipped, not failed, where no Chrome exists;
// set CHROME=/path/to/chrome if it is not in the default place). It is not yet part of `npm run check`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PAGE = pathToFileURL(path.resolve('ai-vision/index.html')).href;
const CHROME = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));

let proc, ws, profile, seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
const current = () => evaluate(`scene`);
const key = async k => {
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: k === 'ArrowRight' ? 39 : 37 });
};
const clickAt = async (x, y) => {
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
};
const swipe = async (x0, x1) => {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: 300 }] });
  for (let k = 1; k <= 5; k++) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * k / 5, y: 300 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await new Promise(r => setTimeout(r, 50));
};

const skip = CHROME ? false : 'no Chrome on this machine (set CHROME=/path/to/chrome)';
before(async () => {
  if (skip) return;
  profile = mkdtempSync(path.join(tmpdir(), 'aivs-'));
  proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    proc.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\S+)/); if (m) res(m[1]); });
    setTimeout(() => rej(new Error('Chrome did not start')), 15000);
  });
  const port = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  ws.onmessage = e => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await new Promise(r => { ws.onopen = r; });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 50 && (await evaluate('document.readyState')) !== 'complete'; i++) await new Promise(r => setTimeout(r, 100));
});
after(async () => {
  if (skip) return;
  ws?.close();
  if (proc && proc.exitCode === null) { const gone = new Promise(r => proc.once('exit', r)); proc.kill(); await gone; }
  // Chrome's helper processes can still be writing the temp profile after the main one exits: removing it is best-effort.
  if (profile) try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  try { rmSync(SHOTS, { recursive: true, force: true }); } catch {}
});


const sleep = ms => new Promise(r => setTimeout(r, ms));
const goTo = n => evaluate(`go(${n})`);
const settle = () => sleep(1700);
const rect = sel => evaluate(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()`);
// Each milestone-step screenshot (local to the Mac, outside the repo, for a human to eyeball) lands here.
const SHOTS = mkdtempSync(path.join(tmpdir(), 'aivs-shots-'));
async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(SHOTS, `${name}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  assert.ok(statSync(file).size > 1000, `${name} screenshot is suspiciously small`);
  return file;
}
const solidIds = () => evaluate(`[...document.querySelectorAll('#world [data-ms][id]')].filter(e => !e.classList.contains('gh')).map(e => e.id).sort()`);

test('eight scenes over one picture, one caption at a time', { skip }, async () => {
  assert.deepEqual(await evaluate(`SCENES.map(s => s.id)`), ['title', 'question', 'l1', 'l2', 'l3', 'ms', 'night', 'lab']);
  for (let n = 0; n < 8; n++) {
    await goTo(n);
    assert.equal(await current(), n);
    assert.equal(await evaluate(`document.querySelectorAll('.panel.on').length`), 1, `scene ${n + 1}: exactly one caption`);
  }
  assert.equal(await evaluate(`document.querySelectorAll('#world').length`), 1, 'one picture, shared by every scene');
});

test('the camera fits each layer scene to its layer, and the focused layer is the bright one', { skip }, async () => {
  for (const [n, layer] of [[2, 'L1'], [3, 'L2'], [4, 'L3']]) {
    await goTo(n); await settle();
    const v = await rect('#view'), L = await rect('.' + layer);
    const h = Math.min(L[3], v[3]) - Math.max(L[1], v[1]);
    assert.ok(h >= (L[3] - L[1]) * 0.9, `scene ${n + 1}: ${layer} sits inside the view`);
    const dim = await evaluate(`[...document.querySelectorAll('#world .n')].filter(e => +getComputedStyle(e).opacity < .5).length`);
    assert.ok(dim > 0, `scene ${n + 1}: the other layers recede`);
  }
});

test('level of detail: tool names and data slices show only when that layer is in focus', { skip }, async () => {
  const shown = sel => evaluate(`getComputedStyle(document.querySelector('${sel}')).visibility === 'visible' && +getComputedStyle(document.querySelector('${sel}')).opacity > .9`);
  await goTo(0); await settle();
  assert.equal(await shown('#sl-retail'), false); assert.equal(await shown('#n-tools .chips'), false);
  await goTo(2); await settle();
  assert.equal(await shown('#sl-retail'), true, 'data slices show on the data layer');
  assert.equal(await shown('#n-tools .chips'), false);
  await goTo(3); await settle();
  assert.equal(await shown('#n-tools .chips'), true, 'tools show on the AI Hub');
});

test('alignment: every slice of the governed layer sits under its own wire, and zoomed layers share the caption margins', { skip }, async () => {
  await goTo(2); await settle();
  const off = await evaluate(`(() => {
    const m = getComputedStyle(world).transform.match(/matrix\\(([^)]+)\\)/)[1].split(',').map(Number); // a, b, c, d, tx, ty
    const want = { 'sl-retail': X.retail, 'sl-merch': X.merch, 'sl-exec': MID, 'sl-buying': X.buying, 'sl-more': X.more, 'sl-lab': X.lab };
    return Object.entries(want).map(([id, x]) => { const r = document.getElementById(id).getBoundingClientRect(), s = deck.getBoundingClientRect().width / deck.offsetWidth;
      return [id, Math.abs((r.left + r.width / 2) / s - (m[4] + x * m[0]))]; });
  })()`);
  for (const [id, d] of off) assert.ok(d < 1.5, `${id} is ${d.toFixed(1)}px off its wire`);
  const caption = await rect('.panel.on .pts'), gov = await rect('#n-gov');
  assert.ok(Math.abs(caption[0] - gov[0]) < 2 && Math.abs(caption[2] - gov[2]) < 2, 'the data layer spans the caption margins');
});

test('one question: it travels down to the governed data layer, never the sources, and the answer comes back', { skip }, async () => {
  await goTo(1);
  let seen = 0;
  for (let k = 0; k < 30 && !seen; k++) { await sleep(100); seen = await evaluate(`document.querySelectorAll('#dots circle').length`); }
  assert.ok(seen > 0, 'dots are travelling');
  assert.equal(await evaluate(`document.querySelector('.s-question').classList.contains('answered')`), false);
  // paced for a live room (about 17 s end to end)
  for (let k = 0; k < 120 && !(await evaluate(`document.querySelector('.s-question').classList.contains('answered')`)); k++) await sleep(250);
  assert.equal(await evaluate(`document.querySelector('.s-question').classList.contains('answered')`), true, 'the answer shows');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#world .done')].map(e => e.id).sort()`),
    ['n-buying', 'n-check', 'n-cos', 'n-exec', 'n-gov', 'n-merch', 'n-retail']);
  assert.ok(await evaluate(`Math.max(...down.flatMap(p => p.segs.map(s => Math.max(s[1], s[3]))))`) <= 676, 'no dot goes past the governed layer');
  await screenshot('question-answered');
  await goTo(3);
  assert.equal(await evaluate(`document.querySelectorAll('#world .done, #world .lit, #dots circle').length`), 0, 'leaving the scene clears the flow');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await goTo(1);
  assert.equal(await evaluate(`document.querySelector('.s-question').classList.contains('answered')`), true, 'reduced motion: the answer shows at once');
  await send('Emulation.setEmulatedMedia', { features: [] });
});

test('the data scene: data keeps flowing from the sources into the governed layer, and stops when you leave', { skip }, async () => {
  await goTo(2); await sleep(1600);
  const ys = () => evaluate(`[...document.querySelectorAll('#dots .flow')].map(c => +c.getAttribute('cy'))`);
  const a = await ys(); await sleep(300); const b = await ys();
  assert.equal(a.length, 14, 'two dots for each of the seven real sources');
  assert.ok(a.some((y, i) => y !== b[i]), 'the dots move');
  assert.ok(b.every(y => y >= 782 && y <= 852), 'they stay between the sources and the layer');
  await goTo(3);
  assert.equal(await evaluate(`document.querySelectorAll('#dots circle').length`), 0, 'leaving the scene stops the flow');
});

test('milestones: Retail is done, then the Retail agent and Merch, then every function', { skip }, async () => {
  await goTo(5); await settle();
  const want = {
    1: ['n-retail', 's-dayforce', 's-statelake', 't-contracts'],
    2: ['n-check', 'n-cos', 'n-gov', 'n-merch', 'n-retail', 'n-road', 's-dayforce', 's-qlik', 's-statelake', 's-wms', 'sl-exec', 'sl-merch', 'sl-retail', 't-contracts', 't-dayforce', 't-callin', 't-mail'],
  };
  const shown = sel => evaluate(`getComputedStyle(document.querySelector('${sel}')).visibility === 'visible'`);
  assert.equal(await shown('#t-dayforce'), true, 'the tools show on the milestones scene');
  assert.match(await evaluate(`document.getElementById('t-dayforce').textContent + ' / ' + document.getElementById('t-callin').textContent`), /Write to Dayforce.*Retail \/ Call in.*Merch/);
  for (const m of [1, 2, 3]) {
    await evaluate(`document.querySelector('.msbtn [data-m="${m}"]').click()`);
    assert.equal(await current(), 5, 'a step does not change the scene');
    const ids = await solidIds();
    if (m < 3) assert.deepEqual(ids, want[m].sort(), `solid in step ${m}`);
    else assert.equal(await evaluate(`document.querySelectorAll('#world .gh').length`), 0, 'step 3: everything is built');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.mslist')].filter(u => !u.hidden).map(u => u.dataset.for)`), [String(m)]);
    await screenshot(`milestone-0${m}`);
  }
  assert.match(await evaluate(`document.querySelector('.msbtn [data-m="1"]').textContent`), /Done/);
  await goTo(4);
  assert.equal(await evaluate(`document.querySelectorAll('#world .gh').length`), 0, 'outside the milestones scene the whole picture is solid');
});

test('the night run: the engine briefs the chief of staff by morning, and the plan goes to the Head of Merch', { skip }, async () => {
  await goTo(6);
  const N = cls => evaluate(`document.querySelector('.s-night').classList.contains('${cls}')`);
  let seen = 0;
  for (let k = 0; k < 30 && !seen; k++) { await sleep(100); seen = await evaluate(`document.querySelectorAll('#dots circle').length`); }
  assert.ok(seen > 0, 'the night run is moving');
  assert.equal(await N('morning'), false, 'the brief waits for the morning');
  for (let k = 0; k < 120 && !(await N('sent')); k++) await sleep(250);
  assert.equal(await N('sent'), true, 'the plan is sent');
  assert.match(await evaluate(`document.getElementById('nclock').textContent`), /07:00/);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#world .done')].map(e => e.id).sort()`),
    ['n-check', 'n-cos', 'n-engine', 'n-exec', 'n-gov', 'n-merch']);
  await screenshot('night-sent');
  await goTo(5);
  assert.equal(await evaluate(`document.querySelectorAll('#world .done, #world .lit, #dots circle').length`), 0, 'leaving the scene clears the run');
  assert.equal(await N('morning'), false);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await evaluate(`dispatchEvent(new Event('resize'))`);
  await goTo(6);
  assert.equal(await N('sent'), true, 'reduced motion: the end state shows at once');
  const [b, h] = await evaluate(`(() => { let b = 0; document.querySelectorAll('.s-night *').forEach(e => { const q = e.getBoundingClientRect(); if (q.width) b = Math.max(b, q.bottom); }); return [b, innerHeight]; })()`);
  assert.ok(b <= h - 8, `the morning brief fits at 1280x720 (${Math.round(b)} of ${h})`);
  await send('Emulation.setEmulatedMedia', { features: [] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await evaluate(`dispatchEvent(new Event('resize'))`);
});

test('the lab: the full picture, with the lab as one more container beside the functions', { skip }, async () => {
  await goTo(7); await settle();
  assert.equal(await evaluate(`+getComputedStyle(world).opacity`), 1, 'the whole picture stays on screen');
  assert.equal(await evaluate(`document.querySelectorAll('.ask, .next3, #labscene').length`), 0, 'no path or decision boxes');
  assert.equal(await evaluate(`+getComputedStyle(document.getElementById('n-lab')).opacity`), 1);
  assert.ok(await evaluate(`+getComputedStyle(document.getElementById('n-retail')).opacity`) < .5, 'the live functions step back');
  const [lab, more] = [await rect('#n-lab'), await rect('#n-more')];
  assert.ok(lab[0] > more[2] && lab[3] === more[3], 'the lab sits beside the functions, on the same baseline');
});

test('every caption fits the screen at common sizes, and no transition is left running once a scene settles', { skip }, async () => {
  for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080], [2560, 1080]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate(`dispatchEvent(new Event('resize'))`);
    for (const n of [0, 2, 3, 4, 5, 7]) {
      await goTo(n); await settle();
      const [ok, why] = await evaluate(`(() => {
        const p = document.querySelector('.panel.on'), r = p.getBoundingClientRect();
        let b = 0, rt = 0; p.querySelectorAll('*').forEach(e => { const q = e.getBoundingClientRect(); if (q.width) { b = Math.max(b, q.bottom); rt = Math.max(rt, q.right); } });
        const nav = document.querySelector('nav').getBoundingClientRect();
        return [b <= innerHeight - 8 && rt <= innerWidth && r.top >= nav.bottom - 4, [Math.round(b), innerHeight, Math.round(r.top), Math.round(nav.bottom)].join(' ')]; })()`);
      assert.ok(ok, `${width}x${height} scene ${n + 1}: caption spills (${why})`);
      assert.equal(await evaluate(`document.getAnimations().length`), 0, `${width}x${height} scene ${n + 1}: something is still moving`);
    }
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await evaluate(`dispatchEvent(new Event('resize'))`);
});

test('phone width: no scene spills sideways', { skip }, async () => {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`dispatchEvent(new Event('resize'))`);
  assert.equal(await evaluate(`deck.classList.contains('portrait')`), true);
  for (let n = 0; n < 8; n++) { await goTo(n); assert.equal(await evaluate(`document.documentElement.scrollWidth`), 390, `scene ${n + 1} overflows sideways`); }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await evaluate(`dispatchEvent(new Event('resize'))`);
});

test('self-contained: nothing loads from outside the page folder', { skip }, async () => {
  const ext = await evaluate(`[...document.querySelectorAll('[src],[href]')].map(e => e.getAttribute('src') || e.getAttribute('href')).filter(u => /^(https?:)?\\/\\//.test(u))`);
  assert.deepEqual(ext, []);
  assert.deepEqual(await evaluate(`performance.getEntriesByType('resource').map(r => r.name).filter(u => !u.startsWith('file:'))`), []);
});

test('public page carries no client or people names (the named exec version lives on a private link)', { skip }, async () => {
  const text = await evaluate(`document.documentElement.outerHTML`);
  for (const w of [/Broadway/, /\bMark\b/, /Hilton/, /\bJD\b/]) assert.doesNotMatch(text, w);
  assert.doesNotMatch(text, /Sydney|ap-southeast/, 'no hosting-location claim (Sir, 2 Nov)');
});

test('dark mode: the theme switches', { skip }, async () => {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  assert.equal(await evaluate(`getComputedStyle(document.body).backgroundColor`), 'rgb(21, 23, 28)');
  await send('Emulation.setEmulatedMedia', { features: [] });
});
