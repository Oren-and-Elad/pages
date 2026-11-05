// tests/gsa-trial-jobboard.test.mjs — the Job board editor on the locked gsa-trial/answers/ page, driven in a real browser
// the way a visitor uses it: open with the access code, give a DA job a different planner and move it to Court, check it
// moved and the counts follow, reload and check it stayed, press "Reset demo" and check the original board is back.
// Runs at laptop and phone width. No content is written here: the job is found on the page at run time.
// Needs the access code (GSA_TRIAL_CODE) and Playwright with Chromium (import 'playwright', or a path in GSA_PLAYWRIGHT);
// skipped, not failed, without either.
// Run: `GSA_TRIAL_CODE=… [GSA_PLAYWRIGHT=/path/to/playwright/index.mjs] node --test tests/gsa-trial-jobboard.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const CODE = process.env.GSA_TRIAL_CODE;
let pw = null;
try { pw = await import(process.env.GSA_PLAYWRIGHT || 'playwright'); } catch { pw = null; }
const skip = !CODE ? 'GSA_TRIAL_CODE not set' : !pw ? 'playwright not available' : false;

const columns = (p) => p.$$eval('.kanban section', (s) => s.map((x) => [x.querySelector('.chip').textContent, +x.querySelector('.n').textContent]));
const whereIs = (p, id) => p.$eval('.kanban', (k, id) => {
  for (const s of k.querySelectorAll('section')) for (const j of s.querySelectorAll('.jm'))
    if (j.textContent.startsWith('Job ' + id + ' ')) return { stage: s.querySelector('.chip').textContent, who: j.textContent.split(' · ')[1] };
  return null;
}, id);

for (const vp of [{ name: 'laptop', width: 1280, height: 800 }, { name: 'phone', width: 390, height: 844 }]) {
  test(`job board: assign, move DA → Court, survives reload, Reset restores (${vp.name})`, { skip, timeout: 120000 }, async () => {
    const html = readFileSync('gsa-trial/answers/index.html');
    const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(html); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const browser = await (pw.chromium || pw.default.chromium).launch();
    try {
      const page = await (await browser.newContext({ viewport: vp })).newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const ready = () => page.waitForSelector('.kanban .jbe', { state: 'attached', timeout: 60000 });
      await page.goto(`http://127.0.0.1:${srv.address().port}/#J1`);
      await page.fill('#code', CODE); await page.click('#gate button'); await ready();

      const before = await columns(page);
      assert.deepEqual(before.map((c) => c[0]), ['Pre-DA', 'DA', 'Court', 'Completed', 'No stage'], 'all five stages shown');
      const count = (cols, s) => cols.find((c) => c[0] === s)[1];
      const id = await page.$eval('.kanban section:nth-child(2) details.job .jm', (e) => e.textContent.match(/Job (\S+)/)[1]);
      const orig = await whereIs(page, id);
      assert.equal(orig.stage, 'DA');

      const card = page.locator('details.job', { hasText: `Job ${id} ·` }).first();
      await card.locator('summary').click();
      const planners = await card.locator('select[aria-label=Planner] option').allTextContents();
      const pick = planners.slice(1).find((t) => !t.endsWith(' · ' + orig.who));
      assert.ok(pick, 'a different planner to pick');
      await card.locator('select[aria-label=Planner]').selectOption({ label: pick });
      await card.locator('select[aria-label=Stage]').selectOption('Court');

      const want = { stage: 'Court', who: pick.split(' · ')[1] };
      assert.deepEqual(await whereIs(page, id), want, 'moved to Court with the new planner');
      const after = await columns(page);
      assert.equal(count(after, 'DA'), count(before, 'DA') - 1, 'DA count down by one');
      assert.equal(count(after, 'Court'), count(before, 'Court') + 1, 'Court count up by one');

      await page.reload(); await ready();
      assert.deepEqual(await whereIs(page, id), want, 'still there after a reload');

      await page.click('text=Reset demo');
      await page.waitForFunction((id) => [...document.querySelectorAll('.kanban section:nth-child(2) .jm')].some((j) => j.textContent.startsWith('Job ' + id + ' ')), id);
      assert.deepEqual(await whereIs(page, id), orig, 'Reset restores the job');
      assert.deepEqual(await columns(page), before, 'Reset restores every column');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
      assert.deepEqual(errors, [], 'no page errors');
    } finally { await browser.close(); srv.close(); }
  });
}
