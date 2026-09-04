/*
  GOOGLE CALENDAR, as this app's model sees it.

  /today already draws two kinds of thing on its timeline: TASKS you planned and
  gave an hour to, and COMMITMENTS you typed in yourself (class, lunch). This
  adds a third, and it is unlike either of them:

    an EXTERNAL EVENT   something already on your real Google calendar. It is
                        not a task and not one of your commitments; it is the
                        shape of the day you are planning INTO. You cannot move
                        it, resize it, complete it or delete it from here — the
                        only honest thing a planner can do with a lecture at
                        nine is draw it and plan around it.

  and one thing goes the other way:

    a PUSHED BLOCK      a task you scheduled, written into Google Calendar when
                        you finish planning, so the day you decided on is the
                        day your phone shows you at eleven o'clock.

  THE ONE RULE THAT MAKES THE ROUND TRIP SAFE. Every event this app writes
  carries the task's id in `extendedProperties.private` (TASK_ID_PROPERTY).
  That single fact does three jobs at once:

    · reading   an event stamped with a task id is OUR OWN copy of a block
                already on the timeline, so it is dropped rather than drawn a
                second time. Finish planning, and the day still shows each
                thing exactly once.
    · updating  a block that moved is found again by its task id, so re-planning
                MOVES the Google event instead of leaving a stale one behind and
                adding a second.
    · deleting  we only ever delete an event carrying one of our ids, so a
                planner writing into your primary calendar can never remove a
                real meeting, whatever else goes wrong.

  Everything here is PURE — no fetch, no environment, no server. The talking to
  Google lives in lib/googleAuth.js and lib/googleCalendar.js; this is only the
  shapes, and it is shared by both sides of the wire so the client and the
  server cannot disagree about what a day contains.
*/

import {
  DAY_WINDOW_END, MINUTES_PER_DAY, addDaysISO, clockToMinutes, dayClock, dayMinutes,
} from './dates.js';
import { DEFAULT_BLOCK_MINUTES, normalizeEstimate } from './tasks.js';

// ─────────────────────────────────────────────────────────────────────────────
// The mark we leave on our own events
// ─────────────────────────────────────────────────────────────────────────────

/*
  Private extended properties: visible to this app through the API, invisible in
  the Google Calendar UI, and carried by the event itself rather than by a table
  on our side. That last part is the point — if the mapping blob in app_settings
  were lost tomorrow, every event we have ever written would still identify
  itself, so the worst case is a re-push, not a duplicate calendar.
*/
export const TASK_ID_PROPERTY = 'tasksAppTaskId';
export const DATE_PROPERTY = 'tasksAppDate';

/** The colour an event falls back to when neither it nor its calendar names one. */
export const EXTERNAL_FALLBACK_COLOR = '#4285f4';

/** A block Google gave us no length for still has to be visible. */
export const MIN_EXTERNAL_MINUTES = 15;

/** How many external events one day is allowed to draw before we stop reading. */
export const MAX_EXTERNAL_EVENTS = 200;

const HEX = /^#[0-9a-fA-F]{6}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Wall clock in a named timezone
// ─────────────────────────────────────────────────────────────────────────────

/*
  Google hands back instants ('2026-09-03T09:00:00-04:00'); the timeline works
  in minutes past midnight, LOCAL. Converting between them is the one place this
  feature could quietly be an hour wrong twice a year, so it is done through
  Intl rather than by arithmetic on the offset in the string: the offset is
  correct for that instant, but "which local day is this, and how far into it"
  is a question only the timezone database can answer across a DST boundary.

  Formatters are cached because one is built per timezone, not per event, and a
  day with sixty events would otherwise construct sixty of them.
*/
const formatters = new Map();

function formatterFor(timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Is this a timezone Intl actually knows? The client sends it, so it is input. */
export function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    formatters.delete(timeZone);
    return false;
  }
}

/**
 * An instant, as a person in `timeZone` reads it off a clock:
 * `{ date: 'YYYY-MM-DD', minutes: <past midnight> }`.
 */
export function wallClock(instant, timeZone) {
  const parts = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) parts[part.type] = part.value;
  // 'h23' says midnight is 00, but some ICU builds still say 24. Cheap to allow.
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// One Google event → one thing on the day
// ─────────────────────────────────────────────────────────────────────────────

/*
  THE COLOUR, which is half of what a real calendar on this timeline is for: an
  event you recognise by its colour in Google has to be that colour here, or the
  page is a different calendar wearing the same times.

  Google says it in THREE places, and they are tried narrowest first, which is
  the order its own UI resolves them in:

    1. the LABEL      `eventLabelId` names an entry in the calendar's own
                      `labelProperties.eventLabels` (see Calendars.get) — a
                      named colour you defined, like "Chill Vibes" or "Classes".
                      Google's docs are explicit that this SUPERSEDES colorId,
                      and it is the one the modern Google Calendar UI actually
                      draws. It is also the only one of the three carrying a
                      name, which is why `label` comes back with the event.
    2. its own colour `colorId`, an index into the eleven-colour event palette
                      (see /colors). The older mechanism, still used by anything
                      coloured before labels existed or through the API.
    3. its calendar   everything else takes the colour of the calendar it lives
                      on, exactly as it does in Google.

  Getting this order wrong is not a near miss. A labelled event usually carries
  NO colorId at all, so it silently fell through to its calendar's colour — a
  blue "Chill Vibes" event drawn in the red of the calendar holding it.
*/
export function eventColor(raw, calendar = {}, palette = {}) {
  const label = eventLabel(raw, calendar);
  if (label?.backgroundColor) return asDrawn(label.backgroundColor);
  const own = raw?.colorId && palette?.event?.[raw.colorId]?.background;
  return asDrawn(own || calendar.backgroundColor || EXTERNAL_FALLBACK_COLOR);
}

/*
  THE TWO PALETTES, and why an event off Google arrives the wrong red.

  Google draws its calendar in one set of colours and answers about it in
  another. `/colors` and a calendar's own `backgroundColor` still return the
  pastel table from 2011 — Tomato is #dc2127 there, a brick red — while the
  calendar you are actually looking at has drawn that same colour, under that
  same name, as #d50000 for years. Neither is wrong and nothing is broken: they
  are the same names with two generations of hexes, and the API kept the old
  ones so that everything which had already stored them kept working.

  This page is a PICTURE OF THE CALENDAR YOU ARE LOOKING AT, so it has to use
  the colours you are looking at, or the point of drawing your real events in
  their real colours — recognising Thursday at a glance — is lost to a shade.

  Keyed by hex rather than by colour id, so it corrects every source at once:
  the event palette, the colour of the calendar an event lives on, and the
  written-down copy in googleCalendar.js all pass through here. Anything it does
  not recognise comes back exactly as it arrived — a label's colour is already
  the modern set, and a colour Google adds next year should be drawn as Google
  sends it rather than guessed at.
*/
const AS_DRAWN = {
  // The eleven EVENT colours (/colors → `event`).
  '#a4bdfc': '#7986cb', // Lavender
  '#7ae7bf': '#33b679', // Sage
  '#dbadff': '#8e24aa', // Grape
  '#ff887c': '#e67c73', // Flamingo
  '#fbd75b': '#f6bf26', // Banana
  '#ffb878': '#f4511e', // Tangerine
  '#46d6db': '#039be5', // Peacock
  '#e1e1e1': '#616161', // Graphite
  '#5484ed': '#3f51b5', // Blueberry
  '#51b749': '#0b8043', // Basil
  '#dc2127': '#d50000', // Tomato

  // The twenty-four CALENDAR colours (/colors → `calendar`), which an event
  // with no colour of its own inherits. Same story, a longer table.
  '#ac725e': '#795548', // Cocoa
  '#d06b64': '#e67c73', // Flamingo
  '#f83a22': '#d50000', // Tomato
  '#fa573c': '#f4511e', // Tangerine
  '#ff7537': '#ef6c00', // Pumpkin
  '#ffad46': '#f09300', // Mango
  '#42d692': '#009688', // Eucalyptus
  '#16a765': '#0b8043', // Basil
  '#7bd148': '#7cb342', // Pistachio
  '#b3dc6c': '#c0ca33', // Avocado
  '#fbe983': '#e4c441', // Citron
  '#fad165': '#f6bf26', // Banana
  '#92e1c0': '#33b679', // Sage
  '#9fe1e7': '#039be5', // Peacock
  '#9fc6e7': '#4285f4', // Cobalt
  '#4986e7': '#3f51b5', // Blueberry
  '#9a9cff': '#7986cb', // Lavender
  '#b99aff': '#b39ddb', // Wisteria
  '#c2c2c2': '#616161', // Graphite
  '#cabdbf': '#a79b8e', // Birch
  '#cca6ac': '#ad1457', // Beetroot
  '#f691b2': '#d81b60', // Cherry Blossom
  '#cd74e6': '#8e24aa', // Grape
  '#a47ae2': '#9e69af', // Amethyst
};

/**
 * A colour Google reported, as Google actually draws it. A hex it does not know
 * is its own answer, so this can only ever correct a colour, never invent one.
 */
export function asDrawn(hex) {
  return AS_DRAWN[String(hex || '').trim().toLowerCase()] || hex;
}

/** The label an event carries, if it carries one this calendar still defines. */
export function eventLabel(raw, calendar = {}) {
  const id = raw?.eventLabelId;
  return (id && calendar.labels?.[id]) || null;
}

/**
 * A raw Google event, as the day sees it — or `null` when the day does not see
 * it at all.
 *
 * Four kinds of event are dropped here rather than drawn, and each of them
 * would be a lie on a page about today:
 *
 *   cancelled    it is not happening.
 *   OURS         it carries a task id, so it is a copy of a block already on
 *                this timeline. Drawing it too would be the same hour twice —
 *                which is exactly what "it removes the temporary ones" means.
 *   declined     you said no. It is on the calendar and it is not on your day.
 *   another day  it does not overlap the day being drawn.
 *
 * An event that starts yesterday or runs into tomorrow is CLIPPED to the day
 * rather than dropped, and says which end was cut, because "this started before
 * you got up" is a fact about today.
 */
export function externalFromGoogle(raw, { date, timeZone, calendar = {}, palette = {} }) {
  if (!raw || raw.status === 'cancelled') return null;
  if (raw.extendedProperties?.private?.[TASK_ID_PROPERTY]) return null;
  if (Array.isArray(raw.attendees) && raw.attendees.some(a => a?.self && a.responseStatus === 'declined')) {
    return null;
  }

  const base = {
    id: `${calendar.id || 'primary'}::${raw.id}`,
    title: String(raw.summary || '').trim() || 'Busy',
    color: eventColor(raw, calendar, palette),
    // What you called that colour. "Chill Vibes" says more about an hour than
    // the fact that it is blue does, and it is the only word Google gives us
    // for what KIND of thing an event is.
    label: String(eventLabel(raw, calendar)?.name || '').trim(),
    calendar: String(calendar.summary || '').trim(),
    location: String(raw.location || '').trim(),
  };

  // ── All day: no hour to draw it at, so it is not a block at all ───────────
  if (raw.start?.date) {
    const from = raw.start.date;
    // Google's all-day end date is EXCLUSIVE: a one-day event ends tomorrow.
    const until = raw.end?.date || addDaysISO(from, 1);
    if (!(from <= date && date < until)) return null;
    return { ...base, allDay: true, start: null, minutes: 0, clipped: null };
  }

  if (!raw.start?.dateTime || !raw.end?.dateTime) return null;
  const startAt = new Date(raw.start.dateTime);
  const endAt = new Date(raw.end.dateTime);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;

  /*
    An instant, placed on THIS day's timeline: minutes from midnight of `date`,
    which runs past 1440 because the day does. Half past one tomorrow morning is
    25:30 here, and it belongs at the bottom of tonight rather than at the top of
    a day you have not started — which is the whole reason the window ends at
    4am (see DAY_ANCHOR_MINUTES in lib/dates).

    Anything earlier than this date returns a negative, anything later returns
    past the end of the window, and both are then either clipped or dropped by
    the overlap test below.
  */
  const nextDate = addDaysISO(date, 1);
  const place = (wall) => {
    if (wall.date === date) return wall.minutes;
    if (wall.date === nextDate) return MINUTES_PER_DAY + wall.minutes;
    return wall.date < date ? -1 : DAY_WINDOW_END + 1;
  };

  const startsAt = place(wallClock(startAt, timeZone));
  const endsAt = place(wallClock(endAt, timeZone));

  // Not on this day at all. `endsAt <= 0` also disposes of the event that ends
  // at the stroke of this midnight: that is the END of yesterday, not a
  // zero-length sliver at the top of today.
  if (endsAt <= 0 || startsAt >= DAY_WINDOW_END) return null;

  const start = Math.max(0, startsAt);
  const end = Math.min(DAY_WINDOW_END, endsAt);
  const clippedStart = startsAt < 0;
  const clippedEnd = endsAt > DAY_WINDOW_END;

  return {
    ...base,
    allDay: false,
    startMinutes: start,
    minutes: Math.min(Math.max(MIN_EXTERNAL_MINUTES, end - start), DAY_WINDOW_END - start),
    clipped: clippedStart && clippedEnd ? 'both' : clippedStart ? 'start' : clippedEnd ? 'end' : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The wire, read defensively
// ─────────────────────────────────────────────────────────────────────────────

/*
  The same contract as `normalizeEvent` in lib/agenda: whatever arrives, what
  comes out is drawable or it is nothing. It is read on the client, where the
  input is a JSON body, so a missing colour or a start of 'half nine' must cost
  one event and not the timeline.
*/
export function normalizeExternal(raw) {
  if (!raw || !raw.id) return null;

  const shared = {
    id: String(raw.id),
    title: String(raw.title || '').trim() || 'Busy',
    color: HEX.test(String(raw.color || '')) ? raw.color : EXTERNAL_FALLBACK_COLOR,
    label: String(raw.label || '').trim(),
    calendar: String(raw.calendar || '').trim(),
    location: String(raw.location || '').trim(),
  };

  if (raw.allDay) {
    return { ...shared, allDay: true, startMinutes: null, minutes: 0, clipped: null };
  }

  const start = Math.round(Number(raw.startMinutes));
  if (!Number.isFinite(start) || start < 0 || start >= DAY_WINDOW_END) return null;
  const minutes = Math.min(
    Math.max(MIN_EXTERNAL_MINUTES, Number(raw.minutes) || MIN_EXTERNAL_MINUTES),
    DAY_WINDOW_END - start
  );
  const clipped = ['start', 'end', 'both'].includes(raw.clipped) ? raw.clipped : null;

  return { ...shared, allDay: false, startMinutes: start, minutes, clipped };
}

/** A day's worth, drawable, in the order the day runs. All-day ones first. */
export function normalizeExternals(list) {
  return (Array.isArray(list) ? list : [])
    .slice(0, MAX_EXTERNAL_EVENTS)
    .map(normalizeExternal)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      if (a.allDay) return a.title.localeCompare(b.title);
      return a.startMinutes - b.startMinutes;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// The other direction: the day, as Google should hold it
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What finishing the day sends to Google: every task planned for `date` that
 * you actually gave an hour to.
 *
 * A task with no block is deliberately NOT here. "Some time this afternoon" is
 * a real plan and the app supports it, but it is not an appointment, and a
 * calendar full of invented times for work you never scheduled is worse than a
 * calendar that only knows what you decided.
 *
 * Finished tasks ARE here: a block you worked through is a thing that happened,
 * and deleting it out of your calendar at the moment you tick it off would
 * quietly rewrite the day as you lived it.
 *
 * Sorted, so the same day always produces the same list — which is what lets
 * `pushSignature` mean "has anything changed since the last push".
 */
export function dayPushItems(tasks, date) {
  if (!ISO_DATE.test(String(date))) return [];

  return (Array.isArray(tasks) ? tasks : [])
    .filter(task => task?.planned_date === date && clockToMinutes(task.scheduled_start) !== null)
    .map((task) => {
      const start = dayMinutes(task.scheduled_start);
      const length = normalizeEstimate(task.scheduled_minutes)
        || normalizeEstimate(task.estimated_minutes)
        || DEFAULT_BLOCK_MINUTES;
      return {
        taskId: String(task.id),
        title: String(task.title || '').trim() || 'Untitled task',
        start: dayClock(start),
        // `start` here is a position on the 4am day, so a 1am block has until
        // four rather than until midnight.
        minutes: Math.min(length, DAY_WINDOW_END - start),
      };
    })
    // Sorted by where they sit on the DAY, so the 1am block is last rather than
    // first: '01:00' < '09:00' as a string, and that is not the order the day
    // runs in.
    .sort((a, b) => (
      dayMinutes(a.start) - dayMinutes(b.start) || a.taskId.localeCompare(b.taskId)
    ));
}

/*
  WHAT WE SENT, in one string.

  Per item first: the three things about a block Google needs to be told again
  if any of them changes. Storing it beside the event id is what makes a re-push
  cheap — a day of eight blocks where you moved one is one PATCH, not eight.

  Then the day: the per-item signatures, keyed by task and sorted, so the string
  is the same whether it was built from the tasks in the browser or from the map
  of what was written. Comparing those two is the whole of "the day has changed
  since you sent it", and it has to be an identity, not a heuristic.
*/
export function itemSignature(item) {
  return `${item.start}+${item.minutes}|${item.title}`;
}

export function daySignature(entries) {
  return (entries || [])
    .map(([taskId, signature]) => `${taskId}=${signature}`)
    .sort()
    .join(';');
}

export function pushSignature(items) {
  return daySignature((items || []).map(item => [item.taskId, itemSignature(item)]));
}

/**
 * One item off the wire, checked. The push body is client-sent — it is the day
 * on screen, which is fresher than anything a re-read of the database could be
 * mid-drag — so every field of it is validated before it becomes a calendar
 * event in a real person's account.
 */
export function normalizePushItem(raw) {
  if (!raw || !raw.taskId) return null;
  const start = dayMinutes(raw.start);
  if (start === null) return null;
  const minutes = normalizeEstimate(raw.minutes) || DEFAULT_BLOCK_MINUTES;
  const title = String(raw.title || '').trim().slice(0, 300) || 'Untitled task';
  return {
    taskId: String(raw.taskId).slice(0, 64),
    title,
    start: dayClock(start),
    minutes: Math.min(minutes, DAY_WINDOW_END - start),
  };
}

export function normalizePushItems(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const item = normalizePushItem(raw);
    // One block per task per day: the timeline cannot draw two, so a body
    // claiming otherwise is a bug on the way to a duplicated calendar.
    if (!item || seen.has(item.taskId)) continue;
    seen.add(item.taskId);
    out.push(item);
  }
  return out.sort((a, b) => (
    dayMinutes(a.start) - dayMinutes(b.start) || a.taskId.localeCompare(b.taskId)
  ));
}
