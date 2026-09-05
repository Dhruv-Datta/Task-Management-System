import 'server-only';

import { readSetting, writeSetting } from './appSettings.js';
import { prunePlans as keepRecentDays } from './dayPlan.js';
import { DAY_WINDOW_END, MINUTES_PER_DAY, addDaysISO, dayClock, dayMinutes } from './dates.js';
import {
  DATE_PROPERTY, MAX_DESCRIPTION, MAX_EXTERNAL_EVENTS, TASK_ID_PROPERTY, daySignature,
  externalFromGoogle, itemSignature, noteDigest, noteDigestOf, normalizeLabels, withNoteDigest,
} from './googleEvents.js';
import { forgetAccessToken, getAccessToken } from './googleAuth.js';

/*
  THE CALENDAR ITSELF: reading your real day, and writing the one you planned.

  Two jobs, in the two directions, and they are deliberately asymmetric.

  READING is wide and forgiving. It asks Google for every calendar you have
  ticked in its own sidebar, pulls the day off each of them, and if one calendar
  fails the rest of the day still draws — a shared calendar you have lost access
  to should cost you that calendar, not your morning.

  WRITING is narrow and careful. It touches ONE calendar (your primary), it only
  ever creates, moves or deletes events carrying a task id in their private
  extended properties, and it works out the smallest set of changes that makes
  Google agree with the day on screen. A planner writing into the calendar you
  actually live by has one absolute obligation: never to touch anything it did
  not put there itself.

  No SDK. The whole surface used here is five REST calls, and `googleapis` is a
  very large dependency to add to an app whose entire package.json is eleven
  lines.
*/

const API = 'https://www.googleapis.com/calendar/v3';

/*
  WHERE THE DAY GETS WRITTEN: one named calendar of your own, never `primary`.

  It is looked up BY NAME rather than by id, because a calendar id is an opaque
  string nobody can read or check, and this is a setting whose whole job is to
  be recognisable — you should be able to look at your Google sidebar and at
  this line and see that they agree.

  Writing to a calendar of its own is what makes the whole arrangement
  reversible. Your plan is one checkbox away from being hidden, one deletion
  away from being gone, and it is never mixed in with the meetings other people
  put in your day.

  If no such calendar exists, the push FAILS and says so. It deliberately does
  not fall back to `primary`: quietly writing a fortnight of blocks into the
  calendar you actually live by, because a name did not match, is precisely the
  outcome having a named calendar exists to prevent.
*/
const WRITE_CALENDAR_NAME = (process.env.GOOGLE_CALENDAR_NAME || 'Personal / Work').trim();

/*
  Tomato — the red in Google's own palette.

  A colour is not decoration here, it is the answer to a question you ask at a
  glance on a phone: which of today's boxes did I put there. `colorId` is an
  index into Google's fixed eleven (see /colors), and it is set per EVENT, so it
  wins over whatever colour the calendar itself is drawn in.
*/
const PLANNED_COLOR_ID = '11';

/** Where the record of what we have written lives. */
const PUSHED_KEY = 'google_pushed';

/** How much of it to keep. The same window as the day's events and plans. */
const PUSH_PRUNE_DAYS = 30;

class GoogleApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
  }
}

/*
  The one failure this feature has that is neither a fault nor a permission
  problem: the calendar we are meant to write to is not there, or is not ours to
  write to. It is a 409 rather than a 500 because nothing is broken — a thing
  the app expects to exist does not yet, and the fix is thirty seconds in the
  Google Calendar sidebar. The message IS the instruction, because it is the
  only place the person will read it.
*/
export class GoogleWriteCalendarError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GoogleWriteCalendarError';
    this.status = 409;
    this.code = 'write_calendar';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// One request
// ─────────────────────────────────────────────────────────────────────────────

/*
  `retryOn401` is not paranoia about Google: it is about the token CACHE. An
  access token minted 59 minutes ago passes the local expiry check and is
  rejected by Google, which is a race no amount of headroom removes — a token
  can also be invalidated early. So a 401 drops the cached token and the call is
  made once more with a fresh one. Once, and only once: a second 401 is a real
  authorization problem and looping on it would hammer the token endpoint.
*/
async function callGoogle(supabase, path, { method = 'GET', params, body, retryOn401 = true } = {}) {
  const token = await getAccessToken(supabase);
  const url = new URL(API + path);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  if (res.status === 401 && retryOn401) {
    forgetAccessToken();
    return callGoogle(supabase, path, { method, params, body, retryOn401: false });
  }

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new GoogleApiError(
      data?.error?.message || `Google Calendar returned HTTP ${res.status}`,
      res.status
    );
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

/*
  THE PALETTE. `colorId` on an event is an index into a fixed table, not a
  colour, so the table has to be in hand before any event can be drawn in the
  colour you picked for it.

  Google's eleven event colours have not changed in a decade, so they are
  written down here as well. The live table still wins — it is Google's to
  change and this is a copy — but a copy means a day never loses its colours to
  one failed request, and the commonest case needs no second round trip at all.

  These are the hexes the API REPORTS, which are not the hexes the calendar
  DRAWS: this is the 2011 palette, Tomato and all, exactly as /colors still
  answers. `asDrawn` in googleEvents.js is what turns them into the colours on
  the screen, and it runs over the live table and this copy alike — so leave
  these as Google's, and correct them there.
*/
const FALLBACK_EVENT_COLORS = {
  1: { background: '#a4bdfc' },   // Lavender
  2: { background: '#7ae7bf' },   // Sage
  3: { background: '#dbadff' },   // Grape
  4: { background: '#ff887c' },   // Flamingo
  5: { background: '#fbd75b' },   // Banana
  6: { background: '#ffb878' },   // Tangerine
  7: { background: '#46d6db' },   // Peacock
  8: { background: '#e1e1e1' },   // Graphite
  9: { background: '#5484ed' },   // Blueberry
  10: { background: '#51b749' },  // Basil
  11: { background: '#dc2127' },  // Tomato
};

/*
  Cached with a TTL, and — the part that matters — a FAILURE IS NEVER CACHED.

  It used to store `{}` when the request failed, and `{}` is truthy, so one bad
  minute cost every event its colour until the process restarted: every block
  quietly fell back to its calendar's colour, which looks exactly like a day
  where nothing has been coloured. Now a failure returns the written-down
  palette and stores nothing, so the next read tries again.
*/
let paletteCache = null;
const PALETTE_TTL_MS = 12 * 60 * 60 * 1000;

async function colorPalette(supabase) {
  if (paletteCache && Date.now() - paletteCache.at < PALETTE_TTL_MS) return paletteCache.value;
  try {
    const live = await callGoogle(supabase, '/colors');
    if (live?.event) {
      paletteCache = { at: Date.now(), value: live };
      return live;
    }
  } catch (err) {
    console.error('Failed to read the Google colour palette', err);
  }
  return { event: FALLBACK_EVENT_COLORS };
}

/*
  EVERY calendar on the account, briefly cached.

  Both halves of this file want it — reading needs the ones you look at, writing
  needs to find one by name — and a single POST does both (send the day, then
  read it back), so without the cache one press is two identical requests. A
  minute is long enough to collapse that and short enough that a calendar you
  have only just made is found on your second attempt.

  `showHidden` is true HERE and filtered later, on purpose: hidden and unticked
  are different states, and the calendar we write to has no obligation to be one
  you keep on screen.
*/
let calendarListCache = null;
const CALENDAR_LIST_TTL_MS = 60_000;

async function fetchCalendarList(supabase) {
  if (calendarListCache && Date.now() - calendarListCache.at < CALENDAR_LIST_TTL_MS) {
    return calendarListCache.items;
  }
  const data = await callGoogle(supabase, '/users/me/calendarList', {
    params: { minAccessRole: 'reader', showHidden: true, maxResults: 250 },
  });
  const items = (data?.items || [])
    .filter(item => item && !item.deleted)
    .map(item => ({
      id: item.id,
      summary: item.summaryOverride || item.summary || item.id,
      backgroundColor: item.backgroundColor || null,
      primary: !!item.primary,
      selected: item.selected === true,
      accessRole: item.accessRole || 'reader',
    }));
  calendarListCache = { at: Date.now(), items };
  return items;
}

/*
  A CALENDAR'S EVENT LABELS: the named colours you defined on it — "Chill
  Vibes", "Classes", "Meetings" — each with the colour Google actually draws
  events in.

  They are not on the calendarList entry, which is why this is a second request:
  calendarList is YOUR VIEW of a calendar (is it ticked, what colour did you
  give the calendar itself), and the labels belong to the calendar, so they come
  from `calendars.get`. Missing that distinction is what made a blue event red —
  a labelled event usually carries no `colorId` at all, so it fell all the way
  through to its calendar's colour.

  One request per calendar you actually read, cached: labels are edited about as
  often as you invent a new category for your life.

  A failure is swallowed to an empty map rather than raised. Labels are how an
  event is COLOURED, and a day drawn in its calendar's colours is a day; a day
  that refuses to draw because a second request failed is not.
*/
const labelCache = new Map();
const LABEL_TTL_MS = 10 * 60 * 1000;

async function calendarLabels(supabase, calendarId) {
  const hit = labelCache.get(calendarId);
  if (hit && Date.now() - hit.at < LABEL_TTL_MS) return hit.value;

  let labels = {};
  try {
    const calendar = await callGoogle(supabase, `/calendars/${encodeURIComponent(calendarId)}`);
    for (const label of calendar?.labelProperties?.eventLabels || []) {
      // The id goes in the VALUE as well as the key, so `Object.values` is
      // already the list the tag menu wants and nothing has to zip it back
      // together (see `normalizeLabels` in lib/googleEvents).
      if (label?.id) {
        labels[label.id] = { id: label.id, backgroundColor: label.backgroundColor, name: label.name || '' };
      }
    }
  } catch (err) {
    console.error(`Failed to read the labels on Google calendar "${calendarId}"`, err);
    labels = {};
  }

  labelCache.set(calendarId, { at: Date.now(), value: labels });
  return labels;
}

/**
 * Which calendars the day is READ from: the ones you have TICKED in Google
 * Calendar's own sidebar (`selected`).
 *
 * That is the definition that needs no settings screen here and no second
 * opinion about your own calendar — if a birthdays calendar is cluttering
 * /today, the place to untick it is the place you already untick it. An account
 * with nothing ticked at all falls back to the primary calendar, so the feature
 * can never come up empty and unexplained.
 */
export async function listCalendars(supabase) {
  const items = await fetchCalendarList(supabase);
  const selected = items.filter(item => item.selected);
  return selected.length > 0 ? selected : items.filter(item => item.primary);
}

/*
  Names are compared the way a person would compare them: case and stray
  whitespace are not the difference between two calendars, and "Personal / Work"
  typed with two spaces around the slash is the same calendar you meant.
*/
const sameName = (a, b) => (
  String(a || '').trim().toLowerCase().replace(/\s+/g, ' ')
  === String(b || '').trim().toLowerCase().replace(/\s+/g, ' ')
);

/**
 * The calendar the day is WRITTEN to, found by name.
 *
 * Missed once, the cache is dropped and it looks again — the overwhelmingly
 * likely reason for a miss is that you have just this minute made the calendar,
 * and being told "no such calendar" about one you are looking at would be
 * absurd. That second look is worth a round trip where a MISS COSTS YOU
 * something, which is the push; it is not worth one on every page load, so
 * `retry: false` is how the tag menu asks the same question cheaply and waits
 * for your next visit to notice a calendar made thirty seconds ago.
 *
 * Two ways to fail, and they need different sentences: there is no calendar by
 * that name, or there is one and Google will not let us write to it (a calendar
 * somebody else shared with you read-only). Neither is recoverable by retrying,
 * so both say what to go and do.
 */
export async function writeCalendar(supabase, { retry = true } = {}) {
  let match = (await fetchCalendarList(supabase)).find(c => sameName(c.summary, WRITE_CALENDAR_NAME));

  if (!match && retry) {
    calendarListCache = null;
    match = (await fetchCalendarList(supabase)).find(c => sameName(c.summary, WRITE_CALENDAR_NAME));
  }

  if (!match) {
    throw new GoogleWriteCalendarError(
      `No Google calendar called “${WRITE_CALENDAR_NAME}”. Make one with that name in Google Calendar `
      + '(Other calendars → + → Create new calendar), then send the day again.'
    );
  }

  if (match.accessRole !== 'owner' && match.accessRole !== 'writer') {
    throw new GoogleWriteCalendarError(
      `The calendar “${WRITE_CALENDAR_NAME}” is shared with you read-only, so the day cannot be written to it.`
    );
  }

  return match;
}

/**
 * The calendar the day is written to, and the TAGS defined on it — which are
 * the ones a task block or a commitment of your own may be given, because they
 * are the ones that will still mean something when the day is sent.
 *
 * Never throws. There may be no such calendar yet, and that is a fact about
 * sending the day rather than about drawing it: the tag menu on a task simply
 * has nothing to offer and says why. The push is where a missing calendar is an
 * error, because the push is where it stops something.
 */
export async function writeCalendarTags(supabase) {
  try {
    const target = await writeCalendar(supabase, { retry: false });
    const labels = await calendarLabels(supabase, target.id);
    return { id: target.id, name: target.summary, labels: normalizeLabels(Object.values(labels)) };
  } catch {
    return null;
  }
}

/**
 * One calendar's slice of one day.
 *
 * The window asked for is THREE UTC days wide, which looks wrong and is the
 * whole trick: `timeMin`/`timeMax` are instants, the day being drawn is a local
 * one, and a fixed ±1 day covers every timezone on earth without this file
 * having to compute a UTC offset. What actually decides membership is
 * `externalFromGoogle`, which converts each event into the viewer's own wall
 * clock — so the query is generous and the model is exact.
 *
 * `singleEvents` expands a recurring event into the occurrence that is
 * genuinely on this day; without it Google returns the RULE, which has the
 * start time of the first meeting in the series and would draw a Monday standup
 * on a Thursday.
 *
 * Returns Google's RAW items. Shaping them needs the calendar's labels, which
 * are fetched beside this rather than before it.
 */
async function readCalendarDay(supabase, calendar, { date, timeZone, palette }) {
  const data = await callGoogle(supabase, `/calendars/${encodeURIComponent(calendar.id)}/events`, {
    params: {
      singleEvents: true,
      orderBy: 'startTime',
      showDeleted: false,
      maxResults: 250,
      timeMin: `${addDaysISO(date, -1)}T00:00:00Z`,
      timeMax: `${addDaysISO(date, 2)}T00:00:00Z`,
    },
  });

  // The raw items, not yet shaped: `externalFromGoogle` needs the calendar's
  // labels to resolve a colour, and those are fetched in parallel with this.
  return data?.items || [];
}

/**
 * The whole day, across every calendar you look at.
 *
 * `allSettled`, not `all`: one calendar that 404s (shared and since revoked,
 * deleted between the list and the read) must cost that calendar and nothing
 * else. What broke is reported alongside what worked, so the page can say
 * "three of your four calendars" instead of silently drawing a thinner day.
 */
export async function readGoogleDay(supabase, { date, timeZone }) {
  const [calendars, palette, writeTags] = await Promise.all([
    listCalendars(supabase),
    colorPalette(supabase),
    // The tags a task block may take. Read alongside the day rather than on its
    // own request, for the same reason everything else here is: /today asks all
    // of these questions in the same breath or not at all.
    writeCalendarTags(supabase),
  ]);

  // The labels come alongside the events rather than before them: they are one
  // request per calendar, they are cached, and nothing about reading a day
  // needs to wait on the ones for a different calendar.
  const results = await Promise.allSettled(
    calendars.map(async (calendar) => {
      const [labels, items] = await Promise.all([
        calendarLabels(supabase, calendar.id),
        readCalendarDay(supabase, calendar, { date, timeZone, palette }),
      ]);
      return { calendar, labels, items };
    })
  );

  const events = [];
  const failed = [];
  // Our own pushed blocks, kept for their descriptions alone (see below).
  const blocks = [];
  /*
    The tags, per calendar, so the menu on a Google event offers the labels of
    the calendar it actually lives on. They belong to one calendar each (the id
    is unique within it), so a flat list of everything would be a menu where
    half the entries are ids the write is about to reject.
  */
  const labelsByCalendar = {};
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      failed.push(calendars[i].summary);
      console.error(`Failed to read the Google calendar "${calendars[i].summary}"`, result.reason);
      return;
    }
    const { calendar, labels, items } = result.value;
    labelsByCalendar[calendar.id] = normalizeLabels(Object.values(labels));
    for (const raw of items) {
      /*
        Our own blocks are DROPPED from the day — they are already on the
        timeline, drawn from the task itself — but they are no longer ignored.
        The description on one is the task's notes as Google now holds them,
        which may be a sentence you typed into Google Calendar on your phone at
        the end of the meeting. `externalFromGoogle` still drops it a line
        below; this only reads it on the way past.
      */
      const mine = ownBlock(raw, calendar.id);
      if (mine) blocks.push(mine);
      const event = externalFromGoogle(raw, { date, timeZone, calendar: { ...calendar, labels }, palette });
      if (event) events.push(event);
    }
  });

  /*
    And the notes come back. It is done here, inside the read every visit to
    /today makes, because there is no other moment: nothing else ever looks at
    the events we wrote, and a description edited in Google would otherwise sit
    there unseen until the next push quietly overwrote it.

    A failure costs the notes and NOT the day. This is scenery on a page about
    today; a settings row that would not save must not take your meetings with
    it.
  */
  let notes = [];
  try {
    notes = await adoptGoogleNotes(supabase, date, blocks);
  } catch (err) {
    console.error('Failed to read notes back out of Google Calendar', err);
  }

  return {
    events: events.slice(0, MAX_EXTERNAL_EVENTS),
    calendars: calendars.length,
    failed,
    labels: labelsByCalendar,
    writeCalendar: writeTags,
    // The tasks whose notes Google turned out to know better than we did.
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// What we have written, and when
// ─────────────────────────────────────────────────────────────────────────────

/*
      google_pushed → { 'YYYY-MM-DD': { at, events: { taskId: { eventId, calendarId, sig, label } } } }

  One entry per task per day: the Google event we created for it, WHICH CALENDAR
  it went to, and the signature of what we told Google (see `itemSignature`).
  The signature is what turns re-sending a day into the small write it should be
  — a day of eight blocks where you moved one is one PATCH — and comparing the
  whole day's worth against the day on screen is what lets /today say "you have
  changed something since you sent this".

  `label` is the tag as Google was last told it, and it is here for one reason:
  a patch cannot express "no longer tagged" by omission (see `clearLabel`), so
  the push has to know whether there is a label to take off before it can put a
  block back to Tomato. Absent on an entry written before tags existed, which
  reads correctly as "no tag was ever set".

  `calendarId` is what makes the target calendar changeable. An event lives
  where it was written, not where we would write it today, so moving the
  destination has to MOVE the events rather than orphan them — and an entry
  written before this field existed went to `primary`, which is what
  `entryCalendar` below assumes. Without that, changing the destination would
  silently leave every block already sent sitting in the old calendar with
  nothing on our side still pointing at it.

  Pruned to the same thirty days as `day_events` and `day_plans`, relative to
  the day being written rather than the server's clock.
*/

/** Where an entry's event actually is. Older entries predate the field. */
const entryCalendar = entry => entry?.calendarId || 'primary';
async function readPushed(supabase) {
  const stored = await readSetting(supabase, PUSHED_KEY, {});
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

function dayEntry(blob, date) {
  const entry = blob?.[date];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { at: null, events: {} };
  const events = entry.events && typeof entry.events === 'object' && !Array.isArray(entry.events)
    ? entry.events
    : {};
  return { at: entry.at || null, events };
}

/**
 * What /today needs to know on load: has this day been sent, and as what.
 *
 * `stale` is the second half of that question, and it exists because the
 * signature cannot answer it. The signature describes the day's CONTENT, which
 * the browser can compute for itself; whether those events are in the calendar
 * we would write to now is a server-side fact the browser has no way to know.
 * Change the destination calendar and every block already sent is in the wrong
 * place while looking, by content, perfectly up to date — so the day would
 * quietly claim to be in Google and never offer to fix itself.
 *
 * Working out the destination can fail (there may be no such calendar yet), and
 * that must not take the day's events down with it: this is called on every
 * page load, so a lookup that throws is caught and read as "nothing to say".
 * The push is where that failure belongs, because the push is where it matters.
 */
export async function readPushState(supabase, date) {
  const entry = dayEntry(await readPushed(supabase), date);
  const pairs = Object.entries(entry.events).map(([taskId, e]) => [taskId, e?.sig || '']);

  let stale = false;
  let calendar = null;
  if (pairs.length > 0) {
    try {
      const target = await writeCalendar(supabase);
      calendar = target.summary;
      stale = Object.values(entry.events).some(e => entryCalendar(e) !== target.id);
    } catch {
      stale = false;
    }
  }

  return {
    at: entry.at,
    count: pairs.length,
    signature: daySignature(pairs),
    stale,
    calendar,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The notes coming back
// ─────────────────────────────────────────────────────────────────────────────

/*
  A TASK'S NOTES AND ITS BLOCK'S DESCRIPTION ARE ONE FIELD WITH TWO EDITORS.

  You can type into it here — the detail panel, or the description in a block's
  own menu — and you can type into it in Google Calendar, on a phone, in the
  event we put there. Both are the same sentence about the same hour, so the
  question is never "which copy is right" but "which one MOVED", and that has an
  exact answer rather than a guess: the digest of what we last pushed, stored
  beside the event id (see `itemSignature`).

    Google's description matches it   nobody has touched it there. Whatever the
                                      task says now is the newer text, and it
                                      goes up on the next push.
    it does not                       it was edited in Google, and Google's is
                                      the newer text. It is adopted into the
                                      task's notes, and the stored digest moves
                                      with it — so the day does not then read as
                                      unsent and offer to push the same words
                                      back at the calendar they came from.

  The one thing that is never adopted is a description we can only see PART of
  (MAX_DESCRIPTION). Taking a truncated copy into the notes would delete the
  rest of it on the next push, which is the same rule the block menu already
  follows when it refuses to edit one.

  The task is written FIRST and the digest second. That order is the whole
  safety of it: a crash between them re-reads as "still changed" and adopts the
  same text again, where the reverse order would lose the note and then send the
  old one back over it.
*/

/** One of our own events, as the pull-back needs it — or null for anyone else's. */
function ownBlock(raw, calendarId) {
  if (!raw || raw.status === 'cancelled') return null;
  const stamp = raw.extendedProperties?.private || {};
  const taskId = stamp[TASK_ID_PROPERTY];
  if (!taskId) return null;
  return {
    taskId: String(taskId),
    calendarId: String(calendarId),
    // Which day we wrote it for. The read window is a day either side of the
    // one being drawn, so yesterday's block for the same task is in these
    // items too, and it is not this day's note.
    date: String(stamp[DATE_PROPERTY] || ''),
    description: String(raw.description || ''),
  };
}

/**
 * Notes edited in Google Calendar itself, taken back into their tasks.
 *
 * Returns the rows it wrote (whole, so the browser can adopt their new
 * `version` as well as their words), and an empty list — cheaply, without
 * touching the database — on the ordinary day where nothing was edited there.
 */
export async function adoptGoogleNotes(supabase, date, blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];

  const blob = await readPushed(supabase);
  const entry = dayEntry(blob, date);
  if (Object.keys(entry.events).length === 0) return [];

  const changed = [];
  for (const block of blocks) {
    const known = entry.events[block.taskId];
    if (!known?.eventId) continue;
    // The event we wrote for THIS day, in the calendar we wrote it to. A copy
    // left behind in a calendar we no longer write to is not the block's
    // description; it is litter, and the next push removes it.
    if (block.date !== date || entryCalendar(known) !== block.calendarId) continue;
    if (block.description.length > MAX_DESCRIPTION) continue;
    const digest = noteDigest(block.description);
    if (digest === noteDigestOf(known.sig)) continue;
    changed.push({ ...block, digest });
  }
  if (changed.length === 0) return [];

  const next = { ...entry.events };
  const rows = [];
  for (const item of changed) {
    const { data, error } = await supabase
      .from('tasks')
      .update({ notes: item.description })
      .eq('id', item.taskId)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    // The task is gone and its event outlived it. Nothing to adopt into, and
    // nothing to record: the next push takes the block out of the calendar.
    if (!data) continue;
    rows.push(data);
    next[item.taskId] = { ...next[item.taskId], sig: withNoteDigest(next[item.taskId].sig, item.digest) };
  }

  if (rows.length > 0) {
    blob[date] = { at: entry.at, events: next };
    await writeSetting(supabase, PUSHED_KEY, blob);
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One block, as a Google event.
 *
 * The times are sent as a wall clock plus a NAMED timezone rather than as an
 * instant with an offset, which is the one form that cannot drift: '14:00 in
 * America/New_York' is what you meant, and it stays what you meant across a
 * daylight-saving change, a flight, and a laptop whose clock is wrong.
 *
 * `reminders` is explicitly empty. Blocks are how you arranged your own
 * afternoon; a default ten-minute popup for each of six of them turns a plan
 * into a machine that interrupts you all day.
 */
/*
  WHICH CALENDAR DATE a block lands on is not always the date it is planned for,
  and this is where a day that runs 4am to 4am has to be turned back into dates
  Google understands. A block at minute 1500 of the 3rd is one in the morning of
  the 4TH — the small hours at the END of the 3rd's day — so both ends are worked
  out from the block's position ON THE DAY, and either end may fall on tomorrow.

  '24:00' is not a time and Google rejects it, so anything at or past midnight is
  said as tomorrow's clock on tomorrow's date.

  Shared by the two things that write a time into Google — the day's own blocks,
  and a meeting of yours dragged on this grid — because "where is this on the
  4am day" is the same question whoever is asking it, and answering it twice is
  how one of the two ends up an hour out in October.
*/
function blockTimes(start, minutes, { date, timeZone }) {
  const end = Math.min(start + minutes, DAY_WINDOW_END);
  const onDay = m => (m >= MINUTES_PER_DAY ? addDaysISO(date, 1) : date);
  return {
    start: { dateTime: `${onDay(start)}T${dayClock(start)}:00`, timeZone },
    end: { dateTime: `${onDay(end)}T${dayClock(end)}:00`, timeZone },
  };
}

function eventBody(item, { date, timeZone }) {
  /*
    THE DESCRIPTION IS THE TASK'S NOTES. Not a copy kept in step with them —
    the same field, written where you will actually read it, so a note typed on
    the detail panel is under the block on your phone at eleven o'clock.

    It is sent even when it is EMPTY, and that is the half that is easy to get
    wrong: a PATCH that simply stops mentioning the field leaves whatever Google
    is holding exactly where it is, so a note you deleted would live on in your
    calendar forever. '' is the instruction, and it travels.

    What still does not go is a line saying which app wrote this. An event whose
    content is the machine that made it is noise repeated on every block, in the
    one place you look while trying to read your day — and the block is red, in
    its own calendar, which says the same thing without spending a line.
  */
  return {
    summary: item.title,
    description: item.notes || '',
    /*
      THE COLOUR, said in whichever of Google's two vocabularies applies.

      A tagged block is `eventLabelId` — the named colour you defined on the
      calendar ("Classes", "Chill Vibes"), which Google's docs are explicit
      SUPERSEDES colorId, and which is what its own UI now sets. An untagged one
      is the Tomato it has always been. Never both: under eventLabelVersion=1
      (see `eventParams`) colorId is ignored outright, so sending it as well
      would be a line that reads as a fallback and is not one.
    */
    ...(item.labelId ? { eventLabelId: item.labelId } : { colorId: PLANNED_COLOR_ID }),
    ...blockTimes(dayMinutes(item.start), item.minutes, { date, timeZone }),
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: {
      private: { [TASK_ID_PROPERTY]: item.taskId, [DATE_PROPERTY]: date },
    },
  };
}

/*
  `eventLabelVersion=1` is how a client tells Google it understands labels, and
  Google will not read `eventLabelId` out of a body without it — an insert or a
  patch that omits it is quietly processed as a colorId-only write, which is the
  one failure mode here that looks exactly like nothing happening.

  It is sent only when there IS a tag, because it is not free: under version 1
  colorId stops being processed at all, so a blanket flag would make the untagged
  block's Tomato unsettable.
*/
const eventParams = item => (item.labelId ? { eventLabelVersion: 1 } : undefined);

/*
  TAKING A TAG OFF, which is not the same write as putting one on.

  A patch that merely stops mentioning `eventLabelId` leaves the label exactly
  where it was — Google patches are partial, and "no longer tagged" is a value,
  not an absence. So an untagging is said explicitly, in the label vocabulary
  (version 1, `eventLabelId: null`), and only then does the ordinary body put
  the Tomato back. Two calls, on the one transition that needs them, rather than
  a flag on every push.
*/
async function clearLabel(supabase, calendarId, eventId) {
  await callGoogle(
    supabase,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', params: { eventLabelVersion: 1 }, body: { eventLabelId: null } }
  );
}

/*
  Deleting an event that is already gone is a SUCCESS, not a failure. You can
  delete one of these from Google Calendar directly, and then taking the task
  off the day would otherwise fail forever on an event nobody has. 410 is
  Google's "already deleted"; 404 is "never heard of it".
*/
async function deleteEvent(supabase, calendarId, eventId) {
  try {
    await callGoogle(
      supabase,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' }
    );
  } catch (err) {
    if (err.status !== 404 && err.status !== 410) throw err;
  }
}

/**
 * SEND THE DAY.
 *
 * `items` is the day as the browser has it (see `dayPushItems`) — the tasks you
 * planned for this date and gave an hour to. It is taken from the client rather
 * than re-read from the database on purpose: it is what is on screen at the
 * moment you press the button, so a block dragged half a second before pressing
 * Finish is included instead of racing its own save. Every field of it is
 * validated first (`normalizePushItems`), and nothing but a title and two
 * numbers ever reaches Google.
 *
 * Then it is a RECONCILIATION, not an upload, and that is the difference
 * between a calendar you can trust and one that fills up with ghosts:
 *
 *   new to us       created, and the event remembered against the task.
 *   moved / renamed patched in place, so the event keeps its identity — its
 *                   notifications, and whatever you may have added to it.
 *   unchanged       left completely alone. Re-sending a day you have not
 *                   touched writes nothing at all.
 *   gone from today  deleted. A task you unscheduled, took off the day, or
 *                   dropped entirely takes its block out of your calendar with
 *                   it, because a plan you have changed your mind about is
 *                   worse than no plan once it is sitting in your calendar.
 *   in the wrong    deleted from where it is and made again where it belongs.
 *   calendar        This is the destination having changed under a day that was
 *                   already sent, and it is the one case a PATCH cannot express.
 *
 * It all happens on ONE calendar, found by name (`writeCalendar`), and never on
 * `primary`. If that calendar is missing the whole push fails, loudly, before a
 * single event is written: falling back to the main calendar would put a
 * fortnight of blocks somewhere nobody asked for them.
 *
 * A failure part-way through still SAVES what it managed, and rethrows. The one
 * unacceptable outcome is an event created in Google and forgotten here, which
 * is precisely how you end up with a second copy on the next attempt.
 */
export async function pushGoogleDay(supabase, { date, timeZone, items }) {
  const blob = await readPushed(supabase);
  const previous = dayEntry(blob, date);
  const next = { ...previous.events };

  const result = { created: 0, updated: 0, unchanged: 0, removed: 0, calendar: null };

  const save = async () => {
    const pruned = keepRecentDays(blob, date, PUSH_PRUNE_DAYS);
    if (Object.keys(next).length > 0) {
      pruned[date] = { at: new Date().toISOString(), events: next };
    }
    await writeSetting(supabase, PUSHED_KEY, pruned);
  };

  try {
    const calendar = await writeCalendar(supabase);
    result.calendar = calendar.summary;

    for (const item of items) {
      const signature = itemSignature(item);
      const known = previous.events[item.taskId];
      // An event written before the destination changed is in the wrong
      // calendar. It cannot be patched into the right one — Google has no move
      // that a PATCH can express — so it is taken out of where it is and made
      // again where it belongs, and the day migrates itself on its next send.
      const elsewhere = known?.eventId && entryCalendar(known) !== calendar.id;

      if (elsewhere) {
        await deleteEvent(supabase, entryCalendar(known), known.eventId);
        // Forgotten the instant it is gone, so a failure between here and the
        // POST below cannot leave the record pointing at an event that no
        // longer exists.
        delete next[item.taskId];
      } else if (known?.eventId) {
        if (known.sig === signature) {
          result.unchanged += 1;
          continue;
        }
        // A tag that has been taken off has to be taken off in so many words
        // before the body below can put the red back. Known from what we last
        // wrote, so an untouched tag costs nothing.
        if (!item.labelId && known.label) await clearLabel(supabase, calendar.id, known.eventId);
        await callGoogle(
          supabase,
          `/calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(known.eventId)}`,
          { method: 'PATCH', params: eventParams(item), body: eventBody(item, { date, timeZone }) }
        );
        next[item.taskId] = {
          eventId: known.eventId, calendarId: calendar.id, sig: signature, label: item.labelId || null,
        };
        result.updated += 1;
        continue;
      }

      const created = await callGoogle(supabase, `/calendars/${encodeURIComponent(calendar.id)}/events`, {
        method: 'POST',
        params: eventParams(item),
        body: eventBody(item, { date, timeZone }),
      });
      if (created?.id) {
        next[item.taskId] = {
          eventId: created.id, calendarId: calendar.id, sig: signature, label: item.labelId || null,
        };
        if (elsewhere) result.updated += 1; else result.created += 1;
      }
    }

    const wanted = new Set(items.map(item => item.taskId));
    for (const [taskId, entry] of Object.entries(previous.events)) {
      if (wanted.has(taskId)) continue;
      if (entry?.eventId) await deleteEvent(supabase, entryCalendar(entry), entry.eventId);
      delete next[taskId];
      result.removed += 1;
    }
  } catch (err) {
    // Whatever landed, landed. Remembering it is what stops the next attempt
    // creating a second copy of everything it already wrote.
    await save().catch(saveErr => console.error('Failed to record a partial Google push', saveErr));
    throw err;
  }

  await save();

  const pairs = Object.entries(next).map(([taskId, entry]) => [taskId, entry.sig]);
  return {
    ...result,
    count: pairs.length,
    signature: daySignature(pairs),
    // Everything that survived this is in the calendar we just wrote to.
    stale: false,
    at: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The other calendar: editing an event this app did not write
// ─────────────────────────────────────────────────────────────────────────────

/*
  EVERYTHING ABOVE THIS LINE only ever touches an event carrying one of our task
  ids. That rule made the push safe to trust, and it is not being relaxed: what
  follows is a SECOND, separately addressed surface, where the id of the thing to
  change arrives from the browser because you right-clicked or dragged the block
  it is drawn as.

  Which makes the guard a different one, and it is `writableCalendar`: every
  write here is checked against your own calendar list first, so a request can
  only ever reach a calendar you have write access to and that you are actually
  looking at. A birthdays feed, a colleague's calendar shared read-only, and a
  calendar id invented by a client are all refused before any request is made —
  and refused with the sentence that says why, since "this one is not yours to
  change" is information rather than an error.
*/
async function writableCalendar(supabase, calendarId) {
  const match = (await fetchCalendarList(supabase)).find(c => c.id === calendarId);

  if (!match) {
    // The commonest reason is a stale page: a calendar unsubscribed from in
    // another tab, or a connection since dropped. Drop the cache so the next
    // attempt asks Google rather than repeating a minute-old answer.
    calendarListCache = null;
    throw new GoogleWriteCalendarError(
      'That event’s calendar is no longer on this account. Refresh the day and try again.'
    );
  }
  if (match.accessRole !== 'owner' && match.accessRole !== 'writer') {
    throw new GoogleWriteCalendarError(
      `“${match.summary}” is shared with you read-only, so its events cannot be changed from here.`
    );
  }
  return match;
}

const eventPath = (calendarId, eventId) => (
  `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
);

/**
 * CHANGE ONE OF YOUR REAL EVENTS: when it is, what it is called, what it says,
 * what it is tagged. Whatever is passed is what changes; everything else about the event —
 * its guests, its description, its notifications, its recurrence — is not
 * mentioned, and Google's PATCH leaves what is not mentioned exactly alone.
 *
 * `start` is a position on the 4am day rather than a clock, because that is
 * what a drag on the timeline produces and what the small hours need in order to
 * be said at all (see `blockTimes`).
 *
 * `retag` is a separate flag from `labelId` because null is a value here: "take
 * the tag off" and "leave the tag alone" are different requests, and a body
 * that expressed both as a missing field would make the first one impossible.
 *
 * A RECURRING event arrives as the single occurrence Google expanded for this
 * day (`singleEvents: true`), and its id addresses that occurrence, so this
 * changes THIS Tuesday and not every Tuesday. That is the same thing Google's
 * own UI does when you drag one and choose "This event", and the timeline says
 * so before you do it.
 */
export async function patchExternalEvent(
  supabase,
  { calendarId, eventId, date, timeZone, start, minutes, title, description, labelId, retag = false }
) {
  const calendar = await writableCalendar(supabase, calendarId);

  const body = {};
  if (typeof start === 'number') Object.assign(body, blockTimes(start, minutes, { date, timeZone }));
  if (typeof title === 'string') body.summary = title;
  // An empty string is a real answer here and means "no description": it is how
  // one gets cleared, and Google takes it as such.
  if (typeof description === 'string') body.description = description;
  /*
    Setting and clearing are ONE call here, unlike a task's block: an event of
    yours has no Tomato to put back underneath, so `eventLabelId: null` is the
    whole of "no tag" — it drops the label and the event goes back to whatever
    colour it had before you gave it one, which is exactly what Google's own
    "Default colour" does.
  */
  if (retag) body.eventLabelId = labelId || null;

  // Nothing asked for is not a request worth making. Better a no-op here than
  // an empty PATCH that touches an `updated` timestamp for no reason.
  if (Object.keys(body).length === 0) return { calendar: calendar.summary };

  await callGoogle(supabase, eventPath(calendarId, eventId), {
    method: 'PATCH',
    // Only when a tag is in play, for the reason `eventParams` gives: version 1
    // is what makes Google read the field, and it makes it stop reading colorId.
    params: retag ? { eventLabelVersion: 1 } : undefined,
    body,
  });

  return { calendar: calendar.summary };
}

/**
 * DELETE one of your real events.
 *
 * The one gesture here that cannot be taken back, so it is the one that reads
 * the event first. Two things are worth a round trip before removing something
 * from a real person's calendar:
 *
 *   ours       an event carrying a task id is a block this app wrote, and it is
 *              owned by the push (which knows how to remove it and how to forget
 *              it afterwards). Deleting one through this door would leave
 *              `google_pushed` pointing at nothing and the next send making a
 *              second copy. It is refused, and the message says where the real
 *              control is.
 *   gone       410 and 404 are successes, not failures: you can delete one of
 *              these in Google directly, and then deleting it here must not fail
 *              forever on an event nobody has.
 */
export async function deleteExternalEvent(supabase, { calendarId, eventId }) {
  await writableCalendar(supabase, calendarId);

  let existing = null;
  try {
    existing = await callGoogle(supabase, eventPath(calendarId, eventId));
  } catch (err) {
    if (err.status !== 404 && err.status !== 410) throw err;
    return { deleted: false, title: null };
  }

  if (existing?.extendedProperties?.private?.[TASK_ID_PROPERTY]) {
    throw new GoogleWriteCalendarError(
      'That block is one of this app’s own. Take the time off the task on the timeline instead, '
      + 'and the next send removes it from Google.'
    );
  }

  await deleteEvent(supabase, calendarId, eventId);
  return { deleted: true, title: String(existing?.summary || '').trim() || null };
}

/**
 * Forget every event we have written, without touching Google.
 *
 * Used when the connection is dropped: the record maps task ids to events in an
 * account this deployment can no longer reach, so keeping it would mean a later
 * reconnect trying to PATCH ids that may by then belong to nothing. Connecting
 * again starts the day's history over, which is the only honest state.
 */
export async function forgetPushed(supabase) {
  await writeSetting(supabase, PUSHED_KEY, {});
}
