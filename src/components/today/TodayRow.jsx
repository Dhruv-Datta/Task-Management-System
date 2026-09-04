'use client';

/*
  One task on today, wherever today is being read or built.

  ONE LINE. Read left to right it is the sentence you would say about it: how
  much it matters and whether it is going to hurt, what it is, how long it
  takes, when it is owed, which half of the day it is in, and when you are doing
  it. The last of those is deliberately last, on the right, where the eye ends:
  the times line up into a column you can read as a schedule.

  `showStatus` is the progress ring at the head of the row. It is off while you
  are BUILDING the day, because a four-state pipeline — not started, in
  progress, waiting review, done — is a report on work you have not started
  yet, and ten of those rings down the left edge is a column of noise in front
  of the titles, all of them saying the same nothing. It comes back on the
  surfaces that are about doing the work rather than choosing it.

  Every CONTROL sits on the title's line, right-aligned, giving up its least
  important members first as the column narrows (the tag goes, then the
  estimate). The one thing under the title is the list the task came from: it is
  not a control, it is the task describing itself, and a chip for it in among
  the buttons reads as one more thing to press. The title truncates rather than
  wrapping, because a wrapped title puts every row below it at a different
  height and the list stops being scannable — the second line is one line, at a
  fixed size, for the same reason.

  `timing` is what separates the row on step 1 from the same row on step 4. WHEN
  is the calendar step's question: asking it while you are still deciding WHAT
  you are doing today is asking you to schedule a list you have not finished
  writing. So step 1's rows carry no time at all, and on step 4 the row shows
  the block's start once there IS a block. There is no estimate control anywhere
  on the row any more: the length of the block is the estimate, written when you
  drop it (at DEFAULT_BLOCK_MINUTES) and again every time you drag its edge.

  The two verbs that are not decisions — take it off the day, grab it — appear
  on hover. `completable` is the ✓ at the tail, off for the same reason as
  `showStatus`: on the step where you are still DECIDING the day it is the
  loudest button on a row that is not asking you to do anything yet. Both come
  back on the surfaces that are about working through the day.

  It is the task itself, not a copy: every control on it is the same picker
  /tasks uses, so finishing something here finishes it everywhere.

  The row is also a drag handle for the timeline beside it (see Timeline.jsx and
  the DndContext on the page). Dragging is the fast way; the time chip opens the
  same thing as a form, because a drag is a bad way to say "2:15 for forty-five
  minutes" and a good way to say "about then".
*/

import { useDraggable } from '@dnd-kit/core';
import { ArrowDownToLine, ArrowUpToLine, Check, GripVertical, X } from 'lucide-react';
import { TASK_COLOR, inkOn } from '@/lib/colors';
import { formatDuration } from '@/lib/dates';
import { DEFAULT_BLOCK_MINUTES, priorityMeta } from '@/lib/tasks';
import { ListBadge } from '@/components/dashboard/Panel';
import {
  DailyPriorityToggle, DateChip, DatePicker, HardToggle, PriorityPicker, StatusPicker, TagChip,
} from '@/components/tasks/TaskPickers';
import { ScheduleChip } from './PlanControls';

/*
  The height of the title's own line, given to every control on the row.

  The row is two lines now — the title, and the list it came from under it — and
  a control centred on that BLOCK sits in the gap between the two, attached to
  neither. Everything you can press belongs to the task, which is the first
  line, so each cluster is a box exactly that tall with its contents centred in
  it. The row itself aligns to the top (`items-start`) and the second line hangs
  below, which is what a description does.
*/
const TITLE_LINE = 'h-[18px]';

/*
  THE TASK ITSELF, IN FLIGHT: what is drawn under the cursor between the grip
  and the drop (the page's DragOverlay renders it).

  A narrow card rather than a copy of the row. The row is as wide as the panel
  it lives in and carries eight controls, none of which you can press while you
  are holding it, and a full-width strip of buttons dragged across the timeline
  covers the hours you are aiming at. So the thing in your hand is the two lines
  the BLOCK will have once it lands — what it is, and how long it takes — which
  makes the drop a preview of the result rather than a copy of the source.

  It is only what the task looks like ON ITS WAY to the calendar. The moment the
  pointer crosses onto the grid this stops being drawn and Timeline's DropGhost
  takes over, drawing the same task at the size and in the place it is about to
  occupy — one thing in flight the whole way, answering the question that is
  actually live at each end of the trip. The row it came from stays in the list,
  dimmed: the drag gives the task a time, it does not take it off the day.
*/
export function TaskDragCard({ task, list }) {
  const minutes = task.scheduled_minutes || task.estimated_minutes || DEFAULT_BLOCK_MINUTES;
  // The card is the block it is about to become, so it is drawn the way the
  // timeline draws one: solid, in the one red every task on the day is.
  const ink = inkOn(TASK_COLOR);

  return (
    <div
      style={{ backgroundColor: TASK_COLOR, color: ink }}
      className="w-[230px] overflow-hidden rounded-md px-2 py-[3px] shadow-lg shadow-gray-900/25"
    >
      <p className="truncate text-[12px] font-semibold leading-[15px]">{task.title}</p>
      <p className="truncate text-[11px] leading-[14px] tabular-nums" style={{ opacity: 0.85 }}>
        {formatDuration(minutes)}{list ? ` · ${list.name}` : ''}
      </p>
    </div>
  );
}

export default function TodayRow({
  task, list, optional = false, timing = true, completable = true, showStatus = true,
  onPatch, onOpen, onSchedule, onRemove, onMove, onSetHalf,
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `plan-${task.id}`,
    data: { type: 'task', taskId: task.id },
  });
  const stop = e => e.stopPropagation();
  const urgent = task.priority === 'urgent';

  return (
    <div
      ref={setNodeRef}
      onClick={() => onOpen(task)}
      className={`group relative flex items-start gap-1.5 rounded-xl pl-1 pr-1.5 py-1 cursor-pointer transition-colors ${
        isDragging ? 'opacity-40 bg-gray-50' : 'hover:bg-gray-50'
      }`}
    >
      {urgent && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
          style={{ backgroundColor: priorityMeta('urgent').color }}
        />
      )}

      {/* The grip holds its width whether or not it is showing, so nothing
          shifts sideways when you point at a row. */}
      <span
        {...attributes}
        {...listeners}
        onClick={stop}
        title="Drag onto the timeline"
        className={`flex-shrink-0 flex items-center ${TITLE_LINE} text-gray-300 opacity-0 group-hover:opacity-100 hover:text-gray-600 cursor-grab active:cursor-grabbing transition-all`}
      >
        <GripVertical size={13} />
      </span>

      {showStatus && (
        <span onClick={stop} className={`flex-shrink-0 flex items-center ${TITLE_LINE}`}>
          <StatusPicker status={task.status} onSelect={s => onPatch(task.id, { status: s })} />
        </span>
      )}

      {/* `pr-1` on top of the row's own gap: the flag is a glyph with no box
          around it, so it sits closer to the title than a chip of the same
          width would and needs the difference back. */}
      <span onClick={stop} className={`flex-shrink-0 flex items-center gap-1 pr-1 ${TITLE_LINE}`}>
        <PriorityPicker priority={task.priority} onSelect={p => onPatch(task.id, { priority: p })} />
        {/* Hard is set where you feel it: while looking at the day and deciding
            what to put off. It changes nothing about today — it is what brings
            the task back a week early NEXT time. */}
        <HardToggle
          value={task.is_hard}
          onToggle={next => onPatch(task.id, { is_hard: next })}
          size={11}
        />
      </span>

      {/* The title, and under it the list it came from — the row's own quiet
          second line, where a description would sit, rather than another chip
          filed in with the controls. */}
      <span className="min-w-0 flex-1 flex flex-col gap-[1px]">
        {/* A block, not a flex box: `truncate` needs a block to put its
            ellipsis in. The line height IS the title line every control is
            squared up against. */}
        <span className={`min-w-0 truncate text-[13px] leading-[18px] ${
          optional ? 'text-gray-500' : urgent ? 'text-gray-950 font-semibold' : 'text-gray-800'
        }`}>
          {task.title}
        </span>
        <ListBadge list={list} sub />
      </span>

      {/* Right-hand side: everything the row KNOWS, dropping the least
          important first as the column narrows. */}
      <span onClick={stop} className={`flex items-center gap-1 flex-shrink-0 ${TITLE_LINE}`}>
        {task.tag && <TagChip tag={task.tag} dense className="hidden xl:inline-flex" />}

        {task.due_date && (
          <span className="hidden sm:flex items-center mr-1">
            <DatePicker value={task.due_date} onSelect={d => onPatch(task.id, { due_date: d })} label="Due date">
              <DateChip iso={task.due_date} dense />
            </DatePicker>
          </span>
        )}

        {onSetHalf && (
          <DailyPriorityToggle
            value={optional ? 'optional' : 'must_do'}
            onChange={half => onSetHalf(task, half)}
            dense
          />
        )}

        {/* Only ever a READOUT of the block: the time it starts, which is worth
            a place on the row. There is no "Schedule" button in the empty case
            — the timeline is right there and the gesture is to drag it onto the
            hour you mean, not to open a form about it. */}
        {timing && task.scheduled_start && <ScheduleChip task={task} onSchedule={onSchedule} />}

        {onMove && (
          <button
            type="button"
            onClick={() => onMove(task)}
            title={optional ? 'Move up to today commitments' : 'Move to optional'}
            className="p-1 rounded-md text-gray-400 hover:text-gray-800 hover:bg-gray-100 transition-all active:scale-90"
          >
            {optional ? <ArrowUpToLine size={13} /> : <ArrowDownToLine size={13} />}
          </button>
        )}

        <button
          type="button"
          onClick={() => onRemove(task)}
          title="Take off today"
          className="p-1 rounded-md text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all active:scale-90"
        >
          <X size={13} />
        </button>

        {completable && (
          <button
            type="button"
            onClick={(e) => { stop(e); onPatch(task.id, { status: 'completed' }); }}
            title="Mark done"
            className="flex-shrink-0 w-[22px] h-[22px] rounded-md flex items-center justify-center text-gray-300 hover:text-white hover:bg-emerald-500 transition-all active:scale-75"
          >
            <Check size={13} strokeWidth={3} />
          </button>
        )}
      </span>
    </div>
  );
}
