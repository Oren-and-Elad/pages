// tests/ai-blueprint.test.mjs — renders ai-blueprint/ in a real headless Chrome and drives the deck:
// arrow keys, the Next/Back buttons, clicking the right/left half, swiping, the first/last-slide bounds, and the
// print layout (one slide per page). Plain Node, no dependencies: Chrome is driven over its DevTools protocol.
// Run it by hand before changing the deck: `node --test tests/ai-blueprint.test.mjs` (skipped, not failed, where no Chrome exists;
// set CHROME=/path/to/chrome if it is not in the default place). It is not yet part of `npm run check`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PAGE = pathToFileURL(path.resolve('ai-blueprint/index.html')).href;
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
  profile = mkdtempSync(path.join(tmpdir(), 'aibp-'));
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
});

test('opens on slide 1 of 8, with exactly one slide showing', { skip }, async () => {
  assert.equal(await evaluate(`document.querySelectorAll('.slide').length`), 8);
  assert.equal(await current(), 0);
  assert.equal(await visibleCount(), 1);
  assert.equal(await evaluate(`document.querySelectorAll('#dots i.on').length`), 1);
});

test('arrow keys move forward and back, and stop at both ends', { skip }, async () => {
  await key('ArrowLeft');
  assert.equal(await current(), 0, 'Back on the first slide stays on the first slide');
  for (let n = 1; n <= 7; n++) { await key('ArrowRight'); assert.equal(await current(), n); }
  await key('ArrowRight');
  assert.equal(await current(), 7, 'Next on the last slide stays on the last slide');
  await key('ArrowLeft');
  assert.equal(await current(), 6);
  assert.equal(await visibleCount(), 1);
});

test('Next / Back buttons move one slide and do not also trigger the click-halves', { skip }, async () => {
  await evaluate(`document.getElementById('prev').click()`);
  assert.equal(await current(), 5);
  await evaluate(`document.getElementById('next').click()`);
  assert.equal(await current(), 6);
});

test('clicking the right half goes forward, the left half goes back', { skip }, async () => {
  await clickAt(1000, 300);
  assert.equal(await current(), 7);
  await clickAt(200, 300);
  assert.equal(await current(), 6);
});

test('swiping left goes forward, swiping right goes back, a short drag does nothing', { skip }, async () => {
  await swipe(900, 300);
  assert.equal(await evaluate('location.href'), PAGE, 'a swipe must not make the browser leave the deck (back/forward)');
  assert.equal(await current(), 7);
  await swipe(300, 900);
  assert.equal(await current(), 6);
  await swipe(500, 530);
  assert.equal(await current(), 6);
});

test('print: every slide fits its own A4-landscape page and no two slides overlap', { skip }, async () => {
  for (const [w, h] of [[800, 600], [1440, 900]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    assert.equal(await visibleCount(), 8);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('nav')).display`), 'none');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.stages')).gridTemplateColumns.split(' ').length`), 3, 'stages keep 3 columns');
    const over = await evaluate(`[...document.querySelectorAll('.slide')].map((s, k) => [k + 1, s.scrollHeight, s.clientHeight]).filter(([, a, b]) => a > b)`);
    assert.deepEqual(over, [], `slides overflowing [n, scrollHeight, clientHeight]: ${JSON.stringify(over)}`);
    const hits = await evaluate(`(() => { const r = [...document.querySelectorAll('.slide')].map(s => s.getBoundingClientRect()); const o = [];
      for (let a = 0; a < r.length; a++) for (let b = a + 1; b < r.length; b++)
        if (r[a].top < r[b].bottom - 0.5 && r[b].top < r[a].bottom - 0.5) o.push([a + 1, b + 1]); return o; })()`);
    assert.deepEqual(hits, [], `slides overlapping: ${JSON.stringify(hits)}`);
    const { data } = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
    const pages = (Buffer.from(data, 'base64').toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.equal(pages, 8, `expected 8 printed pages at ${w}x${h}, got ${pages}`);
    await send('Emulation.setEmulatedMedia', { media: '' });
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
});

test('every function on slide 2 shows its own examples', { skip }, async () => {
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.unit')].map(u => u.querySelectorAll('li').length)`), [2, 2, 2, 2, 2]);
});

test('nothing blueprint remains: light background, no blueprint words', { skip }, async () => {
  assert.equal(await evaluate(`getComputedStyle(document.body).backgroundColor`), 'rgb(250, 249, 247)');
  const text = await evaluate(`document.body.innerText`);
  for (const w of ['Rev A', 'Sheet 1', 'Legend', 'orchestration']) assert.ok(!text.includes(w), `still says "${w}"`);
});
