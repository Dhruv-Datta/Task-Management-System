'use client';

/*
  The two shapes a task takes on screen: a dense ROW (list layout) and a CARD
  (board + week layouts). Both are presentational: every mutation goes back up
  through `onPatch(id, updates)` so the page stays the single writer.

  Both label their list only when it has to be said. The BOARD is inside one
  list, where the label would be the same word on every card; the list and the
  calendar are every task you own at once (see /tasks), where it is the only
  thing telling two similarly-named tasks apart.
*/

import { CalendarDays, ListChecks, Trash2 } from 'lucide-react';
import { isOverdue, subtaskProgress } from '@/lib/tasks';
import {
  DateChip, DatePicker, HardFlag, PriorityPicker, StatusChip, StatusPicker,
} from './TaskPickers';

/*
  Which list a row came from: a dot to scan by, a name to read.

  Drawn beside the title rather than out in the metadata cluster on the right,
  because it is part of WHAT the task is and not another fact about it — and
  because that cluster's job is to line its contents up in columns, which a
  name of any length would wreck.

  The dot never disappears and the name is what gives up width first: at a
  glance the colour is what you are reading anyway, and eight lists' worth of
  full names down a narrow column is a second list to read.
*/
function ListTag({ list, tight = false }) {
  if (!list) return null;
  return (
    <span
      title={`List: ${list.name}`}
      className="flex-shrink-0 inline-flex items-center gap-1 min-w-0 max-w-[110px] text-[10.5px] font-semibold text-gray-400"
    >
      <span
        aria-hidden
        className="w-[6px] h-[6px] rounded-full flex-shrink-0"
        style={{ backgroundColor: list.color }}
      />
      {/*
        `tight` is the ROW asking for less. A row is one line competing for
        width with a title, a status, a count, a date and a delete button, and
        on a phone there is not enough of it to go round — so there the name
        goes and the dot stays, which is what you were scanning anyway. A card
        gives this its own line and can afford the word.
      */}
      <span className={`truncate ${tight ? 'hidden sm:inline' : ''}`}>{list.name}</span>
    </span>
  );
}

function SubtaskBadge({ subtasks, dense = false }) {
  const { done, total } = subtaskProgress(subtasks);
  if (!total) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-gray-400 whitespace-nowrap ${dense ? 'text-[10.5px] px-0.5' : 'text-[11px]'}`}
      title={`${done} of ${total} subtasks done`}
    >
      <ListChecks size={dense ? 10 : 11} />
      {done}/{total}
    </span>
  );
}

// ─── List row ────────────────────────────────────────────────────────────────

/*
  A row is read down a column, not across one card, so it is laid out as
  columns: priority, then the title taking whatever width is left, then the
  metadata in fixed slots on the right. Fixed slots are the whole point: the
  due dates line up under each other down the page, and a row with no date
  leaves a gap rather than sliding everything else along.

  No status dot here. In a list the section heading already says the status, and
  the dot only added a second thing to read on every row. When you're grouped by
  something else, `showStatus` puts it back as a word.
*/
export function TaskRow({ task, list = null, showStatus = false, onPatch, onOpen, onDelete }) {
  return (
    <div
      onClick={() => onOpen(task)}
      className="group flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
    >
      <span onClick={e => e.stopPropagation()} className="flex-shrink-0 flex items-center gap-1">
        <PriorityPicker priority={task.priority} onSelect={p => onPatch(task.id, { priority: p })} />
        <HardFlag hard={task.is_hard && !task.done} size={11} />
      </span>

      <span className="flex-1 min-w-0 flex items-center gap-2">
        <span className={`truncate text-[13px] ${task.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
          {task.title}
        </span>
        <ListTag list={list} tight />
      </span>

      <span className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
        {showStatus && (
          <StatusPicker status={task.status} onSelect={s => onPatch(task.id, { status: s })} align="right">
            <StatusChip status={task.status} dense className="hidden sm:inline-flex" />
          </StatusPicker>
        )}
        <SubtaskBadge subtasks={task.subtasks} />
        {/*
          A slot the dates align in, present or not — so they read down the page
          as a column, and an undated row leaves a gap rather than sliding
          everything else along. (It shows nothing until you point at it: an
          empty box on every such row says less than the space does.)

          MIN width, not a fixed one. A DateChip never wraps, so a label wider
          than the slot — "Tomorrow", "12d late" — cannot shrink to fit it. Given
          a fixed width it overflowed instead, and `justify-end` sent the
          overflow LEFT, straight over the subtask count beside it. As a minimum,
          a long label widens its own slot and takes the width off the title,
          which is the one thing on the row that can spare it.
        */}
        <span className="min-w-[74px] flex justify-end">
          <DatePicker value={task.due_date} onSelect={d => onPatch(task.id, { due_date: d })} label="Due date">
            {task.due_date
              ? <DateChip iso={task.due_date} done={task.done} />
              : (
                <span className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 text-[10.5px] font-semibold text-gray-400 rounded-md px-1.5 py-[5px] hover:bg-gray-100 transition-all">
                  <CalendarDays size={12} strokeWidth={2.5} />
                  Due
                </span>
              )}
          </DatePicker>
        </span>
        <button
          type="button"
          onClick={() => onDelete(task)}
          className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-all"
          title="Delete task"
        >
          <Trash2 size={13} />
        </button>
      </span>
    </div>
  );
}

// ─── Board / week card ───────────────────────────────────────────────────────

/*
  The card reads top to bottom in the order you ask about a task: what it is,
  who owns it, when it is owed.

    !!  Rewrite the DCF model       ← priority, then the title
    ◍ Priya                         ← the list it lives in, named
    3d   2/5                        ← when it's owed, then the subtasks

  A name is the one thing on this card that can be any length, so it is the one
  thing allowed to truncate: the pill gives up width and cuts itself rather than
  widening the card. A calendar column is a seventh of the screen wide, so that
  is the difference between "kitchen" and "kit…".

  No status on the card. On the board the column the card sits in IS its status;
  in the calendar the columns are days, and a status you can't read off the
  layout is still not something you're asking a calendar.

  `dense` is the calendar asking for its own size: a board column is roomy and a
  day column is a seventh of the screen, and the same chips that sit comfortably
  on one stack up one-per-line on the other.
*/
export function TaskCard({
  task, list = null, onPatch, onOpen, dragHandleProps, compact = false, dense = false,
}) {
  const late = isOverdue(task);
  const hard = task.is_hard && !task.done;
  const hasMeta = task.due_date || task.subtasks?.length > 0;

  return (
    <div
      onClick={() => onOpen(task)}
      {...dragHandleProps}
      className={`group bg-white border rounded-xl px-3 py-2.5 cursor-pointer shadow-sm hover:shadow-md hover:border-gray-300 transition-all ${
        late ? 'border-red-200' : 'border-gray-200'
      }`}
    >
      {/* What it is. The glyph box and the title's first line are both 18px
          tall, so the marks sit on the title's line however long it wraps. */}
      <div className="flex items-start gap-2">
        <span onClick={e => e.stopPropagation()} className="flex-shrink-0 flex items-center h-[18px]">
          <PriorityPicker priority={task.priority} onSelect={p => onPatch(task.id, { priority: p })} />
        </span>
        <span className={`flex-1 min-w-0 text-[13px] leading-[18px] ${task.done ? 'text-gray-400 line-through' : 'text-gray-800'} ${compact ? 'line-clamp-2' : ''}`}>
          {task.title}
        </span>
        {/* Top right, opposite the priority marks: the two glyphs that say what
            this is going to cost you sit at either end of the title's line. */}
        <span className="flex-shrink-0 flex items-center h-[18px]">
          <HardFlag hard={hard} size={12} />
        </span>
      </div>

      {/* What it's part of: the list it lives in, and only when the view spans
          more than one. Drawn only when there is something to say, since an
          empty row here would push the dates down for no reason. */}
      {list && (
        <div className="flex items-center gap-2 mt-2 min-w-0">
          <ListTag list={list} />
        </div>
      )}

      {/* When it's owed, whether it's going to be a fight, and how much of it
          is already ticked off. Set apart from the title above: that's a
          different question. They wrap rather than shrink, because every one of
          these is short and none of them survives being cut. */}
      {hasMeta && (
        <div className={`flex items-center flex-wrap ${dense ? 'gap-1 mt-2' : 'gap-1.5 mt-2.5'}`}>
          {task.due_date && <DateChip iso={task.due_date} done={task.done} dense={dense} />}
          <SubtaskBadge subtasks={task.subtasks} dense={dense} />
        </div>
      )}
    </div>
  );
}
