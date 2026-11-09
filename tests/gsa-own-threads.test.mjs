// tests/gsa-own-threads.test.mjs — a guest sees only the conversations they started in their own browser (9 Nov 2026):
// people sharing one username no longer see or continue each other's chats; a director sees every one. Both chat links.
// Run: `node --test tests/gsa-own-threads.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const dir of ['gsa-chat', 'gsa-team']) {
  const { ownKey, ownThreads, addOwn } = await import(`../${dir}/ask-logic.mjs`);

  test(`${dir}: the key is the username plus the entered name, case and spaces ignored`, () => {
    assert.equal(ownKey('Guest@X.com', '  Ann '), 'gsa-own:guest@x.com:ann');
    assert.notEqual(ownKey('guest@x.com', 'Ann'), ownKey('guest@x.com', 'Bob'));
    assert.equal(ownKey(undefined, null), 'gsa-own::');
  });

  test(`${dir}: a guest keeps only their own threads; a director (no list) sees all`, () => {
    const threads = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assert.deepEqual(ownThreads(threads, ['b']), [{ id: 'b' }]);
    assert.deepEqual(ownThreads(threads, []), []);
    assert.equal(ownThreads(threads, null), threads);
    assert.deepEqual(ownThreads(undefined, ['a']), []);
  });

  test(`${dir}: addOwn appends once, drops junk, ignores an empty id, keeps the last 200`, () => {
    assert.deepEqual(addOwn(['a'], 'b'), ['a', 'b']);
    assert.deepEqual(addOwn(['a'], 'a'), ['a']);
    assert.deepEqual(addOwn(['a', 5, null], ''), ['a']);
    assert.deepEqual(addOwn('nope', 'x'), ['x']);
    const many = Array.from({ length: 200 }, (_, i) => `t${i}`);
    const next = addOwn(many, 'new');
    assert.equal(next.length, 200);
    assert.equal(next[0], 't1');
    assert.equal(next.at(-1), 'new');
  });

  test(`${dir}: the page filters guests by their own list and saves a new thread only for a guest`, () => {
    const js = readFileSync(new URL(`../${dir}/ask.js`, import.meta.url), 'utf8');
    assert.match(js, /ownThreads\(chatThreads\(items, \{[^}]*\}\), me\?\.guest \? ownLoad\(\) : null\)/);
    assert.match(js, /const ownSave = \(id\) => \{ if \(!me\?\.guest\) return;/);
  });
}
