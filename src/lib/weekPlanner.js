// Pure helpers behind the Week layout of /tasks: a Mon–Sun planner grid that
// buckets the visible tasks by their `due_date`. Kept side-effect free (native
// Date only, no libraries) so the date math is easy to reason about and test,
// mirroring the pure-helper style of lib/tasks.js.

import { MONTH_NAMES, WEEKDAY_NAMES, toISODate, todayISO } from './dates.js';
import { compareTasks } from './tasks.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export { toISODate, todayISO };

// Monday 00:00 of the week containing `date` (weeks are Mon–Sun).
export function startOfWeek(date = new Date()) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();               // 0=Sun … 6=Sat
  const diff = (day + 6) % 7;           // days since Monday
  d.setDate(d.getDate() - diff);
  return d;
}

export function addWeeks(weekStart, n) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + n * 7);
  return startOfWeek(d);
}

// The seven day descriptors for the week beginning `weekStart`.
export function getWeekDays(weekStart, now = new Date()) {
  const start = startOfWeek(weekStart);
  const today = todayISO(now);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getTime() + i * DAY_MS);
    const iso = toISODate(d);
    return {
      iso,
      date: d,
      dayName: WEEKDAY_NAMES[d.getDay()],
      dayNum: d.getDate(),
      monthName: MONTH_NAMES[d.getMonth()],
      isToday: iso === today,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    };
  });
}

// "Jul 13 - 19" or "Jun 30 - Jul 6" across a month boundary.
export function weekLabel(weekStart) {
  const days = getWeekDays(weekStart);
  const first = days[0];
  const last = days[6];
  if (first.monthName === last.monthName) {
    return `${first.monthName} ${first.dayNum} - ${last.dayNum}`;
  }
  return `${first.monthName} ${first.dayNum} - ${last.monthName} ${last.dayNum}`;
}

// Order within a day/bucket: the same rule the list and board layouts use, so
// a task's relative importance reads identically wherever you look at it.
export const plannerSort = compareTasks;

// Split the board's tasks into the buckets the Week view renders:
//   byDay:     { [iso]: task[] } for each of the seven visible days
//   backlog:   tasks with no due_date
//   overdue:   dated, incomplete, before today AND before the visible week
//              (only meaningful things the planner should nag you to reschedule)
//   scheduledOtherWeek: dated tasks that fall outside the visible week and
//              aren't overdue; surfaced only as a count so nothing silently
//              disappears when you page between weeks.
export function groupTasksForWeek(tasks, weekStart, now = new Date()) {
  const days = getWeekDays(weekStart, now);
  const weekIsos = new Set(days.map(d => d.iso));
  const firstIso = days[0].iso;
  const today = todayISO(now);

  const byDay = {};
  for (const iso of weekIsos) byDay[iso] = [];
  const backlog = [];
  const overdue = [];
  let scheduledOtherWeek = 0;

  for (const task of tasks) {
    const due = task.due_date || null;
    if (!due) {
      // Completed undated tasks are done and unscheduled, with nothing to plan, so
      // keep them out of the Backlog rather than cluttering it.
      if (!task.done) backlog.push(task);
      continue;
    }
    if (weekIsos.has(due)) {
      byDay[due].push(task);
      continue;
    }
    if (!task.done && due < today && due < firstIso) {
      overdue.push(task);
    } else {
      scheduledOtherWeek += 1;
    }
  }

  for (const iso of weekIsos) byDay[iso].sort(plannerSort);
  backlog.sort(plannerSort);
  overdue.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : plannerSort(a, b)));

  return { days, byDay, backlog, overdue, scheduledOtherWeek };
}

// ─────────────────────────────────────────────────────────────────────────────
// Month
// ─────────────────────────────────────────────────────────────────────────────

// Midnight on the 1st of the month containing `date`.
export function startOfMonth(date = new Date()) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

/*
  The month a WEEK belongs to: the one holding its Thursday, which is the ISO
  rule. A week that straddles a month boundary belongs to whichever month has
  most of it, and the Thursday is the cheap way to ask that.

  Taking the Monday instead files 31 Aug – 6 Sep under August, which is both
  wrong and invisible until the day a week straddles, so the calendar's zoom
  switch would look fine all month and then jump you two months back.
*/
export function monthOfWeek(weekStart) {
  const thursday = startOfWeek(weekStart);
  thursday.setDate(thursday.getDate() + 3);
  return startOfMonth(thursday);
}

/** Do these two dates fall in the same calendar month? */
export function sameMonth(a, b) {
  return startOfMonth(a).getTime() === startOfMonth(b).getTime();
}

export function addMonths(anchor, n) {
  const d = startOfMonth(anchor);
  d.setMonth(d.getMonth() + n);
  return d;
}

export function monthLabel(anchor) {
  const d = startOfMonth(anchor);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/*
  The month as whole Mon–Sun weeks: the grid starts on the Monday on or before
  the 1st and runs to the Sunday on or after the last, so every row is a real
  week and the columns stay under their weekday all the way down. Days spilling
  in from the neighbouring months are marked `isOtherMonth`; they're drawn
  faintly, but they take drops like any other day, because a task due on the 1st
  is a task you schedule from the last week of the month before.
*/
export function getMonthDays(anchor, now = new Date()) {
  const first = startOfMonth(anchor);
  const month = first.getMonth();
  const start = startOfWeek(first);
  const last = new Date(first.getFullYear(), month + 1, 0);
  const end = startOfWeek(last);
  const weeks = Math.round((end.getTime() - start.getTime()) / (7 * DAY_MS)) + 1;
  const today = todayISO(now);

  return Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(start.getTime() + i * DAY_MS);
    const iso = toISODate(d);
    return {
      iso,
      date: d,
      dayName: WEEKDAY_NAMES[d.getDay()],
      dayNum: d.getDate(),
      monthName: MONTH_NAMES[d.getMonth()],
      isToday: iso === today,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      isOtherMonth: d.getMonth() !== month,
      isFirstOfMonth: d.getDate() === 1,
    };
  });
}

/*
  The same split as the week, over a month's grid: what falls on each visible
  day, what has no date at all, and what is overdue and earlier than anything on
  screen. `scheduledOtherMonth` keeps the count of everything else, so paging
  never makes work look like it vanished.
*/
export function groupTasksForMonth(tasks, anchor, now = new Date()) {
  const days = getMonthDays(anchor, now);
  const isos = new Set(days.map(d => d.iso));
  const firstIso = days[0].iso;
  const today = todayISO(now);

  const byDay = {};
  for (const iso of isos) byDay[iso] = [];
  const backlog = [];
  const overdue = [];
  let scheduledOtherMonth = 0;

  for (const task of tasks) {
    const due = task.due_date || null;
    if (!due) {
      if (!task.done) backlog.push(task);
      continue;
    }
    if (isos.has(due)) {
      byDay[due].push(task);
      continue;
    }
    if (!task.done && due < today && due < firstIso) overdue.push(task);
    else scheduledOtherMonth += 1;
  }

  for (const iso of isos) byDay[iso].sort(plannerSort);
  backlog.sort(plannerSort);
  overdue.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : plannerSort(a, b)));

  return { days, byDay, backlog, overdue, scheduledOtherMonth };
}

// Translate a droppable container id back into the due_date it represents.
// `day-YYYY-MM-DD` → that ISO date; `backlog` → null (undated). Returns
// `undefined` for anything unrecognised so callers can ignore stray drops.
export function dueDateFromDropId(dropId) {
  if (dropId === 'backlog') return null;
  if (typeof dropId === 'string' && dropId.startsWith('day-')) {
    return dropId.slice(4);
  }
  return undefined;
}

export function dayDropId(iso) {
  return `day-${iso}`;
}
