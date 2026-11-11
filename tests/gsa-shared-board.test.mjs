// tests/gsa-shared-board.test.mjs — the shared potential-jobs board's pure helpers on both trial-chat links: a board call is
// whole JSON or refused (never cut mid-way), a job with no notes still draws, the planner filter holds, and a board call
// never shows as a chat line. Run: `node --test tests/gsa-shared-board.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';

const who = { name: 'Halina', realName: 'Halina K', uid: 'u1', email: 'h@example.com', guest: false };
const board = { stages: [{ id: 'potential', label: 'Potential' }, { id: 'loi', label: 'LOI sent' }], architects: [{ name: 'A' }],
  jobs: [{ id: 'j1', stage: 'potential', planner: 'Sam', client: 'One' }, null,
    { id: 'j2', stage: 'loi', planner: 'Ann', notes: [{ text: 'sent' }, null, { by: 'x' }] }, { id: 'j3', stage: 'potential', planner: 'Ann', notes: 'bad' }] };

for (const dir of ['gsa-chat', 'gsa-team']) {
  const { boardMessage, pipelineView, mergeRows, BOARD_MAX } = await import(`../${dir}/ask-logic.mjs`);

  test(`${dir}: a board call carries the whole change as valid JSON and is marked a board row`, () => {
    const change = { op: 'note', job: 'j1', text: 'called the architect' };
    const m = boardMessage(who, 'change', change);
    assert.deepEqual(JSON.parse(m.text), change);
    assert.equal(m.board, 'change'); assert.equal(m.byName, 'Halina K'); assert.equal(m.fromUid, 'u1');
    assert.equal(boardMessage(who, 'get').text, '{}');
  });

  test(`${dir}: a change too long to carry is refused, never cut into broken JSON`, () => {
    assert.throws(() => boardMessage(who, 'change', { op: 'note', job: 'j1', text: 'x'.repeat(BOARD_MAX) }), /too long/);
    const fits = boardMessage(who, 'change', { op: 'note', job: 'j1', text: 'x'.repeat(BOARD_MAX - 100) });
    assert.doesNotThrow(() => JSON.parse(fits.text));
  });

  test(`${dir}: the board view draws jobs with missing or bad notes, and filters by planner`, () => {
    const v = pipelineView(board);
    assert.equal(v.total, 3);
    assert.deepEqual(v.stages.map((s) => s.jobs.map((j) => j.id)), [['j1', 'j3'], ['j2']]);
    for (const s of v.stages) for (const j of s.jobs) assert.ok(Array.isArray(j.notes));
    assert.deepEqual(v.stages[1].jobs[0].notes, [{ text: 'sent' }]);
    assert.equal(pipelineView(board, 'Ann').total, 2);
    assert.deepEqual(pipelineView(null), { stages: [], architects: [], total: 0 });
  });

  test(`${dir}: a board call never shows as a chat line`, () => {
    const rows = mergeRows([{ id: 'a', text: 'hi' }, { id: 'b', board: 'get', text: '{}' }], [{ id: 'c', board: 'change' }, { id: 'a', text: 'hi again' }]);
    assert.deepEqual(rows.map((r) => r.id), ['a']);
    assert.equal(rows[0].text, 'hi again');
  });
}

for (const dir of ['gsa-chat', 'gsa-team']) {
  const { widerWindow, CHAT_MIN, WINDOW_MAX } = await import(`../${dir}/ask-logic.mjs`);
  test(`${dir}: a window full of board calls widens until there are enough chat lines, and never past the cap`, () => {
    assert.equal(widerWindow(600, 600, 0), 1200, 'all board calls: widen');
    assert.equal(widerWindow(600, 600, CHAT_MIN), 600, 'enough chat lines: stay');
    assert.equal(widerWindow(600, 420, 10), 600, 'not full, so the room holds no more: stay');
    assert.equal(widerWindow(500, 500, 3), 1000, 'a guest window widens too');
    assert.equal(widerWindow(3000, 3000, 0), WINDOW_MAX, 'capped');
    assert.equal(widerWindow(WINDOW_MAX, WINDOW_MAX, 0), WINDOW_MAX, 'stops at the cap');
  });
}
