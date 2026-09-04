/*
  The day's planning FLOW, checked.

  Same contract as the other two suites: everything under test is pure, so the
  order of the steps, what a fresh day starts with, and what survives a reload
  can all be pinned down without a database, a browser or a clock.

      npm test
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_DAY_PLAN, FIRST_STEP, LAST_STEP, PLAN_STEPS, PLAN_STEP_KEYS, nextStepKey,
  normalizeDayPlan, owedTodaySeed, prevStepKey, prunePlans, stepIndex,
} from '../src/lib/dayPlan.js';
import { normalizeTask } from '../src/lib/tasks.js';
import { addDaysISO, todayISO } from '../src/lib/dates.js';

const today = todayISO();
const tomorrow = addDaysISO(today, 1);
const mk = (o) => normalizeTask({ id: o.id, title: o.title || 't', list_id: 'default', ...o });

// ─────────────────────────────────────────────────────────────────────────────
// The steps
// ─────────────────────────────────────────────────────────────────────────────

test('the flow is four steps in the order you actually ask them', () => {
  assert.deepEqual(PLAN_STEP_KEYS, ['plan', 'attention', 'projects', 'calendar']);
  assert.equal(FIRST_STEP, 'plan');
  assert.equal(LAST_STEP, 'calendar');
  // Every step says what it is asking; a step with no question is a tab.
  for (const step of PLAN_STEPS) {
    assert.ok(step.label && step.question && step.hint, `${step.key} is missing copy`);
  }
});

test('next and back stop at the ends rather than wrapping', () => {
  assert.equal(nextStepKey('plan'), 'attention');
  assert.equal(nextStepKey('calendar'), 'calendar');
  assert.equal(prevStepKey('attention'), 'plan');
  assert.equal(prevStepKey('plan'), 'plan');
  // A step name from an older release, or a typo, is step one and not a crash.
  assert.equal(stepIndex('nonsense'), 0);
  assert.equal(nextStepKey('nonsense'), 'attention');
});

// ─────────────────────────────────────────────────────────────────────────────
// The stored plan
// ─────────────────────────────────────────────────────────────────────────────

test('a day with no plan is a fresh, unfinished one', () => {
  assert.deepEqual(normalizeDayPlan(undefined), EMPTY_DAY_PLAN);
  assert.deepEqual(normalizeDayPlan(null), EMPTY_DAY_PLAN);
  assert.deepEqual(normalizeDayPlan('garbage'), EMPTY_DAY_PLAN);
  assert.deepEqual(normalizeDayPlan([]), EMPTY_DAY_PLAN);
  assert.equal(EMPTY_DAY_PLAN.step, FIRST_STEP);
  assert.equal(EMPTY_DAY_PLAN.finalized, false);
});

test('a stored plan keeps its two facts and nothing else', () => {
  // `seeded` is from an older release and is deliberately NOT kept: what the
  // seed has already done is read off the tasks, never remembered here.
  assert.deepEqual(
    normalizeDayPlan({ step: 'projects', seeded: true, finalized: 1, junk: 'x' }),
    { step: 'projects', finalized: true }
  );
  // A step this release does not have falls back rather than showing nothing.
  assert.deepEqual(
    normalizeDayPlan({ step: 'timeline', finalized: true }),
    { step: 'plan', finalized: true }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// The seed
// ─────────────────────────────────────────────────────────────────────────────

test('a fresh day starts with everything owed — today\'s AND late — and only that', () => {
  const seed = owedTodaySeed([
    mk({ id: 'owed', due_date: today }),
    // LATE IS OWED. A deadline that passed is more of a deadline than one
    // landing this morning, so it starts on the day rather than in Coming up.
    mk({ id: 'late', due_date: addDaysISO(today, -2) }),
    mk({ id: 'ancient', due_date: addDaysISO(today, -400) }),
    // Already on today: seeding it again would write nothing and mean nothing.
    mk({ id: 'chosen', due_date: today, planned_date: today }),
    // Stamped with a day that has already PASSED. That day is over and the
    // stamp is stale, so it is written forward onto today rather than left on a
    // date nobody will open again.
    mk({ id: 'stranded', due_date: addDaysISO(today, -9), planned_date: addDaysISO(today, -9) }),
    // Deliberately planned for a LATER day. Dragging it back here would undo a
    // decision you made on purpose — true of a late task as much as a due one.
    mk({ id: 'thursday', due_date: today, planned_date: tomorrow }),
    mk({ id: 'latethursday', due_date: addDaysISO(today, -5), planned_date: tomorrow }),
    // Owed tomorrow, urgent, hard: none of those is a deadline that has arrived.
    mk({ id: 'tmrw', due_date: tomorrow, priority: 'urgent', is_hard: true }),
    // Undated, however urgent.
    mk({ id: 'undated', priority: 'urgent' }),
    // Already finished, on time or not.
    mk({ id: 'done', due_date: today, status: 'completed' }),
    mk({ id: 'donelate', due_date: addDaysISO(today, -3), status: 'completed' }),
  ], today);

  assert.deepEqual(seed.map(t => t.id), ['owed', 'late', 'ancient', 'stranded']);
});

test('the seed settles: what it has placed, and what you took off, stay put', () => {
  // The seed is a WRITE, not a decision — `plannedDay` decides what is on today
  // from the same predicate, at read time. So the seed's only job is to stop
  // having one, and the states it settles into are worth pinning down.
  assert.deepEqual(
    owedTodaySeed([mk({ id: 'owed', due_date: today })], today).map(t => t.id),
    ['owed']
  );

  // Placed: it now has a planned_date, so the seed has nothing to say about it.
  const placed = [mk({ id: 'owed', due_date: today, planned_date: today })];
  assert.deepEqual(owedTodaySeed(placed, today), []);

  // Taken off: `removeFromToday` clears an ARRIVED due date along with the day,
  // so the thing that qualified it is gone and it does not come straight back.
  // This is why the date has to be cleared for a LATE task too — left behind,
  // `due_date <= today` would put it on the day again on the very next render.
  const removed = [mk({ id: 'late', due_date: null, planned_date: null })];
  assert.deepEqual(owedTodaySeed(removed, today), []);
  // And it is reversible: give it a date that has arrived and it is back.
  const restored = [mk({ id: 'late', due_date: addDaysISO(today, -2) })];
  assert.deepEqual(owedTodaySeed(restored, today).map(t => t.id), ['late']);
});

// ─────────────────────────────────────────────────────────────────────────────
// Pruning
// ─────────────────────────────────────────────────────────────────────────────

test('pruning keeps the recent days and drops the one about to be rewritten', () => {
  const blob = {
    [today]: { step: 'plan' },
    [addDaysISO(today, -3)]: { step: 'calendar' },
    [addDaysISO(today, -400)]: { step: 'calendar' },
    'not-a-date': { step: 'plan' },
  };
  // The day being written comes out: the route puts the NEW value back in its
  // place, so carrying the old one through would only be it in the way.
  assert.deepEqual(Object.keys(prunePlans(blob, today)), [addDaysISO(today, -3)]);
  // Asked about some other day, today stays exactly where it is.
  assert.deepEqual(
    Object.keys(prunePlans(blob, addDaysISO(today, -3))).sort(),
    [today].sort()
  );
});

test('pruning tolerates a blob that is not a blob', () => {
  assert.deepEqual(prunePlans(null, today), {});
  assert.deepEqual(prunePlans([1, 2], today), {});
});
