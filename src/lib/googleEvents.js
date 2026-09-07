/*
  GOOGLE CALENDAR, as this app's model sees it.

  /today already draws two kinds of thing on its timeline: TASKS you planned and
  gave an hour to, and COMMITMENTS you typed in yourself (class, lunch). This
  adds a third, and it is unlike either of them:

    an EXTERNAL EVENT   something already on your real Google calendar. It is
                        not a task and not one of your commitments; it is the
                        shape of the day you are planning INTO. It cannot be
                        completed and it has no due date, but it IS yours to
                        rearrange — see below.

  and one thing goes the other way:

    a PUSHED BLOCK      a task you scheduled, written into Google Calendar when
                        you finish planning, so the day you decided on is the
                        day your phone shows you at eleven o'clock.

  THE EXTERNAL EVENT USED TO BE FROZEN, and is no longer. Drawing somebody
  else's ten o'clock and refusing to touch it is the honest thing to do only
  while there is nowhere to send the change; with `calendar.events` already
  granted there is, so a meeting on this timeline moves, resizes, gets renamed,
  gets retagged and gets deleted exactly as it would in Google's own week view,
  and the write goes to the event it came from. Three facts decide how
  far that goes, and they are carried on the event rather than guessed at by the
  page — three different permissions, because collapsing them into one would
  take away something Google itself allows:

    writable   we can write to the calendar it lives on at all (`accessRole`).
               A birthdays calendar, or one shared with you read-only, is still
               inert — there is nothing to write to. A TAG and a DELETE need
               this and nothing more: both act on your own copy of the event,
               which is why Google's own menu offers them on a meeting you were
               merely invited to.
    editable   its WORDS are yours: the title and the description. An event with
               guests that you did not organize belongs to whoever did, and
               Google refuses a rename from a guest.
    movable    its TIME is yours as well — editable, and not clipped to this
               day. What is drawn of an event that crosses a midnight is half of
               it, and a drag could only say where that half goes.

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
  formatDateLong, todayISO,
} from './dates.js';
import { DEFAULT_BLOCK_MINUTES, normalizeDailyPriority, normalizeEstimate } from './tasks.js';

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

/*
  TWO KINDS OF BLOCK, ONE ID SPACE.

  The push, the record of what was sent and the stamp on the event itself are
  all keyed by one string per block, and there are now two kinds of thing that
  can be a block: a task, keyed by its row id, and a commitment of your own,
  which lives in the day's JSON blob and has an id of its own making.

  A commitment's key is prefixed rather than trusted to look different, and the
  prefix is what the round trip is built on: everything Google sends back is
  keyed by it, and the two halves of the day are written to two different
  places — a task to its row, a commitment to the day's blob (see
  `adoptGoogleEdits` and `reapDeletedBlocks` in lib/googleCalendar). Guessing
  from the shape of an id would put a commitment's key into a `.eq('id', …)`
  against a uuid column; "it starts with event_" is a fact about today's id
  generator, where this is a promise.
*/
const COMMITMENT_PREFIX = 'commitment:';

/** The push key for one of your own commitments. */
export function commitmentPushId(id) {
  return `${COMMITMENT_PREFIX}${String(id || '').slice(0, 48)}`;
}

/** Is this push key a commitment's rather than a task's? */
export function isCommitmentPushId(key) {
  return String(key || '').startsWith(COMMITMENT_PREFIX);
}

/** The colour an event falls back to when neither it nor its calendar names one. */
export const EXTERNAL_FALLBACK_COLOR = '#4285f4';

/** A block Google gave us no length for still has to be visible. */
export const MIN_EXTERNAL_MINUTES = 15;

/** How many external events one day is allowed to draw before we stop reading. */
export const MAX_EXTERNAL_EVENTS = 200;

/*
  How much of a description travels with the day.

  Almost every event has none, and the ones that do have a sentence. The
  exception is a meeting invitation, which arrives carrying a kilobyte of
  generated HTML — join links, dial-in numbers, a footer — and two hundred of
  those is a megabyte on every page load, for text nobody reads off a timeline.

  So it is capped, and an event over the cap says so (`descriptionClipped`). That
  flag is not cosmetic: the menu makes the field READ-ONLY when it is set,
  because the one thing worse than not showing you a description is letting you
  save an edit to a truncated copy of one and dropping the rest.
*/
export const MAX_DESCRIPTION = 4000;

const clipDescription = text => (text.length > MAX_DESCRIPTION ? text.slice(0, MAX_DESCRIPTION) : text);

/*
  A DESCRIPTION, AS A BLOCK CAN DRAW IT.

  Two things stand between what is stored and what a box on the timeline can
  show, and neither of them is a change to what is stored:

    it is HTML       not because anybody typed HTML, but because Google Meet,
                     Zoom and every invitation generator writes it that way.
                     Drawn literally, a block would read `<b>Join</b><br>…`,
                     which is worse than showing nothing. The tags come out.
    it has SHAPE     paragraphs, list items, blank lines. A block is a few lines
                     tall, so the shape cannot survive and should not try: it is
                     collapsed to one run of text and the box clamps it.

  Display only, and deliberately one-way — the menu edits the stored text, not
  this. A preview that could be saved back would quietly strip the formatting
  off somebody's meeting invitation the first time they fixed a typo.

  The cap is not the truncation you SEE (the box does that, with its own
  ellipsis, at whatever height it happens to be). It is a bound on how much text
  goes into the DOM for each of up to two hundred blocks.
*/
export function descriptionPreview(text, limit = 400) {
  const plain = String(text || '')
    // The tags that mean "a break here" become a space before they are removed,
    // or two paragraphs are run together into one word.
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    // Entities last: an escaped `&lt;b&gt;` was TEXT, and decoding it after the
    // tags are gone is what keeps it text rather than resurrecting it as markup.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit).trimEnd()}…` : plain;
}

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
  A WALL CLOCK, PLACED ON ONE DAY'S TIMELINE: minutes from midnight of `date`,
  running past 1440 because the day does. Half past one tomorrow morning is
  25:30 here, and it belongs at the bottom of tonight rather than at the top of
  a day you have not started — which is the whole reason the window ends at 4am
  (see DAY_ANCHOR_MINUTES in lib/dates).

  Anything earlier than this date is a negative, anything later is past the end
  of the window, and both are for the caller to clip or drop.
*/
function placeOnDay(wall, date) {
  if (wall.date === date) return wall.minutes;
  if (wall.date === addDaysISO(date, 1)) return MINUTES_PER_DAY + wall.minutes;
  return wall.date < date ? -1 : DAY_WINDOW_END + 1;
}

/**
 * Where a Google event sits on this day, for one of OUR OWN blocks read back —
 * `{ start, minutes }` in the same numbers the timeline is drawn in.
 *
 * `null` unless the whole event falls inside this day's window. A block dragged
 * into tomorrow in Google, or across the 4am edge, is not a move this side can
 * express: our copy belongs to a date, and a date is the one thing the drag did
 * not change here. Better to leave it alone (the next push puts it back where
 * this day says it is) than to adopt a start clipped to the edge of the window
 * and call that where you moved it to.
 */
export function timedOnDay(raw, { date, timeZone }) {
  if (!raw?.start?.dateTime || !raw?.end?.dateTime) return null;
  const startAt = new Date(raw.start.dateTime);
  const endAt = new Date(raw.end.dateTime);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;

  const start = placeOnDay(wallClock(startAt, timeZone), date);
  const end = placeOnDay(wallClock(endAt, timeZone), date);
  if (start < 0 || end > DAY_WINDOW_END || end <= start) return null;
  return { start, minutes: end - start };
}

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

// ─────────────────────────────────────────────────────────────────────────────
// TAGS: the named colours you keep your calendar in
// ─────────────────────────────────────────────────────────────────────────────

/*
  A LABEL IS THE ONLY WORD GOOGLE HAS for what KIND of thing an hour is.

  "Work", "Classes", "Chill Vibes" — you defined them on a calendar, Google
  draws every event carrying one in that colour, and its own right-click menu is
  a row of them. That is the whole vocabulary, and this app borrows it rather
  than inventing a parallel one: a tag here IS a Google event label, so a block
  you retag on this timeline is the same colour on your phone thirty seconds
  later and means the same thing.

  They belong to ONE CALENDAR each — the id is a UUID that is unique within it —
  so the tags offered for a block are always the tags of the calendar that block
  will be written to: its own, for a Google event; the one the day is pushed to
  (GOOGLE_CALENDAR_NAME), for a task or a commitment of your own. Offering a
  label from somewhere else would be offering an id the write is about to
  reject.

  A LABEL WITH NO NAME IS NOT A TAG, and this is not a defensive nicety — it is
  most of what a calendar returns. Google keeps an unnamed label for each of the
  colours in its own palette, so `labelProperties.eventLabels` comes back as your
  six real tags followed by a dozen anonymous swatches. Drawn, they are a menu
  of identical "Untitled" pills you would never pick, burying the six words you
  actually named; and a tag is a WORD before it is a colour — "Chill Vibes" is
  the thing being said, and the colour is only how you recognise it at a
  distance. So a nameless one is dropped, and the menu is the list you wrote.

  Dropping it here costs an event that carries one NOTHING, because this is the
  menu's list and not the colour table: `eventColor` resolves a block's colour
  from the calendar's raw labels (see `eventLabel`), so an event coloured by an
  unnamed swatch is still drawn in that swatch's colour. It simply is not one of
  the things you can choose.

  Read defensively for the same reason as everything else here: this crosses the
  wire, so a label with no colour is not a label either, and is dropped rather
  than drawn as a transparent pill.
*/
export function normalizeLabel(raw) {
  const id = String(raw?.id || '').trim();
  const name = String(raw?.name || '').trim();
  const backgroundColor = String(raw?.backgroundColor || '').trim();
  if (!id || !name || !HEX.test(backgroundColor)) return null;
  return { id, name, backgroundColor };
}

export function normalizeLabels(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const label = normalizeLabel(raw);
    if (!label || seen.has(label.id)) continue;
    seen.add(label.id);
    out.push(label);
  }
  return out;
}

/** One tag out of a list, by id. `null` is "no tag", and so is one since deleted. */
export function findLabel(labels, id) {
  if (!id) return null;
  return (Array.isArray(labels) ? labels : []).find(label => label.id === id) || null;
}

/**
 * The colour a tag paints a block, or `null` when there is no tag on it — in
 * which case the caller's own default stands (Tomato for a task, slate for a
 * commitment, whatever Google says for one of its own events).
 */
export function labelColor(labels, id) {
  return findLabel(labels, id)?.backgroundColor || null;
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

  /*
    WHAT MAY BE DONE TO IT, decided here and carried on the event, so the page
    never has to guess and the two flags cannot drift apart from the reasons
    behind them:

      writable  the calendar accepts writes from us. A holiday feed or a
                calendar shared read-only does not, and a block you can drag but
                that snaps back is worse than one that never moved. Tagging and
                deleting need only this, because both act on your own copy.
      editable  its words are yours too. An invitation you ACCEPTED belongs to
                whoever sent it: Google refuses a rename from a guest, and its
                own UI does not offer one either.
      movable   and so is its time. Finished on the timed branch below, where it
                also has to survive the clipping test.
  */
  const writable = calendar.accessRole === 'owner' || calendar.accessRole === 'writer';
  const guests = Array.isArray(raw.attendees) && raw.attendees.length > 0;
  // `self: true` and nothing else. Google omits the flag rather than sending
  // false, so "not mentioned" has to read as "not yours" — which only ever
  // matters for an event that HAS guests, since one with none is yours by
  // definition however sparsely Google described its organizer.
  const organizer = raw.organizer?.self === true;

  const base = {
    id: `${calendar.id || 'primary'}::${raw.id}`,
    // The two halves of that id, kept as well as joined: the id is what React
    // draws a list by, and these are what a write is addressed to. Splitting
    // the string again on the way back would be a parser nobody needs, and one
    // that a calendar id containing '::' would quietly get wrong.
    calendarId: String(calendar.id || 'primary'),
    eventId: String(raw.id),
    title: String(raw.summary || '').trim() || 'Busy',
    color: eventColor(raw, calendar, palette),
    // What you called that colour. "Chill Vibes" says more about an hour than
    // the fact that it is blue does, and it is the only word Google gives us
    // for what KIND of thing an event is.
    label: String(eventLabel(raw, calendar)?.name || '').trim(),
    // The tag itself, as an id the tag menu can compare against and write back.
    labelId: String(eventLabel(raw, calendar) ? raw.eventLabelId : '').trim(),
    calendar: String(calendar.summary || '').trim(),
    // What Google calls the description, kept as Google keeps it — which for a
    // meeting invitation genuinely is HTML. Capped rather than dropped: see
    // MAX_DESCRIPTION.
    description: clipDescription(String(raw.description || '')),
    descriptionClipped: String(raw.description || '').length > MAX_DESCRIPTION,
    writable,
    editable: writable && (!guests || organizer),
    movable: writable && (!guests || organizer),
    // One occurrence of a repeating event. Changing it changes THIS Tuesday,
    // not every Tuesday, and that is worth saying before you drag it.
    recurring: !!raw.recurringEventId,
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
  const startsAt = placeOnDay(wallClock(startAt, timeZone), date);
  const endsAt = placeOnDay(wallClock(endAt, timeZone), date);

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
    /*
      AN EVENT THAT CROSSES A MIDNIGHT IS NOT DRAGGED FROM HERE, however much of
      it you can see. What is drawn is the slice that falls on this day, and a
      drag can only say where that slice goes — so committing it would rewrite a
      conference that runs Thursday to Sunday as a two-hour block on Friday.
      That is not a move, it is a deletion with a plausible shape, and the one
      place to make it is the one that can see both ends: Google.

      The tag is untouched by any of this and stays offered, because a colour
      says nothing about when a thing is.
    */
    movable: base.editable && !clippedStart && !clippedEnd,
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
    calendarId: String(raw.calendarId || '').trim(),
    eventId: String(raw.eventId || '').trim(),
    title: String(raw.title || '').trim() || 'Busy',
    color: HEX.test(String(raw.color || '')) ? raw.color : EXTERNAL_FALLBACK_COLOR,
    label: String(raw.label || '').trim(),
    labelId: String(raw.labelId || '').trim(),
    calendar: String(raw.calendar || '').trim(),
    description: clipDescription(String(raw.description || '')),
    descriptionClipped: !!raw.descriptionClipped,
    // A gesture is only offered where the write behind it can land, and an
    // event with no address to write to is not one of them however it was
    // flagged: both halves of the id have to be there.
    writable: !!raw.writable && !!raw.calendarId && !!raw.eventId,
    editable: !!raw.editable && !!raw.calendarId && !!raw.eventId,
    movable: !!raw.movable && !!raw.calendarId && !!raw.eventId,
    recurring: !!raw.recurring,
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

/*
  THE STAR: today's must-do, said in the one alphabet a calendar has.

  A task on the day is either something you are COMMITTING to finish
  (`daily_priority: 'must_do'`, the filled star on every row of this app) or
  something you will get to if the day allows. On this side of the wire that
  distinction is a column and a control; on your phone at eleven o'clock it is
  nothing at all — six identical red boxes, and no way to tell the two you
  promised yourself from the four you did not.

  Google gives an event a title and a colour and nothing else to say this with.
  The colour is already spoken for (it is the tag, see `labelColor`), so the
  title carries it: one star, in front of the name, and only on the copy that
  goes to Google. The task keeps its own title exactly as you typed it — a mark
  that leaked back into the task list would be a second, worse copy of the star
  that is already on the row.

  IN FRONT, which is the same choice this app's own timeline makes (see
  BlockFace) and for the same reason: the stars line up in a column down the
  day, so "what have I promised today" is one glance rather than a read of every
  block. A calendar truncates a narrow block from the right, so a trailing star
  is the first thing to go — and a mark that disappears exactly on the busiest
  blocks is a mark that is not there. It costs one character of the name on a
  block too narrow to have shown the whole of it anyway.
*/
export const MUST_DO_STAR = '⭐';

/*
  WHERE THE WORK CAME FROM, on the front of the description.

  A block in Google Calendar says what you are doing and when, and by the time
  you are looking at it on a phone the one thing it cannot say is WHICH PART OF
  YOUR LIFE it belongs to — "Read chapter 4" is a different afternoon depending
  on whether it came out of Thesis or out of Book club. The list is the answer
  this app already has and was throwing away at the border, so it goes on the
  front of every task's description, above whatever notes you keep there.

  A MARK RATHER THAN A WORD ("📋 Thesis", not "List: Thesis"), for the same
  reason the must-do star is a star: it survives being read in a two-line
  preview, it is obviously not part of your own note, and it needs no
  translating. It is one line, followed by a blank one, so the notes underneath
  start where a paragraph starts.

  AND IT COMES BACK OFF. The description is the task's notes and the two are
  edited from both ends (see `adoptGoogleEdits`), so a description read back out
  of Google has to be the notes ALONE — otherwise the header is adopted into the
  task, and the next push puts a second one in front of it. `withoutBlockHeader`
  is the exact inverse, and it is deliberately shape-based rather than
  name-based: a list renamed between the push and the read is still the header
  we wrote, and taking it off is still the right thing to do.
*/
export const LIST_MARK = '📋';

/*
  AND WHEN IT IS OWED, beside it.

  A block says when you are DOING the work. The due date is the other date, and
  it is the one that decides whether an hour you are about to give away is an
  hour you can afford — "Read chapter 4, Tuesday 2pm" is a different proposition
  when the essay is owed on Wednesday. The app draws that date on every row it
  can; a calendar three feet away on your phone knew nothing about it.

  So it rides on the same line as the list, under its own mark — and it is said
  in the words you would use, because the three deadlines that change what you
  do today are not dates, they are verdicts:

    LATE           it was owed before the day this block sits on. How late is a
                   question for the app; on a calendar the only thing worth a
                   line is that you are past it.
    DUE TODAY      it is owed on the day of this block. The one that decides
                   whether this hour is optional.
    DUE TOMORROW   the next morning's problem, which is tonight's decision.

  Anything further out is a DATE, spelled out and absolute — "Sat, Aug 22",
  never "in five days". A relative word is true on the day it is written and a
  lie every day after, and an event sits in your calendar long after the day it
  was pushed. The three above survive that because they are anchored to the
  block's OWN day rather than to the clock: an event on the 3rd saying DUE TODAY
  still means "owed on the 3rd" whenever you read it, which is what it meant
  when it was written.

  Only when there IS a deadline. Most tasks have none, and "Due: none" is a line
  of noise on every block in the day.
*/
export const DUE_MARK = '📅';

/**
 * The deadline as the block should say it, relative to the day the block is on.
 *
 * `today` is that day — the date being pushed, not the real clock — so the
 * wording is fixed at the moment the block is written and stays true for it.
 */
export function dueHeader(due, today = todayISO()) {
  const day = String(due || '').trim();
  if (!day) return '';
  if (day < today) return `${DUE_MARK} LATE`;
  if (day === today) return `${DUE_MARK} DUE TODAY`;
  if (day === addDaysISO(today, 1)) return `${DUE_MARK} DUE TOMORROW`;
  return `${DUE_MARK} Due ${formatDateLong(day, today)}`;
}

/**
 * The line above your notes: where the work came from, and when it is owed.
 * '' when it is neither — an undated task in no list has no header at all.
 *
 * `today` is what the deadline is read against (see `dueHeader`), and the push
 * passes the day being written rather than the real clock: a block on the 3rd
 * should say what its deadline meant on the 3rd, whenever it is read.
 */
export function blockHeader(list, due = null, today = todayISO()) {
  const parts = [];
  const name = String(list || '').trim();
  if (name) parts.push(`${LIST_MARK} ${name}`);
  const when = dueHeader(due, today);
  if (when) parts.push(when);
  return parts.join(' · ');
}

/** The description Google is given: what this block is, then what you wrote. */
export function withBlockHeader(header, notes) {
  const line = String(header || '').trim();
  const body = String(notes || '');
  if (!line) return body;
  return body.trim() ? `${line}\n\n${body}` : line;
}

/**
 * The same description with our header taken back off — the inverse of
 * `withBlockHeader`, and the thing that keeps the round trip from accumulating.
 *
 * Only ever the FIRST line, and only when it is one of ours — which is either
 * of our two marks, in either order, since a task with no list is a header that
 * begins with the deadline. A note of your own that happens to mention a list
 * is untouched, and a header you deleted in Google stays deleted (until the
 * next push writes the real one back, which is the app being right about where
 * the task lives rather than an edit war).
 */
export function withoutBlockHeader(text) {
  const body = String(text || '');
  if (!body.startsWith(`${LIST_MARK} `) && !body.startsWith(`${DUE_MARK} `)) return body;
  const brk = body.indexOf('\n');
  // Nothing but the header: the task has no notes, which is exactly what a
  // block with no notes should read back as.
  if (brk === -1) return '';
  // One blank line after it is ours as well; a second is yours.
  return body.slice(brk + 1).replace(/^\r?\n/, '');
}

/** A block's title as Google should hold it: the star if you owe it today, then yours. */
export function pushTitle(title, mustDo) {
  const name = String(title || '').trim() || 'Untitled task';
  // Idempotent: a title that already starts with one is not given a second.
  if (!mustDo || name.startsWith(MUST_DO_STAR)) return name;
  return `${MUST_DO_STAR} ${name}`;
}

/**
 * What finishing the day sends to Google: every task planned for `date` that
 * you actually gave an hour to, AND every fixed commitment on that day.
 *
 * The commitments used to stay behind, on the argument that they are furniture
 * rather than work. That was the wrong line to draw: the class at nine and the
 * hour of revision after it are both things that occupy you, and a calendar on
 * your phone that shows one and not the other is not your day — it is the half
 * of your day this app happens to call a task. They travel with the same fields
 * as everything else (title, hour, length, tag, description) and with no star,
 * since "must do" is a question about work.
 *
 * And they travel BOTH WAYS, exactly as a task's block does: a description
 * typed onto one in Google Calendar comes back into it, and one deleted there
 * is deleted here. The only asymmetry left is what deletion MEANS, and it is a
 * real one — a task outlives its hour and goes back to unplaced, a commitment
 * is nothing but its hour and goes.
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
 *
 * `listName` is (task) → the name of the list it lives in, and it is a function
 * because the lists are the caller's: this file knows what a block looks like in
 * Google and nothing about where the app keeps its lists. Absent, no header is
 * written, which is what keeps this a pure function of the tasks it is given.
 */
export function dayPushItems(tasks, date, listName = null, events = []) {
  if (!ISO_DATE.test(String(date))) return [];

  /*
    A commitment, as Google should hold it. No list header — it came from no
    list — and no star. Its own id, prefixed, so what comes back is recognised
    as ours and as NOT a task (see `commitmentPushId`).
  */
  const commitments = (Array.isArray(events) ? events : [])
    .map((event) => {
      const start = dayMinutes(event?.start);
      if (start === null || !event?.id) return null;
      const minutes = normalizeEstimate(event.minutes) || DEFAULT_BLOCK_MINUTES;
      return {
        taskId: commitmentPushId(event.id),
        title: String(event.title || '').trim() || 'Commitment',
        start: dayClock(start),
        minutes: Math.min(minutes, DAY_WINDOW_END - start),
        labelId: normalizeLabelId(event.labelId),
        notes: clipDescription(String(event.notes || '')),
      };
    })
    .filter(Boolean);

  return (Array.isArray(tasks) ? tasks : [])
    .filter(task => task?.planned_date === date && clockToMinutes(task.scheduled_start) !== null)
    .map((task) => {
      const start = dayMinutes(task.scheduled_start);
      const length = normalizeEstimate(task.scheduled_minutes)
        || normalizeEstimate(task.estimated_minutes)
        || DEFAULT_BLOCK_MINUTES;
      return {
        taskId: String(task.id),
        title: pushTitle(task.title, normalizeDailyPriority(task.daily_priority) === 'must_do'),
        start: dayClock(start),
        // `start` here is a position on the 4am day, so a 1am block has until
        // four rather than until midnight.
        minutes: Math.min(length, DAY_WINDOW_END - start),
        // The tag, as an id on the calendar the day is written to. Null is not
        // "no opinion" but "no tag": it is what puts a retagged block back to
        // Tomato, so it travels rather than being omitted.
        labelId: String(task.google_label_id || '').trim() || null,
        /*
          THE NOTES, which become the event's description — not a copy of them,
          the same field. It is what the detail panel edits, what the block on
          /today already draws under its clock, and what its menu already
          writes; an event carrying anything else would be the same block saying
          two different things in two places.

          Empty travels as well as full: '' is what CLEARS a description Google
          is still holding from the last push, and a task whose notes you have
          deleted must not keep them in your calendar.

          Clipped to what the day can carry in the OTHER direction
          (MAX_DESCRIPTION), so nothing is ever sent that a read could not bring
          back whole — and clipped AFTER the list header goes on the front, so
          the one line that says where the work came from cannot be the line
          that falls off the end.
        */
        notes: clipDescription(withBlockHeader(
          blockHeader(listName ? listName(task) : '', task.due_date, date),
          String(task.notes || '')
        )),
      };
    })
    .concat(commitments)
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
/*
  A NOTE, IN SIXTEEN CHARACTERS.

  The signature is kept per task per day for a month of days, all of it in one
  settings row, so it cannot carry the note itself — a paragraph of prose on
  each of eight blocks would be the whole blob. A digest answers the only
  question ever asked of that text, and answers it in both directions: "is this
  what we sent?", of the day on screen, and of a description read back out of
  Google (see `adoptGoogleEdits`).

  FNV-1a, twice, over different seeds. Not a security boundary — nobody is
  attacking their own calendar — but one 32-bit hash over prose collides often
  enough to matter when the cost of a collision is an edit that silently never
  reaches the calendar, which is the one failure this field exists to prevent.

  No note is the empty string rather than the hash of one, so an ordinary
  block's signature stays a thing you can read in a log.
*/
function fnv1a(text, seed) {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function noteDigest(text) {
  const words = String(text || '');
  return words ? `${fnv1a(words, 0x811c9dc5)}${fnv1a(words, 0x9e3779b9)}` : '';
}

/*
  The title goes LAST and everything else is fixed-shape, because a title is the
  one field here that may itself contain a '|'. Nothing needs to be found after
  it, so nothing can be found wrongly.

  Adding the digest changed this format, which means every day already sent
  reads as changed once and re-sends. That is correct rather than unfortunate:
  those events are sitting in Google with no description at all.
*/
export function itemSignature(item) {
  return `${item.start}+${item.minutes}|${item.labelId || ''}|${noteDigest(item.notes)}|${item.title}`;
}

/**
 * The same signature, with the note it describes replaced.
 *
 * A description edited in Google Calendar itself is adopted into the task's
 * notes rather than overwritten (see `adoptGoogleEdits`), and after that Google
 * holds exactly what the browser is about to compute a signature for — so the
 * record of what we sent has to move with it, or /today would offer to send a
 * day that is already there. The format lives here and not at the call site,
 * which is the whole reason this is a function.
 *
 * A signature written before notes travelled has no field to replace; it is
 * left alone, and reads as "changed", which is what it is.
 */
export function withNoteDigest(signature, digest) {
  const parts = String(signature || '').split('|');
  if (parts.length < 4) return signature;
  parts[2] = digest;
  return parts.join('|');
}

/**
 * The hour we last sent, out of the signature we stored — `{ start, minutes }`,
 * where `start` is the wall clock as it was written ('09:00').
 *
 * This is what makes "somebody moved it in Google" a question with an answer:
 * the event as Google now holds it, against the event as we last left it. Equal,
 * nothing happened; different, the calendar knows something this side does not.
 */
export function timesOf(signature) {
  const [head] = String(signature || '').split('|');
  const [start, length] = String(head || '').split('+');
  const at = dayMinutes(start);
  const minutes = Number(length);
  if (at === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  return { start, startMinutes: at, minutes };
}

/**
 * The same signature with the hour it describes replaced — the counterpart of
 * `withNoteDigest`, and needed for the same reason: once a move made in Google
 * has been adopted here, the record of what we sent has to move with it, or the
 * page offers to send a day that is already sitting in the calendar it came
 * from.
 */
export function withTimes(signature, start, minutes) {
  const parts = String(signature || '').split('|');
  if (parts.length < 4) return signature;
  parts[0] = `${start}+${minutes}`;
  return parts.join('|');
}

/**
 * The note we last sent, out of the signature we stored — which is where it
 * already lives, so there is no second field to be told about a push and no
 * second field to fall behind one.
 *
 * An old signature has none, and '' reads correctly as "no description was ever
 * written for this block": those events went up before notes travelled, and
 * Google is holding nothing for them.
 */
export function noteDigestOf(signature) {
  const parts = String(signature || '').split('|');
  return parts.length < 4 ? '' : parts[2];
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
 * A tag id off the wire. Google's are UUIDs; anything that is not shaped like
 * one is not a tag, and `null` is the perfectly ordinary answer "no tag".
 */
export function normalizeLabelId(raw) {
  const id = String(raw || '').trim();
  return /^[0-9a-fA-F-]{8,64}$/.test(id) ? id : null;
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
    labelId: normalizeLabelId(raw.labelId),
    // The description, capped at what the day carries and NOT trimmed to
    // nothing: an empty note is a real instruction (clear the description), and
    // a missing one is the same instruction, since a block whose notes were
    // never mentioned has none.
    notes: clipDescription(String(raw.notes || '')),
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
