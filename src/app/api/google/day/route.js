import { getDb } from '@/lib/db';
import { apiBadRequest, apiJson, withApiError } from '@/lib/apiResponses';
import {
  GoogleAuthError, GoogleNotConnectedError, isGoogleConfigured, publicConnection, readConnection,
} from '@/lib/googleAuth';
import { pushGoogleDay, readGoogleDay, readPushState } from '@/lib/googleCalendar';
import { isValidTimeZone, normalizePushItems } from '@/lib/googleEvents';

/*
  /api/google/day: one day, both directions.

    GET  ?date&tz   what Google already has on that day, plus whether we are
                    connected at all and what we last sent.
    POST {date,tz,items}
                    send the day, then hand back the calendar as it now stands.

  ONE ENDPOINT FOR BOTH, and one round trip for each, because /today asks these
  questions together or not at all: it opens by asking "what does my real day
  look like", and it finishes by saying "and here is what I decided", after
  which the only thing worth knowing is what the calendar looks like now. A push
  that did not return the refreshed day would leave the page to guess, or to ask
  again.

  GET NEVER FAILS FOR A REASON THE PAGE CAN ACT ON. Not configured, not
  connected, and access revoked are all 200s carrying `connected: false` and a
  word saying which, because /today loads this on every visit and none of the
  three is an error — they are three things to offer a button for. A genuine
  fault (Google down, a network that isn't) still throws, and the page keeps its
  timeline and says so quietly.
*/

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A day of blocks is a plan; sixty of them is a runaway client. */
const MAX_PUSH_ITEMS = 60;

/*
  The timezone the day is read in. It comes from the browser
  (`Intl.DateTimeFormat().resolvedOptions().timeZone`), because THAT is the
  clock the timeline is drawn against — the server may be in another country and
  is nobody's idea of what nine in the morning means. Untrusted input, so it is
  checked against Intl itself, and a nonsense value falls back to this box's own
  zone rather than refusing the request.
*/
function resolveTimeZone(raw) {
  if (isValidTimeZone(raw)) return raw;
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(local) ? local : 'UTC';
}

function disconnected(date, reason) {
  return apiJson({
    date,
    configured: reason !== 'unconfigured',
    connected: false,
    email: null,
    connectedAt: null,
    events: [],
    calendars: 0,
    failed: [],
    // The tag vocabulary, empty: it is Google's, so with no connection there is
    // none of it, and the menu on a block says so rather than offering nothing
    // and looking broken.
    labels: {},
    writeCalendar: null,
    notes: [],
    pushed: { at: null, count: 0, signature: '' },
    reason,
  });
}

// GET ?date=YYYY-MM-DD&tz=Area/City → the day, as Google has it
export async function GET(request) {
  return withApiError(async () => {
    const { supabase } = await getDb();
    const params = request.nextUrl.searchParams;
    const date = params.get('date');
    if (!ISO_DATE.test(String(date))) return apiBadRequest('date=YYYY-MM-DD is required');

    if (!isGoogleConfigured()) return disconnected(date, 'unconfigured');

    const connection = await readConnection(supabase);
    if (!connection) return disconnected(date, 'not_connected');

    const timeZone = resolveTimeZone(params.get('tz'));

    try {
      /*
        In this order, and not in parallel, for one reason: reading the day is
        also what notices a description edited in Google Calendar itself, and
        adopting one MOVES the record of what we last sent (see
        `adoptGoogleNotes`). Asked at the same moment, `readPushState` would
        answer from the record as it was a moment ago, and /today would offer to
        send a day that is already sitting in the calendar it came from.
      */
      const day = await readGoogleDay(supabase, { date, timeZone });
      const pushed = await readPushState(supabase, date);

      return apiJson({
        date,
        configured: true,
        ...publicConnection(connection),
        events: day.events,
        calendars: day.calendars,
        // Which calendars could not be read, so the page can say "3 of 4"
        // rather than draw a thinner day and let you plan into a meeting.
        failed: day.failed,
        // The TAGS the day can be drawn in: per calendar, for its own events,
        // and the ones on the calendar the day is pushed to, which are the ones
        // a task block or a commitment of yours may take.
        labels: day.labels,
        writeCalendar: day.writeCalendar,
        // The tasks whose notes were edited in Google Calendar rather than
        // here, already adopted and handed back whole, so the page can put the
        // words on screen without re-reading the whole task list for them.
        notes: day.notes,
        pushed,
        reason: null,
      });
    } catch (err) {
      // The grant died between requests. `getAccessToken` has already dropped
      // it, so all that is left is to say so: the page offers Connect again.
      if (err instanceof GoogleAuthError || err instanceof GoogleNotConnectedError) {
        return disconnected(date, err.code);
      }
      throw err;
    }
  });
}

/*
  POST { date, tz, items } → send the day to Google, and read it straight back.

  `items` is the day as the browser has it: every task planned for this date
  that you gave an hour to (see `dayPushItems` in lib/googleEvents). It comes
  from the client and not from a fresh read of the tasks table, because the
  press that triggers this generally lands within a heartbeat of a drag, and the
  day on screen is the one you meant — waiting for the last save to round-trip
  would sometimes send a plan one block out of date.

  Which means it is INPUT, and it is treated as such: shape-checked, capped, and
  de-duplicated before a single event is written into a real person's calendar.
  What it can express is a title and two numbers; there is nothing in it that
  can name a calendar, an id, or an event to delete.

  The reply carries the refreshed day. Everything just written comes back
  stamped as ours and is dropped by the reader, so the timeline that redraws
  shows each thing exactly once: your real meetings from Google, and your own
  blocks still yours to move.
*/
export async function POST(request) {
  return withApiError(async () => {
    const { supabase } = await getDb();
    const body = await request.json().catch(() => ({}));
    const { date } = body;
    if (!ISO_DATE.test(String(date))) return apiBadRequest('date=YYYY-MM-DD is required');

    if (!isGoogleConfigured() || !(await readConnection(supabase))) {
      throw new GoogleNotConnectedError();
    }

    const timeZone = resolveTimeZone(body.tz);
    const items = normalizePushItems(body.items).slice(0, MAX_PUSH_ITEMS);

    const pushed = await pushGoogleDay(supabase, { date, timeZone, items });
    const day = await readGoogleDay(supabase, { date, timeZone });

    return apiJson({
      date,
      pushed,
      events: day.events,
      calendars: day.calendars,
      failed: day.failed,
      labels: day.labels,
      writeCalendar: day.writeCalendar,
      notes: day.notes,
    });
  });
}
