/*
  /today's model: the day you chose, across every list.

  /tasks answers "what is in this list". This answers four questions, in the
  order you ask them when you open the app in the morning:

    1. WHAT AM I FINISHING TODAY?   `plannedDay().commitments` — the tasks on
       today, held as things you WILL finish; `plannedDay().optional` is the
       same day held more loosely.
    2. WHAT ELSE IS ASKING?         `attention` — owed tomorrow, or hard or
       important and owed within the week. Three rules and no fourth. Nothing
       LATE: an arrived deadline is already on the day above.
    3. WHAT COULD I ADD?            `taskCatalog` — everything open, by the
       project it lives in, searchable.
    4. WHEN AM I DOING EACH THING?  `dayTimeline` — the blocks you placed, plus
       the commitments the day already contains (class, lunch) that no task
       system put there.

  The distinction the whole file rests on: a task's LIST is where it lives, its
  STATUS is how far along it is, its DUE DATE is when it is owed, and its
  PLANNED DATE is when you decided to do it. Four independent facts. Planning
  something for today changes exactly one of them (see plannedPatch in
  lib/tasks.js), which is what lets the Today page be a plan rather than a
  second, competing copy of the task list.

  Pure functions only, the same contract as lib/tasks.js: the arrangement is
  testable without a database, a browser, or a clock that has to be a particular
  time of day, and the page only decides how it is drawn.
*/

import {
  DAY_ANCHOR_MINUTES, DAY_WINDOW_END,
  addDaysISO, clockToMinutes, dayClock, dayMinutes, snapUpMinutes, todayISO,
} from './dates.js';
import {
  DEFAULT_BLOCK_MINUTES, UNKNOWN_LIST, compareTasks, isOverdue, isOwedToday,
  normalizeDailyPriority, normalizeEstimate,
} from './tasks.js';
import { MAX_DESCRIPTION, normalizeExternals, normalizeLabelId } from './googleEvents.js';

// ─────────────────────────────────────────────────────────────────────────────
// Lists, as a colour
// ─────────────────────────────────────────────────────────────────────────────

/*
  On /tasks a list needs no label: you are inside one, and every row would say
  the same word. Here every row comes from somewhere different, so each list
  gets a colour to be scanned by and its name to be read by.

  The colour is positional, not hashed: the first list you made is always the
  first colour, so it doesn't change under you when you add another. They are
  deliberately none of the four status colours and none of the four priority
  colours: a list is a different question, and it should not look like an
  answer to those.
*/
export const LIST_COLORS = [
  '#0ea5e9', // sky
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#ec4899', // pink
  '#14b8a6', // teal
  '#6366f1', // indigo
  '#a855f7', // purple
  '#0891b2', // cyan
];

/** id → { id, name, color }, in the order the lists were created. */
export function listIndex(lists = []) {
  const index = new Map();
  lists.forEach((list, i) => {
    index.set(list.id, {
      id: list.id,
      name: list.name || 'Untitled list',
      color: LIST_COLORS[i % LIST_COLORS.length],
    });
  });
  return index;
}

export function listOf(index, listId) {
  return index.get(listId) || { ...UNKNOWN_LIST, id: listId };
}

/*
  Re-exported, not redefined. The fallback list is part of the task MODEL — a
  task can outlive the list it names, however you happen to be drawing it — so
  it lives in lib/tasks.js beside the rest of the list model, where `groupTasks`
  can reach it without importing this file back. It is still named here because
  this is where you come looking for what a list looks like.
*/
export { UNKNOWN_LIST };

// ─────────────────────────────────────────────────────────────────────────────
// The planned day
// ─────────────────────────────────────────────────────────────────────────────

/*
  A planned task sorts by when you said you would do it, and everything with no
  time on it sorts after everything that has one. Inside each of those, the
  ordinary task order (priority, then due date) applies.

  So the section reads top to bottom as the day actually runs: the 9am block,
  the 11am block, then the work you are doing today at no particular time.
*/
export function compareByPlan(a, b) {
  // Placed on the 4am day, so the 1am block sorts after the 11pm one instead of
  // leading the morning. See `dayMinutes` in lib/dates.
  const sa = dayMinutes(a.scheduled_start);
  const sb = dayMinutes(b.scheduled_start);
  if (sa !== null && sb !== null && sa !== sb) return sa - sb;
  if (sa !== null && sb === null) return -1;
  if (sa === null && sb !== null) return 1;
  return compareTasks(a, b);
}

/*
  WHAT IS ON TODAY, and why it is worked out here rather than looked up.

  There are two ways onto the day and they are not the same kind of fact:

    CHOSEN   `planned_date === today`. You put it there, from any of the four
             steps, and it stays until you take it off.
    OWED     the deadline has arrived — due today, or already late. Nobody has
             to put it there and nobody should have to: see `isOwedToday`.

  The second half used to be a WRITE. /today ran a seed on mount that stamped
  `planned_date = today` onto everything owed, and the day was then read back
  out of that column — so the day was only right if a round trip had succeeded.
  Everything that could go wrong with that did: a due date set to today on
  /tasks showed up on today only after the seed had run and come back; a failed
  write (or a database missing the column) silently produced a day with your
  deadlines missing from it and nothing on screen to say so; and a task left
  planned on a day that had already passed was owed, unplanned-for-today, and
  therefore nowhere at all.

  So membership is DERIVED, here, from facts already on the task. The seed
  (lib/dayPlan) still runs, but it is now only PERSISTENCE — it gives an owed
  task a real planned_date so it can be scheduled, reordered and taken off — and
  the page no longer waits on it to draw the right day. If every write on earth
  failed, today would still contain everything you owe.

  Split into the two halves you chose it in:

    commitments  open, must_do: what you are saying you will finish. Anything
                 owed lands here until you say otherwise, because
                 DEFAULT_DAILY_PRIORITY is must_do — a deadline is a commitment
                 by default, and "if there's time" is the thing you opt into.
    optional     open, "if there's time".
    done         planned for the day and finished. Only what was actually ON the
                 day: a day you cleared is not the same as a day you never
                 planned, and the receipt is half of what the page is for. Owed
                 work you finished from /tasks without ever planning it is not
                 back-dated onto today's receipt.

  `estimatedMinutes` is the work still AHEAD of you (the open half), because
  that is the number you are checking the day against; `unestimated` is how many
  of those carry no estimate at all, which is what stops the total from quietly
  reading as smaller than the day really is.
*/
export function plannedDay(tasks, today = todayISO()) {
  const open = tasks
    .filter(task => !task.done && (task.planned_date === today || isOwedToday(task, today)))
    .sort(compareByPlan);

  const commitments = open.filter(task => normalizeDailyPriority(task.daily_priority) === 'must_do');
  const optional = open.filter(task => normalizeDailyPriority(task.daily_priority) === 'optional');
  const done = tasks
    .filter(task => task.done && task.planned_date === today)
    .sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1));

  let estimatedMinutes = 0;
  let unestimated = 0;
  for (const task of open) {
    const minutes = normalizeEstimate(task.estimated_minutes);
    if (minutes) estimatedMinutes += minutes;
    else unestimated += 1;
  }

  const planned = [...open, ...done];

  return {
    commitments,
    optional,
    done,
    open,
    planned,
    estimatedMinutes,
    unestimated,
    count: planned.length,
  };
}

/** Is this task on today — either because you chose it or because you owe it? */
export function isOnDay(task, today = todayISO()) {
  return task.planned_date === today || isOwedToday(task, today);
}

/**
 * The line at the top of the page: the day in five numbers.
 *
 * `overdue` and `dueToday` count across EVERY list rather than across the day
 * you planned, on purpose: a count that only described what you had already
 * chosen could never tell you about the thing you forgot to choose. Both are
 * normally already ON the day by the time you read them (the seed puts
 * everything owed there), so they read as "how much of today is a deadline"
 * rather than as a warning about somewhere else to look.
 */
export function daySummary(tasks, today = todayISO()) {
  const day = plannedDay(tasks, today);

  let overdue = 0;
  let dueToday = 0;
  for (const task of tasks) {
    if (task.done) continue;
    if (isOverdue(task, today)) overdue += 1;
    else if (task.due_date === today) dueToday += 1;
  }

  const done = day.done.length;
  const remaining = day.open.length;
  const total = done + remaining;

  return {
    planned: total,
    remaining,
    done,
    ratio: total > 0 ? done / total : 0,
    estimatedMinutes: day.estimatedMinutes,
    unestimated: day.unestimated,
    mustDo: day.commitments.length,
    optional: day.optional.length,
    overdue,
    dueToday,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Attention
// ─────────────────────────────────────────────────────────────────────────────

/*
  What is asking for a decision, and NOTHING ELSE.

  This is the second step of the day's planning flow, and it is the one section
  on the page whose contents you do not choose. Which is exactly why the rules
  for getting into it are short enough to hold in your head — a section that
  gathers everything "important" is a second task list, and a second task list
  is one you stop reading.

  There are three ways in, and there is no fourth:

    DUE TOMORROW  the last morning on which starting it is still a choice.
    HARD, SOON    flagged `is_hard` and owed within a week. The hard ones are
                  the ones you cannot start on the day they are due, so they are
                  the ones worth seeing early.
    IMPORTANT     urgent or high priority and owed within a week. The same
                  argument, made by the priority you already set.

  Note what is NOT here. Not "waiting on someone", not "high priority" on its
  own with no date attached, and not anything at all without a due date: an
  undated task cannot be late, cannot be soon, and has no business interrupting
  a decision about today. It is in Add from projects, where you go looking.

  LATE is not here either, and it used to be. A section called "Coming up" is
  read as a forecast, and burying the work you already owe inside a forecast put
  the most urgent thing you had one step away from the day it belonged on — you
  had to walk into the next step of the flow to find out you were behind. An
  arrived deadline is not coming up; it is here. So everything owed today OR
  EARLIER goes straight onto the plan (see `owedTodaySeed` in lib/dayPlan), and
  this step is left to say only what it can say honestly: what is coming.

  DUE TODAY is missing for the same reason: the flow has already put today's
  work on today's plan by the time you get here, so listing it again would be
  asking you to decide something you have decided.

  A task appears in exactly ONE bucket, claimed in the order above, so the
  counts add up and nothing is read twice. Every row's only verb is "must do /
  optional": you look, and then you choose, one at a time. Nothing here moves
  onto your day by itself.
*/

/** How far ahead "soon" reaches, for the two rules that have a horizon. */
export const ATTENTION_HORIZON_DAYS = 7;

export const ATTENTION_SECTIONS = [
  { key: 'due_tomorrow', label: 'Due tomorrow', tone: 'amber' },
  { key: 'hard_soon', label: 'Hard, due this week', tone: 'violet' },
  { key: 'important_soon', label: 'High priority this week', tone: 'orange' },
];

export function attention(tasks, today = todayISO()) {
  const tomorrow = addDaysISO(today, 1);
  const horizon = addDaysISO(today, ATTENTION_HORIZON_DAYS);
  const open = tasks.filter(task => !task.done);
  const claimed = new Set();

  const claim = (predicate, sort = compareTasks) => {
    const out = [];
    for (const task of open) {
      if (claimed.has(task.id) || !predicate(task)) continue;
      claimed.add(task.id);
      out.push(task);
    }
    return out.sort(sort);
  };

  // Owed inside the horizon, and not today or anything before it (all of which
  // is already on the plan), and not tomorrow (which has its own section above).
  const soon = task => !!task.due_date && task.due_date > tomorrow && task.due_date <= horizon;

  // Oldest first: the thing that has been waiting longest has cost the most.
  const byDueDate = (a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : compareTasks(a, b));

  const found = {
    due_tomorrow: claim(task => task.due_date === tomorrow),
    hard_soon: claim(task => task.is_hard && soon(task), byDueDate),
    important_soon: claim(
      task => (task.priority === 'urgent' || task.priority === 'high') && soon(task),
      byDueDate
    ),
  };

  return ATTENTION_SECTIONS
    .map(section => ({ ...section, tasks: found[section.key] }))
    .filter(section => section.tasks.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Choosing what to do
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every task you could put on a day, gathered by the list it lives in: what
 * the "add to today" browser and the planner's second step both read.
 *
 * Lists come back in their own order, with their colour, and empty ones are
 * dropped: this is a place to pick from, and a heading over nothing is a row
 * you have to skip past. `query` matches the title and notes, the same fields
 * the /tasks search box reads, so searching means the same thing in both
 * places.
 *
 *   excludePlanned  leave out what is already on the day — chosen OR owed (see
 *                   `isOnDay`), because "already on the day" has to mean the
 *                   same thing here as it does on the day itself, or the
 *                   browser offers you a task it is showing as done deal two
 *                   steps back. The browser on the page wants this (it offers
 *                   what you have NOT chosen); the planner does not, because
 *                   there it is a checklist and the things already chosen have
 *                   to show up ticked.
 */
export function taskCatalog(tasks, lists = [], { today = todayISO(), query = '', excludePlanned = false } = {}) {
  const index = listIndex(lists);
  const q = String(query || '').trim().toLowerCase();

  const matches = tasks.filter(task => {
    if (task.done) return false;
    if (excludePlanned && isOnDay(task, today)) return false;
    if (!q) return true;
    return `${task.title} ${task.notes}`.toLowerCase().includes(q);
  });

  const groups = new Map();
  for (const meta of index.values()) groups.set(meta.id, { list: meta, tasks: [] });
  for (const task of matches) {
    const id = task.list_id;
    if (!groups.has(id)) groups.set(id, { list: listOf(index, id), tasks: [] });
    groups.get(id).tasks.push(task);
  }

  return [...groups.values()]
    .filter(group => group.tasks.length > 0)
    .map(group => ({ ...group, tasks: group.tasks.sort(compareTasks) }));
}

/** The estimated minutes of a set of tasks: the planner's running total. */
export function workload(tasks) {
  let minutes = 0;
  let unestimated = 0;
  for (const task of tasks) {
    const value = normalizeEstimate(task.estimated_minutes);
    if (value) minutes += value;
    else unestimated += 1;
  }
  return { minutes, unestimated, count: tasks.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// The timeline
// ─────────────────────────────────────────────────────────────────────────────

/*
  The day, drawn as the day.

  THREE kinds of thing sit on it, and the differences between them are the whole
  design:

    a TASK BLOCK   a task you planned and then gave a time to. It is the task,
                   so finishing it here finishes it everywhere, and unscheduling
                   it leaves it on the day with no time attached.
    an EVENT       class, lunch, a standing meeting you typed in yourself.
                   Something the day already contains that you do not owe
                   anybody and cannot tick off. It is not a task and must never
                   become one, or the task list would fill up with your own
                   timetable. Events live in app_settings (see /api/events), one
                   small array per day.
    an EXTERNAL    an event off your real Google calendar (see lib/googleEvents
                   and /api/google/day). Read-only, on purpose: it is not yours
                   to move from here, it is the shape of the day you are
                   planning INTO. It carries the colour Google draws it in, so
                   the lecture you recognise by its colour is the same colour
                   here.

  All three are drawn from the same two numbers, a start in minutes past
  midnight and a length in minutes, because the layout is arithmetic and nothing
  about drawing a block should have to parse a string. Which means all three
  also take part in the same overlap layout, and in `nextFreeStart` — so
  "schedule this at the next free hour" already knows about your ten o'clock
  meeting without a line of code that mentions Google.

  ALL-DAY events are the one thing that is not a block. They have no hour to be
  drawn at, so they come back separately (`allDay`) for the strip above the grid,
  the way every calendar draws them.
*/

/*
  The window the day is drawn in when nothing pushes it wider: 4am to 4am.

  A full 24 hours, anchored where a day actually starts rather than where the
  calendar says it does (see DAY_ANCHOR_MINUTES in lib/dates). The bottom of the
  grid is 28:00 — four in the morning, tomorrow — so a one-o'clock finish is
  drawn at the end of the evening it belongs to instead of at the top of a day
  you have not begun.

  It still stretches: anything you put outside it widens the window rather than
  being clamped to the edge and drawn as a lie.
*/
export const DAY_START = DAY_ANCHOR_MINUTES;
export const DAY_END = DAY_WINDOW_END;

/** One fixed commitment, read defensively: it comes from a JSON blob. */
export function normalizeEvent(raw) {
  const start = clockToMinutes(raw?.start);
  if (start === null) return null;
  const minutes = normalizeEstimate(raw?.minutes) || DEFAULT_BLOCK_MINUTES;
  return {
    id: String(raw.id || `event_${start}`),
    title: String(raw.title || '').trim() || 'Busy',
    start: dayClock(start),
    // Trimmed to the end of the day, which is 4am: a commitment at midnight has
    // four hours in front of it, not none.
    minutes: Math.min(minutes, DAY_WINDOW_END - dayMinutes(raw.start)),
    // The tag it is drawn in: a Google event label id, exactly as a task's
    // `google_label_id` is (see lib/googleEvents). A commitment is never
    // written to Google — it is furniture, not work — so this only ever colours
    // the block here, which is the whole of what it is for.
    labelId: normalizeLabelId(raw?.labelId),
    // And whatever you wanted to remember about it: the room the class is in,
    // the number to dial. Called `notes` rather than `description` because that
    // is what the same field is called on a task, and this side of the wire is
    // this app's vocabulary; only Google's own events use Google's word.
    notes: String(raw?.notes || '').slice(0, MAX_DESCRIPTION),
  };
}

export function normalizeEvents(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeEvent)
    .filter(Boolean)
    .sort((a, b) => dayMinutes(a.start) - dayMinutes(b.start));
}

/*
  Two blocks that overlap are drawn side by side rather than on top of each
  other: a 2pm task hidden underneath a 2pm lecture is exactly the collision the
  timeline exists to show you.

  The runs of mutually-overlapping blocks are found first (a "cluster"), then
  each block takes the first column in its cluster whose last block has already
  ended. Every block in a cluster reports the SAME column count, so they split
  the width evenly and their edges line up.
*/
function layout(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.minutes - a.minutes);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const columnEnds = [];
    for (const block of cluster) {
      let column = columnEnds.findIndex(end => end <= block.start);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(0);
      }
      columnEnds[column] = block.end;
      block.column = column;
    }
    for (const block of cluster) block.columns = columnEnds.length;
    out.push(...cluster);
    cluster = [];
    clusterEnd = -1;
  };

  for (const block of sorted) {
    if (block.start >= clusterEnd) flush();
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  flush();
  return out;
}

/**
 * One day, laid out: the window it is drawn in, the hour lines inside it, and
 * every block placed in a column.
 *
 * The window opens at DAY_START–DAY_END and is stretched (out to whole hours)
 * by anything scheduled outside it, so a 6am start or an 11pm block is drawn
 * where it is rather than clamped to the edge and drawn as a lie.
 *
 * `listName` is (task) → the name of the list it came from, and it is here
 * rather than looked up by each thing that draws a block: the list is part of
 * what a task block IS on a calendar — "Read chapter 4" means one thing out of
 * Thesis and another out of Book club — and it is written on the block, in its
 * description, and into the Google event alike. A function, because the lists
 * belong to the page; absent, a block simply has no list and everything drawing
 * one leaves it out.
 */
export function dayTimeline(tasks, events = [], today = todayISO(), external = [], listName = null) {
  const blocks = [];

  for (const task of tasks) {
    if (task.planned_date !== today) continue;
    // The stored wall clock, placed on a day that runs 4am to 4am: '01:00' is
    // the small hours at the END of this day, at minute 1500.
    const start = dayMinutes(task.scheduled_start);
    if (start === null) continue;
    const minutes = normalizeEstimate(task.scheduled_minutes)
      || normalizeEstimate(task.estimated_minutes)
      || DEFAULT_BLOCK_MINUTES;
    blocks.push({
      key: `task-${task.id}`,
      kind: 'task',
      id: task.id,
      title: task.title,
      task,
      // Where the work came from. Only a task has one — a commitment is not in
      // a list, and somebody else's meeting is not in yours.
      list: (listName ? String(listName(task) || '') : '').trim(),
      // The tag, in the same place on all three kinds of block, so the grid can
      // colour one without first asking what it is.
      labelId: task.google_label_id || null,
      start,
      minutes,
      end: Math.min(start + minutes, DAY_WINDOW_END),
    });
  }

  for (const event of normalizeEvents(events)) {
    const start = dayMinutes(event.start);
    blocks.push({
      key: `event-${event.id}`,
      kind: 'event',
      id: event.id,
      title: event.title,
      event,
      labelId: event.labelId || null,
      start,
      minutes: event.minutes,
      end: Math.min(start + event.minutes, DAY_WINDOW_END),
    });
  }

  // Google's, split as it arrives: the timed ones are blocks like any other,
  // the all-day ones have no hour and are handed back for the strip on top.
  const allDay = [];
  for (const event of normalizeExternals(external)) {
    if (event.allDay) {
      allDay.push(event);
      continue;
    }
    /*
      Minutes, not a clock string. An external block can sit after midnight —
      that is the whole point of a day that ends at 4am — and 'HH:MM' cannot say
      25:30. Task blocks and your own commitments still use the clock, because
      they are stored as one and cannot outlive the calendar day.
    */
    const start = event.startMinutes;
    blocks.push({
      key: `external-${event.id}`,
      kind: 'external',
      id: event.id,
      title: event.title,
      external: event,
      labelId: event.labelId || null,
      start,
      minutes: event.minutes,
      end: Math.min(start + event.minutes, DAY_WINDOW_END),
    });
  }

  const laid = layout(blocks);
  const startMinute = Math.min(DAY_START, ...laid.map(b => Math.floor(b.start / 60) * 60));
  const endMinute = Math.max(DAY_END, ...laid.map(b => Math.ceil(b.end / 60) * 60));

  const hours = [];
  for (let m = startMinute; m <= endMinute; m += 60) hours.push(m);

  return {
    startMinute,
    endMinute,
    hours,
    allDay,
    blocks: laid.sort((a, b) => a.start - b.start),
    busyMinutes: laid.reduce((sum, block) => sum + block.minutes, 0),
  };
}

/**
 * Where a new block should go: the first gap from `from` onwards that is long
 * enough to hold it, on the quarter hour.
 *
 * A suggestion and nothing more. The Schedule box opens on this because an
 * empty time field is a question you have to answer before you can even see
 * what you are answering, but every minute of it is yours to overwrite, and
 * dropping a task on top of something else is allowed: an overbooked day is a
 * real state, and the timeline draws it as one rather than refusing it.
 */
export function nextFreeStart(timeline, minutes = DEFAULT_BLOCK_MINUTES, from = null) {
  const earliest = snapUpMinutes(Math.max(from ?? timeline.startMinute, timeline.startMinute));
  const busy = timeline.blocks
    .map(block => ({ start: block.start, end: block.end }))
    .sort((a, b) => a.start - b.start);

  let candidate = earliest;
  for (const block of busy) {
    if (block.end <= candidate) continue;
    if (block.start >= candidate + minutes) break;   // the gap in front is enough
    candidate = snapUpMinutes(block.end);
  }
  return Math.min(candidate, DAY_WINDOW_END - minutes);
}
