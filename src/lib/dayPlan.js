/*
  HOW A DAY GETS PLANNED: four steps, in one order, once per day.

  The old /today put every part of planning on one screen at once — the plan,
  what was shouting, everything you could add, and the timeline — and left you
  to work out which of them you were supposed to be looking at. Four panels
  visible at all times is not four steps; it is one wall.

  So planning is a FLOW, and this file is the whole of its model:

    1. PLAN       what is on today. It opens with everything you already owe —
                  due today, or due on a day that has been and gone — because
                  a deadline that has arrived is not a decision you need to be
                  asked about; everything after that is.
    2. COMING UP  what else is asking (due tomorrow, hard or important within
                  the week — see `attention` in lib/agenda). You add what is
                  yours today, one at a time. Nothing LATE is in here: an
                  arrived deadline is step 1's business, not a preview.
    3. PROJECTS   everything else you own, by the project it lives in,
                  searchable. The step for the work that is not shouting.
    4. CALENDAR   when each of them is happening.

  Then the day is FINALIZED and /today stops being a form: it becomes the
  finished day — the calendar, and the day's work beside it in priority order —
  and stays that way until tomorrow, or until you re-open the flow yourself.

  The state is per-day and tiny: which step you are on, and whether you are
  finished. It lives in app_settings under `day_plans` (see /api/day-plan)
  rather than in localStorage, so opening the app on the phone after planning on
  the laptop does not ask you to plan again.

  Pure functions only, the same contract as lib/tasks.js and lib/agenda.js.
*/

import { addDaysISO, todayISO } from './dates.js';
import { isOwedToday } from './tasks.js';

/*
  The steps, in the only order they make sense in.

  `label` is the word on the rail, so it has to survive being read sideways at
  eleven pixels; `question` is the heading, and it is a QUESTION rather than a
  noun because you are answering something at each step and the heading should
  say what. `hint` is the rule underneath it, in one sentence — the steps whose
  contents are decided by rules (Attention, above all) are unusable if you have
  to guess what got in.
*/
export const PLAN_STEPS = [
  {
    key: 'plan',
    label: 'Today',
    question: 'What are you finishing today?',
    hint: 'Everything you owe — due today, or already late — is here. Add, drop, or move things between must-do and optional.',
  },
  {
    key: 'attention',
    label: 'Coming Up',
    question: 'What else is asking for today?',
    hint: 'Due tomorrow, or hard or high priority within the week. Anything late is already on today.',
  },
  {
    key: 'projects',
    label: 'Projects',
    question: 'Anything else you want to get to?',
    hint: 'Every open task you own, by the project it lives in. Search it, and add what belongs to today.',
  },
  {
    key: 'calendar',
    label: 'Calendar',
    question: 'When is each of these happening?',
    hint: 'Drag a task onto the hour you mean to do it, or use Schedule. A task can stay unplaced.',
  },
];

export const PLAN_STEP_KEYS = PLAN_STEPS.map(step => step.key);
export const FIRST_STEP = PLAN_STEP_KEYS[0];
export const LAST_STEP = PLAN_STEP_KEYS[PLAN_STEP_KEYS.length - 1];

export function stepIndex(key) {
  const i = PLAN_STEP_KEYS.indexOf(key);
  return i === -1 ? 0 : i;
}

export function nextStepKey(key) {
  return PLAN_STEP_KEYS[Math.min(stepIndex(key) + 1, PLAN_STEP_KEYS.length - 1)];
}

export function prevStepKey(key) {
  return PLAN_STEP_KEYS[Math.max(stepIndex(key) - 1, 0)];
}

/*
  One day's planning state.

    step       which of the four you are on. Meaningless once finalized, but
               kept, so re-opening a finished day puts you back where you were
               rather than at the start of a form you already filled in.
    finalized  the flow is done and /today draws the finished day.

  There is deliberately NO record here of what the seed has already done, and
  that absence is the fix for two bugs in a row. The first version stored a
  `seeded` boolean, so anything that became due today after you first opened the
  page never arrived. The second stored the ids you had taken back off, so
  putting a task's due date back to today could not bring it back either — the
  day still remembered a no you had since changed your mind about, and nothing
  on screen said so.

  The state that decides the day's contents lives on the TASKS, where you can
  see it and change it: owed (due today or on a day already past) and not
  planned elsewhere means on today, full stop. Taking a task off today clears an
  arrived due date with it (see
  `removeFromToday`), which is what makes the answer stick, and is also what
  makes it reversible — set the date to today again and so is the task.
*/
export const EMPTY_DAY_PLAN = { step: FIRST_STEP, finalized: false };

export function normalizeDayPlan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_DAY_PLAN };
  return {
    step: PLAN_STEP_KEYS.includes(raw.step) ? raw.step : FIRST_STEP,
    finalized: !!raw.finalized,
  };
}

/**
 * What the day is CARRYING that has not been written down yet: everything owed
 * today (see `isOwedToday` in lib/tasks) that is not already stamped with
 * today's date.
 *
 * This is not what decides the contents of the day — `plannedDay` in lib/agenda
 * does that, from the same predicate, at read time, so an owed task is on today
 * the instant its due date says so. This is the WRITE that catches the column
 * up: a real `planned_date` is what lets a task be given a time on the
 * calendar, reordered inside the day, and taken back off it.
 *
 * That split is the fix for a whole family of bugs that all had the same shape.
 * When the write WAS the day, a due date changed to today on /tasks did not
 * appear on /today until a round trip had completed; a write that failed (an
 * older database with no `planned_date`, a dropped connection) produced a day
 * with your deadlines silently missing from it; and a task still stamped with
 * LAST Tuesday was owed, was not planned for today, and so appeared nowhere.
 * Now the worst a failed write can do is leave a task unschedulable for the
 * session. It cannot make the day wrong.
 *
 * LATE COUNTS AS OWED. A deadline that passed is not less of a deadline than
 * one landing this morning — it is more of one — so parking it in Coming up,
 * one step away from the day, put the most overdue work in the one place you
 * had to go looking for it. And a task carrying a PAST planned_date is picked
 * up here rather than skipped: that day is over, so the stamp is stale, and it
 * is rewritten to today.
 *
 * It runs continuously rather than once per day, because "owed" is not a fact
 * that is settled the first time you open the page: a task written at eleven, a
 * due date moved to today from /tasks, a row synced from another device, or
 * simply a due date that went past while the tab sat open. Nothing remembers
 * what the seed has already done — see EMPTY_DAY_PLAN.
 */
export function owedTodaySeed(tasks, today = todayISO()) {
  return tasks.filter(task => isOwedToday(task, today) && task.planned_date !== today);
}

/*
  What is NOT carried over is yesterday's UNDATED leftovers — the things you
  planned for a day and did not finish. A day that inherits every leftover is a
  day you did not plan, and by Thursday it is just the backlog wearing today's
  date. Only a DEADLINE brings work forward by itself, because only a deadline
  is a fact rather than a plan you already changed your mind about once.
*/

/** How much of the past `day_plans` keeps. Same window as the day's events. */
export const PLAN_PRUNE_DAYS = 30;

/**
 * The other days worth keeping, when writing `date`.
 *
 * It drops three things: anything older than the window, anything whose key is
 * not a date at all, and `date` ITSELF — the caller is about to write that one
 * and re-adding it here would just be the old value in the way. Pruning is
 * measured from the day being written rather than from the server's clock, so a
 * box in another timezone can never drop the day you are editing.
 */
export function prunePlans(blob, date, days = PLAN_PRUNE_DAYS) {
  const all = blob && typeof blob === 'object' && !Array.isArray(blob) ? blob : {};
  const cutoff = addDaysISO(date, -days);
  const next = {};
  for (const [key, value] of Object.entries(all)) {
    if (key === date || !/^\d{4}-\d{2}-\d{2}$/.test(key) || key < cutoff) continue;
    next[key] = value;
  }
  return next;
}
