// tests/gsa-chat.test.mjs — GSA's own chat page (gsa-chat/, moved out of Cleo's console on 5 Nov 2026): it opens on the
// chat with no hash, keeps the three tabs and the GSA look, and Feedback sits in the top bar, never over Send on a phone.
// Run: `node --test tests/gsa-chat.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ASK_ROOMS, roomOfLocation } from '../gsa-chat/ask-logic.mjs';

test('the bare link opens the chat; a hash still picks its room', () => {
  assert.equal(roomOfLocation('', ''), 'gsa-chat');
  assert.equal(roomOfLocation('#gsa-chat', ''), 'gsa-chat');
});

test('the chat: tabs Chat, Job board, Pricing; the prepared answers next door in gsa-trial', () => {
  const r = ASK_ROOMS['gsa-chat'];
  assert.equal(r.chat, true);
  assert.deepEqual(r.tabs.map((t) => t.label), ['Chat', 'Job board', 'Pricing']);
  assert.equal(r.prepared, 'https://oren-and-elad.github.io/pages/gsa-trial/answers/');
  assert.equal(r.feedback, 'gsa');
});

test('Feedback moves into the top bar next to Sign out in the chat', () => {
  const html = readFileSync(new URL('../gsa-chat/index.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../gsa-chat/ask.js', import.meta.url), 'utf8');
  assert.match(js, /\$\('topbar'\)\.insertBefore\(\$\('fbgo'\), \$\('signout'\)\)/);
  assert.match(html, /body\.chat #topbar #fbgo \{ position:static;/);
});
