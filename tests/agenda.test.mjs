/*
  /today's arrangement, checked.

  Same contract as tests/model.test.mjs: everything under test is pure, so what
  counts as "on today", which section of Attention claims a task, how a day lays
  out into blocks and what a planned day adds up to can all be pinned down here
  once, without a database, a browser or a clock that has to be a particular
  time of day.

      npm test
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTENTION_HORIZON_DAYS, ATTENTION_SECTIONS, DAY_END, DAY_START, LIST_COLORS, attention,
  compareByPlan, dayTimeline, daySummary, isOnDay, listIndex, listOf, nextFreeStart,
  normalizeEvents, plannedDay, taskCatalog, workload,
} from '../src/lib/agenda.js';
import { normalizeTask, plannedPatch, schedulePatch } from '../src/lib/tasks.js';
import { addDaysISO, clockToMinutes, todayISO } from '../src/lib/dates.js';

const today = todayISO();
const tomorrow = addDaysISO(today, 1);
const mk = (o) => normalizeTask({ id: o.id, title: o.title || 't', list_id: 'default', ...o });

// A task planned for today, the way every write on the page makes one.
const planned = (o) => mk({ ...o, ...plannedPatch(today, o.daily_priority) });

// ─────────────────────────────────────────────────────────────────────────────
// The planned day
// ─────────────────────────────────────────────────────────────────────────────

test('the day is what you chose, split into the two halves you chose it in', () => {
  const day = plannedDay([
    planned({ id: 'must', estimated_minutes: 45 }),
    planned({ id: 'maybe', daily_priority: 'optional', estimated_minutes: 60 }),
    planned({ id: 'finished', status: 'completed', completed_at: `${today}T10:00:00.000Z` }),
    planned({ id: 'noestimate' }),
    // Planned, but for another day.
    mk({ id: 'tomorrow', planned_date: tomorrow }),
  ], today);

  assert.deepEqual(day.commitments.map(t => t.id), ['must', 'noestimate']);
  assert.deepEqual(day.optional.map(t => t.id), ['maybe']);
  assert.deepEqual(day.done.map(t => t.id), ['finished']);
  // The workload is the work still ahead, and it says how much of it is a guess.
  assert.equal(day.estimatedMinutes, 105);
  assert.equal(day.unestimated, 1);
});

test('the day also contains what you OWE, with nothing written down first', () => {
  /*
    The membership rule, and the reason it is derived rather than seeded: none
    of these three carries `planned_date === today`, and all three are on today
    the moment the page reads them. If the seed's write never lands, the day is
    still right.
  */
  const day = plannedDay([
    mk({ id: 'duetoday', due_date: today }),
    mk({ id: 'late', due_date: addDaysISO(today, -3) }),
    // Stamped with a day that has already passed. It is owed, that day is over,
    // and it used to fall through every crack in the app: not planned for
    // today, and (once Late left Coming up) in no other list either.
    mk({ id: 'stranded', due_date: addDaysISO(today, -9), planned_date: addDaysISO(today, -9) }),

    // ── and what is NOT on the day ──────────────────────────────────────────
    // Parked on a LATER day on purpose. Owed today, but you already decided.
    mk({ id: 'thursday', due_date: today, planned_date: tomorrow }),
    // Owed, and finished. It is not open work, and it was never on this day, so
    // it is not back-dated onto today's receipt either.
    mk({ id: 'donelate', due_date: addDaysISO(today, -2), status: 'completed' }),
    // Not owed yet.
    mk({ id: 'tmrw', due_date: tomorrow, priority: 'urgent' }),
    // Never owed at all.
    mk({ id: 'undated', priority: 'urgent', is_hard: true }),
    // Yesterday's UNDATED leftover: a plan that lapsed is not a deadline, so it
    // does not follow you into today.
    mk({ id: 'leftover', planned_date: addDaysISO(today, -1) }),
  ], today);

  // Owed work is must-do by default: a deadline is a commitment unless you say
  // otherwise, which is DEFAULT_DAILY_PRIORITY doing exactly its job.
  assert.deepEqual(day.commitments.map(t => t.id), ['stranded', 'late', 'duetoday']);
  assert.deepEqual(day.optional, []);
  assert.deepEqual(day.done, []);
  assert.equal(day.open.length, 3);

  // The same rule, exported for the one other place that has to agree with it.
  assert.equal(isOnDay(mk({ id: 'x', due_date: today }), today), true);
  assert.equal(isOnDay(mk({ id: 'x', due_date: tomorrow }), today), false);
  assert.equal(isOnDay(mk({ id: 'x', planned_date: today }), today), true);
});

test('the day you owe survives being taken off it, because the date goes too', () => {
  // `removeFromToday` clears the planned day AND an arrived due date. Both have
  // to go: with the date left behind, the model would put the task straight
  // back on the day and the × would do nothing you could see.
  const stillDated = plannedDay([mk({ id: 'late', due_date: addDaysISO(today, -2) })], today);
  assert.deepEqual(stillDated.open.map(t => t.id), ['late']);
  const cleared = plannedDay([mk({ id: 'late', due_date: null, planned_date: null })], today);
  assert.deepEqual(cleared.open, []);
});

test('planning a task touches the day and nothing else', () => {
  // Putting something ON a day writes the day and which half of it, and that is
  // the whole of it: no due date, no status, no list.
  assert.deepEqual(plannedPatch(today), { planned_date: today, daily_priority: 'must_do' });
  assert.deepEqual(plannedPatch(today, 'optional'), { planned_date: today, daily_priority: 'optional' });

  // Taking it off the day takes its block with it: a 2pm block on a day you are
  // no longer planning is a ghost that would reappear the moment you replanned.
  const cleared = plannedPatch(null);
  assert.equal(cleared.planned_date, null);
  assert.equal(cleared.scheduled_start, null);
  assert.equal(cleared.scheduled_minutes, null);
});

test('a planned day reads in the order it happens', () => {
  const rows = [
    planned({ id: 'whenever', priority: 'urgent' }),
    planned({ id: 'afternoon', scheduled_start: '14:00' }),
    planned({ id: 'morning', scheduled_start: '09:00' }),
  ].sort(compareByPlan);
  // Times first, in time order; everything without one after it, by priority.
  assert.deepEqual(rows.map(t => t.id), ['morning', 'afternoon', 'whenever']);
});

test('the summary counts the plan and the world separately', () => {
  const summary = daySummary([
    planned({ id: 'a', estimated_minutes: 30 }),
    planned({ id: 'b', daily_priority: 'optional', estimated_minutes: 15 }),
    planned({ id: 'done', status: 'completed', completed_at: `${today}T09:00:00.000Z` }),
    mk({ id: 'late', due_date: addDaysISO(today, -3) }),
    mk({ id: 'due', due_date: today }),
    mk({ id: 'donelate', due_date: addDaysISO(today, -9), status: 'completed' }),
  ], today);

  // 'late' and 'due' are owed, so they are ON the day without being planned:
  // two chosen, two owed, one finished.
  assert.equal(summary.planned, 5);          // including the one already finished
  assert.equal(summary.remaining, 4);
  assert.equal(summary.done, 1);
  assert.equal(summary.mustDo, 3);           // 'a', plus the two owed
  assert.equal(summary.optional, 1);
  assert.equal(summary.estimatedMinutes, 45);
  // These two describe every list, not the plan, so they see what you did NOT
  // choose — a task owed and sitting nowhere is exactly what they are for.
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueToday, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Attention
// ─────────────────────────────────────────────────────────────────────────────

test('attention has three ways in, claimed once each, in question order', () => {
  const sections = attention([
    mk({ id: 'tmrw', due_date: tomorrow, priority: 'low' }),
    mk({ id: 'hard', due_date: addDaysISO(today, 4), is_hard: true, priority: 'low' }),
    mk({ id: 'important', due_date: addDaysISO(today, 5), priority: 'high' }),

    // ── and everything that is NOT a way in ─────────────────────────────────
    // Due today: the plan has already been seeded with it.
    mk({ id: 'duetoday', due_date: today, priority: 'urgent' }),
    // LATE, however urgent and however hard. It is owed, so the seed has put it
    // on today; a step called "Coming up" is not where you keep what is overdue.
    mk({ id: 'late', due_date: addDaysISO(today, -3), priority: 'urgent', is_hard: true }),
    // Waiting on somebody: not a thing you can pick up, so not a decision.
    mk({ id: 'waiting', status: 'waiting_review', priority: 'urgent' }),
    // Important and hard, but with no date at all: that is Add from projects.
    mk({ id: 'undated', priority: 'urgent', is_hard: true }),
    // Hard and important, but further out than the horizon.
    mk({ id: 'far', due_date: addDaysISO(today, ATTENTION_HORIZON_DAYS + 1), priority: 'high', is_hard: true }),
    // Neither hard nor important, inside the horizon: a quiet task stays quiet.
    mk({ id: 'quiet', due_date: addDaysISO(today, 3), priority: 'medium' }),
    mk({ id: 'finished', due_date: addDaysISO(today, -5), status: 'completed' }),
  ], today);

  assert.deepEqual(
    sections.map(s => [s.key, s.tasks.map(t => t.id)]),
    [
      ['due_tomorrow', ['tmrw']],
      ['hard_soon', ['hard']],
      ['important_soon', ['important']],
    ]
  );
});

test('the horizon is inclusive at exactly a week, and nothing beyond it gets in', () => {
  const edge = addDaysISO(today, ATTENTION_HORIZON_DAYS);
  const past = addDaysISO(today, ATTENTION_HORIZON_DAYS + 1);

  assert.deepEqual(
    attention([mk({ id: 'edge', due_date: edge, is_hard: true })], today)
      .flatMap(s => s.tasks.map(t => t.id)),
    ['edge']
  );
  assert.deepEqual(attention([mk({ id: 'past', due_date: past, is_hard: true })], today), []);
});

test('hard is its own reason: a low-priority task earns its place by being hard', () => {
  const soon = addDaysISO(today, 3);
  // Same date, same low priority. The flag is the only difference between them.
  const sections = attention([
    mk({ id: 'grind', due_date: soon, priority: 'low', is_hard: true }),
    mk({ id: 'easy', due_date: soon, priority: 'low' }),
  ], today);
  assert.deepEqual(sections.map(s => [s.key, s.tasks.map(t => t.id)]), [['hard_soon', ['grind']]]);
});

test('attention is drawn in the order the page names, and empty sections are dropped', () => {
  const sections = attention([mk({ id: 'a', due_date: tomorrow })], today);
  assert.deepEqual(sections.map(s => s.key), ['due_tomorrow']);
  assert.deepEqual(
    ATTENTION_SECTIONS.map(s => s.key),
    ['due_tomorrow', 'hard_soon', 'important_soon']
  );
});

test('nothing late reaches Coming up, however late it is', () => {
  // The rule the fix rests on: overdue work belongs on the day, not one step
  // further into a forecast. However far back the date is, this stays empty.
  assert.deepEqual(attention([
    mk({ id: 'recent', due_date: addDaysISO(today, -1) }),
    mk({ id: 'ancient', due_date: addDaysISO(today, -30), priority: 'urgent', is_hard: true }),
  ], today), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Choosing
// ─────────────────────────────────────────────────────────────────────────────

test('the catalog is every open task by project, and can hide what is already chosen', () => {
  const tasks = [
    mk({ id: 'a', list_id: 'work', title: 'Ratings research' }),
    planned({ id: 'b', list_id: 'work', title: 'Already on today' }),
    mk({ id: 'c', list_id: 'home', title: 'Buy milk', notes: 'errand' }),
    mk({ id: 'done', list_id: 'home', status: 'completed' }),
    // Owed, never planned: on the day all the same (see `isOnDay`).
    mk({ id: 'owed', list_id: 'home', title: 'Late already', due_date: today }),
  ];
  const lists = [{ id: 'work', name: 'Hedge Fund' }, { id: 'home', name: 'Personal' }];

  const all = taskCatalog(tasks, lists, { today });
  assert.deepEqual(all.map(g => [g.list.name, g.tasks.map(t => t.id)]), [
    ['Hedge Fund', ['a', 'b']],
    ['Personal', ['owed', 'c']],
  ]);

  // The page's browser offers what you have NOT chosen — and "already on the
  // day" has to mean the same here as it does on the day, or step 3 offers you
  // a task step 1 is already showing you.
  const remaining = taskCatalog(tasks, lists, { today, excludePlanned: true });
  assert.deepEqual(remaining.flatMap(g => g.tasks.map(t => t.id)), ['a', 'c']);

  // …and search reads the same fields the /tasks search box does.
  const found = taskCatalog(tasks, lists, { today, query: 'errand' });
  assert.deepEqual(found.map(g => g.list.name), ['Personal']);
});

test('a workload says what it does not know', () => {
  const load = workload([
    mk({ id: 'a', estimated_minutes: 45 }),
    mk({ id: 'b', estimated_minutes: 180 }),
    mk({ id: 'c' }),
  ]);
  assert.deepEqual(load, { minutes: 225, unestimated: 1, count: 3 });
});

// ─────────────────────────────────────────────────────────────────────────────
// The timeline
// ─────────────────────────────────────────────────────────────────────────────

test('the timeline draws planned blocks and the day’s fixed commitments', () => {
  const timeline = dayTimeline([
    planned({ id: 'work', title: 'CAD', scheduled_start: '10:15', scheduled_minutes: 60 }),
    planned({ id: 'noblock', title: 'Whenever' }),
    // Scheduled, but planned for another day: not this day's business.
    mk({ id: 'other', planned_date: tomorrow, scheduled_start: '10:00', scheduled_minutes: 30 }),
  ], [{ id: 'e1', title: 'Class', start: '09:00', minutes: 60 }], today);

  assert.deepEqual(timeline.blocks.map(b => [b.kind, b.title, b.start, b.end]), [
    ['event', 'Class', 540, 600],
    ['task', 'CAD', 615, 675],
  ]);
  // Nothing outside the window, so the window is the default working day.
  assert.equal(timeline.startMinute, DAY_START);
  assert.equal(timeline.endMinute, DAY_END);
  assert.equal(timeline.hours[0], DAY_START);
});

test('a task block carries the list it came from; nothing else does', () => {
  const timeline = dayTimeline(
    [planned({ id: 'work', title: 'CAD', scheduled_start: '10:00', scheduled_minutes: 60 })],
    [{ id: 'e1', title: 'Class', start: '09:00', minutes: 60 }],
    today,
    [],
    () => 'Design',
  );
  assert.deepEqual(timeline.blocks.map(b => [b.kind, b.list]), [
    ['event', undefined],
    ['task', 'Design'],
  ]);

  // No resolver, no list: the timeline still draws, and everything reading a
  // list simply has none to draw.
  const bare = dayTimeline(
    [planned({ id: 'work', scheduled_start: '10:00', scheduled_minutes: 60 })], [], today
  );
  assert.equal(bare.blocks[0].list, '');
});

test('a block’s length falls back to the estimate, then to a sane default', () => {
  const timeline = dayTimeline([
    planned({ id: 'a', scheduled_start: '09:00', estimated_minutes: 90 }),
    planned({ id: 'b', scheduled_start: '13:00' }),
  ], [], today);
  assert.deepEqual(timeline.blocks.map(b => b.minutes), [90, 30]);
});

/*
  A day runs 4am to 4am, so it already contains every hour anyone schedules
  anything in — an evening block no longer widens it, and the small hours after
  midnight are the END of it rather than the start of the next one.
*/
test('the drawn day is a whole one, anchored at 4am rather than at midnight', () => {
  assert.equal(DAY_START, 4 * 60);
  assert.equal(DAY_END, 28 * 60);
  assert.equal(DAY_END - DAY_START, 24 * 60);

  const timeline = dayTimeline([
    planned({ id: 'morning', scheduled_start: '05:30', scheduled_minutes: 30 }),
    planned({ id: 'late', scheduled_start: '22:30', scheduled_minutes: 45 }),
  ], [], today);
  // Both are inside 4am–4am, so neither moves the window.
  assert.equal(timeline.startMinute, DAY_START);
  assert.equal(timeline.endMinute, DAY_END);
  assert.equal(timeline.hours.at(-1), DAY_END);
});

/*
  A clock before 4am is the small hours at the END of the day, not the start of
  it — which is the whole of what "my day runs 4am to 4am" means once the model
  believes it. A block stored as '02:30' on the 3rd is half past two on the
  MORNING OF THE 4TH, and it is drawn at 26:30, after the evening.
*/
test('a block in the small hours is the end of the day, not the top of it', () => {
  const timeline = dayTimeline([
    planned({ id: 'evening', scheduled_start: '22:00', scheduled_minutes: 60 }),
    planned({ id: 'insomnia', scheduled_start: '02:30', scheduled_minutes: 30 }),
  ], [], today);

  assert.deepEqual(timeline.blocks.map(b => [b.id, b.start]), [
    ['evening', 22 * 60],
    ['insomnia', 26 * 60 + 30],
  ]);
  // Both are inside 4am–4am, so the window is untouched.
  assert.equal(timeline.startMinute, DAY_START);
  assert.equal(timeline.endMinute, DAY_END);
});

test('the day sorts by when it actually runs, so 1am comes last', () => {
  const late = planned({ id: 'late', scheduled_start: '01:00', scheduled_minutes: 30 });
  const morning = planned({ id: 'morning', scheduled_start: '09:00', scheduled_minutes: 30 });
  // '01:00' sorts before '09:00' as a string, and that is not the order the day
  // is lived in.
  assert.ok(compareByPlan(morning, late) < 0);
  assert.deepEqual(plannedDay([late, morning], today).open.map(t => t.id), ['morning', 'late']);
});

test('overlapping blocks sit side by side, and agree how many columns there are', () => {
  const timeline = dayTimeline([
    planned({ id: 'a', scheduled_start: '09:00', scheduled_minutes: 60 }),
    planned({ id: 'b', scheduled_start: '09:30', scheduled_minutes: 60 }),
    planned({ id: 'c', scheduled_start: '11:00', scheduled_minutes: 30 }),
  ], [], today);

  const [a, b, c] = timeline.blocks;
  assert.deepEqual([a.column, b.column], [0, 1]);
  assert.deepEqual([a.columns, b.columns], [2, 2]);
  // A block that clashes with nothing gets the whole width back.
  assert.deepEqual([c.column, c.columns], [0, 1]);
});

test('a block is trimmed to the end of the DAY, which is 4am', () => {
  // 11:30pm plus three hours lands at 2:30am, which is still tonight.
  assert.deepEqual(schedulePatch('23:30', 180), { scheduled_start: '23:30', scheduled_minutes: 180 });
  // Half past three has half an hour left before the day turns over.
  assert.deepEqual(schedulePatch('03:30', 180), { scheduled_start: '03:30', scheduled_minutes: 30 });
  assert.deepEqual(schedulePatch(null, 60), { scheduled_start: null, scheduled_minutes: null });
});

test('the suggested start is the first gap big enough, on the quarter hour', () => {
  const timeline = dayTimeline([
    planned({ id: 'a', scheduled_start: '09:00', scheduled_minutes: 50 }),
  ], [{ id: 'e', title: 'Lunch', start: '12:00', minutes: 60 }], today);

  // Before anything: the top of the day.
  assert.equal(nextFreeStart(timeline, 60), DAY_START);
  // Asked for a time inside a block, it comes out the far side, snapped.
  assert.equal(nextFreeStart(timeline, 30, 9 * 60 + 20), 10 * 60);
  // A gap that is too short is skipped: 11:30 + 60 would run into lunch.
  assert.equal(nextFreeStart(timeline, 60, 11 * 60 + 30), 13 * 60);
});

test('events are read defensively: they come from a JSON blob', () => {
  const events = normalizeEvents([
    { id: 'b', title: 'Lunch', start: '12:00', minutes: 60 },
    { id: 'a', title: '', start: '9:00' },
    { id: 'junk', title: 'No time', start: 'noon' },
    null,
  ]);
  assert.deepEqual(events.map(e => [e.id, e.title, e.start, e.minutes]), [
    ['a', 'Busy', '09:00', 30],
    ['b', 'Lunch', '12:00', 60],
  ]);
  assert.equal(clockToMinutes(events[0].start), 540);
});

// ─────────────────────────────────────────────────────────────────────────────
// Lists
// ─────────────────────────────────────────────────────────────────────────────

test('a list keeps its colour as later lists are added', () => {
  const one = listIndex([{ id: 'a', name: 'Work' }]);
  const three = listIndex([{ id: 'a', name: 'Work' }, { id: 'b', name: 'Home' }, { id: 'c', name: 'Someday' }]);
  assert.equal(one.get('a').color, three.get('a').color);
  assert.equal(three.get('a').color, LIST_COLORS[0]);
  // A task pointing at a list that isn't there still draws.
  assert.equal(listOf(three, 'gone').name, 'Other');
  assert.equal(listOf(three, 'gone').id, 'gone');
});
