'use client';

/*
  /today: the day you are choosing, across every project.

  /tasks is a place: one list, drawn as a board, a list or a calendar, and every
  write lands in the list you are standing in. That is the right shape for
  working ON something and the wrong shape for the question you actually open a
  task app to ask in the morning, which is "what am I doing today" — a question
  no single list can answer, because your day is not sorted by which list you
  filed something under.

  This page is the other axis, and it is a FLOW rather than a dashboard. Four
  panels visible at once is not four steps; it is one wall, and you end up
  reading whichever of them is loudest instead of the one you are on. So the day
  is planned in order, one question at a time (see lib/dayPlan and PlanFlow):

    1 PLAN       what is on today. It opens with everything you already OWE
                 already on it — due today, or late — because a deadline that
                 has arrived is a fact, not a decision; everything after that is
                 chosen by hand.
    2 ATTENTION  what else is asking: due tomorrow, or hard or high priority
                 within the week. Three rules, no fourth, and nothing late —
                 that is step 1's, not a forecast. You add what is yours, one at
                 a time, as must-do or optional.
    3 PROJECTS   every open task you own, by project, searchable. The step for
                 the work that is not shouting.
    4 CALENDAR   when each of them is happening.

  Then the day is FINALIZED and the page stops being a form: it becomes the
  finished day (DayView) — the calendar, with the day's work in priority order
  beside it — and stays that way until tomorrow or until you re-plan.

  What is ON the day is DERIVED, not looked up: `plannedDay` in lib/agenda takes
  everything you chose (`planned_date === today`) plus everything you owe (due
  today or already late — `isOwedToday` in lib/tasks), and that union is the
  day. No write has to land first. A due date changed to today on /tasks is on
  today the moment this page reads the row, and a write that fails cannot
  produce a day with your deadlines quietly missing from it.

  The seed below still runs, but only to CATCH THE COLUMN UP — an owed task
  needs a real `planned_date` before it can be given a time, reordered, or taken
  off the day. Read the two together and the rule is: the model decides what is
  on today, the seed writes it down.

  GOOGLE CALENDAR, if it is connected, wraps that flow at both ends and changes
  none of it. The day OPENS with your real events already drawn on the timeline
  — read-only, in their own colours, because a lecture at nine is a fact you
  plan around and not a task you own — and FINISHING the day sends the blocks
  you placed back to Google, so what you decided at nine is on your phone at
  eleven. The events we write are stamped with their task's id, which is what
  lets the next read recognise our own copies and drop them: the timeline shows
  each thing exactly once, and a delete can only ever reach something this app
  put there. All of it is optional and none of it is load-bearing — with no
  Google client configured the page is exactly what it was before, and a Google
  request that fails costs the day its colours and nothing else.

  `planned_date` is separate from the due date, the status and the list, so
  putting something on today moves NOTHING else — in particular NOT the due
  date, which stays exactly what it was — and finishing it here finishes it
  everywhere (see plannedPatch and lib/taskStore). The arrangement is pure and
  lives in lib/agenda.js and lib/dayPlan.js; this file owns loading, writing,
  dragging and the overlays, and nothing else.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, useSensor, useSensors,
} from '@dnd-kit/core';
import { dayClock, fromISODate, nowDayMinutes, snapMinutes, todayISO } from '@/lib/dates';
import { DEFAULT_BLOCK_MINUTES, resolveListsPayload } from '@/lib/tasks';
import {
  attention, dayTimeline, daySummary, listIndex, listOf, nextFreeStart, plannedDay,
} from '@/lib/agenda';
import {
  EMPTY_DAY_PLAN, FIRST_STEP, nextStepKey, owedTodaySeed, prevStepKey,
} from '@/lib/dayPlan';
import {
  createTask, deleteGoogleEvent, disconnectGoogle, fetchDayEvents, fetchDayPlan, fetchGoogleDay,
  fetchLists, fetchTasks, patchGoogleEvent, pushGoogleDay, saveDayEvents, saveDayPlan,
} from '@/lib/tasksApi';
import { dayPushItems, pushSignature } from '@/lib/googleEvents';
import { useTaskStore } from '@/lib/taskStore';
import LoadError from '@/components/tasks/LoadError';
import WriteError from '@/components/tasks/WriteError';
import TaskComposer from '@/components/tasks/TaskComposer';
import TaskDetailPanel from '@/components/tasks/TaskDetailPanel';
import { OVERLAY_Z } from '@/components/tasks/TaskPickers';
import AttentionPanel from '@/components/today/AttentionPanel';
import CalendarStep from '@/components/today/CalendarStep';
import CommitmentsPanel from '@/components/today/CommitmentsPanel';
import DayView from '@/components/today/DayView';
import { GoogleChip, GoogleNotice, GoogleSync } from '@/components/today/GoogleCalendar';
import PlanFlow from '@/components/today/PlanFlow';
import ProjectPickerPanel from '@/components/today/ProjectPickerPanel';
import { TaskDragCard } from '@/components/today/TodayRow';
import { PX_PER_MINUTE } from '@/components/today/Timeline';
import { EventDialog, ScheduleDialog } from '@/components/today/DayForms';

// A tab left open in the background goes stale, and this is the one page you
// would leave open all day. Cheap enough to just re-read when you come back to
// it, throttled so flicking between tabs isn't a request each time.
const REFRESH_AFTER_MS = 30_000;

/*
  Puts the dragged card's TOP-LEFT under the cursor, rather than leaving it
  wherever in the row you happened to take hold of it.

  The drop minute is read off the cursor (`dropMinutes`), so the cursor is the
  block's start — and a card hanging half an hour above the line it is about to
  land on is a drag that reads as if it were aimed somewhere else. Anchored, the
  card's top edge IS the start of the block, and it comes to rest inside the
  ghost that says so.

  dnd-kit gives a modifier the transform it was about to apply plus the rect the
  overlay currently occupies (the row's, at the moment the drag began); the grab
  offset is the distance from that rect's corner to the pointer that started it.
*/
const cursorTopLeft = ({ activatorEvent, draggingNodeRect, transform }) => {
  const point = activatorEvent?.touches?.[0] ?? activatorEvent;
  if (!draggingNodeRect || typeof point?.clientX !== 'number') return transform;
  return {
    ...transform,
    x: transform.x + point.clientX - draggingNodeRect.left,
    y: transform.y + point.clientY - draggingNodeRect.top,
  };
};

export default function TodayPage() {
  const { tasks, setTasks, tasksRef, patchTask, removeTask, writeError, setWriteError } = useTaskStore();

  const [lists, setLists] = useState([]);
  const [events, setEvents] = useState([]);
  /*
    Where a task WRITTEN here goes. Not "the list you are in" — this page is in
    all of them at once, which is the whole point of it — but the one a new task
    lands in unless you say otherwise, seeded from whichever list /tasks had open
    and changed in the composer.
  */
  const [newTaskListId, setNewTaskListId] = useState('default');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [openTaskId, setOpenTaskId] = useState(null);
  const [composer, setComposer] = useState(null);        // null | defaults object
  const [scheduling, setScheduling] = useState(null);    // null | task id
  const [eventDraft, setEventDraft] = useState(null);    // null | { event | null }

  /*
    THE GOOGLE HALF, in three pieces.

      google    the connection as the page may say it out loud: configured,
                connected, which account, which calendars would not read.
                `null` until asked, so the chip draws nothing rather than
                flashing "Connect" at someone who already has.
      external  today's real events. Read-only all the way down; nothing on this
                page writes to this array except a fresh read.
      sync      what Google was last TOLD. `signature` is the whole of it: the
                day's blocks reduced to one string (see lib/googleEvents), so
                comparing it against the day on screen answers "have I changed
                anything since I sent this" exactly, rather than approximately.
  */
  const [google, setGoogle] = useState(null);
  const [external, setExternal] = useState([]);
  const [googleNotice, setGoogleNotice] = useState(null);
  /*
    THE TAGS, which come down with the day for the same reason the events do:
    they are Google's, they are read in the same request, and they are useless
    apart. `byCalendar` is the labels defined on each calendar you read — the
    ones a Google event may take — and `write` is the calendar the day is pushed
    to plus its own labels, which are the only ones a TASK's block can be given,
    because that is where a task's block ends up.
  */
  const [labels, setLabels] = useState({ byCalendar: {}, write: null });
  /*
    Today's real events, readable from a callback without every callback
    depending on the array — the same trick and the same reason as `tasksRef`.
    An optimistic edit to one of them needs the list as it was, so a write that
    Google refuses can put it back.
  */
  const externalRef = useRef(external);
  useEffect(() => { externalRef.current = external; }, [external]);
  const [sync, setSync] = useState({
    status: 'idle', signature: '', at: null, count: 0, stale: false, calendar: null, error: null,
  });

  /*
    The clock the day is read against. The browser's, not the server's: /today
    is drawn in local wall-clock minutes, and a box in another country has no
    opinion worth having about when your nine o'clock is.
  */
  const timeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);

  /*
    How far through the flow this day is: { step, finalized }. `null`
    until it has been read, which is what stops the page flashing the first step
    of a form for a day that was finished hours ago.
  */
  const [plan, setPlan] = useState(null);

  /*
    Midnight is a real event on a page whose entire subject is today, and so is
    the passing minute: the "now" line on the timeline is the one thing on the
    page that moves by itself. Both are read from one interval, once a minute,
    so a dashboard left open overnight rolls over instead of quietly describing
    yesterday.

    BOTH ARE ANCHORED AT 4am, which is the whole point of `todayISO` and
    `nowDayMinutes` (lib/dates). The rollover happens at four in the morning
    rather than at midnight, so a plan you are still working through at one
    o'clock does not vanish out from under you — and "now" is expressed in the
    same minutes the timeline is drawn in, so at 1am the line is at 25:00, near
    the bottom of the day it belongs to.
  */
  const [today, setToday] = useState(() => todayISO());
  const [nowMinutes, setNowMinutes] = useState(() => nowDayMinutes());
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      setToday(prev => (prev === todayISO(now) ? prev : todayISO(now)));
      setNowMinutes(nowDayMinutes(now));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // ─── Loading ───────────────────────────────────────────────────────────────

  const lastLoadRef = useRef(0);

  /*
    No `list_id`, on purpose: /api/tasks with no filter is every list, which is
    exactly the slice this page is about. The lists load alongside, not to scope
    anything, only to give each row its name and its colour; the day's fixed
    commitments come from /api/events and its planning state from /api/day-plan.

    `quiet` is the background refresh: it replaces what is on screen without
    blanking it first, because a page that flashes empty every time you come back
    to the tab is worse than one that is thirty seconds old.
  */
  const loadAll = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    lastLoadRef.current = Date.now();

    try {
      const resolved = resolveListsPayload(await fetchLists());
      setLists(resolved.lists);
      setNewTaskListId(prev => (prev === 'default' ? resolved.activeListId : prev));
    } catch (err) {
      // Not fatal: without the lists the rows only lose their labels, and the
      // tasks below are what the page is actually for.
      console.error('Failed to load lists', err);
      setLists(resolveListsPayload({}).lists);
    }

    try {
      setEvents(await fetchDayEvents(today));
    } catch (err) {
      // Also not fatal: the timeline loses the furniture, keeps the work.
      console.error('Failed to load the day’s commitments', err);
      setEvents([]);
    }

    try {
      setPlan(await fetchDayPlan(today));
    } catch (err) {
      // An unplanned day is the safe assumption: it offers to plan, which is
      // recoverable, where assuming "finished" would hide the flow entirely.
      console.error('Failed to load the day’s plan', err);
      setPlan({ ...EMPTY_DAY_PLAN });
    }

    try {
      setTasks(await fetchTasks());
      setLoadError(null);
    } catch (err) {
      console.error('Failed to load tasks', err);
      if (!quiet) setTasks([]);
      setLoadError(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [setTasks, today]);

  /*
    GOOGLE, read on its own.

    Deliberately not part of loadAll, and the reason is the whole posture of
    this feature: the tasks are the page, and Google is scenery. Reading it in
    the same try/finally would make a Google outage a /today outage, and would
    make the page's first paint wait on a third party. So it is a separate
    request on a separate timeline, and every one of its failure modes leaves
    the day drawable.

    One round trip answers everything the page needs: whether we are connected,
    to what, today's events, and what we last sent (/api/google/day). The three
    are always wanted together, so asking for them apart would only be three
    times the latency.

    Not configured, not connected and revoked all come back as ordinary answers
    rather than errors — they are three different buttons to offer, not three
    faults — so the catch here is for a genuine one, and it KEEPS whatever is
    already on screen. A refresh that fails should cost you the update, not
    today's meetings.
  */
  const loadGoogle = useCallback(async () => {
    setGoogle(prev => (prev ? { ...prev, loading: true } : prev));
    try {
      const day = await fetchGoogleDay(today, timeZone);
      setGoogle({
        configured: !!day.configured,
        connected: !!day.connected,
        email: day.email || null,
        reason: day.reason || null,
        failed: Array.isArray(day.failed) ? day.failed : [],
        loading: false,
        error: null,
      });
      // Only a CONNECTED answer is allowed to replace the events. A
      // disconnected one clears them, because they are no longer ours to draw.
      setExternal(day.connected ? (day.events || []) : []);
      setLabels(day.connected
        ? { byCalendar: day.labels || {}, write: day.writeCalendar || null }
        : { byCalendar: {}, write: null });
      setSync(prev => ({
        ...prev,
        signature: day.pushed?.signature || '',
        at: day.pushed?.at || null,
        count: day.pushed?.count || 0,
        stale: !!day.pushed?.stale,
        calendar: day.pushed?.calendar || null,
      }));
    } catch (err) {
      console.error('Failed to read Google Calendar', err);
      setGoogle(prev => ({
        configured: true,
        connected: false,
        email: null,
        reason: null,
        failed: [],
        ...(prev || {}),
        loading: false,
        error: err?.message || 'Google Calendar could not be read.',
      }));
    }
  }, [timeZone, today]);

  useEffect(() => {
    // Fired from inside an async closure, so nothing in loadAll's chain can set
    // state synchronously during the effect and cascade a second render.
    (async () => { await loadAll(); })();
  }, [loadAll]);

  useEffect(() => { loadGoogle(); }, [loadGoogle]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastLoadRef.current < REFRESH_AFTER_MS) return;
      loadAll({ quiet: true });
      // Your calendar is the half of this page most likely to have moved while
      // the tab sat in the background: somebody else books you.
      loadGoogle();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadAll, loadGoogle]);

  /*
    HOW THE CONSENT FLOW REPORTS BACK.

    It leaves the app and returns as a whole new page load, so there is nothing
    still mounted to have been told the outcome. /api/google/callback says it in
    the URL instead; this reads it once and immediately scrubs it, because a
    `?google=connected` left in the address bar becomes a bookmark that claims
    something happened every time it is opened.

    `replaceState` rather than the router: there is nothing to re-render, and a
    navigation would remount the page we have just finished loading.
  */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('google');
    if (!status) return;
    setGoogleNotice({ status });
    params.delete('google');
    const query = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
  }, []);

  // ─── The arrangement ───────────────────────────────────────────────────────

  const index = useMemo(() => listIndex(lists), [lists]);
  const listOptions = useMemo(() => [...index.values()], [index]);
  const listFor = useCallback(task => listOf(index, task.list_id), [index]);

  const day = useMemo(() => plannedDay(tasks, today), [tasks, today]);
  const summary = useMemo(() => daySummary(tasks, today), [tasks, today]);
  const sections = useMemo(() => attention(tasks, today), [tasks, today]);
  /*
    Your real calendar goes into the SAME timeline as everything else, rather
    than a layer drawn behind it — which is what makes a meeting participate in
    the overlap layout (a task on top of your standup is drawn beside it, not
    underneath) and in `nextFreeStart`, so "schedule this at the next free hour"
    already knows about your ten o'clock without a line of code that mentions
    Google.
  */
  const timeline = useMemo(
    () => dayTimeline(tasks, events, today, external),
    [tasks, events, today, external]
  );
  const attentionCount = useMemo(
    () => sections.reduce((count, section) => count + section.tasks.length, 0),
    [sections]
  );
  const openTask = openTaskId ? tasks.find(t => t.id === openTaskId) : null;
  const scheduleTask = scheduling ? tasks.find(t => t.id === scheduling) : null;
  const onOpen = useCallback(task => setOpenTaskId(task.id), []);

  // ─── Writing the day ───────────────────────────────────────────────────────

  /*
    The four verbs of this page, and what each of them is allowed to touch.

      plan        planned_date = today, and the half of the day it lands in.
                  NOT the due date: a task owed on Friday that you are doing
                  today is still owed on Friday.
      unplan      planned_date = null, which also clears its block (plannedPatch
                  owns that). The project, the status and the due date are
                  untouched: taking something off today is not abandoning it.
      schedule    a start and a length. Only meaningful for a planned task.
      unschedule  the block goes, the task STAYS on today.
  */
  const planForToday = useCallback((task, dailyPriority = 'must_do') => {
    patchTask(task.id, { planned_date: today, daily_priority: dailyPriority });
  }, [patchTask, today]);

  /*
    A block on the timeline, and the estimate that comes with it.

    `estimated_minutes` is written alongside the block rather than picked off a
    menu somewhere, because the length of the block IS the estimate — it is the
    one place the question is worth asking, since it is the one place you can
    see what else has to fit around the answer. Everything that reads a
    workload (the step's totals, the unplaced column) therefore reads the day
    you actually drew. Unscheduling leaves it behind: what you learnt about how
    long the thing takes does not stop being true when you take it off the grid.
  */
  const schedule = useCallback((task, startClock, minutes) => {
    patchTask(task.id, {
      planned_date: today,
      daily_priority: task.daily_priority,
      scheduled_start: startClock,
      scheduled_minutes: minutes,
      estimated_minutes: minutes,
    });
  }, [patchTask, today]);

  const unschedule = useCallback((task) => {
    patchTask(task.id, { scheduled_start: null, scheduled_minutes: null });
  }, [patchTask]);

  /*
    Where a block ends up after you have moved or resized it on the timeline.
    One call for both, because both gestures produce the same two numbers, and
    the calendar has no reason to know that "same start, longer" and "same
    length, later" are different writes here.
  */
  const placeTask = useCallback((task, startMinutes, minutes) => {
    // `dayClock` and not `minutesToClock`: a block dropped at 25:00 is stored as
    // the wall clock '01:00', which is what that hour is called and what the
    // column has always held. Reading it back on this day puts it at 25:00
    // again (see `dayMinutes`).
    schedule(task, dayClock(startMinutes), minutes);
  }, [schedule]);

  const handleCreate = useCallback(async (fields) => {
    try {
      const { ok, data } = await createTask({
        ...fields,
        list_id: fields.list_id || newTaskListId || 'default',
      });
      if (ok && data?.id) setTasks(prev => [...prev, data]);
    } catch (err) {
      console.error('Failed to create the task', err);
    }
  }, [newTaskListId, setTasks]);

  const handleDelete = useCallback(async (task) => {
    if (openTaskId === task.id) setOpenTaskId(null);
    await removeTask(task);
  }, [openTaskId, removeTask]);

  const openComposer = useCallback(() => {
    // A task written on this page is for this page: it lands on today, in the
    // list you last had open, as a commitment. Its DUE date is left alone,
    // because "I am doing it today" and "it is owed today" are the two things
    // this page exists to keep apart.
    setComposer({ list_id: newTaskListId, planned_date: today, daily_priority: 'must_do' });
  }, [newTaskListId, today]);

  const setHalf = useCallback((task, half) => {
    patchTask(task.id, { daily_priority: half });
  }, [patchTask]);

  // ─── The flow ──────────────────────────────────────────────────────────────

  /*
    Writing the plan is optimistic and unguarded: it is three fields describing
    one person's progress through one form, so a lost write costs you a click on
    a step name, and a version check would cost more code than the thing being
    protected.
  */
  const writePlan = useCallback((updates) => {
    setPlan((prev) => {
      const next = { ...(prev || EMPTY_DAY_PLAN), ...updates };
      saveDayPlan(today, next).catch(err => console.error('Failed to save the day’s plan', err));
      return next;
    });
  }, [today]);

  /*
    THE SEED, and the only write on this page nobody asked for.

    It no longer decides anything. Everything OWED — due today, or due on a day
    already been and gone — is on the day because `plannedDay` says so, whether
    this ever runs or not. What this does is write the day down: stamp
    `planned_date = today` on the owed tasks that are not carrying it yet, so
    they can be scheduled on the calendar, reordered within the day, and taken
    off it. A deadline is not a decision — being asked to tick four boxes to
    acknowledge four things you already owe is ceremony — and anything the seed
    writes here can be taken straight back off.

    Making the day derived rather than seeded is what fixed the three ways it
    used to go wrong, all of which were the same bug wearing different clothes:
    a due date set to today on /tasks was not on today until a round trip came
    back; a write that failed left a day with the deadlines missing and nothing
    on screen to explain it; and a task still stamped with LAST Tuesday was owed
    but not planned for today, so it appeared in neither place.

    A STALE BLOCK is cleared on the way through. A task being pulled forward
    from a day that has passed may still carry that day's `scheduled_start`, and
    a schedule belongs to the day it was made for (see plannedPatch) — silently
    re-booking this afternoon because that is when you meant to do it on Monday
    is not a plan, it is a guess wearing one.

    It runs whenever something qualifies, not once when the day is first opened,
    because "owed" is not settled the first time you open the page: a task
    written at eleven, a due date moved to today from /tasks, a row synced from
    another device, a date that simply went past while the tab sat open.

    What keeps a continuous seed from arguing with you is that taking a task off
    today clears an ARRIVED due date with it (see `removeFromToday`): the thing
    that qualified it is gone, so neither the model nor the seed puts it back.
    Nothing here remembers the refusal, which is the point — set the due date to
    today again and the task comes back, because it is owed today again. A
    stored list of ids could not do that: it would hold a no you had since
    changed your mind about, and say nothing about why the task would not
    return.

    Two refs, two different jobs:

      seedingRef  the WITHIN-render guard. The writes are async and the effect
                  would otherwise re-enter before any of them came back.
      failedRef   the FAILURE guard, and the reason this cannot become a write
                  loop. A task the seed could not place stays in the seed list —
                  the classic case being a database with no `planned_date`
                  column, which rejects every one of these — so without it the
                  effect would retry that task forever.

    Only FAILURES are remembered, and only until the page is reloaded. A task
    that was placed successfully is forgotten immediately, because a success
    takes it out of the seed list by itself: it now has a planned_date. That is
    what lets the same task be seeded, taken off, and seeded again within one
    sitting, which a "seeded once" record of any kind would quietly forbid.
  */
  const seedingRef = useRef(false);
  const failedRef = useRef(new Set());

  const toSeed = useMemo(() => owedTodaySeed(tasks, today), [tasks, today]);

  useEffect(() => {
    if (loading || !plan || seedingRef.current) return;

    const fresh = toSeed.filter(task => !failedRef.current.has(task.id));
    if (fresh.length === 0) return;

    seedingRef.current = true;

    (async () => {
      const results = await Promise.all(fresh.map((task) => {
        const patch = { planned_date: today, daily_priority: 'must_do' };
        // Carried forward from a day that is over: its time goes with that day.
        if (task.planned_date && task.scheduled_start) patch.scheduled_start = null;
        return patchTask(task.id, patch).then(res => [task.id, !!res?.ok]);
      }));
      for (const [id, ok] of results) {
        if (ok) failedRef.current.delete(id);
        else failedRef.current.add(id);
      }
      seedingRef.current = false;
    })();
  }, [loading, patchTask, plan, toSeed, today]);

  /*
    Taking something off the day: the seed's counterpart, and defined next to it
    because the two only make sense read together.

    Two writes, one decision.

      planned_date  cleared. It is off the day.
      due_date      cleared TOO, but only when it has ARRIVED — today's, or a
                    day already past. That date is why the task was on the day at
                    all, so leaving it behind leaves a task that still says "due
                    today" (or "4d late") everywhere else in the app and is
                    nowhere on today — a state you did not choose and cannot see
                    the cause of. Worse, with the seed reading `due_date <=
                    today` it would land straight back on the day, and taking it
                    off would not stay off. A due date in the FUTURE is left
                    exactly alone: that is a deadline you set, it has nothing to
                    do with which day you planned the work for, and a planner
                    that quietly erased it would be lying about what you owe.

    Clearing the date is also what makes this REVERSIBLE, which a remembered
    list of refusals would not be: set the due date to today again, from here or
    from /tasks, and the seed puts it straight back on the day, because it is
    owed today again.
  */
  const removeFromToday = useCallback((task) => {
    const patch = { planned_date: null };
    if (task.due_date && task.due_date <= today) patch.due_date = null;
    patchTask(task.id, patch);
  }, [patchTask, today]);

  // A new day is a new form: both guards reopen or tomorrow never seeds.
  useEffect(() => {
    seedingRef.current = false;
    failedRef.current = new Set();
  }, [today]);

  const step = plan?.step || FIRST_STEP;
  const goStep = useCallback(key => writePlan({ step: key }), [writePlan]);
  const goNext = useCallback(() => writePlan({ step: nextStepKey(step) }), [step, writePlan]);
  const goBack = useCallback(() => writePlan({ step: prevStepKey(step) }), [step, writePlan]);
  const replan = useCallback(
    () => writePlan({ finalized: false, step: FIRST_STEP }),
    [writePlan]
  );

  // ─── Sending the day to Google ─────────────────────────────────────────────

  /*
    THE DAY YOU DECIDED ON, WRITTEN WHERE YOU WILL ACTUALLY SEE IT.

    What goes is `dayPushItems`: the tasks planned for today that you gave an
    hour to. Not the whole day — a task with no block is a real plan ("some time
    this afternoon") but it is not an appointment, and inventing a time for it in
    your calendar would be the app making up a commitment on your behalf.

    Read off `tasksRef` rather than `tasks`, so this callback survives every
    keystroke on the page — and, more to the point, so it reads the day as it is
    at the MOMENT you press the button. That matters because the commonest
    sequence in this whole app is "drag a block, immediately press Finish": the
    optimistic row is already correct, its save may still be somewhere over the
    Atlantic, and a server-side re-read would send the plan you had a moment ago.

    The reply carries the refreshed calendar as well as the receipt, which is
    what makes the timeline settle into one honest state rather than two: every
    block just written comes back from Google stamped with its task's id, is
    recognised as ours, and is dropped — so what redraws is your real meetings
    plus your own blocks, each drawn once, each still yours to move.
  */
  const sendToGoogle = useCallback(async () => {
    setSync(prev => ({ ...prev, status: 'sending', error: null }));
    try {
      const res = await pushGoogleDay(today, timeZone, dayPushItems(tasksRef.current, today));
      if (!res.ok) {
        setSync(prev => ({ ...prev, status: 'error', error: res.error }));
        /*
          Said in the banner as well as on the button. The commonest reason a
          push fails is that the calendar it writes to does not exist yet, and
          the answer to that is a sentence of instructions — which does not fit
          on a chip, and which you would never see if it lived only in a
          tooltip on a button you have no reason to hover over.
        */
        setGoogleNotice({ status: 'push_failed', message: res.error });
        return;
      }
      setSync({
        status: 'idle',
        signature: res.pushed?.signature || '',
        at: res.pushed?.at || null,
        count: res.pushed?.count || 0,
        stale: !!res.pushed?.stale,
        calendar: res.pushed?.calendar || null,
        error: null,
      });
      setGoogleNotice(null);
      setExternal(res.events || []);
      setLabels({ byCalendar: res.labels || {}, write: res.writeCalendar || null });
      setGoogle(prev => (prev ? { ...prev, failed: res.failed || [] } : prev));
    } catch (err) {
      console.error('Failed to send the day to Google Calendar', err);
      setSync(prev => ({ ...prev, status: 'error', error: err?.message || 'The day did not reach Google.' }));
    }
  }, [tasksRef, timeZone, today]);

  /*
    Finishing does both, and does not wait for the second: the page becomes the
    finished day at once, and the send reports itself in the corner of it. A
    planner that made you watch a spinner before showing you your own afternoon
    would have got the priorities backwards — and if the send fails, the day is
    still planned and the button says "try again".
  */
  const finish = useCallback(() => {
    writePlan({ finalized: true });
    if (google?.connected) sendToGoogle();
  }, [google, sendToGoogle, writePlan]);

  /*
    Disconnecting hands the grant back to Google and forgets which events were
    ours. It does NOT delete them: they are in your calendar because the days
    happened, and quietly clearing a fortnight out of somebody's calendar
    because they unhooked an integration is data loss wearing the word cleanup.
  */
  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectGoogle();
    } catch (err) {
      console.error('Failed to disconnect Google Calendar', err);
    }
    setExternal([]);
    setLabels({ byCalendar: {}, write: null });
    setSync({ status: 'idle', signature: '', at: null, count: 0, error: null });
    setGoogle(prev => ({ ...(prev || { configured: true }), connected: false, email: null, reason: null, failed: [], loading: false, error: null }));
  }, []);

  // ─── Changing one of your real Google events ───────────────────────────────

  /*
    THE SECOND WRITE PATH TO GOOGLE, and it is nothing like the first.

    Finishing the day SENDS A DAY: a whole reconciliation, worked out server-side
    against what we last wrote, touching only events this app made. This is one
    event, changed one field at a time, and the event belongs to your calendar
    rather than to us — you dragged your ten o'clock, or you retagged it.

    Optimistic, like every other write on this page, and rolled back on refusal.
    The commonest refusal is not a fault at all — a calendar you may read and not
    write, an invitation somebody else organized — and a block that silently
    springs back to where it was is the single most confusing thing this app can
    do, so the reason is said out loud in the banner.

    The reply is the WHOLE DAY, not a receipt, and that is the point of doing it
    this way round: moving an event changes what overlaps what and which column
    every block near it is drawn in, and none of that is derivable from "ok".
  */
  const changeExternal = useCallback(async (event, changes, optimistic) => {
    if (!event?.calendarId || !event?.eventId) return;
    const before = externalRef.current;

    setExternal(prev => prev.map(e => (e.id === event.id ? { ...e, ...optimistic } : e)));

    try {
      const res = await patchGoogleEvent({
        calendarId: event.calendarId,
        eventId: event.eventId,
        date: today,
        tz: timeZone,
        ...changes,
      });
      if (!res.ok) {
        setExternal(before);
        setGoogleNotice({ status: 'event_failed', message: res.error });
        return;
      }
      setExternal(res.events || []);
      setLabels({ byCalendar: res.labels || {}, write: res.writeCalendar || null });
      setGoogle(prev => (prev ? { ...prev, failed: res.failed || [] } : prev));
    } catch (err) {
      console.error('Failed to change a Google Calendar event', err);
      setExternal(before);
      setGoogleNotice({ status: 'event_failed', message: err?.message || null });
    }
  }, [timeZone, today]);

  /*
    Dragged or resized on the grid. `start` is a position on the 4am day, which
    is what the timeline works in and what the small hours need: an event moved
    to half past midnight is minute 1470 here and one in the morning of tomorrow
    in Google, and the route is what turns one into the other.
  */
  const placeExternal = useCallback((event, startMinutes, minutes) => {
    changeExternal(
      event,
      { start: startMinutes, minutes },
      { startMinutes, minutes, clipped: null },
    );
  }, [changeExternal]);

  const removeExternal = useCallback(async (event) => {
    if (!event?.calendarId || !event?.eventId) return;
    const before = externalRef.current;
    setExternal(prev => prev.filter(e => e.id !== event.id));

    try {
      const res = await deleteGoogleEvent({
        calendarId: event.calendarId,
        eventId: event.eventId,
        date: today,
        tz: timeZone,
      });
      if (!res.ok) {
        setExternal(before);
        setGoogleNotice({ status: 'event_failed', message: res.error });
        return;
      }
      setExternal(res.events || []);
      setLabels({ byCalendar: res.labels || {}, write: res.writeCalendar || null });
    } catch (err) {
      console.error('Failed to delete a Google Calendar event', err);
      setExternal(before);
      setGoogleNotice({ status: 'event_failed', message: err?.message || null });
    }
  }, [timeZone, today]);

  // ─── The day's fixed commitments ───────────────────────────────────────────

  /*
    Events are a small array, written whole. Optimistic like everything else,
    and rolled back on failure: a class that appears and then silently isn't
    there tomorrow is worse than one that refuses to be added.
  */
  const writeEvents = useCallback(async (next) => {
    const before = events;
    setEvents(next);
    try {
      const res = await saveDayEvents(today, next);
      if (!res.ok) setEvents(before);
      else setEvents(res.events);
    } catch (err) {
      console.error('Failed to save the day’s commitments', err);
      setEvents(before);
    }
  }, [events, today]);

  const saveEvent = useCallback((event) => {
    writeEvents([...events.filter(e => e.id !== event.id), event]);
  }, [events, writeEvents]);

  const removeEvent = useCallback((event) => {
    writeEvents(events.filter(e => e.id !== event.id));
  }, [events, writeEvents]);

  const placeEvent = useCallback((event, startMinutes, minutes) => {
    writeEvents(events.map(e => (
      e.id === event.id ? { ...e, start: dayClock(startMinutes), minutes } : e
    )));
  }, [events, writeEvents]);

  // ─── The tag menu, over whichever kind of block you right-clicked ───────────

  /*
    ONE GESTURE, THREE PLACES IT LANDS — because a tag means the same thing on
    all three and is stored by whoever owns the block:

      a task        `google_label_id` on the row. It colours the block here at
                    once, and goes to Google with the next send, which is what
                    the "Send changes" button starts offering the moment you
                    pick one (the tag is in the push signature).
      a commitment  `labelId` in the day's own events blob. It never goes to
                    Google — a commitment is furniture, not work — so this is
                    the whole of it.
      a Google      straight to Google, on the event itself. Its colour here is
      event         its colour there, because they are the same fact.

    The dispatch is here rather than in the timeline for the reason everything
    else on this page is: the grid draws blocks and knows nothing about which
    table each one came from.
  */
  const tagBlock = useCallback((block, labelId) => {
    if (block.kind === 'task') {
      patchTask(block.task.id, { google_label_id: labelId });
    } else if (block.kind === 'event') {
      writeEvents(events.map(e => (e.id === block.event.id ? { ...e, labelId } : e)));
    } else if (block.external) {
      // `labelId: null` is a value and not an omission: it is what takes the
      // tag off, and the route reads the field's presence to tell the two apart.
      changeExternal(block.external, { labelId }, { labelId });
    }
  }, [changeExternal, events, patchTask, writeEvents]);

  const renameBlock = useCallback((block, title) => {
    if (block.kind === 'task') patchTask(block.task.id, { title });
    else if (block.kind === 'event') {
      writeEvents(events.map(e => (e.id === block.event.id ? { ...e, title } : e)));
    } else if (block.external) {
      changeExternal(block.external, { title }, { title });
    }
  }, [changeExternal, events, patchTask, writeEvents]);

  /*
    The description under the name, and it lands in whichever field that kind of
    thing already has for it: a task's `notes` (the same text the detail panel
    shows), a commitment's note in the day's own blob, and a Google event's
    `description`. Three names for one idea, and the menu only knows the idea.
  */
  const describeBlock = useCallback((block, text) => {
    if (block.kind === 'task') patchTask(block.task.id, { notes: text });
    else if (block.kind === 'event') {
      writeEvents(events.map(e => (e.id === block.event.id ? { ...e, notes: text } : e)));
    } else if (block.external) {
      changeExternal(block.external, { description: text }, { description: text });
    }
  }, [changeExternal, events, patchTask, writeEvents]);

  const deleteBlock = useCallback((block) => {
    if (block.kind === 'event') removeEvent(block.event);
    else if (block.external) removeExternal(block.external);
  }, [removeEvent, removeExternal]);

  /*
    The tags as the timeline wants them: the labels of each calendar you read,
    for its own events, and the ones on the calendar the day is pushed to, which
    are the only ones a task's block or a commitment may take. `connected`
    separates "you have no tags" from "there is no Google here", which are two
    different sentences under an empty menu.
  */
  const tags = useMemo(() => ({
    own: labels.write?.labels || [],
    byCalendar: labels.byCalendar || {},
    calendar: labels.write?.name || null,
    connected: !!google?.connected,
  }), [google, labels]);

  // ─── Dragging onto the day ─────────────────────────────────────────────────

  const canvasRef = useRef(null);
  // A few pixels of travel before a drag starts, so a click on a block still
  // opens the task rather than nudging it by two minutes.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  /*
    Where the pointer is, and where inside the dragged thing you took hold of
    it. Both are read live rather than reconstructed from dnd-kit's `delta` at
    the end: that delta is the TRANSFORM applied to the element, which already
    carries any scrolling that happened mid-drag, and the timeline is a
    scrolling container that dnd-kit will happily scroll for you as you
    approach its edge. Adding a fresh rect to a delta that has already been
    corrected counts the same scroll twice, and a block dropped at four lands
    at seven.

    A block keeps its grab offset, so it comes to rest where you dropped it
    instead of snapping its own top edge up to the cursor. A row dragged in
    from the list has no such offset: its top IS the cursor.
  */
  const pointerRef = useRef(null);
  const untrackRef = useRef(null);

  /*
    Where the thing you are dragging would land, live: { start, minutes, title }.

    A drag with no readout is a guess. Dropping a task on a grid and finding out
    afterwards that you meant 2:00 and got 2:15 is the one interaction here that
    is genuinely hard to do blind, so the timeline draws the landing spot — as
    the block itself, full size and snapped to the quarter hour — while you are
    still holding it (see Timeline's DropGhost).

    It is also the HANDOVER. While it is set, the pointer is over the grid and
    the timeline is drawing the block, so the card following the cursor stops
    being drawn: two copies of the same task in flight, one of them the wrong
    size, is worse feedback than either alone.

    Only for a task dragged IN from the list. A block already on the grid is its
    own preview: it moves under the cursor and re-reads its own clock, so a
    second ghost behind it would be the same fact twice.
  */
  const [dragPreview, setDragPreview] = useState(null);

  /*
    WHAT is being carried, as opposed to where it would land: the task under
    the cursor for the whole of the drag, so the DragOverlay at the foot of
    this file can draw it (see TaskDragCard).

    The id and not the row: the task can be written mid-drag — a status changed
    in another tab, a refresh landing — and the card should be reading the same
    task everything else is.
  */
  const [dragTaskId, setDragTaskId] = useState(null);

  const dragTask = useMemo(
    () => (dragTaskId ? tasks.find(t => t.id === dragTaskId) || null : null),
    [dragTaskId, tasks],
  );

  const onDragStart = useCallback((event) => {
    setDragTaskId(event.active.data.current?.taskId ?? null);
    const track = (e) => { pointerRef.current = e.clientY; };
    window.addEventListener('pointermove', track);
    untrackRef.current = () => window.removeEventListener('pointermove', track);
  }, []);

  const stopTracking = useCallback(() => {
    untrackRef.current?.();
    untrackRef.current = null;
    pointerRef.current = null;
    setDragPreview(null);
    setDragTaskId(null);
  }, []);

  useEffect(() => stopTracking, [stopTracking]);

  /*
    The quarter hour the cursor is over, or null if it is not over the day.

    No grab offset to correct for: the only thing dnd-kit still carries is a
    task ROW being brought in from the list beside the grid, and a row has no
    position on the timeline to preserve — where you point is where the block
    starts. Blocks already on the grid are not dnd-kit's any more; they move
    and resize on their own pointer events (see Timeline).
  */
  const dropMinutes = useCallback(() => {
    const canvas = canvasRef.current;
    const y = pointerRef.current;
    if (!canvas || typeof y !== 'number') return null;
    const offset = y - canvas.getBoundingClientRect().top;
    return snapMinutes(timeline.startMinute + offset / PX_PER_MINUTE);
  }, [timeline.startMinute]);

  /*
    Recomputed on every pointer move, and deliberately compared before it is
    stored: the drop minute is snapped to the quarter hour, so it changes maybe
    twenty times across a drag the length of the page. Setting state on each of
    the hundreds of moves in between would re-render the whole day to draw the
    identical ghost.
  */
  const onDragMove = useCallback((event) => {
    const data = event.active.data.current || {};
    if (event.over?.id !== 'timeline') {
      setDragPreview(prev => (prev === null ? prev : null));
      return;
    }

    const start = dropMinutes();
    if (start === null) return;

    const task = tasksRef.current.find(t => t.id === data.taskId);
    if (!task) return;
    const minutes = task.scheduled_minutes || task.estimated_minutes || DEFAULT_BLOCK_MINUTES;

    setDragPreview(prev => (
      prev && prev.start === start && prev.minutes === minutes
        ? prev
        : { start, minutes, title: task.title }
    ));
  }, [dropMinutes, tasksRef]);

  const onDragEnd = useCallback((event) => {
    const start = dropMinutes();
    stopTracking();
    if (event.over?.id !== 'timeline' || start === null) return;

    const data = event.active.data.current || {};
    const task = tasksRef.current.find(t => t.id === data.taskId);
    if (!task) return;
    placeTask(
      task,
      start,
      task.scheduled_minutes || task.estimated_minutes || DEFAULT_BLOCK_MINUTES
    );
  }, [dropMinutes, placeTask, stopTracking, tasksRef]);

  // ─── Keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Not behind an open dialog: a box you have clicked no field in leaves
      // focus on <body>, where a bare letter would open a second one.
      if (composer || openTaskId) return;
      // `n` is the shortcut; `t` and `c` still work for anyone who learned
      // them here or has the Linear reflex.
      if (e.key === 'n' || e.key === 't' || e.key === 'c') { e.preventDefault(); openComposer(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openComposer, composer, openTaskId]);

  // ─── Copy ──────────────────────────────────────────────────────────────────

  const dateLine = useMemo(() => {
    const d = fromISODate(today);
    if (!d) return '';
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }, [today]);

  /*
    The one number the step you are on is about, said beside its Next button.
    Each of them is the thing you would check just before deciding you are done
    with this step, which is exactly where it is.
  */
  const summaryLine = useMemo(() => {
    // No hours before step 4. How long the day is, is the calendar's question;
    // saying it here invites you to answer it two steps early.
    if (step === 'plan') return `${day.open.length} on today`;
    if (step === 'attention') {
      return attentionCount === 0
        ? 'Nothing is asking'
        : `${attentionCount} asking · ${day.open.length} on today`;
    }
    if (step === 'projects') return `${day.open.length} on today`;
    const placed = day.open.filter(t => t.scheduled_start).length;
    return `${placed} of ${day.open.length} placed`;
  }, [attentionCount, day, step]);

  /*
    HAS THE DAY MOVED SINCE YOU SENT IT?

    Exactly, not approximately: both sides are the same pure reduction of the
    same blocks (`pushSignature`), one built from the tasks on screen and one
    returned by the push, so equal strings mean Google holds precisely this day.
    Nothing else on the page could tell you — a day that has been sent and a day
    that has been sent and then rearranged look identical on a timeline.
  */
  const pendingSignature = useMemo(
    () => pushSignature(dayPushItems(tasks, today)),
    [tasks, today]
  );
  /*
    Two different ways to be out of date, and the second is invisible from here:
    the day's CONTENT can have moved on (that is the signature), or the events
    can be sitting in a calendar we no longer write to, which only the server
    knows (`stale`). Both mean the same thing to you — press Send — so both are
    the same flag.
  */
  const syncView = useMemo(() => ({
    ...sync,
    dirty: sync.status === 'idle' && (sync.stale || pendingSignature !== sync.signature),
  }), [sync, pendingSignature]);

  /*
    One control, handed to whichever timeline is on screen. It lives in the
    timeline's own header because that is where the question it answers gets
    asked, and it is built here because everything it needs to do — reload the
    day, drop the connection — is this page's to do.
  */
  const googleControl = (
    <GoogleChip
      google={google}
      count={timeline.blocks.filter(block => block.kind === 'external').length}
      allDayCount={timeline.allDay.length}
      refreshing={!!google?.loading}
      onRefresh={loadGoogle}
      onDisconnect={handleDisconnect}
    />
  );

  const stepBody = () => {
    if (step === 'attention') {
      return (
        <AttentionPanel
          sections={sections}
          listFor={listFor}
          today={today}
          onPatch={patchTask}
          onOpen={onOpen}
          onPlan={planForToday}
          onRemoveFromToday={removeFromToday}
        />
      );
    }
    if (step === 'projects') {
      return (
        <ProjectPickerPanel
          tasks={tasks}
          lists={lists}
          today={today}
          onPlan={planForToday}
          onRemove={removeFromToday}
          onOpen={onOpen}
        />
      );
    }
    if (step === 'calendar') {
      return (
        <CalendarStep
          day={day}
          timeline={timeline}
          events={events}
          nowMinutes={nowMinutes}
          listFor={listFor}
          canvasRef={canvasRef}
          onPatch={patchTask}
          onOpen={onOpen}
          onSchedule={task => setScheduling(task.id)}
          onRemoveFromToday={removeFromToday}
          onSetHalf={setHalf}
          onUnschedule={unschedule}
          onPlaceTask={placeTask}
          onPlaceEvent={placeEvent}
          onPlaceExternal={placeExternal}
          onTagBlock={tagBlock}
          onRenameBlock={renameBlock}
          onDescribeBlock={describeBlock}
          onDeleteBlock={deleteBlock}
          tags={tags}
          onAddEvent={range => setEventDraft({ event: null, range })}
          onEditEvent={event => setEventDraft({ event })}
          dragPreview={dragPreview}
          googleControl={googleControl}
        />
      );
    }
    return (
      <CommitmentsPanel
        day={day}
        listFor={listFor}
        onPatch={patchTask}
        onOpen={onOpen}
        onRemoveFromToday={removeFromToday}
        onSetHalf={setHalf}
        onNew={openComposer}
      />
    );
  };

  const finalized = !!plan?.finalized;

  /*
    THE CALENDAR IS THE WINDOW, not something on a page that scrolls.

    On the two views the timeline is the main object — the calendar step, and
    the finished day — the page is exactly as tall as what is left of the
    window, and anything that does not fit scrolls inside its own column. Give
    those views an ordinary page instead and the window scrolls a hundred
    pixels past the bottom of a grid that is already showing you everything:
    a scrollbar that moves nothing you wanted to see.

    Wide screens only. Stacked into one column on a phone the two panels are
    genuinely taller than the window, and there the page is right to scroll.
  */
  const fitsWindow = finalized || step === 'calendar';

  return (
    /*
      Same white ground and same container as /tasks: this is another room in
      the same building, not a different app one tab across.
    */
    <div
      className={`max-w-[1400px] mx-auto px-6 lg:px-12 pt-6 pb-16 ${
        fitsWindow ? 'lg:h-[calc(100vh-6rem)] lg:pb-6 lg:flex lg:flex-col' : ''
      }`}
    >
      {loadError && <div className="mb-4"><LoadError error={loadError} onRetry={() => loadAll()} /></div>}
      {writeError && <WriteError error={writeError} onDismiss={() => setWriteError(null)} />}
      {googleNotice && (
        <GoogleNotice
          status={googleNotice.status}
          message={googleNotice.message}
          onDismiss={() => setGoogleNotice(null)}
        />
      )}

      {loading || !plan ? (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl border border-gray-200/70 p-6 shadow-sm animate-pulse">
            <div className="h-3 bg-gray-100 rounded w-40 mb-5" />
            <div className="h-3 bg-gray-50 rounded w-64" />
          </div>
          <div className="bg-white rounded-3xl border border-gray-200/70 p-6 shadow-sm animate-pulse">
            <div className="h-3 bg-gray-100 rounded w-28 mb-5" />
            <div className="h-3 bg-gray-50 rounded w-full mb-3" />
            <div className="h-3 bg-gray-50 rounded w-4/5 mb-3" />
            <div className="h-3 bg-gray-50 rounded w-2/3" />
          </div>
        </div>
      ) : (
        /*
          One DndContext over the whole page, because the drag it is for starts
          in a list and ends on the timeline — and on the finished day the
          blocks are still draggable, since a day that changes at eleven is the
          normal case and not an exception.

          `pointerWithin`: the drop target is whatever is under the CURSOR, not
          whatever the dragged element happens to overlap. Dragging a 13px grip
          handle across a page, the rectangle it covers is not the answer to
          "where did you mean to put this".
        */
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={stopTracking}
        >
          {finalized ? (
            <DayView
              day={day}
              dateLine={dateLine}
              summary={summary}
              timeline={timeline}
              events={events}
              nowMinutes={nowMinutes}
              listFor={listFor}
              canvasRef={canvasRef}
              refreshing={refreshing}
              onRefresh={() => loadAll({ quiet: true })}
              onReplan={replan}
              onPatch={patchTask}
              onOpen={onOpen}
              onUnschedule={unschedule}
              onPlaceTask={placeTask}
              onPlaceEvent={placeEvent}
              onPlaceExternal={placeExternal}
              onTagBlock={tagBlock}
              onRenameBlock={renameBlock}
              onDescribeBlock={describeBlock}
              onDeleteBlock={deleteBlock}
              tags={tags}
              onAddEvent={range => setEventDraft({ event: null, range })}
              onEditEvent={event => setEventDraft({ event })}
              dragPreview={dragPreview}
              googleControl={googleControl}
              googleSync={<GoogleSync google={google} sync={syncView} onSync={sendToGoogle} />}
            />
          ) : (
            <PlanFlow
              fill={fitsWindow}
              step={step}
              onStep={goStep}
              onBack={goBack}
              onNext={goNext}
              onFinish={finish}
              dateLine={dateLine}
              summaryLine={summaryLine}
            >
              {stepBody()}
            </PlanFlow>
          )}

          {/*
            The task under the cursor on its way ACROSS THE PAGE, so what you
            are moving is visible while you move it and not just at both ends of
            it. Over the grid it hands over to Timeline's DropGhost, which draws
            the same task as the block it is about to become — the card is what
            a task looks like in a list, and once it is over the calendar the
            useful question is not "what am I holding" but "what hour is this,
            and how much of it".

            Portalled to <body> for the reason TaskBoardView's overlay is: it
            is positioned `fixed` from viewport coordinates, and any ancestor
            carrying a transform — an entrance animation that has finished is
            enough — becomes the containing block for it, after which the card
            trails the pointer by that ancestor's offset. Out of the tree it is
            also out of the page's stacking context, so it says its own depth.

            `dropAnimation={null}`: the default flies the card back to the row
            it came from, which is the one thing this drag never means. The
            block appears on the timeline where you let go, so the card has
            nowhere to travel to — it hands over to the block and goes.
          */}
          {typeof document === 'undefined' ? null : createPortal(
            <DragOverlay
              dropAnimation={null}
              modifiers={[cursorTopLeft]}
              style={{ zIndex: OVERLAY_Z.drag }}
            >
              {dragTask && !dragPreview ? (
                <div className="rotate-1 opacity-95 cursor-grabbing">
                  <TaskDragCard task={dragTask} list={listFor(dragTask)} />
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )}
        </DndContext>
      )}

      {/* ── Overlays ───────────────────────────────────────────────────────── */}
      {openTask && (
        <TaskDetailPanel
          task={openTask}
          list={listFor(openTask)}
          planning
          onPatch={patchTask}
          onDelete={handleDelete}
          onClose={() => setOpenTaskId(null)}
        />
      )}

      {composer && (
        <TaskComposer
          defaults={composer}
          lists={listOptions}
          planning
          onCreate={handleCreate}
          onClose={() => setComposer(null)}
        />
      )}

      {scheduleTask && (
        <ScheduleDialog
          task={scheduleTask}
          defaultStart={nextFreeStart(
            timeline,
            scheduleTask.scheduled_minutes || scheduleTask.estimated_minutes || DEFAULT_BLOCK_MINUTES,
            nowMinutes
          )}
          onSave={schedule}
          onUnschedule={unschedule}
          onClose={() => setScheduling(null)}
        />
      )}

      {eventDraft && (
        <EventDialog
          event={eventDraft.event}
          // Drawn on the grid, the range IS the answer and the box only
          // confirms it. Opened from the button, there is nothing to go on but
          // the first gap long enough to hold an hour.
          defaultStart={eventDraft.range?.start ?? nextFreeStart(timeline, 60, nowMinutes)}
          defaultMinutes={eventDraft.range?.minutes ?? 60}
          onSave={saveEvent}
          onRemove={removeEvent}
          onClose={() => setEventDraft(null)}
        />
      )}

    </div>
  );
}
