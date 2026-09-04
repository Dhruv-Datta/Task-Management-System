import { getDb } from '@/lib/db';
import { apiBadRequest, apiJson, withApiError } from '@/lib/apiResponses';
import { GoogleNotConnectedError, isGoogleConfigured, readConnection } from '@/lib/googleAuth';
import { deleteExternalEvent, patchExternalEvent, readGoogleDay } from '@/lib/googleCalendar';
import {
  MAX_DESCRIPTION, MIN_EXTERNAL_MINUTES, isValidTimeZone, normalizeLabelId,
} from '@/lib/googleEvents';
import { DAY_WINDOW_END } from '@/lib/dates';

/*
  /api/google/event: ONE of your real Google events, changed from this timeline.

    PATCH  { calendarId, eventId, date, tz, start?, minutes?, title?, description?, labelId? }
    DELETE { calendarId, eventId, date, tz }

  The other half of /api/google/day, and deliberately its own route rather than
  another verb on that one. /day is about a DAY — read it, send the plan into it
  — and its writes only ever touch events this app wrote itself. This is about a
  single event that one of your calendars owns, addressed by an id the browser
  was handed when the day was drawn, and the safety story for it is entirely
  different (see `writableCalendar` in lib/googleCalendar): the guard is that the
  calendar is one of yours and one you may write to.

  BOTH REPLY WITH THE WHOLE DAY, refreshed, exactly as the push does. A moved
  event changes what overlaps what, which column each block is drawn in, and
  whether Google now considers it to run past midnight — none of which the
  browser can work out from a receipt. One extra read per gesture is a small
  price for the timeline never disagreeing with the calendar it is a picture of.

  What can be said here is deliberately tiny: two numbers, a title, a description
  and a tag id. There is nothing in this body that can reach a calendar you
  cannot write to, and nothing that can delete an event this app wrote (that is
  refused, with a sentence saying where the real control is).
*/

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A title is a line, not a document. The description is the document. */
const MAX_TITLE = 300;

function resolveTimeZone(raw) {
  if (isValidTimeZone(raw)) return raw;
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(local) ? local : 'UTC';
}

/*
  The three things every request here needs, checked once: we are connected, the
  event is addressed, and the day it sits on is a day. Returns either a formed
  400 under `error` or the values, so both verbs below read as a straight line
  instead of as two copies of the same guards.
*/
async function target(supabase, body) {
  if (!isGoogleConfigured() || !(await readConnection(supabase))) throw new GoogleNotConnectedError();

  const calendarId = String(body?.calendarId || '').trim();
  const eventId = String(body?.eventId || '').trim();
  if (!calendarId || !eventId) return { error: apiBadRequest('calendarId and eventId are required') };

  const date = String(body?.date || '');
  if (!ISO_DATE.test(date)) return { error: apiBadRequest('date=YYYY-MM-DD is required') };

  return { calendarId, eventId, date, timeZone: resolveTimeZone(body?.tz) };
}

/*
  A drag on the timeline, checked. `start` is a position on the 4am day, so it
  runs past 1440 and stops at DAY_WINDOW_END — the same window every block on the
  grid lives in. A length is CLAMPED rather than refused: the gesture that
  produced it was already clamped on screen, and disagreeing with what the person
  just watched happen is worse than trimming a minute off it.
*/
function placement(body) {
  if (body?.start === undefined) return {};
  const start = Math.round(Number(body.start));
  if (!Number.isFinite(start) || start < 0 || start >= DAY_WINDOW_END) return {};
  const length = Math.round(Number(body.minutes));
  const minutes = Number.isFinite(length) ? Math.max(MIN_EXTERNAL_MINUTES, length) : MIN_EXTERNAL_MINUTES;
  return { start, minutes: Math.min(minutes, DAY_WINDOW_END - start) };
}

export async function PATCH(request) {
  return withApiError(async () => {
    const { supabase } = await getDb();
    const body = await request.json().catch(() => ({}));

    const found = await target(supabase, body);
    if (found.error) return found.error;
    const { calendarId, eventId, date, timeZone } = found;

    /*
      `retag` is "was the tag mentioned at all", not "is there a tag": null is a
      real answer here — it is what taking the tag off means — and a body that
      said "no tag" and "leave the tag alone" the same way would make one of the
      two unsayable.
    */
    const retag = body.labelId !== undefined;
    const title = body.title === undefined ? undefined : String(body.title).trim().slice(0, MAX_TITLE);
    // An empty title is not a rename, it is an erasure: Google would draw the
    // event as "(No title)" and the name it had is gone.
    if (title !== undefined && !title) return apiBadRequest('An event needs a title');

    /*
      The description, unlike the title, IS allowed to be empty — that is how one
      is cleared, and clearing it is a thing people mean. It is capped at what
      the day was allowed to carry down (MAX_DESCRIPTION), so a body cannot use
      this route to stuff a novel into a calendar entry.
    */
    const description = body.description === undefined
      ? undefined
      : String(body.description).slice(0, MAX_DESCRIPTION);

    await patchExternalEvent(supabase, {
      calendarId,
      eventId,
      date,
      timeZone,
      ...placement(body),
      title,
      description,
      labelId: retag ? normalizeLabelId(body.labelId) : null,
      retag,
    });

    const day = await readGoogleDay(supabase, { date, timeZone });
    return apiJson({ date, ...day });
  });
}

export async function DELETE(request) {
  return withApiError(async () => {
    const { supabase } = await getDb();
    const body = await request.json().catch(() => ({}));

    const found = await target(supabase, body);
    if (found.error) return found.error;
    const { calendarId, eventId, date, timeZone } = found;

    const removed = await deleteExternalEvent(supabase, { calendarId, eventId });
    const day = await readGoogleDay(supabase, { date, timeZone });
    return apiJson({ date, removed, ...day });
  });
}
