/*
  THE INBOX model, checked.

  Same contract as the other suites: everything under test is pure, so what
  counts as unfiled, what a pasted note turns into and what saving writes can
  all be pinned down here without a database, a browser, or a clock that has to
  be a particular day of the week.

      npm test
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INBOX_LIST_ID, capturePayload, capturedAgo, filePayload, isCaptured, quickDues,
  sortCaptured, splitCaptures,
} from '../src/lib/inbox.js';
import { normalizeTask } from '../src/lib/tasks.js';
import { addDaysISO } from '../src/lib/dates.js';

const caught = (o) => normalizeTask({ id: o.id, title: o.title || 't', list_id: INBOX_LIST_ID, ...o });

// ─────────────────────────────────────────────────────────────────────────────
// What counts as unfiled
// ─────────────────────────────────────────────────────────────────────────────

test('a thought is one that is still in the reserved list, and nothing else', () => {
  assert.equal(isCaptured(caught({ id: 'a' })), true);
  assert.equal(isCaptured(normalizeTask({ id: 'b', title: 't', list_id: 'default' })), false);
  // A filed task carries no residue: the list IS the flag, so there is nothing
  // left over that could still read as unfiled.
  assert.equal(isCaptured({ ...caught({ id: 'c' }), list_id: 'list_1' }), false);
  assert.equal(isCaptured(null), false);
  assert.equal(isCaptured({}), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Capturing
// ─────────────────────────────────────────────────────────────────────────────

test('a capture is a title and a list, and nothing is asked for', () => {
  assert.deepEqual(capturePayload('  call the bank  '), { title: 'call the bank', list_id: INBOX_LIST_ID });
});

test('blank is not a thought', () => {
  assert.equal(capturePayload(''), null);
  assert.equal(capturePayload('   \n  '), null);
  assert.equal(capturePayload(undefined), null);
});

test('a pasted note becomes one thought per line, bullets and numbering stripped', () => {
  assert.deepEqual(
    splitCaptures('- call the bank\n* book flights\n\n  3. renew passport  \n• email Sam'),
    ['call the bank', 'book flights', 'renew passport', 'email Sam']
  );
});

test('an ordinary one-line capture survives the splitter unchanged', () => {
  assert.deepEqual(splitCaptures('buy milk'), ['buy milk']);
  // A dash inside the sentence is part of the sentence; only a leading bullet
  // followed by a space is the shape of a list.
  assert.deepEqual(splitCaptures('re-read the 2-3 page brief'), ['re-read the 2-3 page brief']);
  assert.deepEqual(splitCaptures(''), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Saving
// ─────────────────────────────────────────────────────────────────────────────

test('saving is a move to a real list, with the decisions attached', () => {
  assert.deepEqual(
    filePayload({ title: ' fix the sink ', listId: 'list_1', priority: 'high', dueDate: '2026-09-09', hard: true }),
    { list_id: 'list_1', title: 'fix the sink', priority: 'high', due_date: '2026-09-09', is_hard: true }
  );
});

test('"no" is a real answer to the date and the flag, and is written rather than left out', () => {
  const payload = filePayload({ title: 't', listId: 'list_1' });
  assert.equal(payload.due_date, null);
  assert.equal(payload.is_hard, false);
  // Never a half-answer: the card asked, so the row is told.
  assert.equal('is_hard' in payload, true);
  assert.equal('due_date' in payload, true);
});

test('a description is written when there is one, and cleared when there is not', () => {
  assert.equal(filePayload({ title: 't', listId: 'list_1', notes: 'ring the desk, not the mobile' }).notes,
    'ring the desk, not the mobile');
  // Emptied on the card, and emptied on the row: '' is a description you deleted.
  assert.equal(filePayload({ title: 't', listId: 'list_1', notes: '' }).notes, '');
});

test('a caller that never asked for a description does not blank one', () => {
  // Not asking is not the same as answering "none": a caller that never showed
  // the field must leave whatever the row already holds alone.
  assert.equal('notes' in filePayload({ title: 't', listId: 'list_1' }), false);
});

test('there is no saving into the inbox, or into nothing at all', () => {
  assert.equal(filePayload({ title: 't', listId: INBOX_LIST_ID }), null);
  assert.equal(filePayload({ title: 't' }), null);
  assert.equal(filePayload(), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Order
// ─────────────────────────────────────────────────────────────────────────────

const at = (iso, id, position = 0) => caught({ id, created_at: iso, position });

test('the queue is oldest first and the feed is newest first', () => {
  const pile = [
    at('2026-09-03T09:00:00.000Z', 'tue'),
    at('2026-09-05T09:00:00.000Z', 'thu'),
    at('2026-09-04T09:00:00.000Z', 'wed'),
  ];
  assert.deepEqual(sortCaptured(pile).map(t => t.id), ['tue', 'wed', 'thu']);
  assert.deepEqual(sortCaptured(pile, { newestFirst: true }).map(t => t.id), ['thu', 'wed', 'tue']);
  // Neither order disturbs the array it was handed.
  assert.deepEqual(pile.map(t => t.id), ['tue', 'thu', 'wed']);
});

test('two thoughts typed in the same second keep the order they were typed in', () => {
  const same = '2026-09-05T09:00:00.000Z';
  const pile = [at(same, 'second', 2), at(same, 'first', 1)];
  assert.deepEqual(sortCaptured(pile).map(t => t.id), ['first', 'second']);
  assert.deepEqual(sortCaptured(pile, { newestFirst: true }).map(t => t.id), ['second', 'first']);
});

test('how long it has been sitting there, in the width of a timestamp', () => {
  const now = Date.parse('2026-09-05T12:00:00.000Z');
  const ago = (ms) => capturedAgo({ created_at: new Date(now - ms).toISOString() }, now);
  assert.equal(ago(5 * 1000), 'just now');
  assert.equal(ago(9 * 60 * 1000), '9m ago');
  assert.equal(ago(3 * 3600 * 1000), '3h ago');
  assert.equal(ago(2 * 86400 * 1000), '2d ago');
  assert.equal(ago(21 * 86400 * 1000), '3w ago');
  // A row with no timestamp says nothing rather than "just now", which would be
  // a claim the row cannot support.
  assert.equal(capturedAgo({}, now), '');
});

// ─────────────────────────────────────────────────────────────────────────────
// The two answers to "when"
// ─────────────────────────────────────────────────────────────────────────────

test('the two quick answers are today and tomorrow, and nothing else', () => {
  const dues = quickDues('2026-09-08');   // a Tuesday
  assert.deepEqual(dues.map(d => d.key), ['today', 'tomorrow']);
  assert.equal(dues[0].iso, '2026-09-08');
  assert.equal(dues[1].iso, '2026-09-09');
  // Across a month end, which is the one place adding a day is not arithmetic
  // on the last two digits.
  assert.equal(quickDues('2026-09-30')[1].iso, '2026-10-01');
});

test('every quick answer is a real date the model can hold', () => {
  for (const { iso } of quickDues('2026-09-08')) {
    assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(addDaysISO(iso, 0), iso);
  }
});
