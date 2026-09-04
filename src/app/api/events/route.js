import { getDb } from '@/lib/db';
import { apiBadRequest, apiJson, withApiError } from '@/lib/apiResponses';
import { readSetting, writeSetting } from '@/lib/appSettings';
import { normalizeEvents } from '@/lib/agenda';
import { addDaysISO } from '@/lib/dates';

/*
  /api/events: the fixed commitments on a day's timeline.

  A class, lunch, a standing meeting. Something the day already CONTAINS, as
  opposed to something you owe: it has a time and a length, it cannot be
  completed, it has no due date, no priority and no list, and it must never
  become a task, or the board would fill up with your own timetable.

  Which is exactly why this is not a table. An event has no lifecycle to model
  and nothing joins to it; it is a handful of strings per day, so it lives in
  `app_settings` under one key, the same way the lists do:

      day_events → { 'YYYY-MM-DD': [{ id, title, start, minutes }] }

  One key rather than one per day, because the whole blob is a few kilobytes at
  the outside and a read of "the day" should be one round trip. It is pruned on
  every write (see PRUNE_DAYS): a timetable from last spring is not history
  worth carrying, and nothing in the app can read it.

  Shape: GET ?date= → { date, events }, PUT { date, events } → { date, events }.
*/

const EVENTS_KEY = 'day_events';

// How much of the past to keep. Long enough that a week off doesn't lose the
// week you had planned, short enough that the blob stays a blob.
const PRUNE_DAYS = 30;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readDay(blob, date) {
  const all = blob && typeof blob === 'object' && !Array.isArray(blob) ? blob : {};
  return normalizeEvents(all[date]);
}

// GET ?date=YYYY-MM-DD → one day's events
export async function GET(req) {
  return withApiError(async () => {
    const { supabase } = await getDb();
    const date = new URL(req.url).searchParams.get('date');
    if (!ISO_DATE.test(String(date))) return apiBadRequest('date=YYYY-MM-DD is required');

    const blob = await readSetting(supabase, EVENTS_KEY, {});
    return apiJson({ date, events: readDay(blob, date) });
  });
}

// PUT { date, events } → that day, replaced wholesale
export async function PUT(req) {
  return withApiError(async () => {
    const { supabase } = await getDb();
    const { date, events } = await req.json();
    if (!ISO_DATE.test(String(date))) return apiBadRequest('date=YYYY-MM-DD is required');

    const stored = await readSetting(supabase, EVENTS_KEY, {});
    const blob = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};

    const clean = normalizeEvents(events);
    const next = {};
    // Prune relative to the day being written rather than to the server's own
    // clock: this box may be in a different timezone from the person planning,
    // and a cutoff that can drop the day you are editing is worse than one that
    // keeps a few extra.
    const cutoff = addDaysISO(date, -PRUNE_DAYS);
    for (const [key, value] of Object.entries(blob)) {
      if (key === date || !ISO_DATE.test(key) || key < cutoff) continue;
      next[key] = value;
    }
    if (clean.length > 0) next[date] = clean;

    await writeSetting(supabase, EVENTS_KEY, next);
    return apiJson({ date, events: clean });
  });
}
