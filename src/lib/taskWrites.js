/*
  Server-side write helpers for the `tasks` table, shared by /api/tasks and
  /api/tasks/reorder.

  One job: `sanitizeWritableFields`, the allow-list of columns a client may
  set, with normalization applied once, here. In particular `status` owns `done`
  and `completed_at`: they are mirrors of it (see statusPatch), never set on
  their own, so a row can never read as open in one column and finished in
  another. `planned_date` owns the day's fields the same way (see plannedPatch):
  taking a task off a day takes its timeline block with it. Anything not named
  here (`id`, `version`, the timestamps) is the server's to decide and is
  ignored on the way in.

  Deliberately NOT `server-only`: no secrets, no client, so it stays plain
  testable functions.
*/

import { normalizeLabelId } from './googleEvents.js';
import {
  normalizeDailyPriority, normalizeEstimate, normalizePriority, normalizeStatus,
  plannedPatch, schedulePatch, statusPatch,
} from './tasks.js';

/** Only the fields a client may set, normalized. Anything else is ignored. */
export function sanitizeWritableFields(body = {}) {
  const row = {};
  if (body.title !== undefined) row.title = String(body.title).trim();
  if (body.notes !== undefined) row.notes = String(body.notes ?? '');
  if (body.priority !== undefined) row.priority = normalizePriority(body.priority);
  if (body.list_id !== undefined) row.list_id = body.list_id || 'default';
  if (body.position !== undefined) row.position = body.position;
  if (body.subtasks !== undefined) row.subtasks = Array.isArray(body.subtasks) ? body.subtasks : [];
  if (body.due_date !== undefined) row.due_date = body.due_date || null;
  // "This one is going to be a fight." A boolean and nothing cleverer: it is
  // what Attention reads a week out (see lib/agenda's `attention`).
  if (body.is_hard !== undefined) row.is_hard = !!body.is_hard;
  /*
    The tag on its timeline block, as a Google event label id — set from the
    calendar's own right-click menu (see lib/googleEvents). Null is a real
    value here and means "no tag", which is what takes a block back to Tomato,
    so it is stored rather than skipped.
  */
  if (body.google_label_id !== undefined) {
    row.google_label_id = normalizeLabelId(body.google_label_id);
  }
  if (body.status !== undefined || body.done !== undefined) {
    const status = body.status !== undefined
      ? normalizeStatus(body.status)
      : normalizeStatus(undefined, !!body.done);
    Object.assign(row, statusPatch(status));
  }

  /*
    The planning fields (/today). `planned_date` owns the other three the same
    way `status` owns `done`: clearing the day clears the block that was made
    for it and the half of the day it was in, here as well as in the browser, so
    a client that only sent `{ planned_date: null }` cannot leave a ghost block
    behind on a day nothing is planned for.
  */
  if (body.estimated_minutes !== undefined) {
    row.estimated_minutes = normalizeEstimate(body.estimated_minutes);
  }
  if (body.planned_date !== undefined) {
    Object.assign(row, plannedPatch(body.planned_date || null, body.daily_priority));
  } else if (body.daily_priority !== undefined) {
    row.daily_priority = normalizeDailyPriority(body.daily_priority);
  }
  // A scheduled_start of null is "unschedule", and is meaningful on its own:
  // it takes the block off the timeline and leaves the task on the day.
  if (body.scheduled_start !== undefined && row.planned_date !== null) {
    Object.assign(row, schedulePatch(body.scheduled_start, body.scheduled_minutes, body));
  } else if (body.scheduled_minutes !== undefined && row.scheduled_minutes === undefined) {
    row.scheduled_minutes = normalizeEstimate(body.scheduled_minutes);
  }
  return row;
}
