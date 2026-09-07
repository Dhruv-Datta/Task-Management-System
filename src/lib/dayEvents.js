import 'server-only';

/*
  THE DAY'S FIXED COMMITMENTS, where they live: `app_settings.day_events`.

      day_events → { 'YYYY-MM-DD': [{ id, title, start, minutes, labelId, notes }] }

  A class, lunch, a standing meeting. Something the day already CONTAINS, as
  opposed to something you owe: it has a time and a length, it cannot be
  completed, and it must never become a task (see /api/events for why it is a
  blob and not a table).

  This file exists because there are now TWO places that read and write that
  blob, and they must agree about every part of it — the key, the shape, and the
  pruning. /api/events is the obvious one. The other is Google Calendar: a
  commitment goes up with the rest of the day, which means a description typed
  onto it in Google comes back into it, and an event deleted there deletes it
  here (see `adoptGoogleNotes` and `reapDeletedBlocks` in lib/googleCalendar).
  Two copies of "which settings key, pruned how" is exactly the kind of thing
  that stays in agreement until the day it doesn't.
*/

import { readSetting, writeSetting } from './appSettings.js';
import { normalizeEvents } from './agenda.js';
import { addDaysISO } from './dates.js';

export const EVENTS_KEY = 'day_events';

/*
  How much of the past to keep. Long enough that a week off doesn't lose the
  week you had planned, short enough that the blob stays a blob.
*/
const PRUNE_DAYS = 30;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isDayKey = key => ISO_DATE.test(String(key));

/** The whole blob, read defensively: it is JSON somebody could have hand-edited. */
export async function readDayEventsBlob(supabase) {
  const stored = await readSetting(supabase, EVENTS_KEY, {});
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

/** One day's commitments, normalized and in the order they happen. */
export function dayEventsOf(blob, date) {
  return normalizeEvents(blob?.[date]);
}

/** One day's commitments, straight from the database. */
export async function readDayEvents(supabase, date) {
  return dayEventsOf(await readDayEventsBlob(supabase), date);
}

/**
 * One day, replaced wholesale, and the rest of the blob pruned.
 *
 * Pruned relative to the day being WRITTEN rather than to the server's own
 * clock: this box may be in a different timezone from the person planning, and
 * a cutoff that can drop the day you are editing is worse than one that keeps a
 * few extra days.
 */
export async function writeDayEvents(supabase, date, events, blob = null) {
  const stored = blob || await readDayEventsBlob(supabase);
  const clean = normalizeEvents(events);

  const next = {};
  const cutoff = addDaysISO(date, -PRUNE_DAYS);
  for (const [key, value] of Object.entries(stored)) {
    if (key === date || !isDayKey(key) || key < cutoff) continue;
    next[key] = value;
  }
  if (clean.length > 0) next[date] = clean;

  await writeSetting(supabase, EVENTS_KEY, next);
  return clean;
}
