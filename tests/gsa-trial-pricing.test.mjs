// tests/gsa-trial-pricing.test.mjs — checks the locked gsa-trial/answers/ page without putting any of its content in
// this public repo. The page is opened the way a visitor's browser opens it (PBKDF2-SHA256 → AES-256-GCM, the page's own
// parameters) and every part of it is compared by SHA-256 fingerprint against the version the directors approved on
// 5 Nov: the pricing tab (GST note at the top, reworded first line) and every other tab, unchanged. Fingerprints only —
// no prices, names or wording are written here. The access code is never in this repo: pass it as GSA_TRIAL_CODE (that
// test is skipped, not failed, without it). The code-free tests (still locked, the trial root forwards, the old demos
// are gone) always run.
// Run: `GSA_TRIAL_CODE=… node --test tests/gsa-trial-pricing.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pbkdf2Sync, createDecipheriv, createHash } from 'node:crypto';

const CODE = process.env.GSA_TRIAL_CODE;
const PAGE = 'gsa-trial/answers/index.html';

// The approved page, part by part (sha256 of each decrypted part).
const APPROVED = {
  "css": "883e8c747623d9ff810d6399f88319c5b4ed2b79c7c659362ffcf987f139efed",
  "body": "304569ef4431cacb487649d85bc89ebfb85c93ab5d15af64ea2757e1cef21e1f",
  "order": "048257737ef58e7147cf2d5a0b5d9bf507c9afcf19dc6eddf0eb604ccbe136d0",
  "groups": "f8d592d3224862882fb288c97798a459a04f5f8a9f5d9aaf2db9db42f5decbb1",
  "scope": "5e927e1407296eb20a15a0888289afc26eff44c6e3ea1fca36a445ba47de3786",
  "tab:J1": "e000f6dd35e05437721ea1a10f4e780da216b54c6b601048adad230e1dfdbc1f",
  "tab:PR": "296ba1662c7c81329446aea4dfc3ac17e0bf5f8dabd8d58a260ea62fa53f96f0",
  "tab:T1": "7fdf1d9f1d694166c4db09e0d153fa8f213e665e6393164934f4957b94c7b198",
  "tab:T2": "5223b1fe3ffaa0fa25078bd2b9f19687d32ae9b484e08246e511fdc7afce21bd",
  "tab:T3": "bd4f8cb5df49516d4c6ef2738d85c03f53c52465531fa17bca07c9e4555ee2dd",
  "tab:L2": "f9f731432d2835e43fd5af4251b082f78648cf5d3dca5f4d26702ba04dd5e9e8",
  "tab:Q1": "8aff02090a1547dd57b8eab167c9500d21e16d2826d10f92ea2eb62f6c01c37b",
  "tab:Q2": "78c6263601722aa0ad93aa28ee63da29462bfee201d4ce37496ad3137f390d77",
  "tab:Q3": "2dd7ee6c06566a6cbc42b9453e0161842eb11c2e7de88238f5a5e79c825bdb32",
  "tab:Q4": "d2b1028976f906db2c3653797d52952db904341dddef198254dca1b089a09172",
  "tab:Q5": "d1b64bfd3444451546e10c02323c068b360d42db378d0981c920a8e962d82b87",
  "tab:Q6": "d07cde13548a63f63abaddc049a99e1fa264864f74c5408dbd9adbe87093e64a",
  "tab:F1": "f78a13107ce707e25392b5abd44c3f5e4471435d8577c2e3b12945fcb7e0007a",
  "tab:P1": "c385a1998cf988ce3efdf52fdb3f0ebf10c8c93d76b374cfacbabc60a82a4e0f"
};
// The pricing tab as it was before the 5 Nov edit (live 65f9d90): the new page must not still be this.
const PREVIOUS_PRICING = '70aa53c099d4d2161eb55fca49ac2fe89302b285bebdf39da33ca28e219ee63e';

function openPage(file, code) {
  const html = readFileSync(file, 'utf8');
  const b = JSON.parse(html.match(/const B=(\{[^\n]*?\});/)[1]);
  const key = pbkdf2Sync(code, Buffer.from(b.salt, 'base64'), b.iter, 32, 'sha256');
  const ct = Buffer.from(b.ct, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(b.iv, 'base64'));
  d.setAuthTag(ct.subarray(-16));
  return JSON.parse(Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]).toString('utf8'));
}
const sha = v => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const fingerprint = D => ({ css: sha(D.css), body: sha(D.body), order: sha(D.order), groups: sha(D.groups), scope: sha(D.scope),
  ...Object.fromEntries(Object.entries(D.bodies).map(([k, v]) => ['tab:' + k, sha(v)])) });

test('the locked page opens with its code and every part matches the approved version', { skip: !CODE && 'GSA_TRIAL_CODE not set' }, () => {
  const got = fingerprint(openPage(PAGE, CODE));
  assert.notEqual(got['tab:PR'], PREVIOUS_PRICING, 'pricing tab carries the 5 Nov edit');
  assert.deepEqual(Object.keys(got).sort(), Object.keys(APPROVED).sort(), 'same parts and tabs as approved');
  for (const k of Object.keys(APPROVED)) assert.equal(got[k], APPROVED[k], `part matches the approved version: ${k}`);
});

test('the page is still locked: nothing readable without the code', () => {
  const html = readFileSync(PAGE, 'utf8');
  // Look only outside the encrypted block: its base64 can spell any short word by chance.
  const clear = html.replace(/const B=\{[^\n]*?\};/, '');
  assert.notEqual(clear, html, 'the encrypted block is there');
  for (const s of ['A$', '$', 'GST']) assert.ok(!clear.includes(s), `not in clear: ${s}`);
  assert.throws(() => openPage(PAGE, 'not-the-code'), 'a wrong code does not open it');
});

test('the trial root only forwards to the answers page', () => {
  const html = readFileSync('gsa-trial/index.html', 'utf8');
  assert.ok(!html.includes('const B='), 'no slideshow content at the root');
  assert.match(html, /url=answers\//, 'forwards to answers/');
});

test('the old illustrative demos are gone', () => {
  for (const d of ['gsa-demo', 'gsa-demo-v2', 'gsa-demo-v3', 'gsa-demo-v4']) assert.ok(!existsSync(d), `${d}/ removed`);
});
