'use client';

/*
  THE FINISHED DAY. What /today is once the planning flow is done.

  The flow asked four questions and this is the answer to all of them at once,
  which is the one moment where showing everything together is right: you are no
  longer deciding, you are working, and while you work the only two things you
  need are WHEN each thing happens and WHAT is left.

  So: the calendar, full width, as the main object on the page — and beside it
  the day's work in priority order, which is the list you fall back to the
  moment the schedule slips, because it answers "the next hour got eaten, what
  actually matters" without you having to re-read the grid.

  The two are the same tasks. Ticking one off in the list greys its block, and
  everything in the list still opens the task itself, so this is a place you can
  work from rather than a summary you have to leave in order to act.

  AND THE SAME DAY AS A BOARD, behind the switch in the header. The calendar and
  the list beside it both answer WHEN and WHAT; neither of them answers where a
  thing is up to, which is the question you actually have at eleven o'clock with
  three things half-started. So the day is also the four status columns the rest
  of the app is built on, holding today and nothing else — you drag a card into
  In progress as you start it, and into Completed as you finish it, which is the
  same write the tick in the column beside the calendar makes.

  One day, two drawings of it, one header over both: the counts, the Google
  status and Re-plan do not move when you switch, because they are facts about
  the day rather than about the view.

  "Re-plan" goes back into the flow at step one. It is deliberately quiet and
  deliberately present: the day changes at eleven o'clock more often than any
  planner likes to admit, and a finished plan you cannot reopen is one you start
  keeping in your head instead.

  Which is exactly why the Google status is up here in the header next to it. If
  the day can change at eleven, then a day that was sent at nine can be out of
  date by lunchtime — and a sent day and a sent-then-rearranged day look
  identical on a timeline. So it is said in words: sent, or send the changes.
*/

import { useState } from 'react';
import { CalendarRange, LayoutGrid, Pencil, RefreshCw, X } from 'lucide-react';
import { compareTasks, priorityMeta } from '@/lib/tasks';
import { compareByPlan } from '@/lib/agenda';
import { formatClock, clockToMinutes } from '@/lib/dates';
import { useDayLayout } from '@/lib/taskPrefs';
import { GroupLabel, ListBadge, Panel, PanelHead } from '@/components/dashboard/Panel';
import {
  DateChip, HardFlag, PriorityIcon, StatusDot, StatusPicker,
} from '@/components/tasks/TaskPickers';
import TaskBoardView from '@/components/tasks/TaskBoardView';
import Timeline from './Timeline';

/*
  One line of the day's work, ordered by how much it matters rather than by when
  it happens: this column exists precisely to be the OTHER ordering from the
  calendar next to it.

  The time is on the left, in a fixed-width column, so the whole list has a
  spine you can read down; a task with no block shows a dash there rather than
  shifting the title left, because a ragged left edge is what makes a list of
  twelve unreadable.
*/
function DayTaskRow({ task, list, onPatch, onOpen, onRemove }) {
  const start = clockToMinutes(task.scheduled_start);
  const urgent = task.priority === 'urgent';

  return (
    <div
      onClick={() => onOpen(task)}
      className="group relative flex items-start gap-2 pl-3 pr-2 py-[7px] rounded-xl cursor-pointer hover:bg-gray-50 transition-colors"
    >
      {urgent && !task.done && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
          style={{ backgroundColor: priorityMeta('urgent').color }}
        />
      )}

      <span
        className={`flex-shrink-0 w-[52px] pt-[1px] text-[11px] font-semibold tabular-nums ${
          start === null ? 'text-gray-300' : task.done ? 'text-gray-300' : 'text-gray-500'
        }`}
      >
        {start === null ? '—' : formatClock(start)}
      </span>

      <span onClick={e => e.stopPropagation()} className="flex-shrink-0 mt-[1px] flex items-center">
        <StatusPicker status={task.status} onSelect={s => onPatch(task.id, { status: s })} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <PriorityIcon priority={task.priority} />
          <HardFlag hard={task.is_hard && !task.done} size={11} />
          <span className={`min-w-0 flex-1 truncate text-[13px] ${
            task.done ? 'text-gray-400 line-through' : urgent ? 'text-gray-950 font-semibold' : 'text-gray-800'
          }`}>
            {task.title}
          </span>
        </div>

        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
          <ListBadge list={list} />
          {task.due_date && <DateChip iso={task.due_date} done={task.done} dense />}
        </div>
      </div>

      {/*
        OFF THE DAY, from the day itself.

        The plan is finished, not settled: half of what a day does after nine
        o'clock is stop being true, and until now the only way to say "not today
        after all" from this screen was to re-open the whole four-step flow to
        take one row out of it. The × is that sentence, on the row it is about.

        On hover, at the tail, and it takes nothing else with it: the task keeps
        its list, its title and its priority, and an ARRIVED deadline is cleared
        with it so the day cannot simply hand it back a second later (see
        `removeFromToday` in /today). Not offered on finished work — taking
        something you have already done off the day is rewriting the record of
        it rather than changing a plan.
      */}
      {onRemove && !task.done && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(task); }}
          title="Take off today"
          className="flex-shrink-0 mt-[1px] p-1 rounded-md text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all active:scale-90"
        >
          <X size={13} />
        </button>
      )}

      {task.done && (
        <span className="flex-shrink-0 w-[22px] h-[22px] flex items-center justify-center">
          <StatusDot status={task.status} size={13} />
        </span>
      )}
    </div>
  );
}

/*
  THE TWO WAYS TO READ A DAY YOU HAVE ALREADY PLANNED.

  Same day, same tasks, two questions. The CALENDAR answers "what now" — the
  hours, and what is in them. The BOARD answers "where is each of these up to":
  four status columns, and you drag a card into In progress as you start it. The
  second is the one you want at eleven o'clock with three things half-done,
  which the timeline cannot tell you — a block says WHEN something is happening
  and nothing at all about whether it is under way.

  A pair of buttons rather than a link somewhere else, because it is one page
  either way: the header above stays put, the thing under it changes. Drawn as
  the app bar's view switcher is (see Navbar) — a recessed group, only the
  active one a solid chip — so the same control means the same thing in both
  places.
*/
const DAY_LAYOUTS = [
  { key: 'calendar', label: 'Calendar', icon: CalendarRange, hint: 'The hours, and what is in them' },
  { key: 'board', label: 'Board', icon: LayoutGrid, hint: 'Status columns — drag a task as you start it' },
];

function LayoutSwitch({ layout, onSelect }) {
  return (
    <div role="group" aria-label="How to read the day" className="flex items-center gap-0.5 p-1 rounded-xl bg-gray-100/80">
      {DAY_LAYOUTS.map(option => {
        const Icon = option.icon;
        const active = layout === option.key;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onSelect(option.key)}
            title={option.hint}
            aria-pressed={active}
            className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-colors ${
              active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Icon size={14} strokeWidth={2.25} className={active ? 'text-emerald-600' : ''} />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function DayView({
  day, dateLine, summary, timeline, nowMinutes, listFor, canvasRef, refreshing,
  dragPreview, onRefresh, onReplan, onPatch, onOpen, onUnschedule, onPlaceTask, onPlaceEvent,
  onPlaceExternal, onCreateEvent, onStatusBlock, onTagBlock, onRenameBlock, onDescribeBlock,
  onDeleteBlock, tags, onBoardDrag, onAddTask, onRemoveFromToday, onSetHalf,
  googleControl = null, googleSync = null,
}) {
  const [layout, setLayout] = useDayLayout();
  /*
    The board's Completed column, shown by default. What you finished today is
    the half of the day worth looking at — the column beside the calendar makes
    the same choice — and the toggle on that column is how you put it away once
    the pile gets long enough to be in the way.
  */
  const [showCompleted, setShowCompleted] = useState(true);

  // Priority order, not plan order: `compareTasks` is priority then due date,
  // which is the same ranking the rest of the app uses.
  const mustDo = [...day.commitments].sort(compareTasks);
  const optional = [...day.optional].sort(compareTasks);

  /*
    FINISHED, AS THE CALENDAR KNOWS IT: what had an hour on this day's grid and
    got done.

    Not everything the day counts as finished. A task that is late lands on
    today whether you asked for it or not — that is the whole point of `owed`
    (see lib/agenda) — and it gets a `planned_date` of today the moment the page
    catches the column up. Tick one of those off from anywhere in the app and it
    used to appear here, under a heading that reads as a record of the day you
    planned, having never been part of it.

    A block is the thing that says you did plan it: you gave it an hour, on this
    grid, beside everything else. So this list is the blocks you struck through,
    which is exactly what the column next to it is showing.

    The header above still counts the whole day — everything on today, finished
    or not, timed or not — because that number is about the day and this list is
    about the calendar.
  */
  const finished = day.done.filter(task => task.scheduled_start);

  const placed = day.open.filter(task => task.scheduled_start).length;
  const left = day.open.length;

  /*
    WHAT THE BOARD HOLDS: the day, and only the day.

    `day.planned` is everything on today — what you chose in the flow plus what
    you owe — finished work included, which is the point: a status board with
    the completed cards taken out of it is a board that can never show you a
    card arriving in Completed, and arriving there is the gesture the whole
    column exists for.

    It is a SLICE of the real list, so it is handed to the board as one (see
    TaskBoardView): no manual reordering, because `position` is one order per
    list and this view spans every list at once; the list's badge on each card,
    because it does; and the day's own order inside each column — when it
    happens, then how much it matters (`compareByPlan`), the same order the
    timeline reads in.
  */
  const boardTasks = showCompleted ? day.planned : day.planned.filter(task => !task.done);

  return (
    /*
      An ordinary page: the header, then the calendar and the day's work beside
      it, both at their own full height. One scrollbar — the window's — moves
      the whole day at once, instead of three that each move a piece of it.
    */
    <div>
      <section
        className="relative overflow-hidden rounded-3xl bg-white border border-gray-200/70 px-5 sm:px-7 pt-4 pb-5"
        style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 16px 36px -20px rgba(16,24,40,0.16)' }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-16 w-[360px] h-[360px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.10) 0%, rgba(16,185,129,0) 68%)' }}
        />

        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{dateLine}</p>
            <h1 className="mt-1 text-[24px] sm:text-[27px] font-bold text-gray-900 leading-tight tracking-[-0.02em]">
              {left === 0
                ? 'The day is done.'
                : `${left} ${left === 1 ? 'thing' : 'things'} left today`}
            </h1>
            <p className="mt-1 text-[13px] text-gray-500">
              {summary.done} of {summary.planned} done
              {left > 0 && (placed === left ? ' · all of it placed' : ` · ${placed} of ${left} placed`)}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Which of the two questions you are asking of the day. First in
                the row, because it decides what the rest of the page IS; the
                buttons after it act on the day however it is drawn. */}
            <LayoutSwitch layout={layout} onSelect={setLayout} />

            {/* Where the day WENT, beside where it is. It sits in the header
                rather than on the timeline because it is a fact about the whole
                finished day, and because this is the one line you read on your
                way out of the app. */}
            {googleSync}
            <button
              type="button"
              onClick={onRefresh}
              title="Refresh"
              aria-label="Refresh"
              className="p-2 rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            >
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={onReplan}
              title="Go back through the four planning steps"
              className="flex items-center gap-1.5 text-[13.5px] font-semibold pl-2.5 pr-3.5 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 transition-all active:scale-95"
            >
              <Pencil size={14} strokeWidth={2.5} />
              Re-plan the day
            </button>
          </div>
        </div>

        <div aria-hidden className="absolute left-0 right-0 bottom-0 h-[3px] bg-gray-100">
          <div
            className="h-full bg-emerald-500 transition-[width] duration-700"
            style={{ width: `${Math.round(summary.ratio * 100)}%` }}
          />
        </div>
      </section>

      {layout === 'board' ? (
        /*
          THE DAY AS A WORKFLOW. Four columns, the same four the rest of the app
          uses, holding only what is on today — so moving a card to In progress
          here is the same write as moving it on /tasks, and the card is in the
          right column in both places a second later.

          Full width, and alone: the board is already four columns of cards, and
          the priority list beside the calendar exists to be the OTHER ordering
          from the grid. There is no grid here to be the other ordering from,
          and a fifth column of the same tasks would be the same day said twice.
        */
        <div className="mt-4">
          <TaskBoardView
            tasks={boardTasks}
            sort={compareByPlan}
            listFor={listFor}
            reorderable={false}
            onPatch={onPatch}
            onOpen={onOpen}
            onAdd={onAddTask}
            onRemove={onRemoveFromToday}
            /* The must-do star. The column beside the calendar says the same
               thing with its two headings; a board's columns are the statuses,
               so here it has to be on the card. */
            onSetHalf={onSetHalf}
            onDragCommit={onBoardDrag}
            showCompleted={showCompleted}
            onToggleCompleted={() => setShowCompleted(v => !v)}
          />

          {day.planned.length === 0 && (
            <p className="mt-4 text-center text-[13px] text-gray-400">
              Nothing on today. Re-plan to put something on it.
            </p>
          )}
        </div>
      ) : (
        /* The calendar leads, because the finished day's first question is
           "what now"; the priority column is the fallback when the schedule
           stops being true. */
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(300px,400px)] gap-5 items-start">
          <Timeline
            timeline={timeline}
            nowMinutes={nowMinutes}
            canvasRef={canvasRef}
            onOpenTask={onOpen}
            onUnschedule={onUnschedule}
            onRemoveTask={onRemoveFromToday}
            onPlaceTask={onPlaceTask}
            onPlaceEvent={onPlaceEvent}
            onPlaceExternal={onPlaceExternal}
            onCreateEvent={onCreateEvent}
            onStatusBlock={onStatusBlock}
            onTagBlock={onTagBlock}
            onRenameBlock={onRenameBlock}
            onDescribeBlock={onDescribeBlock}
            onDeleteBlock={onDeleteBlock}
            tags={tags}
            dragPreview={dragPreview}
            googleControl={googleControl}
          />

          <Panel>
            <PanelHead
              title="By priority"
              count={day.open.length}
              hint={day.open.length > 0 ? 'what matters, if the hours slip' : 'nothing left'}
            />

            <div className="px-2 pb-3">
              {/* Nothing to draw rather than nothing on the day: with Finished
                  narrowed to the blocks (above), a day holding only untimed
                  finished work has three empty groups and no rows, and an empty
                  box says less than a sentence does. */}
              {mustDo.length + optional.length + finished.length === 0 ? (
                <p className="px-5 py-8 text-[13px] text-gray-400 text-center">
                  Nothing on today. Re-plan to put something on it.
                </p>
              ) : (
                <>
                  {mustDo.length > 0 && (
                    <>
                      <GroupLabel count={mustDo.length}>Must finish</GroupLabel>
                      {mustDo.map(task => (
                        <DayTaskRow
                          key={task.id}
                          task={task}
                          list={listFor(task)}
                          onPatch={onPatch}
                          onOpen={onOpen}
                          onRemove={onRemoveFromToday}
                        />
                      ))}
                    </>
                  )}

                  {optional.length > 0 && (
                    <div className={mustDo.length > 0 ? 'mt-2 pt-1 border-t border-gray-100' : ''}>
                      <GroupLabel count={optional.length}>If there&rsquo;s time</GroupLabel>
                      {optional.map(task => (
                        <DayTaskRow
                          key={task.id}
                          task={task}
                          list={listFor(task)}
                          onPatch={onPatch}
                          onOpen={onOpen}
                          onRemove={onRemoveFromToday}
                        />
                      ))}
                    </div>
                  )}

                  {finished.length > 0 && (
                    <div className="mt-2 pt-1 border-t border-gray-100">
                      <GroupLabel tone="emerald" count={finished.length}>Finished</GroupLabel>
                      {finished.map(task => (
                        <DayTaskRow key={task.id} task={task} list={listFor(task)} onPatch={onPatch} onOpen={onOpen} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
