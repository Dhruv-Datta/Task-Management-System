import { getDb } from '@/lib/db';
import { apiBadRequest, apiJson, withApiError } from '@/lib/apiResponses';
import { readDayEvents, writeDayEvents } from '@/lib/dayEvents';

/*
  /api/events: the fixed commitments on a day's timeline.

  A class, lunch, a standing meeting. Something the day already CONTAINS, as
  opposed to something you owe: it has a time and a length, it cannot be
  completed, it has no due date, no priority and no list, and it must never
  become a task, or the board would fill up with your own timetable.

  Which is exactly why this is not a table. An event has no lifecycle to model
  and nothing joins to it; it is a handful of strings per day, so it lives in
  `app_settings` under one key, the same way the lists do — the shape, the key
  and the pruning are all in lib/dayEvents, which Google Calendar's side of the
  day reads and writes too.

  Shape: GET ?date= → { date, events }, PUT { date, events } → { date, events }.
*/

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET ?date=YYYY-MM-DD → one day's events
export async function GET(req) {
  return withApiError(async () => {
    const { supabase } = await getDb();
    const date = new URL(req.url).searchParams.get('date');
    if (!ISO_DATE.test(String(date))) return apiBadRequest('date=YYYY-MM-DD is required');

    return apiJson({ date, events: await readDayEvents(supabase, date) });
  });
}

// PUT { date, events } → that day, replaced wholesale
export async function PUT(req) {
  return withApiError(async () => {
    const { supabase } = await getDb();
    const { date, events } = await req.json();
    if (!ISO_DATE.test(String(date))) return apiBadRequest('date=YYYY-MM-DD is required');

    return apiJson({ date, events: await writeDayEvents(supabase, date, events) });
  });
}
