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
  EXTERNAL_FALLBACK_COLOR, MAX_DESCRIPTION, MIN_EXTERNAL_MINUTES, MUST_DO_STAR, TASK_ID_PROPERTY, asDrawn,
  dayPushItems, daySignature, descriptionPreview, externalFromGoogle, findLabel, isValidTimeZone,
  itemSignature,
  labelColor, normalizeExternal, normalizeExternals, normalizeLabelId, normalizeLabels,
  normalizePushItems, pushSignature, pushTitle, wallClock,
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

/*
  THE ONE THAT ARRIVES THE WRONG RED. Google answers with the palette it shipped
  in 2011 and has drawn the Material one for years, so the Tomato its API calls
  #dc2127 is the #d50000 sitting on the screen next to this one.
*/
test('a colour is drawn the way Google draws it, not the way its API names it', () => {
  assert.equal(read(timed('2026-09-03T09:00:00', '2026-09-03T10:00:00', { colorId: '11' })).color, '#d50000');

  // A calendar's own colour comes off the same old table and gets the same fix.
  const inherited = externalFromGoogle(
    timed('2026-09-03T09:00:00', '2026-09-03T10:00:00'),
    { date: DATE, timeZone: TZ, calendar: { id: 'x', backgroundColor: '#f83a22' }, palette }
  );
  assert.equal(inherited.color, '#d50000');

  // Case is Google's business, not ours.
  assert.equal(asDrawn('#DC2127'), '#d50000');

  // A colour the table does not know is its own answer: correcting a colour is
  // the whole job, and inventing one is not.
  assert.equal(asDrawn('#123456'), '#123456');
  assert.equal(asDrawn('#d50000'), '#d50000');
  assert.equal(asDrawn(null), null);
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

  // Starred, because `normalizeTask` puts an unstated task on the day as
  // must_do — a deadline is a commitment by default (see DEFAULT_DAILY_PRIORITY).
  assert.deepEqual(items, [{
    taskId: '1', title: `Memo ${MUST_DO_STAR}`, start: '11:00', minutes: 60, labelId: null,
  }]);
});

// ─────────────────────────────────────────────────────────────────────────────
// What may be done to somebody else's hour
// ─────────────────────────────────────────────────────────────────────────────

const mine = { ...calendar, accessRole: 'owner' };
const theirs = { ...calendar, accessRole: 'reader' };

test('an event on a calendar you own is yours to move, and carries its address', () => {
  const event = externalFromGoogle(timed('2026-09-03T09:00:00', '2026-09-03T10:00:00'), {
    date: DATE, timeZone: TZ, calendar: mine, palette,
  });
  assert.equal(event.writable, true);
  assert.equal(event.movable, true);
  assert.equal(event.calendarId, calendar.id);
  assert.equal(event.eventId, 'evt1');
});

test('a calendar shared with you read-only is drawn and never written', () => {
  const event = externalFromGoogle(timed('2026-09-03T09:00:00', '2026-09-03T10:00:00'), {
    date: DATE, timeZone: TZ, calendar: theirs, palette,
  });
  assert.equal(event.writable, false);
  assert.equal(event.movable, false);
});

test("a meeting somebody else organized keeps its words, and still takes a tag", () => {
  const event = externalFromGoogle(
    timed('2026-09-03T09:00:00', '2026-09-03T10:00:00', {
      organizer: { email: 'them@example.com' },
      attendees: [{ email: 'me@example.com', self: true, responseStatus: 'accepted' }],
    }),
    { date: DATE, timeZone: TZ, calendar: mine, palette },
  );
  // The three flags are the whole point of being three: recolouring your own
  // copy is yours, its wording and its time are the organizer's.
  assert.equal(event.writable, true);
  assert.equal(event.editable, false);
  assert.equal(event.movable, false);
});

test('an event that crosses a midnight is not dragged from a day that holds half of it', () => {
  const event = externalFromGoogle(timed('2026-09-02T22:00:00', '2026-09-03T09:00:00'), {
    date: DATE, timeZone: TZ, calendar: mine, palette,
  });
  assert.equal(event.clipped, 'start');
  assert.equal(event.movable, false);
  // But its NAME is still perfectly safe to change: clipping is a fact about
  // which hours are on this day, and says nothing about whose event it is.
  assert.equal(event.writable, true);
  assert.equal(event.editable, true);
});

test('a description comes back as Google holds it', () => {
  const event = externalFromGoogle(
    timed('2026-09-03T09:00:00', '2026-09-03T10:00:00', { description: 'Room 214, bring the draft' }),
    { date: DATE, timeZone: TZ, calendar: mine, palette },
  );
  assert.equal(event.description, 'Room 214, bring the draft');
  assert.equal(event.descriptionClipped, false);

  // No description is an empty string rather than undefined, so the field it is
  // drawn in never has to ask which kind of nothing this is.
  const bare = externalFromGoogle(timed('2026-09-03T09:00:00', '2026-09-03T10:00:00'), {
    date: DATE, timeZone: TZ, calendar: mine, palette,
  });
  assert.equal(bare.description, '');
});

test('a meeting invitation\u2019s wall of html is carried in part and flagged as partial', () => {
  const long = 'x'.repeat(MAX_DESCRIPTION + 500);
  const event = externalFromGoogle(
    timed('2026-09-03T09:00:00', '2026-09-03T10:00:00', { description: long }),
    { date: DATE, timeZone: TZ, calendar: mine, palette },
  );
  assert.equal(event.description.length, MAX_DESCRIPTION);
  // The flag is what stops the menu offering to save an edit to two thirds of
  // somebody's dial-in details.
  assert.equal(event.descriptionClipped, true);

  // And it survives the wire, because that is the side the menu reads it on.
  assert.equal(normalizeExternal({
    id: 'x', calendarId: 'c', eventId: 'e', startMinutes: 540, minutes: 60,
    description: long, descriptionClipped: true, writable: true, editable: true,
  }).descriptionClipped, true);
});

test('the tag an event carries comes back as an id, and a deleted one comes back as none', () => {
  const label = { id: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'Classes', backgroundColor: '#f4511e' };
  const withLabel = externalFromGoogle(
    timed('2026-09-03T09:00:00', '2026-09-03T10:00:00', { eventLabelId: label.id }),
    { date: DATE, timeZone: TZ, calendar: { ...mine, labels: { [label.id]: label } }, palette },
  );
  assert.equal(withLabel.labelId, label.id);
  assert.equal(withLabel.color, '#f4511e');
  assert.equal(withLabel.label, 'Classes');

  // The same event on a calendar that no longer defines that label: no tag, and
  // the colour falls through to the calendar's, exactly as Google draws it.
  const orphaned = externalFromGoogle(
    timed('2026-09-03T09:00:00', '2026-09-03T10:00:00', { eventLabelId: label.id }),
    { date: DATE, timeZone: TZ, calendar: mine, palette },
  );
  assert.equal(orphaned.labelId, '');
});

test('a gesture is never offered where there is no address to send it to', () => {
  const event = normalizeExternal({
    id: 'x', startMinutes: 540, minutes: 60, writable: true, editable: true, movable: true,
  });
  assert.equal(event.writable, false);
  assert.equal(event.editable, false);
  assert.equal(event.movable, false);
});

test('a description drawn on a block is plain text, whatever Google put in it', () => {
  // What an invitation generator actually writes.
  assert.equal(
    descriptionPreview('<p>Join the <b>weekly</b> sync</p><br>Room&nbsp;214 &amp; bring the draft'),
    'Join the weekly sync Room 214 & bring the draft',
  );
  // A break tag becomes a space rather than nothing, or two lines run together
  // into one word.
  assert.equal(descriptionPreview('one<br>two'), 'one two');
  // Text that was ESCAPED stays text: decoding after the tags are gone is what
  // stops `&lt;b&gt;` coming back to life as markup.
  assert.equal(descriptionPreview('&lt;b&gt; is bold'), '<b> is bold');
  // A note of your own keeps its words and loses its shape, which is all a
  // three-line box could have kept anyway.
  assert.equal(descriptionPreview('line one\n\nline two'), 'line one line two');
  assert.equal(descriptionPreview(''), '');
  assert.equal(descriptionPreview(null), '');
});

test('a preview is bounded, and says so when it has been cut', () => {
  const long = descriptionPreview('word '.repeat(200));
  assert.ok(long.length <= 401);
  assert.ok(long.endsWith('…'));
  // Short enough to fit is left exactly alone — no ellipsis on a complete note.
  assert.equal(descriptionPreview('Room 214'), 'Room 214');
});

// ─────────────────────────────────────────────────────────────────────────────
// The star: today's must-do, said in the one alphabet a calendar has
// ─────────────────────────────────────────────────────────────────────────────

test('a must-do task carries a star into Google, and an optional one does not', () => {
  const [must] = dayPushItems([
    mk({ id: '1', title: 'Essay', planned_date: DATE, scheduled_start: '09:00', daily_priority: 'must_do' }),
  ], DATE);
  assert.equal(must.title, `Essay ${MUST_DO_STAR}`);

  const [maybe] = dayPushItems([
    mk({ id: '2', title: 'Reading', planned_date: DATE, scheduled_start: '09:00', daily_priority: 'optional' }),
  ], DATE);
  assert.equal(maybe.title, 'Reading');
});

test('the star is appended once, however many times a day is sent', () => {
  assert.equal(pushTitle(`Essay ${MUST_DO_STAR}`, true), `Essay ${MUST_DO_STAR}`);
  // And it is not a permanent mark: unstarring takes it off again, because the
  // title is rebuilt from the task rather than edited in place.
  assert.equal(pushTitle('Essay', false), 'Essay');
});

test('starring a task is a change Google has to be told about', () => {
  const of = priority => itemSignature(dayPushItems([
    mk({ id: '1', title: 'Essay', planned_date: DATE, scheduled_start: '09:00', daily_priority: priority }),
  ], DATE)[0]);
  assert.notEqual(of('must_do'), of('optional'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Tags: the named colours you keep your calendar in
// ─────────────────────────────────────────────────────────────────────────────

const TAGS = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Classes', backgroundColor: '#f4511e' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Chill Vibes', backgroundColor: '#4285f4' },
];

test('a tag with no colour is not a tag, and neither is a duplicate of one', () => {
  const labels = normalizeLabels([
    ...TAGS,
    { id: 'no-colour', name: 'Broken' },
    { name: 'No id at all', backgroundColor: '#000000' },
    TAGS[0],
  ]);
  assert.deepEqual(labels.map(l => l.name), ['Classes', 'Chill Vibes']);
});

test('the anonymous swatches Google keeps for its own palette are not tags', () => {
  /*
    What a real calendar answers with: the handful you named, and one unnamed
    label per colour in Google's palette. Only the named ones are choices — the
    rest would be a menu of identical "Untitled" pills burying the words you
    actually wrote.
  */
  const labels = normalizeLabels([
    TAGS[0],
    { id: '33333333-3333-3333-3333-333333333333', backgroundColor: '#d50000' },
    { id: '44444444-4444-4444-4444-444444444444', name: '   ', backgroundColor: '#0b8043' },
    TAGS[1],
  ]);
  assert.deepEqual(labels.map(l => l.name), ['Classes', 'Chill Vibes']);
});

test('a tag colours the thing it is on, and nothing when it has been deleted', () => {
  assert.equal(labelColor(TAGS, TAGS[1].id), '#4285f4');
  assert.equal(labelColor(TAGS, 'since-deleted-and-gone'), null);
  assert.equal(labelColor(TAGS, null), null);
  assert.equal(findLabel(TAGS, TAGS[0].id).name, 'Classes');
});

test('a tag id off the wire is a uuid or it is no tag at all', () => {
  assert.equal(normalizeLabelId(TAGS[0].id), TAGS[0].id);
  assert.equal(normalizeLabelId(''), null);
  assert.equal(normalizeLabelId(null), null);
  assert.equal(normalizeLabelId('<script>'), null);
});

test("a task's tag is sent with its block, and retagging is a change", () => {
  const [item] = dayPushItems([
    mk({
      id: '1', title: 'Lecture', planned_date: DATE, scheduled_start: '09:00',
      google_label_id: TAGS[0].id,
    }),
  ], DATE);
  assert.equal(item.labelId, TAGS[0].id);

  const [untagged] = dayPushItems([
    mk({ id: '1', title: 'Lecture', planned_date: DATE, scheduled_start: '09:00' }),
  ], DATE);
  assert.notEqual(itemSignature(item), itemSignature(untagged));
});

test('a tag survives the round trip through the push body', () => {
  const [item] = normalizePushItems([
    { taskId: '1', title: 'Lecture', start: '09:00', minutes: 60, labelId: TAGS[0].id },
  ]);
  assert.equal(item.labelId, TAGS[0].id);

  const [scrubbed] = normalizePushItems([
    { taskId: '1', title: 'Lecture', start: '09:00', minutes: 60, labelId: 'not a uuid' },
  ]);
  assert.equal(scrubbed.labelId, null);
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
