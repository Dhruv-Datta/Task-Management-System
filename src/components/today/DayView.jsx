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

  "Re-plan" goes back into the flow at step one. It is deliberately quiet and
  deliberately present: the day changes at eleven o'clock more often than any
  planner likes to admit, and a finished plan you cannot reopen is one you start
  keeping in your head instead.

  Which is exactly why the Google status is up here in the header next to it. If
  the day can change at eleven, then a day that was sent at nine can be out of
  date by lunchtime — and a sent day and a sent-then-rearranged day look
  identical on a timeline. So it is said in words: sent, or send the changes.
*/

import { Pencil, RefreshCw } from 'lucide-react';
import { compareTasks, priorityMeta } from '@/lib/tasks';
import { formatClock, clockToMinutes } from '@/lib/dates';
import { GroupLabel, ListBadge, Panel, PanelHead } from '@/components/dashboard/Panel';
import {
  DateChip, HardFlag, PriorityIcon, StatusDot, StatusPicker,
} from '@/components/tasks/TaskPickers';
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
function DayTaskRow({ task, list, onPatch, onOpen }) {
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

      {task.done && (
        <span className="flex-shrink-0 w-[22px] h-[22px] flex items-center justify-center">
          <StatusDot status={task.status} size={13} />
        </span>
      )}
    </div>
  );
}

export default function DayView({
  day, dateLine, summary, timeline, events, nowMinutes, listFor, canvasRef, refreshing,
  dragPreview, onRefresh, onReplan, onPatch, onOpen, onUnschedule, onPlaceTask, onPlaceEvent,
  onPlaceExternal, onAddEvent, onEditEvent, onTagBlock, onRenameBlock, onDescribeBlock,
  onDeleteBlock, tags,
  googleControl = null, googleSync = null,
}) {
  // Priority order, not plan order: `compareTasks` is priority then due date,
  // which is the same ranking the rest of the app uses.
  const mustDo = [...day.commitments].sort(compareTasks);
  const optional = [...day.optional].sort(compareTasks);

  const placed = day.open.filter(task => task.scheduled_start).length;
  const left = day.open.length;

  return (
    /*
      Wide, the finished day is exactly one screen: the header on top, and under
      it two columns that end where the window does and scroll inside
      themselves. Nothing here is worth scrolling the page for.
    */
    <div className="lg:flex lg:flex-col lg:flex-1 lg:min-h-0">
      <section
        className="relative overflow-hidden rounded-3xl bg-white border border-gray-200/70 px-5 sm:px-7 pt-4 pb-5 lg:flex-shrink-0"
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

      {/* The calendar leads, because the finished day's first question is
          "what now"; the priority column is the fallback when the schedule
          stops being true. */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(300px,400px)] gap-5 items-start lg:flex-1 lg:min-h-0 lg:items-stretch lg:grid-rows-[minmax(0,1fr)]">
        <Timeline
          timeline={timeline}
          events={events}
          nowMinutes={nowMinutes}
          canvasRef={canvasRef}
          onOpenTask={onOpen}
          onUnschedule={onUnschedule}
          onPlaceTask={onPlaceTask}
          onPlaceEvent={onPlaceEvent}
          onPlaceExternal={onPlaceExternal}
          onAddEvent={onAddEvent}
          onEditEvent={onEditEvent}
          onTagBlock={onTagBlock}
          onRenameBlock={onRenameBlock}
          onDescribeBlock={onDescribeBlock}
          onDeleteBlock={onDeleteBlock}
          tags={tags}
          dragPreview={dragPreview}
          googleControl={googleControl}
          sticky={false}
          fill
        />

        <Panel className="lg:h-full lg:flex lg:flex-col lg:min-h-0">
          <PanelHead
            title="By priority"
            count={day.open.length}
            hint={day.open.length > 0 ? 'what matters, if the hours slip' : 'nothing left'}
          />

          <div className="px-2 pb-3 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
            {day.planned.length === 0 ? (
              <p className="px-5 py-8 text-[13px] text-gray-400 text-center">
                Nothing on today. Re-plan to put something on it.
              </p>
            ) : (
              <>
                {mustDo.length > 0 && (
                  <>
                    <GroupLabel count={mustDo.length}>Must finish</GroupLabel>
                    {mustDo.map(task => (
                      <DayTaskRow key={task.id} task={task} list={listFor(task)} onPatch={onPatch} onOpen={onOpen} />
                    ))}
                  </>
                )}

                {optional.length > 0 && (
                  <div className={mustDo.length > 0 ? 'mt-2 pt-1 border-t border-gray-100' : ''}>
                    <GroupLabel count={optional.length}>If there&rsquo;s time</GroupLabel>
                    {optional.map(task => (
                      <DayTaskRow key={task.id} task={task} list={listFor(task)} onPatch={onPatch} onOpen={onOpen} />
                    ))}
                  </div>
                )}

                {day.done.length > 0 && (
                  <div className="mt-2 pt-1 border-t border-gray-100">
                    <GroupLabel tone="emerald" count={day.done.length}>Finished</GroupLabel>
                    {day.done.map(task => (
                      <DayTaskRow key={task.id} task={task} list={listFor(task)} onPatch={onPatch} onOpen={onOpen} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
