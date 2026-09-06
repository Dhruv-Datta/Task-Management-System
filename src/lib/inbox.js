/*
  THE INBOX: a thought, before it is a task.

  Everything else in this app asks you questions. /tasks wants a list, a status
  and a priority; /today wants a day, an estimate and a place on the timeline.
  All of that is the right thing to be asked when you are DECIDING. It is the
  wrong thing to be asked at the moment a thought arrives, because the cost of
  answering is what makes you not write the thought down at all.

  So capture asks one question — what is it — and filing asks the rest, later,
  once, in a pass of its own. Two stages, deliberately apart:

    CAPTURE   type, Enter, gone. One field, no defaults to review, no dialog.
    ORGANIZE  the pile, oldest first, one card at a time: which list, how
              urgent, when it is owed, is it today's problem. Then File.

  WHERE AN UNFILED THOUGHT LIVES, and why it is not a new column.

  It lives in a LIST — the reserved one named here — and that is the whole
  mechanism. A list is not a table in this app (see lib/tasks.js: it is an id in
  a JSON blob), so the inbox costs no schema change, no migration against a
  hand-applied database, and no second definition of "unfiled" that could drift
  out of step with the first. Filing a thought is then exactly what it sounds
  like: the task moves to a real list, and from that moment it is an ordinary
  task that every other view already knows how to draw.

  The reserved id is never offered in the list switcher and never created by
  `createList` (which mints `list_${Date.now()}`), so nothing can collide with
  it. /api/tasks hides this list from every read that does not ASK for it by
  name, which is what keeps a half-formed thought out of the board, the
  calendar and the planned day until you have decided what it is.

  Pure helpers only, like the rest of the model: no fetch, no React.
*/

import { addDaysISO, todayISO } from './dates.js';

/*
  The list an unfiled thought sits in. A plain string, because `tasks.list_id`
  is a plain string; 'inbox' rather than something uglier because it shows up in
  the URL of the one read that asks for it, and there it should say what it is.
*/
export const INBOX_LIST_ID = 'inbox';

/** Is this a thought waiting to be filed, rather than a task? */
export function isCaptured(task) {
  return task?.list_id === INBOX_LIST_ID;
}

/*
  PASTE A LIST, GET A LIST.

  The commonest way a pile of thoughts already exists is as lines in a note, so
  a multi-line paste is split into one capture per line rather than saved as one
  task with newlines in its title. Leading bullets and dashes go with it: they
  are the shape of the note, not part of what you have to do.

  A single line comes back as a single item, which is the ordinary case and
  makes this safe to run over every capture.
*/
export function splitCaptures(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^(?:[-*•‣▪]|\d{1,2}[.)])\s+/, '').trim())
    .filter(Boolean);
}

/** What a capture writes. One field, because capture asks one question. */
export function capturePayload(title) {
  const trimmed = String(title ?? '').trim();
  return trimmed ? { title: trimmed, list_id: INBOX_LIST_ID } : null;
}

/*
  What SAVING writes: the thought, decided.

  `list_id` is the whole of what stops it being a thought — a task in a real
  list is no longer in the inbox, so there is no second flag to clear and no way
  for the two to disagree. The rest is the ordinary task model.

  `due_date` and `is_hard` are sent even when the answer is "no", because on
  this card they always have one: nothing was left unasked, so nothing should be
  left at whatever the row happened to default to.

  `notes` is the exception, and is sent only when the caller has one to send: an
  empty string is a description you deleted and must be written, but a caller
  that never asked for one at all must not blank whatever the row already holds.
*/
export function filePayload({ title, listId, priority, dueDate, hard, notes } = {}) {
  if (!listId || listId === INBOX_LIST_ID) return null;
  const payload = { list_id: listId };
  const trimmed = String(title ?? '').trim();
  if (trimmed) payload.title = trimmed;
  if (priority) payload.priority = priority;
  payload.due_date = dueDate || null;
  payload.is_hard = !!hard;
  if (notes !== undefined) payload.notes = String(notes ?? '');
  return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// Order
// ─────────────────────────────────────────────────────────────────────────────

/*
  The two stages read the same pile in opposite orders, on purpose.

  CAPTURE is a feed: you just typed something and it should be the first thing
  you see, so the newest is on top and the pile grows downward under your hands.

  ORGANIZE is a queue: the thought you had on Tuesday is the one most likely to
  have gone stale, so it is dealt with first. Filing works top-down and the
  oldest thing is always the next card.
*/
function capturedAt(task) {
  const t = Date.parse(task?.created_at ?? '');
  return Number.isNaN(t) ? 0 : t;
}

export function sortCaptured(tasks = [], { newestFirst = false } = {}) {
  const dir = newestFirst ? -1 : 1;
  // `position` is the tiebreaker rather than the lead, because two thoughts
  // typed in the same second still went in in an order and that order is what
  // the row numbers hold.
  return [...tasks].sort((a, b) =>
    (capturedAt(a) - capturedAt(b)) * dir || ((a.position ?? 0) - (b.position ?? 0)) * dir
  );
}

/*
  HOW LONG IT HAS BEEN SITTING THERE, in as few characters as fit on a row.

  Not a date: the only question you ask of a captured thought is whether it is
  fresh or whether it has been rotting, and "3d" answers that in the width of a
  timestamp's first word.
*/
export function capturedAgo(task, now = Date.now()) {
  const at = capturedAt(task);
  if (!at) return '';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return weeks < 5 ? `${weeks}w ago` : `${Math.round(days / 30)}mo ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The two answers to "when"
// ─────────────────────────────────────────────────────────────────────────────

/*
  Triage is fast or it does not happen, and a month grid is not fast. Two
  answers get to be buttons, and they are the two that are true of most things
  you have just written down; every other date is a real date, and a real date
  is what the calendar behind the picker is for.
*/
export function quickDues(today = todayISO()) {
  return [
    { key: 'today', label: 'Today', iso: today },
    { key: 'tomorrow', label: 'Tomorrow', iso: addDaysISO(today, 1) },
  ];
}
