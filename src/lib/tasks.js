/*
  The task model behind /tasks: Linear's shape, for one person's work.

  Adapted from AlphaOS's task system, with the workspace removed: there is one
  account and one person, so a task belongs to a LIST and moves through four
  STATUSES. Everything else (priority, dates) is metadata you filter and sort
  by, never a place a task can get stuck.

    List:       which list a task belongs to (stored as `list_id`; the lists
                themselves live in app_settings under `task_lists`, served by
                /api/lists). Use them for contexts: Personal, Work, Someday.
    Status:     not_started → in_progress → waiting_review → completed.
                The one field you are asked to keep current.
    Priority:   urgent / high / medium / low. A field, not a bucket: there are
                no capacity caps, so priority is a label rather than a scarce
                resource you have to fight over.
    Dates:      `due_date`, when it's owed. One date, and only one: a second
                one to "look in on it" was a date you had to maintain in order
                to be nagged by it.
    Hard:       `is_hard`, whether the task is going to be a FIGHT. Not how
                important it is and not how long it takes: the two other things
                you already have fields for. It is what earns a task a place in
                Attention a week before it is owed.
    The day:    `planned_date` (the day you CHOSE to work on it),
                `daily_priority` (must_do / optional, within that day),
                `estimated_minutes` (how long you think it takes), and
                `scheduled_start` + `scheduled_minutes` (its block on that day's
                timeline). These are /today's, and they are a fifth axis: none
                of them is derivable from the list, the status or the due date,
                and changing one must never move any of those. See
                PLANNING below.

  Pure helpers only (no fetch, no React), so the whole model is testable and
  every view shares exactly one definition of "what counts as overdue" or "what
  order do these go in".
*/

import {
  DAY_WINDOW_END, MONTH_NAMES, clockToMinutes, dayMinutes, formatDuration, fromISODate,
  minutesToClock, todayISO,
} from './dates.js';

// ─────────────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────────────

/*
  The four statuses read as a traffic light you can scan from across the room:
  red for untouched, orange for moving, yellow for "it's with someone else now",
  green for landed. The colour cools as the work gets closer to done, so a wall
  of red is a wall of work nobody has started.

  These colours are a deliberate choice and not an accident to be tidied up. It
  is true that red also means overdue and urgent elsewhere, and a palette that
  started grey would read calmer; it would also stop the board answering "how
  much of this have I not touched" from the other side of the room, which is the
  question the board is for. Leave the traffic light alone.

  `progress` is how full the status dot draws: how far along the work reads at a
  glance. Nothing has been done on a Not started task, so its ring is empty
  rather than a quarter full; Waiting review is nearly closed because the only
  thing left is someone else's look.

  `chip` is the pill the status wears as a word (StatusChip in TaskPickers): the
  same colour as the dot, as a soft tint with a hairline of the same hue and a
  square-ish radius, so a status reads as a label rather than as a button you
  failed to press.
*/
export const STATUSES = [
  {
    key: 'not_started',
    label: 'Not started',
    short: 'Todo',
    color: '#ef4444',
    chip: 'bg-red-50 text-red-700 border-red-200/80',
    ring: 'border-red-300',
    progress: 0,
  },
  {
    key: 'in_progress',
    label: 'In progress',
    short: 'Doing',
    color: '#f97316',
    chip: 'bg-orange-50 text-orange-700 border-orange-200/80',
    ring: 'border-orange-400',
    progress: 0.5,
  },
  {
    key: 'waiting_review',
    label: 'Waiting review',
    short: 'Review',
    color: '#eab308',
    chip: 'bg-yellow-50 text-yellow-700 border-yellow-200/80',
    ring: 'border-yellow-400',
    progress: 0.85,
  },
  {
    key: 'completed',
    label: 'Completed',
    short: 'Done',
    color: '#10b981',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    ring: 'border-emerald-500',
    progress: 1,
  },
];

export const STATUS_KEYS = STATUSES.map(s => s.key);
export const DEFAULT_STATUS = 'not_started';
const STATUS_BY_KEY = new Map(STATUSES.map(s => [s.key, s]));

export function statusMeta(key) {
  return STATUS_BY_KEY.get(key) || STATUS_BY_KEY.get(DEFAULT_STATUS);
}

/*
  Defensive normalization on the way in. The schema constrains `status` to the
  four keys, but a row hand-edited in the Supabase table editor (or imported
  from somewhere else) can still carry an older vocabulary, and `done` is kept
  as a mirror of `status = completed`. Reading through here means no view ever
  has to cope with a row that says two things at once.
*/
const LEGACY_STATUS = {
  '': DEFAULT_STATUS,
  todo: 'not_started',
  working: 'in_progress',
  stuck: 'in_progress',
  waiting: 'in_progress',
  review: 'waiting_review',
  in_review: 'waiting_review',
  done: 'completed',
};

export function normalizeStatus(raw, done) {
  const key = String(raw || '').trim().toLowerCase();
  if (STATUS_BY_KEY.has(key)) {
    // `done` is the mirror of `status = completed`. If something ticked the
    // checkbox without touching status, trust `done`.
    if (done && key !== 'completed') return 'completed';
    return key;
  }
  if (done) return 'completed';
  return LEGACY_STATUS[key] ?? DEFAULT_STATUS;
}

export function isDone(task) {
  return normalizeStatus(task?.status, task?.done) === 'completed';
}

/** The next status in the pipeline (clicking the status dot advances a task). */
export function nextStatus(current) {
  const idx = STATUS_KEYS.indexOf(normalizeStatus(current));
  return STATUS_KEYS[(idx + 1) % STATUS_KEYS.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// Priority
// ─────────────────────────────────────────────────────────────────────────────

/*
  Priority reads as exclamation marks: !!! urgent, !! high, ! medium, and a bare
  dash for low, which is the honest glyph for "no urgency". How many marks and
  what colour they are say the same thing twice, so it lands whether you're
  reading the card or just scanning colour.
*/
export const PRIORITIES = [
  { key: 'urgent', label: 'Urgent', color: '#dc2626', chip: 'bg-red-50 text-red-700 border-red-200', marks: 3 },
  { key: 'high',   label: 'High',   color: '#f97316', chip: 'bg-orange-50 text-orange-700 border-orange-200', marks: 2 },
  { key: 'medium', label: 'Medium', color: '#eab308', chip: 'bg-yellow-50 text-yellow-700 border-yellow-200', marks: 1 },
  { key: 'low',    label: 'Low',    color: '#94a3b8', chip: 'bg-slate-50 text-slate-600 border-slate-200', marks: 0 },
];

/** The glyph for a priority: '!!!' down to '–'. */
export function priorityMarks(key) {
  const { marks } = priorityMeta(key);
  return marks > 0 ? '!'.repeat(marks) : '–';
}

export const PRIORITY_KEYS = PRIORITIES.map(p => p.key);
export const DEFAULT_PRIORITY = 'medium';
const PRIORITY_BY_KEY = new Map(PRIORITIES.map(p => [p.key, p]));
export const PRIORITY_RANK = Object.fromEntries(PRIORITY_KEYS.map((k, i) => [k, i]));

export function priorityMeta(key) {
  return PRIORITY_BY_KEY.get(key) || PRIORITY_BY_KEY.get(DEFAULT_PRIORITY);
}

// The old board's three levels ('highest'/'medium'/'low') map onto the new four.
const LEGACY_PRIORITY = { highest: 'high', high: 'high', medium: 'medium', low: 'low', urgent: 'urgent' };

export function normalizePriority(raw) {
  const key = String(raw || '').trim().toLowerCase();
  return PRIORITY_BY_KEY.has(key) ? key : (LEGACY_PRIORITY[key] || DEFAULT_PRIORITY);
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANNING: the day you chose, how long it takes, and where it sits
// ─────────────────────────────────────────────────────────────────────────────

/*
  A task's list says WHERE it lives, its status says HOW FAR ALONG it is, and
  its due date says WHEN IT IS OWED. None of those answers the question you
  actually open the app in the morning to ask, which is "what am I doing today".

  `planned_date` is that answer, and it is deliberately a separate field with no
  relationship to the other three. A task can be due on the 5th, sit In progress
  in the Hedge Fund list, and be the thing you have decided to do on the 2nd.
  Planning it for today must not move its due date, its status or its list;
  finishing it must not un-plan it; and taking it off today must not touch
  anything except the day.

  Everything else here hangs off that one field:

    daily_priority     within the chosen day: what you are COMMITTING to finish
                       (must_do) and what you will do IF THERE IS TIME
                       (optional). Meaningless while planned_date is null.
    estimated_minutes  how long you think it takes. The day's workload is the
                       sum of these, which is the only number on /today that
                       can tell you the day does not fit before you live it.
    scheduled_start    where in the day it sits, and for how long: the timeline
    scheduled_minutes  block. Optional; a planned task with no block is a thing
                       you are doing today at no particular time.
*/

/*
  The seven estimates, and only these seven. A free-minutes box would make
  estimating a data-entry job, and the difference between 40 and 45 minutes is
  not a difference you can actually feel.

  '3+ hours' is the honest last option rather than a ceiling: past three hours
  you are not estimating any more, you are describing a project. It counts as
  180 minutes in every total, which is why the day's workload reads as "at
  least" once one of these is in it.
*/
export const ESTIMATES = [
  { minutes: 15,  label: '15 min',    short: '15m' },
  { minutes: 30,  label: '30 min',    short: '30m' },
  { minutes: 45,  label: '45 min',    short: '45m' },
  { minutes: 60,  label: '1 hour',    short: '1h' },
  { minutes: 90,  label: '1.5 hours', short: '1h 30m' },
  { minutes: 120, label: '2 hours',   short: '2h' },
  { minutes: 180, label: '3+ hours',  short: '3h+' },
];

export const OPEN_ENDED_ESTIMATE = 180;

/*
  What a block is worth when nothing said. Half an hour, because a block you
  cannot see is a block you cannot move, and the alternative (refusing to
  schedule an unestimated task) would make the timeline harder to use than the
  paper it replaces.
*/
export const DEFAULT_BLOCK_MINUTES = 30;

/** A positive whole number of minutes, or null. Never a string, never a 0. */
export function normalizeEstimate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const minutes = Math.round(Number(raw));
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

/**
 * How an estimate reads. A value that is not one of the seven (hand-edited, or
 * imported) still draws, formatted from its own minutes rather than snapped to
 * a neighbour it does not mean.
 */
export function estimateMeta(minutes) {
  const value = normalizeEstimate(minutes);
  if (value === null) return null;
  return (
    ESTIMATES.find(e => e.minutes === value)
    || { minutes: value, label: formatDuration(value, { long: true }), short: formatDuration(value) }
  );
}

/*
  The two halves of a planned day.

  This is the distinction the day is actually made of: four things you have
  committed to and three you would like to get to are not the same list, and a
  page that mixes them is a to-do list with your intentions hidden inside it.
  You decide which half a task is in; nothing here infers it from priority or
  from a due date, because "urgent" and "I am doing it today" are different
  claims.
*/
export const DAILY_PRIORITIES = [
  { key: 'must_do',  label: 'Must finish',    short: 'Must do' },
  { key: 'optional', label: "If there's time", short: 'Optional' },
];

export const DEFAULT_DAILY_PRIORITY = 'must_do';

export function normalizeDailyPriority(raw) {
  const key = String(raw || '').trim().toLowerCase();
  return DAILY_PRIORITIES.some(d => d.key === key) ? key : DEFAULT_DAILY_PRIORITY;
}

export function dailyPriorityMeta(key) {
  return DAILY_PRIORITIES.find(d => d.key === normalizeDailyPriority(key));
}

/** Planned for a given day (today, unless you say otherwise). */
export function isPlannedFor(task, iso = todayISO()) {
  return !!task?.planned_date && task.planned_date === iso;
}

/** Planned, and given a place in the day. */
export function isScheduled(task) {
  return !!task?.planned_date && clockToMinutes(task?.scheduled_start) !== null;
}

/**
 * The column values a change of PLANNED DAY implies, the same way statusPatch
 * is what a change of status implies. One definition, used by the optimistic
 * client update (lib/taskStore.js) and by the server's write allow-list
 * (lib/taskWrites.js), so the two cannot drift.
 *
 * The rule it exists to keep: a schedule belongs to the day it was made for.
 * Taking a task off today therefore clears its block and resets which half of
 * the day it was in, because a 2pm block on a day you are no longer planning
 * is a ghost, and it would reappear the moment you planned the task again.
 * It touches NOTHING else: not the due date, not the status, not the list.
 */
export function plannedPatch(iso, dailyPriority) {
  if (!iso) {
    return {
      planned_date: null,
      daily_priority: DEFAULT_DAILY_PRIORITY,
      scheduled_start: null,
      scheduled_minutes: null,
    };
  }
  return { planned_date: iso, daily_priority: normalizeDailyPriority(dailyPriority) };
}

/**
 * The columns a timeline block implies: a start, and a length that is always
 * something. `null` unschedules, which leaves the task on the day, exactly
 * where it was, with no time attached.
 */
export function schedulePatch(startClock, minutes, task) {
  const start = clockToMinutes(startClock);
  if (start === null) return { scheduled_start: null, scheduled_minutes: null };
  const length = normalizeEstimate(minutes)
    || normalizeEstimate(task?.scheduled_minutes)
    || normalizeEstimate(task?.estimated_minutes)
    || DEFAULT_BLOCK_MINUTES;
  return {
    scheduled_start: minutesToClock(start),
    // Trimmed to the end of the DAY, which is 4am tomorrow rather than midnight
    // (see dayMinutes in lib/dates): a block starting at 11pm may run three
    // hours, and one starting at 1am is already in the small hours and has
    // until four.
    scheduled_minutes: Math.min(length, DAY_WINDOW_END - dayMinutes(startClock)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One task row as the UI wants it: status/priority in the new vocabulary, a
 * derived `done`, and never-null collections. Everything downstream (grouping,
 * filtering, sorting) assumes normalized tasks.
 */
export function normalizeTask(row) {
  if (!row) return row;
  const status = normalizeStatus(row.status, row.done);
  return {
    ...row,
    status,
    done: status === 'completed',
    priority: normalizePriority(row.priority),
    title: row.title || '',
    notes: row.notes || '',
    due_date: row.due_date || null,
    is_hard: !!row.is_hard,
    // The planning fields, read defensively for the same reason as the rest:
    // rows written before /today existed carry none of them.
    planned_date: row.planned_date || null,
    daily_priority: normalizeDailyPriority(row.daily_priority),
    estimated_minutes: normalizeEstimate(row.estimated_minutes),
    scheduled_start: clockToMinutes(row.scheduled_start) === null
      ? null
      : minutesToClock(clockToMinutes(row.scheduled_start)),
    scheduled_minutes: normalizeEstimate(row.scheduled_minutes),
    // The tag its block is drawn in: a Google event label id, or null for the
    // ordinary "no tag" (see lib/googleEvents). Empty string is not a tag.
    google_label_id: row.google_label_id || null,
    subtasks: Array.isArray(row.subtasks) ? row.subtasks : [],
    position: row.position ?? 0,
  };
}

export function normalizeTasks(rows) {
  return Array.isArray(rows) ? rows.map(normalizeTask) : [];
}

/**
 * The column values a status change implies. Kept here (not in the route) so the
 * optimistic client update and the server write can't drift: `done` is a mirror
 * of status for legacy readers, and `completed_at` stamps when it landed.
 */
export function statusPatch(status, now = new Date()) {
  const key = normalizeStatus(status);
  return {
    status: key,
    done: key === 'completed',
    completed_at: key === 'completed' ? now.toISOString() : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────────────────────

export function daysBetween(fromIso, toIso) {
  const a = fromISODate(fromIso);
  const b = fromISODate(toIso);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** An open task whose due date has passed. Completed work is never overdue. */
export function isOverdue(task, today = todayISO()) {
  return !!task?.due_date && !isDone(task) && task.due_date < today;
}

/**
 * OWED TODAY: the deadline has ARRIVED — due today, or due on a day that has
 * been and gone — and you have not deliberately parked the task on a LATER day.
 *
 * This is the whole membership rule for today's plan, and it lives here, beside
 * `isOverdue`, because /today reads it to decide what is on the day and the
 * seed reads it to decide what to write. Two readers, one definition, so the
 * page can never show a day the seed disagrees with.
 *
 * The one exception is a plan for the FUTURE. If you moved something owed today
 * onto Thursday on purpose, that is a decision, and dragging it back would undo
 * it; it becomes owed again on Thursday, when it is also planned, and lands on
 * the day then. A plan for a day already PAST is not an exception — that day is
 * over and the plan failed, so work you still owe comes forward rather than
 * sitting on a date nobody will look at again.
 */
export function isOwedToday(task, today = todayISO()) {
  if (!task || isDone(task)) return false;
  if (!task.due_date || task.due_date > today) return false;
  return !(task.planned_date && task.planned_date > today);
}

/*
  A date's colour is how much time is left, on a traffic light anyone reads
  without a legend:

    red     past due, or 2 days out or less. It needs you now
    amber   3 to 5 days. It's on the horizon
    green   more than 5 days. There is room
    grey    the task is done; the date is history, not a deadline

  One threshold table, so "amber" means the same number of days wherever you
  meet a date in this app.
*/
export const DATE_URGENT_DAYS = 2;
export const DATE_SOON_DAYS = 5;

/**
 * How a date should read on a card: "Today", "Tomorrow", "3d late", "Aug 22",
 * plus the absolute date (`abs`) for the tooltip. `tone` drives the colour so
 * no view has to recompute what counts as late.
 */
export function dateMeta(iso, today = todayISO(), { done = false } = {}) {
  if (!iso) return null;
  const delta = daysBetween(today, iso);
  const d = fromISODate(iso);
  const abs = d ? `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}` : iso;
  if (delta === null) return { label: iso, abs: iso, tone: 'clear', delta: null };
  if (done) return { label: abs, abs, tone: 'muted', delta };
  if (delta < 0) return { label: `${Math.abs(delta)}d late`, abs, tone: 'late', delta };

  const tone = delta <= DATE_URGENT_DAYS ? 'urgent' : delta <= DATE_SOON_DAYS ? 'soon' : 'clear';
  if (delta === 0) return { label: 'Today', abs, tone, delta };
  if (delta === 1) return { label: 'Tomorrow', abs, tone, delta };
  if (delta <= 6) return { label: `${delta}d`, abs, tone, delta };
  return { label: abs, abs, tone, delta };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lists (app_settings `task_lists` + tasks.list_id)
// ─────────────────────────────────────────────────────────────────────────────

/*
  A list is one body of work: Personal, Work, Someday. Exactly one is open at a
  time, so the page never mixes two lists together, and every write lands in the
  one you are looking at.

  This is AlphaOS's "teams" mechanism with the roster taken out: with a single
  login there is nobody to put on a team, so a list is a name and an id and
  nothing else.
*/

export const DEFAULT_LISTS = [{ id: 'default', name: 'Personal', group: null }];

/*
  A task points at its list by id, and a list is a row in a JSON blob rather
  than a table — so there is no foreign key to stop a task outliving the list it
  named. Deleting a list takes its tasks with it, but a task moved by hand in
  the Supabase editor, or a blob half-written by an older release, can still
  arrive pointing at nothing.

  It has to draw anyway. This is what it draws as, defined once here rather than
  invented separately by everything that groups or colours by list.
*/
export const UNKNOWN_LIST = { id: null, name: 'Other', color: '#94a3b8' };

/*
  A GROUP is a folder of lists, and the only thing it does is fold: "School"
  holds one list per class, and the switcher shows the word School until you
  open it. It carries no tasks of its own, because a task already belongs to a
  list and a second place to put one is a second place to lose one.

  Membership is a field on the list (`group`), not a nested array, so the lists
  stay ONE flat ordered array. That array is also the manual order: the tree the
  switcher draws is ungrouped lists first, then each group in its own order,
  each holding its lists in the order they sit in the array. Dragging rewrites
  the array, and nothing has to keep two orderings in agreement.

  A list whose group no longer exists comes back ungrouped rather than
  disappearing into a folder that isn't drawn.
*/

/*
  An `activeListId` that no longer names a list falls back to the first one, so
  a deleted list can never strand the page on something that isn't there.
*/
export function resolveListsPayload(payload) {
  const groups = (Array.isArray(payload?.groups) ? payload.groups : [])
    .filter(g => g && g.id)
    .map(g => ({ id: g.id, name: g.name || 'Untitled group' }));
  const groupIds = new Set(groups.map(g => g.id));

  const lists = Array.isArray(payload?.lists) && payload.lists.length > 0
    ? payload.lists
    : DEFAULT_LISTS;
  const normalized = lists.map(l => ({
    id: l.id,
    name: l.name || 'Untitled list',
    group: groupIds.has(l.group) ? l.group : null,
  }));
  const activeId = payload?.activeListId;
  return {
    lists: normalized,
    groups,
    activeListId: normalized.some(l => l.id === activeId) ? activeId : normalized[0].id,
  };
}

export function createList(lists, name, group = null, now = Date.now) {
  const id = `list_${now()}`;
  return { lists: [...lists, { id, name, group: group || null }], activeListId: id };
}

export function renameList(lists, id, name) {
  return lists.map(list => list.id === id ? { ...list, name } : list);
}

export function removeList(lists, activeListId, id) {
  const remaining = lists.filter(list => list.id !== id);
  if (remaining.length === 0) return null; // never leave the page with no list
  return {
    lists: remaining,
    activeListId: activeListId === id ? remaining[0].id : activeListId,
  };
}

export function createGroup(groups, name, now = Date.now) {
  const id = `group_${now()}`;
  return { groups: [...groups, { id, name }], id };
}

export function renameGroup(groups, id, name) {
  return groups.map(group => group.id === id ? { ...group, name } : group);
}

/**
 * Deleting a group deletes the folder, never the work in it: its lists come
 * back out to the top level, in the order they were in.
 */
export function removeGroup(lists, groups, id) {
  return {
    groups: groups.filter(group => group.id !== id),
    lists: lists.map(list => list.group === id ? { ...list, group: null } : list),
  };
}

/**
 * Put a list in a group (or take it out of one with `null`). It lands at the
 * end of that group's run, which is where the switcher draws it.
 *
 * A group with nothing in it yet has no run to land at the end of, and index 0
 * is the wrong answer: the list would sit silently at the front of the flat
 * array and reappear at the top of the menu the day you take it back out. The
 * end of the array is where a list with no neighbours belongs.
 */
export function moveListToGroup(lists, id, group) {
  const moving = lists.find(list => list.id === id);
  if (!moving || (moving.group ?? null) === (group ?? null)) return lists;

  const rest = lists.filter(list => list.id !== id);
  const last = rest.map(l => l.group ?? null).lastIndexOf(group ?? null);
  const next = [...rest];
  next.splice(last >= 0 ? last + 1 : rest.length, 0, { ...moving, group: group ?? null });
  return next;
}

/**
 * A drag: drop `draggedId` where `overId` sits. Landing on a list in another
 * group joins that group, because the row you dropped onto is the answer to
 * both "where in the order" and "in which folder" at once.
 */
export function reorderLists(lists, draggedId, overId) {
  if (draggedId === overId) return lists;
  const from = lists.findIndex(list => list.id === draggedId);
  const to = lists.findIndex(list => list.id === overId);
  if (from < 0 || to < 0) return lists;

  const next = [...lists];
  const [moved] = next.splice(from, 1);
  const target = next.findIndex(list => list.id === overId);
  next.splice(from < to ? target + 1 : target, 0, { ...moved, group: lists[to].group ?? null });
  return next;
}

/**
 * What the switcher draws: the loose lists, then the folders. Both keep the
 * order the flat array puts them in, so there is one thing to reorder.
 */
export function listTree(lists, groups = []) {
  return {
    ungrouped: lists.filter(list => !list.group),
    sections: groups.map(group => ({
      ...group,
      lists: lists.filter(list => list.group === group.id),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtering, grouping, ordering
// ─────────────────────────────────────────────────────────────────────────────

export const EMPTY_FILTERS = {
  status: null,      // status key, null = any (completed still hidden by showCompleted)
  priority: null,
  query: '',
  showCompleted: false,
};

/**
 * Everything the views filter by, in one place. `showCompleted` is separate
 * from an explicit status filter: asking for "completed" always shows them.
 */
export function filterTasks(tasks, filters = {}) {
  const f = { ...EMPTY_FILTERS, ...filters };
  const q = f.query.trim().toLowerCase();
  return tasks.filter(task => {
    if (f.status && task.status !== f.status) return false;
    if (!f.showCompleted && f.status !== 'completed' && task.status === 'completed') return false;
    if (f.priority && task.priority !== f.priority) return false;
    if (q) {
      const hay = `${task.title} ${task.notes}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Default order inside any group: open before done, then priority, then the
 * soonest due date (undated last), then the manual `position`.
 */
export function compareTasks(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const pa = PRIORITY_RANK[a.priority] ?? 9;
  const pb = PRIORITY_RANK[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  const da = a.due_date || '9999-12-31';
  const db = b.due_date || '9999-12-31';
  if (da !== db) return da < db ? -1 : 1;
  return (a.position ?? 0) - (b.position ?? 0);
}

/**
 * Deadline order: the same rules with the top two swapped, so the soonest date
 * leads and priority only settles a tie.
 *
 * Undated work sorts LAST rather than first. A task with no date is not due in
 * the year 9999; it is a thing with no deadline at all, and the whole point of
 * reading a list this way is to see what is closing in — which puts "no date"
 * at the bottom, where you look when the dated work is done.
 *
 * Finished tasks still sink first, before the dates are read: a deadline you
 * have already met is not a deadline, and a list that opened with last week's
 * completed work at the top would be answering a different question.
 */
export function compareByDueDate(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const da = a.due_date || '9999-12-31';
  const db = b.due_date || '9999-12-31';
  if (da !== db) return da < db ? -1 : 1;
  const pa = PRIORITY_RANK[a.priority] ?? 9;
  const pb = PRIORITY_RANK[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  return (a.position ?? 0) - (b.position ?? 0);
}

/** Manual order: what drag & drop maintains inside a status column. */
export function compareByPosition(a, b) {
  return (a.position ?? 0) - (b.position ?? 0) || compareTasks(a, b);
}

/*
  WHICH ORDER YOUR WORK READS IN, as a choice rather than a constant.

  Both orders use all the same facts and disagree only about which one leads,
  because they answer two different questions people genuinely alternate
  between: "what matters most" and "what is due first". Anything more than those
  two would be a menu of ways to sort a list rather than a way to read one.

  Grouping is left alone by this: sections and columns are MEMBERSHIP, this is
  the order inside them, so "by list, soonest first" is a sentence you can say.

  ONE CHOICE, TWO VIEWS, and the default means something different in each —
  which is not a fudge, it is what "the order I have not asked to change" IS in
  each of them. The list has never had a manual order to keep, so its default is
  priority; a board column is in the order you dragged its cards into, and
  calling that "by priority" would be a lie about your own arrangement. So the
  key is the same, the comparator is not, and each view names it in its own
  words (`taskSort` / `boardSort`).
*/
export const SORT_BY = [
  { key: 'priority', label: 'Priority' },
  { key: 'due', label: 'Due date' },
];

/** The list's comparator for an order key. Anything unknown is the default. */
export function taskSort(key) {
  return key === 'due' ? compareByDueDate : compareTasks;
}

/**
 * The board's, where the default is the order you dragged the cards into.
 *
 * Choosing one takes manual ordering away for as long as it is on, exactly as
 * grouping a column already does: a drop that the next render would undo is
 * worse than a drop that does not move. The card still crosses into another
 * status — that is a field on the task, not a place in a list.
 */
export function boardSort(key) {
  return key === 'due' ? compareByDueDate : compareByPosition;
}

export const GROUP_BY = [
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'list', label: 'List' },
];

/**
 * Split tasks into rendered sections, each already in order.
 *
 * `sort` is `compareTasks` by default, which is what makes every section read
 * the same way: finished work sinks, then urgent above high above medium above
 * low, then the soonest deadline, then whatever you dragged. So "group by list"
 * is exactly "all of one project together, its most important work at the top",
 * with no second ordering rule to define.
 *
 * WHICH SECTIONS EXIST is the one place the three groupings disagree, and it
 * comes down to whether an empty one is worth drawing.
 *
 *   status, priority  ALWAYS all of them. An empty column is information:
 *                     "nothing is in review" is a fact about your week, and a
 *                     Completed heading with nothing under it is the difference
 *                     between a quiet day and a day you did not look at.
 *   list              only the ones with something in them (`alwaysShow:
 *                     false`). There are four statuses and four priorities and
 *                     there may be thirty lists — a page opening with
 *                     twenty-six empty headings is not information, it is a
 *                     thing to scroll past. Which list you HAVE is a question
 *                     the switcher answers.
 *
 * `lists` is the list metadata, `[{ id, name, color }]`, in the order you keep
 * them — passed in rather than derived, so this file never has to know how a
 * list comes by its colour. A task pointing at a list that has been deleted
 * still has to draw, so anything left over lands in one trailing section.
 */
export function groupTasks(tasks, groupBy, { sort = compareTasks, lists = [] } = {}) {
  const sorted = [...tasks].sort(sort);

  if (groupBy === 'list') {
    const known = new Set();
    const sections = lists.map((list) => {
      known.add(list.id);
      return {
        key: list.id,
        label: list.name || 'Untitled list',
        color: list.color,
        alwaysShow: false,
        tasks: sorted.filter(task => task.list_id === list.id),
      };
    });

    const orphans = sorted.filter(task => !known.has(task.list_id));
    if (orphans.length > 0) {
      sections.push({
        key: '__other__',
        label: UNKNOWN_LIST.name,
        color: UNKNOWN_LIST.color,
        alwaysShow: false,
        tasks: orphans,
      });
    }
    return sections;
  }

  if (groupBy === 'priority') {
    return PRIORITIES.map(p => ({
      key: p.key,
      label: p.label,
      color: p.color,
      tasks: sorted.filter(t => t.priority === p.key),
    }));
  }
  return STATUSES.map(s => ({
    key: s.key,
    label: s.label,
    color: s.color,
    tasks: sorted.filter(t => t.status === s.key),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The header strip: how much is open, what's late, how much of it is hard, and
 * what landed this week. Deliberately computed from the SAME filtered list the
 * view renders, so the numbers always describe what you're looking at.
 */
export function taskSummary(tasks, today = todayISO()) {
  const byStatus = Object.fromEntries(STATUS_KEYS.map(k => [k, 0]));
  let overdue = 0;
  let dueToday = 0;
  let hard = 0;
  let completedRecently = 0;

  for (const task of tasks) {
    byStatus[task.status] = (byStatus[task.status] || 0) + 1;
    if (isOverdue(task, today)) overdue += 1;
    if (!task.done && task.due_date === today) dueToday += 1;
    if (!task.done && task.is_hard) hard += 1;
    if (task.done && task.completed_at) {
      const days = daysBetween(String(task.completed_at).slice(0, 10), today);
      if (days !== null && days >= 0 && days <= 7) completedRecently += 1;
    }
  }

  const open = tasks.length - byStatus.completed;
  return { total: tasks.length, open, byStatus, overdue, dueToday, hard, completedRecently };
}

// ─────────────────────────────────────────────────────────────────────────────
// Clustering inside a board column
// ─────────────────────────────────────────────────────────────────────────────

/*
  The board's columns are ALWAYS the four statuses, which is what a board is for
  and the one axis a drag can meaningfully change. Grouping on the board works
  inside a column instead: it gathers a column's cards into runs, so the urgent
  work sits at the top of the column rather than wherever it was dropped.

  This is ordering, not membership. Nothing moves between columns and no field is
  written; a run is just where a card is drawn.
*/
export const CLUSTER_BY = [
  { key: 'priority', label: 'Priority' },
];

/**
 * A column's tasks, gathered into runs: [{ key, label, color, tasks }].
 * Without a `clusterBy` you get one unlabelled run: the plain column.
 *
 * Runs are ordered by what the axis means, which for priority IS the order:
 * most urgent first. Inside a run, the manual order the board maintains is
 * preserved.
 */
export function clusterTasks(tasks, clusterBy, { sort = compareByPosition } = {}) {
  const sorted = [...tasks].sort(sort);
  if (!clusterBy) return [{ key: null, label: null, color: null, tasks: sorted }];

  const runs = new Map();
  for (const task of sorted) {
    const key = task.priority;
    if (!runs.has(key)) runs.set(key, []);
    runs.get(key).push(task);
  }

  return [...runs.entries()]
    .sort((a, b) => (PRIORITY_RANK[a[0]] ?? 9) - (PRIORITY_RANK[b[0]] ?? 9))
    .map(([key, list]) => ({
      key,
      label: priorityMeta(key).label,
      color: priorityMeta(key).color,
      tasks: list,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Drag & drop (board layout: columns are statuses)
// ─────────────────────────────────────────────────────────────────────────────

export function isColumnId(id) {
  return typeof id === 'string' && id.startsWith('col-');
}

export function statusFromColumnId(id) {
  return isColumnId(id) ? id.slice(4) : null;
}

export function columnId(status) {
  return `col-${status}`;
}

/** Which status column an id belongs to (a column id, or the task's status). */
export function findColumn(tasks, id) {
  return statusFromColumnId(id) || tasks.find(task => task.id === id)?.status || null;
}

function reindex(tasks, statuses) {
  const counters = {};
  return tasks.map(task => {
    if (!statuses.has(task.status)) return task;
    counters[task.status] = counters[task.status] ?? 0;
    return { ...task, position: counters[task.status]++ };
  });
}

/**
 * Cross-column move during a drag (status changes as the card crosses over).
 */
export function moveTaskToStatus(tasks, activeId, overId) {
  const from = findColumn(tasks, activeId);
  const to = findColumn(tasks, overId);
  if (!from || !to || from === to) return { tasks };

  const activeTask = tasks.find(task => task.id === activeId);
  if (!activeTask) return { tasks };

  const targetTasks = tasks.filter(task => task.status === to);
  let insertIdx = targetTasks.length;
  if (!isColumnId(overId)) {
    const idx = targetTasks.findIndex(task => task.id === overId);
    if (idx !== -1) insertIdx = idx;
  }

  const next = tasks.filter(task => task.id !== activeId).map(task => ({ ...task }));
  const moved = { ...activeTask, ...statusPatch(to) };

  if (insertIdx >= targetTasks.length) {
    const lastTarget = targetTasks[targetTasks.length - 1];
    const globalIdx = lastTarget ? next.findIndex(task => task.id === lastTarget.id) + 1 : next.length;
    next.splice(globalIdx, 0, moved);
  } else {
    const globalIdx = next.findIndex(task => task.id === targetTasks[insertIdx].id);
    next.splice(globalIdx, 0, moved);
  }

  return { tasks: reindex(next, new Set([from, to])) };
}

function arrayMoveLocal(items, oldIndex, newIndex) {
  const next = [...items];
  const [moved] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, moved);
  return next;
}

function statusOrderSort(a, b) {
  const sa = STATUS_KEYS.indexOf(a.status);
  const sb = STATUS_KEYS.indexOf(b.status);
  if (sa !== sb) return sa - sb;
  return (a.position ?? 0) - (b.position ?? 0);
}

/**
 * End of a drag: settle same-column ordering and work out the minimal set of
 * rows to persist ({ id, position, status? }; status carries `done` and
 * `completed_at` alongside it, applied by the caller through statusPatch).
 */
export function finalizeTaskDrag(currentTasks, snapshot, activeId, overId) {
  if (!overId || !snapshot) {
    return { tasks: snapshot || currentTasks, itemsToSave: [], shouldRevert: !!snapshot };
  }

  const activeStatus = currentTasks.find(task => task.id === activeId)?.status;
  if (!activeStatus) return { tasks: currentTasks, itemsToSave: [] };

  const original = snapshot.find(task => task.id === activeId);
  const crossColumn = original && original.status !== activeStatus;

  if (isColumnId(overId) || crossColumn) {
    const itemsToSave = currentTasks
      .filter(task => {
        const orig = snapshot.find(item => item.id === task.id);
        return !orig || orig.position !== task.position || orig.status !== task.status;
      })
      .map(task => {
        const orig = snapshot.find(item => item.id === task.id);
        const item = { id: task.id, position: task.position };
        if (orig && orig.status !== task.status) Object.assign(item, statusPatch(task.status));
        return item;
      });
    return { tasks: currentTasks, itemsToSave };
  }

  const overTask = currentTasks.find(task => task.id === overId);
  if (!overTask || overTask.status !== activeStatus) {
    return { tasks: currentTasks, itemsToSave: [] };
  }

  const columnTasks = currentTasks.filter(task => task.status === activeStatus);
  const oldIdx = columnTasks.findIndex(task => task.id === activeId);
  const newIdx = columnTasks.findIndex(task => task.id === overId);
  if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) {
    return { tasks: currentTasks, itemsToSave: [] };
  }

  const reordered = arrayMoveLocal(columnTasks, oldIdx, newIdx).map((task, index) => ({ ...task, position: index }));
  const others = currentTasks.filter(task => task.status !== activeStatus);
  const tasks = [...others, ...reordered].sort(statusOrderSort);
  const itemsToSave = reordered
    .filter(task => {
      const orig = snapshot.find(item => item.id === task.id);
      return !orig || orig.position !== task.position;
    })
    .map(task => ({ id: task.id, position: task.position }));

  return { tasks, itemsToSave };
}

// ─────────────────────────────────────────────────────────────────────────────
// Subtasks (a checklist inside a task: unchanged shape, JSONB on the row)
// ─────────────────────────────────────────────────────────────────────────────

export function createSubtask(title, now = Date.now) {
  return { id: now(), title, done: false };
}

export function addSubtask(subtasks, title, now = Date.now) {
  return [...subtasks, createSubtask(title, now)];
}

export function updateSubtask(subtasks, subtaskId, updates) {
  return subtasks.map(sub => sub.id === subtaskId ? { ...sub, ...updates } : sub);
}

export function toggleSubtask(subtasks, subtaskId) {
  return subtasks.map(sub => sub.id === subtaskId ? { ...sub, done: !sub.done } : sub);
}

export function removeSubtask(subtasks, subtaskId) {
  return subtasks.filter(sub => sub.id !== subtaskId);
}

export function subtaskProgress(subtasks = []) {
  const total = subtasks.length;
  const done = subtasks.filter(s => s.done).length;
  return { done, total, complete: total > 0 && done === total };
}
