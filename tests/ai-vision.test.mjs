// tests/ai-vision.test.mjs — renders ai-vision/ (from disk, file://, no server of any kind) in a real headless
// Chrome and checks the vertical layer stack: the milestone steps (only that milestone's boxes solid, with a
// screenshot per step, plus a reduced-motion run stepping through every milestone with no animation), the zoom
// transition and its own reduced-motion fallback, the neighbour-layer strips, the AI Hub rename, phone width,
// print, and self-containment. Same harness as tests/ai-blueprint.test.mjs: plain Node, Chrome driven over its
// DevTools protocol on loopback (127.0.0.1 only, closed at the end of the run) — no tunnel, no web server.
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
const current = () => evaluate(`[...document.querySelectorAll('.slide')].findIndex(s => s.classList.contains('on'))`);
const visibleCount = () => evaluate(`[...document.querySelectorAll('.slide')].filter(s => getComputedStyle(s).display !== 'none').length`);
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
const solid = () => evaluate(`[...document.querySelectorAll('#mstack .bx')].filter(b => !b.classList.contains('gh')).map(b => b.textContent).sort()`);
// Each milestone-step screenshot (local to the Mac, outside the repo, for a human to eyeball) lands here.
const SHOTS = mkdtempSync(path.join(tmpdir(), 'aivs-shots-'));
async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(SHOTS, `${name}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  assert.ok(statSync(file).size > 1000, `${name} screenshot is suspiciously small`);
  return file;
}
const MS = {
  1: ['Agent surfaces', 'Downstream systems · order entry', 'Merchandising agent', 'MotherDuck · governed layer', 'MotherDuck MCP Server', 'POS sales', 'Qlik Sense', 'Stock & operations feeds'],
  2: ['Agent surfaces', 'Chat', 'Dayforce', 'Downstream systems · Dayforce ingestion', 'MotherDuck · governed layer', 'MotherDuck MCP Server', 'POS sales', 'Rosters and insights', 'Store Operations agent', 'Store traffic counters'],
};

test('six slides: the stack, three layer zooms, milestones, the lab', { skip }, async () => {
  assert.equal(await evaluate(`document.querySelectorAll('.slide').length`), 6);
  assert.equal(await current(), 0);
  assert.equal(await evaluate(`[...document.querySelectorAll('.slide')].filter(s => getComputedStyle(s).visibility === 'visible').length`), 1);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.slide')].map(s => s.dataset.z || '')`), ['all', 'data', 'hub', 'ui', 'all', '']);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.vstack .band')].map(b => b.querySelector('span').textContent)`),
    ['Layer 3AI + UI', 'Layer 2AI Hub', 'Layer 1Data'], 'the stack reads top to bottom: AI + UI, AI Hub, Data');
});

test('milestones: each step makes only its own boxes solid, the rest ghosted; the slide does not change', { skip }, async () => {
  await goTo(4);
  assert.equal(await current(), 4);
  assert.match(await evaluate(`document.querySelector('.slide.on h1').textContent`), /Build only the boxes one department needs/);
  const all = await evaluate(`[...document.querySelectorAll('#mstack .bx')].map(b => b.textContent).sort()`);
  for (const m of [1, 2, 3]) {
    await evaluate(`document.querySelector('.steps [data-m="${m}"]').click()`);
    assert.equal(await current(), 4, 'clicking a step must not also move the slide');
    assert.deepEqual(await solid(), m === 3 ? all : MS[m].slice().sort(), `solid boxes in milestone ${m}`);
    assert.equal(await evaluate(`document.querySelectorAll('#mstack .bx.gh').length`), all.length - (m === 3 ? all.length : MS[m].length));
    assert.equal(await evaluate(`document.querySelector('.steps [aria-pressed="true"]').dataset.m`), String(m));
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.added ul')].filter(u => !u.hidden).map(u => u.dataset.for)`), [String(m)]);
    assert.equal(await evaluate(`document.getElementById('msStep').textContent`), 'In this milestone · 0' + m);
    // every ghost carries a label: Next / Later for what comes after, From 0n for what an earlier step built
    const labels = await evaluate(`[...document.querySelectorAll('#mstack .bx.gh')].map(b => b.dataset.lbl)`);
    for (const l of labels) assert.match(l, /^(Next|Later|From 0[12])$/);
    // a ghost is drawn dashed, a solid box is not
    if (m < 3) assert.equal(await evaluate(`getComputedStyle(document.querySelector('#mstack .bx.gh')).borderTopStyle`), 'dashed');
    // a screenshot per step, for a human to eyeball which boxes are solid vs ghosted
    await screenshot(`milestone-0${m}`);
  }
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#mstack .bx')].filter(b => b.textContent === 'Store Operations agent').map(b => b.dataset.lbl)`), ['']);
  await evaluate(`document.querySelector('.steps [data-m="1"]').click()`);
  assert.equal(await evaluate(`document.querySelector('#mstack .bx[data-ms="2 3"]').dataset.lbl`), 'Next');
  assert.equal(await evaluate(`document.querySelector('#mstack .bx[data-ms="3"]').dataset.lbl`), 'Later');
});

test('reduced motion: milestone steps still change, with no animation', { skip }, async () => {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await goTo(4);
  for (const m of [1, 2, 3]) {
    await evaluate(`document.querySelector('.steps [data-m="${m}"]').click()`);
    assert.equal(await current(), 4, 'reduced motion: still on the milestones slide');
    assert.equal(await evaluate(`document.querySelector('.steps [aria-pressed="true"]').dataset.m`), String(m), `reduced motion: step ${m} still selects`);
    assert.deepEqual(await solid(), m === 3
      ? await evaluate(`[...document.querySelectorAll('#mstack .bx')].map(b => b.textContent).sort()`)
      : MS[m].slice().sort(), `reduced motion: solid boxes in milestone ${m} unchanged`);
    assert.equal(await evaluate(`document.querySelectorAll('#mstack .bx').length === 0 ? 0 : [...document.querySelectorAll('#mstack .bx')].reduce((n, b) => n + b.getAnimations().length, 0)`), 0, `reduced motion: no box animation at step ${m}`);
    await screenshot(`reduced-motion-milestone-0${m}`);
  }
  await send('Emulation.setEmulatedMedia', { features: [] });
  await goTo(4);
  await evaluate(`document.querySelector('.steps [data-m="1"]').click()`);
});

test('zoom: moving between layer slides plays the zoom; reduced motion skips it', { skip }, async () => {
  await goTo(0);
  await sleep(1300);
  await goTo(1);
  assert.equal(await evaluate(`document.getElementById('zoomfx').classList.contains('run')`), true, 'zoom runs between stack and a layer');
  assert.ok(await evaluate(`document.getElementById('zoomfx').getAnimations().length`) > 0);
  await sleep(1400);
  assert.equal(await evaluate(`document.getElementById('zoomfx').classList.contains('run')`), false, 'the overlay clears once the zoom ends');
  await goTo(5); await sleep(100);
  await goTo(4);
  assert.equal(await evaluate(`document.getElementById('zoomfx').getAnimations().length`), 0, 'no zoom to or from the lab slide');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const n of [3, 2, 1, 0]) {
    await goTo(n);
    assert.equal(await current(), n);
    assert.equal(await evaluate(`document.getElementById('zoomfx').classList.contains('run')`), false, 'reduced motion: no zoom');
    assert.equal(await evaluate(`document.getElementById('zoomfx').getAnimations().length`), 0);
  }
  await send('Emulation.setEmulatedMedia', { features: [] });
});

test('a zoomed layer always shows its neighbours at the edges, with labelled connections', { skip }, async () => {
  const edges = await evaluate(`[1, 2, 3].map(n => [...document.querySelectorAll('.slide')[n].querySelectorAll('.edge')].map(e =>
    [e.classList.contains('top') ? 'top' : 'bot', e.querySelector('.en').lastChild.textContent, e.querySelectorAll('.cx b').length]))`);
  assert.deepEqual(edges, [[['top', 'AI Hub', 2]], [['top', 'AI + UI', 2], ['bot', 'Data', 2]], [['bot', 'AI Hub', 2]]]);
  await goTo(2); await sleep(1300);
  const r = await evaluate(`(() => { const s = document.querySelector('.slide.on'); const t = s.querySelector('.edge.top').getBoundingClientRect(), b = s.querySelector('.edge.bot').getBoundingClientRect(), n = document.querySelector('nav').getBoundingClientRect();
    return [t.top, Math.round(b.bottom) === innerHeight, n.bottom <= b.top]; })()`);
  assert.deepEqual(r, [0, true, true], 'strips sit at the very top and bottom, and the nav stays clear of the bottom strip');
});

test('AI Hub: "Connectors" is gone as a layer name, and the tools are on the layer', { skip }, async () => {
  const text = await evaluate(`document.body.textContent`);
  assert.ok(!text.includes('Connectors'), 'no "Connectors" layer name left');
  assert.ok(text.includes('Layer 2 · AI Hub'));
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.tools .bdg')].map(b => b.firstChild.nextSibling.textContent)`),
    ['Mail', 'Office 365 suite', 'SharePoint', 'Contracts search', 'Chat', 'Downstream systems']);
  assert.match(text, /Dayforce ingestion · order entry into downstream systems/);
});

test('the existing claims and caveats survive word for word', { skip }, async () => {
  const text = await evaluate(`document.body.textContent`);
  for (const c of ['Shares are read-only by design — an agent on a share cannot write',
    'Replacing Qlik is only a future option. The implications are not known today, and nothing here commits to it.',
    'Change the AI tool, the agent or the model — nothing above or below has to be rebuilt.',
    'Claude today. If token costs rise or a model stops fitting, the model swaps underneath and nothing above changes.',
    'Data resident in Sydney (AWS ap-southeast-2)', 'Merchandising first', 'only proven agents cross over'])
    assert.ok(text.includes(c), `missing: ${c}`);
});

test('phone width: no slide spills sideways', { skip }, async () => {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (let n = 0; n < 6; n++) { await goTo(n); assert.equal(await evaluate(`document.documentElement.scrollWidth`), 390, `slide ${n + 1} overflows sideways`); }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
});

test('print: six A4 pages, nothing overflowing, milestones show every box with its step', { skip }, async () => {
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  assert.equal(await visibleCount(), 6);
  const over = await evaluate(`[...document.querySelectorAll('.slide')].map((s, k) => [k + 1, s.scrollHeight, s.clientHeight]).filter(([, a, b]) => a > b)`);
  assert.deepEqual(over, []);
  assert.equal(await evaluate(`[...document.querySelectorAll('.added ul')].filter(u => getComputedStyle(u).display !== 'none').length`), 3);
  const { data } = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
  assert.equal((Buffer.from(data, 'base64').toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 6);
  await send('Emulation.setEmulatedMedia', { media: '' });
});

test('self-contained: nothing loads from outside the page folder', { skip }, async () => {
  const ext = await evaluate(`[...document.querySelectorAll('[src],[href]')].map(e => e.getAttribute('src') || e.getAttribute('href')).filter(u => /^(https?:)?\\/\\//.test(u))`);
  assert.deepEqual(ext, []);
  assert.deepEqual(await evaluate(`performance.getEntriesByType('resource').map(r => r.name).filter(u => !u.startsWith('file:'))`), []);
});

test('dark mode: the theme switches', { skip }, async () => {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  assert.equal(await evaluate(`getComputedStyle(document.body).backgroundColor`), 'rgb(21, 23, 28)');
  await send('Emulation.setEmulatedMedia', { features: [] });
});
