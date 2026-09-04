/*
  THE GOOGLE CALENDAR MODEL, checked.

  Same contract as the other suites: everything under test is pure, so what the
  day contains, what is dropped from it, and what gets sent back can all be
  pinned down without a network, a Google account or a clock that has to be in a
  particular timezone.

  A fixed zone is named in every case that involves one. The whole point of
  these functions is converting instants into somebody's local day, so a test
  that used the machine's own zone would pass in one country and fail in
  another — which is exactly the bug they exist to prevent.

      npm test
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTERNAL_FALLBACK_COLOR, MIN_EXTERNAL_MINUTES, TASK_ID_PROPERTY, dayPushItems, daySignature,
  externalFromGoogle, isValidTimeZone, itemSignature, normalizeExternal, normalizeExternals,
  normalizePushItems, pushSignature, wallClock,
} from '../src/lib/googleEvents.js';
import { normalizeTask } from '../src/lib/tasks.js';

const TZ = 'America/New_York';
const DATE = '2026-09-03';

const calendar = { id: 'me@example.com', summary: 'Personal', backgroundColor: '#039be5' };
const palette = { event: { 6: { background: '#f4511e' }, 11: { background: '#dc2127' } } };

/** A timed Google event, given as wall-clock strings in TZ (which is -04:00 in September). */
const timed = (from, to, extra = {}) => ({
  id: 'evt1',
  summary: 'Standup',
  status: 'confirmed',
  start: { dateTime: `${from}-04:00` },
  end: { dateTime: `${to}-04:00` },
  ...extra,
});

const read = (raw, date = DATE) => externalFromGoogle(raw, { date, timeZone: TZ, calendar, palette });

// ─────────────────────────────────────────────────────────────────────────────
// Wall clock
// ─────────────────────────────────────────────────────────────────────────────

test('an instant becomes the local day and minute, not the UTC one', () => {
  // 01:30 UTC on the 4th is still 9:30pm on the 3rd in New York. Getting this
  // wrong is how a late meeting lands on tomorrow's timeline.
  const at = new Date('2026-09-04T01:30:00Z');
  assert.deepEqual(wallClock(at, TZ), { date: '2026-09-03', minutes: 21 * 60 + 30 });
  assert.deepEqual(wallClock(at, 'UTC'), { date: '2026-09-04', minutes: 90 });
});

test('midnight reads as minute zero of the day it starts, not 24:00 of the one before', () => {
  assert.deepEqual(wallClock(new Date('2026-09-03T04:00:00Z'), TZ), { date: '2026-09-03', minutes: 0 });
});

test('a timezone the browser made up is refused rather than trusted', () => {
  assert.equal(isValidTimeZone('America/New_York'), true);
  assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(null), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// What the day draws
// ─────────────────────────────────────────────────────────────────────────────

test('a timed event becomes a block at its local start', () => {
  const event = read(timed('2026-09-03T09:30:00', '2026-09-03T10:15:00'));
  assert.equal(event.title, 'Standup');
  // Minutes past midnight of the day being drawn, not a clock string: a block
  // on this timeline can sit after midnight, and 'HH:MM' cannot say 25:30.
  assert.equal(event.startMinutes, 9 * 60 + 30);
  assert.equal(event.minutes, 45);
  assert.equal(event.allDay, false);
  assert.equal(event.clipped, null);
  // The id is scoped to its calendar: two calendars can hold the same event id.
  assert.equal(event.id, 'me@example.com::evt1');
});

/*
  THE ONE THAT WAS WRONG. A named colour ("Chill Vibes") is an event LABEL, and a
  labelled event usually carries no colorId at all — so reading colorId first and
  falling through to the calendar drew a blue event in its calendar's red.
  Google's own docs say the label supersedes colorId, and its UI agrees.
*/
test('a label beats the event’s own colour, which beats the calendar’s', () => {
  const withLabels = {
    ...calendar,
    labels: { chill: { backgroundColor: '#4285f4', name: 'Chill Vibes' } },
  };
  const read = raw => externalFromGoogle(raw, { date: DATE, timeZone: TZ, calendar: withLabels, palette });

  // Labelled and nothing else: the case that was broken. Not the calendar's.
  const labelled = read(timed('2026-09-03T12:00:00', '2026-09-03T13:00:00', { eventLabelId: 'chill' }));
  assert.equal(labelled.color, '#4285f4');
  assert.equal(labelled.label, 'Chill Vibes');

  // Carrying both, the label still wins.
  const both = read(timed('2026-09-03T12:00:00', '2026-09-03T13:00:00', { eventLabelId: 'chill', colorId: '6' }));
  assert.equal(both.color, '#4285f4');

  // A label id this calendar no longer defines falls through rather than
  // colouring the event as undefined.
  const orphan = read(timed('2026-09-03T12:00:00', '2026-09-03T13:00:00', { eventLabelId: 'deleted', colorId: '6' }));
  assert.equal(orphan.color, '#f4511e');
  assert.equal(orphan.label, '');

  const plain = read(timed('2026-09-03T12:00:00', '2026-09-03T13:00:00'));
  assert.equal(plain.color, calendar.backgroundColor);
});

test('the colour is the event’s own, then the calendar’s, then a fallback', () => {
  assert.equal(read(timed('2026-09-03T09:00:00', '2026-09-03T10:00:00', { colorId: '6' })).color, '#f4511e');
  assert.equal(read(timed('2026-09-03T09:00:00', '2026-09-03T10:00:00')).color, '#039be5');

  const bare = externalFromGoogle(
    timed('2026-09-03T09:00:00', '2026-09-03T10:00:00'),
    { date: DATE, timeZone: TZ, calendar: { id: 'x' }, palette: {} }
  );
  assert.equal(bare.color, EXTERNAL_FALLBACK_COLOR);
});

/*
  THE ONE THAT MAKES THE ROUND TRIP SAFE. An event we wrote ourselves is already
  on the timeline as a task block; drawing Google's copy of it too would show
  every planned hour twice the moment you finished planning.
*/
test('our own pushed blocks are not drawn a second time', () => {
  const ours = timed('2026-09-03T11:00:00', '2026-09-03T12:00:00', {
    extendedProperties: { private: { [TASK_ID_PROPERTY]: 'task-1' } },
  });
  assert.equal(read(ours), null);
});

test('cancelled and declined events are not on your day', () => {
  assert.equal(read(timed('2026-09-03T09:00:00', '2026-09-03T10:00:00', { status: 'cancelled' })), null);
  assert.equal(read(timed('2026-09-03T09:00:00', '2026-09-03T10:00:00', {
    attendees: [{ self: true, responseStatus: 'declined' }],
  })), null);
  // Somebody ELSE declining is not a reason to hide the meeting from you.
  assert.ok(read(timed('2026-09-03T09:00:00', '2026-09-03T10:00:00', {
    attendees: [{ email: 'other@example.com', responseStatus: 'declined' }],
  })));
});

test('another day’s events are not on this one', () => {
  assert.equal(read(timed('2026-09-02T09:00:00', '2026-09-02T10:00:00')), null);
  assert.equal(read(timed('2026-09-04T09:00:00', '2026-09-04T10:00:00')), null);
});

/*
  THE DAY RUNS 4am TO 4am, so "after midnight" is the end of tonight and not the
  start of tomorrow. A one-o'clock finish belongs to the evening it followed,
  and is drawn at 25:00 — which is exactly what a planner is for and exactly
  what clipping everything at midnight used to destroy.
*/
test('a late night carries on past midnight instead of being cut at it', () => {
  const intoTomorrow = read(timed('2026-09-03T23:00:00', '2026-09-04T02:00:00'));
  assert.equal(intoTomorrow.startMinutes, 23 * 60);
  assert.equal(intoTomorrow.minutes, 180);          // the whole three hours
  assert.equal(intoTomorrow.clipped, null);         // nothing was cut

  // Wholly in the small hours of the next morning: still tonight's business.
  const smallHours = read(timed('2026-09-04T01:00:00', '2026-09-04T02:30:00'));
  assert.equal(smallHours.startMinutes, 25 * 60);
  assert.equal(smallHours.minutes, 90);

  // Past 4am tomorrow is a different day, and is not drawn on this one.
  assert.equal(read(timed('2026-09-04T09:00:00', '2026-09-04T10:00:00')), null);
});

test('an event running past either end of the day is clipped, and says which', () => {
  const overnight = read(timed('2026-09-02T22:00:00', '2026-09-03T01:00:00'));
  assert.equal(overnight.startMinutes, 0);
  assert.equal(overnight.minutes, 60);
  assert.equal(overnight.clipped, 'start');

  // Runs off the bottom: trimmed at 4am tomorrow, where the day ends.
  const overshoot = read(timed('2026-09-03T23:00:00', '2026-09-04T09:00:00'));
  assert.equal(overshoot.startMinutes, 23 * 60);
  assert.equal(overshoot.minutes, 5 * 60);          // 23:00 → 28:00
  assert.equal(overshoot.clipped, 'end');

  const allTheWay = read(timed('2026-09-02T20:00:00', '2026-09-04T09:00:00'));
  assert.equal(allTheWay.startMinutes, 0);
  assert.equal(allTheWay.minutes, 28 * 60);
  assert.equal(allTheWay.clipped, 'both');
});

test('an event ending exactly at midnight belongs to the day it ran in', () => {
  // 11pm–midnight is Wednesday's, and must not leave a sliver at the top of
  // Thursday.
  assert.equal(read(timed('2026-09-02T23:00:00', '2026-09-03T00:00:00')), null);
  assert.ok(read(timed('2026-09-02T23:00:00', '2026-09-03T00:00:00'), '2026-09-02'));
});

test('a zero-length event is still visible', () => {
  const event = read(timed('2026-09-03T09:00:00', '2026-09-03T09:00:00'));
  assert.equal(event.minutes, MIN_EXTERNAL_MINUTES);
});

test('all-day events span Google’s exclusive end date', () => {
  const raw = { id: 'a1', summary: 'Conference', start: { date: '2026-09-02' }, end: { date: '2026-09-04' } };
  assert.equal(read(raw, '2026-09-01'), null);
  assert.equal(read(raw, '2026-09-02').allDay, true);
  assert.equal(read(raw, '2026-09-03').allDay, true);
  assert.equal(read(raw, '2026-09-04'), null);   // the end date is not included

  const oneDay = { id: 'a2', summary: 'Holiday', start: { date: '2026-09-03' } };
  assert.equal(read(oneDay, '2026-09-03').allDay, true);
  assert.equal(read(oneDay, '2026-09-04'), null);
});

test('an all-day event has no hour, and an untitled one still has a name', () => {
  const event = read({ id: 'a3', start: { date: DATE }, end: { date: '2026-09-04' } });
  assert.equal(event.start, null);
  assert.equal(event.minutes, 0);
  assert.equal(event.title, 'Busy');
});

// ─────────────────────────────────────────────────────────────────────────────
// The wire, read defensively
// ─────────────────────────────────────────────────────────────────────────────

test('a broken event costs one event, not the timeline', () => {
  assert.equal(normalizeExternal(null), null);
  assert.equal(normalizeExternal({ id: 'x', startMinutes: 'half nine' }), null);
  assert.equal(normalizeExternal({ id: 'x', startMinutes: -30 }), null);
  assert.equal(normalizeExternal({ id: 'x', startMinutes: 28 * 60 }), null);
  assert.equal(
    normalizeExternal({ id: 'x', startMinutes: 540, color: 'javascript:x' }).color,
    EXTERNAL_FALLBACK_COLOR
  );
});

test('a day comes back in the order it runs, all-day first', () => {
  const events = normalizeExternals([
    { id: 'c', startMinutes: 14 * 60, minutes: 30 },
    { id: 'a', allDay: true, title: 'Holiday' },
    { id: 'b', startMinutes: 9 * 60, minutes: 60 },
    // Past midnight, and therefore LAST rather than first.
    { id: 'd', startMinutes: 25 * 60, minutes: 60 },
    null,
    { id: 'e', startMinutes: 'nonsense' },
  ]);
  assert.deepEqual(events.map(e => e.id), ['a', 'b', 'c', 'd']);
});

test('a block cannot be normalized into running past the end of the day', () => {
  const event = normalizeExternal({ id: 'x', startMinutes: 27 * 60 + 30, minutes: 600 });
  assert.equal(event.minutes, 30);                  // 27:30 → 28:00 and no further
});

// ─────────────────────────────────────────────────────────────────────────────
// What gets sent back
// ─────────────────────────────────────────────────────────────────────────────

const mk = o => normalizeTask({ id: o.id, title: o.title || 't', list_id: 'default', ...o });

test('only tasks planned for the day AND given an hour are sent', () => {
  const items = dayPushItems([
    mk({ id: '1', title: 'Memo', planned_date: DATE, scheduled_start: '11:00', scheduled_minutes: 60 }),
    // On the day, but no block: a real plan, and not an appointment.
    mk({ id: '2', title: 'Reading', planned_date: DATE }),
    // A block, but for another day.
    mk({ id: '3', title: 'Old', planned_date: '2026-09-02', scheduled_start: '09:00', scheduled_minutes: 30 }),
  ], DATE);

  assert.deepEqual(items, [{ taskId: '1', title: 'Memo', start: '11:00', minutes: 60 }]);
});

test('a finished block is still sent: the day happened', () => {
  const items = dayPushItems([
    mk({ id: '1', title: 'Done thing', status: 'completed', planned_date: DATE, scheduled_start: '09:00', scheduled_minutes: 30 }),
  ], DATE);
  assert.equal(items.length, 1);
});

test('a block with no length of its own falls back, then to the default', () => {
  const [fromEstimate] = dayPushItems([
    mk({ id: '1', planned_date: DATE, scheduled_start: '09:00', estimated_minutes: 90 }),
  ], DATE);
  assert.equal(fromEstimate.minutes, 90);

  const [fallback] = dayPushItems([
    mk({ id: '2', planned_date: DATE, scheduled_start: '09:00' }),
  ], DATE);
  assert.equal(fallback.minutes, 30);
});

test('the day is sent in order, so the same day is always the same list', () => {
  const tasks = [
    mk({ id: 'b', planned_date: DATE, scheduled_start: '14:00', scheduled_minutes: 30 }),
    mk({ id: 'a', planned_date: DATE, scheduled_start: '09:00', scheduled_minutes: 30 }),
  ];
  assert.deepEqual(dayPushItems(tasks, DATE).map(i => i.taskId), ['a', 'b']);
  assert.deepEqual(dayPushItems([...tasks].reverse(), DATE).map(i => i.taskId), ['a', 'b']);
});

/*
  The signature is the whole of "has this day changed since I sent it", so it
  has to be an identity: equal strings must mean the same day, and any of the
  three things Google is told must move it.
*/
test('the signature moves when, and only when, something Google was told changes', () => {
  const base = [{ taskId: '1', title: 'Memo', start: '11:00', minutes: 60 }];
  const same = [{ taskId: '1', title: 'Memo', start: '11:00', minutes: 60 }];
  assert.equal(pushSignature(base), pushSignature(same));

  assert.notEqual(pushSignature(base), pushSignature([{ ...base[0], start: '11:15' }]));
  assert.notEqual(pushSignature(base), pushSignature([{ ...base[0], minutes: 45 }]));
  assert.notEqual(pushSignature(base), pushSignature([{ ...base[0], title: 'Memo v2' }]));
  assert.notEqual(pushSignature(base), pushSignature([]));
});

test('the signature is the same whether built from the day or from what was written', () => {
  const items = [
    { taskId: 'b', title: 'Two', start: '14:00', minutes: 30 },
    { taskId: 'a', title: 'One', start: '09:00', minutes: 60 },
  ];
  // What the server rebuilds it from: a map of task id → the signature stored
  // beside the event it wrote. Same string, different order, different source.
  const stored = daySignature(items.map(i => [i.taskId, itemSignature(i)]).reverse());
  assert.equal(pushSignature(items), stored);
});

// ─────────────────────────────────────────────────────────────────────────────
// The push body is INPUT: it writes to a real person's calendar
// ─────────────────────────────────────────────────────────────────────────────

test('a push body is shape-checked before any of it becomes a calendar event', () => {
  const items = normalizePushItems([
    { taskId: '1', title: 'Memo', start: '11:00', minutes: 60 },
    { taskId: '2', title: '  ', start: '09:00', minutes: 30 },   // untitled, still named
    { taskId: '3', title: 'No time', start: 'later' },           // no hour, no block
    { taskId: '1', title: 'Duplicate', start: '15:00', minutes: 30 },
    null,
    'nonsense',
  ]);

  assert.deepEqual(items.map(i => i.taskId), ['2', '1']);        // in time order
  assert.equal(items[0].title, 'Untitled task');
  // One block per task per day: the second '1' is dropped rather than written
  // as a second event.
  assert.equal(items.filter(i => i.taskId === '1').length, 1);
});

test('a pushed block is trimmed to the end of the day, which is 4am', () => {
  // 11pm plus five hours runs to 4am, and every minute of it is tonight.
  const [full] = normalizePushItems([{ taskId: '1', title: 'Late', start: '23:00', minutes: 300 }]);
  assert.equal(full.minutes, 300);
  // Past four in the morning is the next day's business.
  const [trimmed] = normalizePushItems([{ taskId: '2', title: 'Later', start: '03:00', minutes: 300 }]);
  assert.equal(trimmed.minutes, 60);
});

test('the day is sent in the order it runs, so the small hours are last', () => {
  const items = normalizePushItems([
    { taskId: 'late', title: 'Wind down', start: '01:00', minutes: 30 },
    { taskId: 'morning', title: 'Lecture', start: '09:00', minutes: 60 },
  ]);
  assert.deepEqual(items.map(i => i.taskId), ['morning', 'late']);
});
