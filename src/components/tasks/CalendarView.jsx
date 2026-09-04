'use client';

/*
  Calendar layout: the same tasks, laid out by `due_date`, at two zooms.

    Week   Mon–Sun, seven wide columns. Enough room for a real card, so this is
           where you plan the days in front of you.
    Month  whole Mon–Sun weeks, every day a cell. Too small for a card, so a task
           is one line (priority, title, owner) and the month answers "when is
           everything landing" rather than "what exactly is on Thursday".

  Scheduling is just setting a date, so a card dragged onto a day is one field
  write, and it keeps its place in the list and board layouts. Both zooms share
  the same drag wiring, the same rails and the same nav, so switching between
  them only changes how much of the calendar you can see at once.

  Undated work sits in the Unscheduled rail; anything open and past due surfaces
  in Overdue so it can be dragged forward instead of quietly rotting.
*/

import { useCallback, useMemo, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Plus } from 'lucide-react';
import {
  addMonths, addWeeks, dayDropId, dueDateFromDropId, groupTasksForMonth, groupTasksForWeek,
  monthLabel, monthOfWeek, sameMonth, startOfMonth, startOfWeek, weekLabel,
} from '@/lib/weekPlanner';
import { WEEKDAY_NAMES } from '@/lib/dates';
import { isOverdue } from '@/lib/tasks';
import { TaskCard } from './TaskItems';
import { PriorityIcon } from './TaskPickers';

// Mon-first weekday headings for the month grid.
const WEEK_HEADS = [1, 2, 3, 4, 5, 6, 0].map(i => WEEKDAY_NAMES[i]);

function DraggableCard({ task, children }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div ref={setNodeRef} {...attributes} style={{ opacity: isDragging ? 0.35 : 1 }}>
      {children({ dragHandleProps: listeners })}
    </div>
  );
}

function DropZone({ id, className = '', activeClassName = 'ring-2 ring-emerald-200 ring-inset bg-emerald-50/70', children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`${className} ${isOver ? activeClassName : ''} transition-colors`}>
      {children}
    </div>
  );
}

/** A task in the month grid: one line, because a cell is one seventh of a row. */
function TaskLine({ task, onOpen, dragHandleProps }) {
  const late = isOverdue(task);
  return (
    <div
      onClick={() => onOpen(task)}
      {...dragHandleProps}
      title={task.title}
      className={`flex items-center gap-1 px-1 py-[3px] rounded-md cursor-pointer border transition-colors ${
        late ? 'border-red-200 bg-red-50/60 hover:bg-red-50' : 'border-transparent bg-white hover:bg-gray-100'
      }`}
    >
      <PriorityIcon priority={task.priority} size={9} />
      <span className={`flex-1 min-w-0 truncate text-[11px] leading-tight ${task.done ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
        {task.title}
      </span>
    </div>
  );
}

// ─── Week grid ───────────────────────────────────────────────────────────────

function WeekGrid({ days, byDay, listFor, onPatch, onOpen, onAdd }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
      {days.map(day => (
        <DropZone
          key={day.iso}
          id={dayDropId(day.iso)}
          className={`rounded-2xl p-2 min-h-[150px] border ${
            day.isToday ? 'border-emerald-200 bg-emerald-50/40' : day.isWeekend ? 'border-gray-100 bg-gray-50/60' : 'border-gray-100 bg-white'
          }`}
        >
          <div className="flex items-center gap-1.5 px-1 pb-2">
            <span className={`text-[11px] font-bold uppercase tracking-widest ${day.isToday ? 'text-emerald-600' : 'text-gray-400'}`}>
              {day.dayName}
            </span>
            <span className={`text-[11px] font-semibold ${day.isToday ? 'text-emerald-600' : 'text-gray-400'}`}>{day.dayNum}</span>
            <button
              type="button"
              onClick={() => onAdd(day.iso)}
              className="ml-auto p-0.5 text-gray-300 hover:text-emerald-600 transition-colors"
              title={`New task due ${day.dayName}`}
            >
              <Plus size={13} />
            </button>
          </div>
          <div className="space-y-2">
            {byDay[day.iso].map(task => (
              <DraggableCard key={task.id} task={task}>
                {({ dragHandleProps }) => (
                  <TaskCard
                    task={task}
                    list={listFor ? listFor(task) : null}
                    onPatch={onPatch}
                    onOpen={onOpen}
                    dragHandleProps={dragHandleProps}
                    compact
                    dense
                  />
                )}
              </DraggableCard>
            ))}
          </div>
        </DropZone>
      ))}
    </div>
  );
}

// ─── Month grid ──────────────────────────────────────────────────────────────

function MonthGrid({ days, byDay, onOpen, onAdd }) {
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
      <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/60">
        {WEEK_HEADS.map(name => (
          <div key={name} className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 text-center">
            {name}
          </div>
        ))}
      </div>

      {weeks.map((week, wi) => (
        <div key={week[0].iso} className={`grid grid-cols-7 ${wi > 0 ? 'border-t border-gray-100' : ''}`}>
          {week.map(day => (
            <DropZone
              key={day.iso}
              id={dayDropId(day.iso)}
              className={`group/day min-h-[104px] p-1.5 border-l first:border-l-0 border-gray-100 ${
                day.isOtherMonth ? 'bg-gray-50/50' : day.isWeekend ? 'bg-gray-50/30' : 'bg-white'
              }`}
            >
              <div className="flex items-center gap-1 px-0.5 pb-1">
                <span
                  className={`text-[11px] font-semibold ${
                    day.isToday
                      ? 'bg-emerald-500 text-white rounded-full w-[19px] h-[19px] inline-flex items-center justify-center'
                      : day.isOtherMonth ? 'text-gray-300' : 'text-gray-500'
                  }`}
                >
                  {day.dayNum}
                </span>
                {/* The 1st names its month, so a spill-over week still says
                    where you are without a second label. */}
                {day.isFirstOfMonth && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{day.monthName}</span>
                )}
                <button
                  type="button"
                  onClick={() => onAdd(day.iso)}
                  className="ml-auto opacity-0 group-hover/day:opacity-100 p-0.5 text-gray-300 hover:text-emerald-600 transition-all"
                  title={`New task due ${day.monthName} ${day.dayNum}`}
                >
                  <Plus size={12} />
                </button>
              </div>
              <div className="space-y-1">
                {byDay[day.iso].map(task => (
                  <DraggableCard key={task.id} task={task}>
                    {({ dragHandleProps }) => (
                      <TaskLine task={task} onOpen={onOpen} dragHandleProps={dragHandleProps} />
                    )}
                  </DraggableCard>
                ))}
              </div>
            </DropZone>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── The calendar ────────────────────────────────────────────────────────────

const ZOOMS = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

export default function CalendarView({ tasks, listFor = null, onPatch, onOpen, onAdd }) {
  const [zoom, setZoom] = useState('week');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const [activeId, setActiveId] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const isMonth = zoom === 'month';

  const grouped = useMemo(
    () => (isMonth ? groupTasksForMonth(tasks, monthStart) : groupTasksForWeek(tasks, weekStart)),
    [tasks, isMonth, monthStart, weekStart]
  );
  const { days, byDay, backlog, overdue } = grouped;
  const elsewhere = isMonth ? grouped.scheduledOtherMonth : grouped.scheduledOtherWeek;

  const step = useCallback((n) => {
    if (isMonth) setMonthStart(m => addMonths(m, n));
    else setWeekStart(w => addWeeks(w, n));
  }, [isMonth]);

  const today = useCallback(() => {
    setWeekStart(startOfWeek(new Date()));
    setMonthStart(startOfMonth(new Date()));
  }, []);

  /*
    Switching zoom keeps your place, and going out to the month and straight back
    must never lose it.

    OUT: the week is filed under the month that owns it (monthOfWeek, the one
    holding its Thursday), so a week straddling a boundary opens the right month.

    BACK, in order:
      1. the week you left, if it still belongs to the month on screen. You
         zoomed out and back without navigating, so you land exactly where you
         were, whichever week of the month that was.
      2. this week, when the month on screen is the current one.
      3. otherwise the month's opening week: you have navigated somewhere else
         entirely, and there is no better guess.
  */
  const setZoomKeeping = useCallback((next) => {
    if (next === 'month') {
      setMonthStart(monthOfWeek(weekStart));
    } else {
      const now = new Date();
      setWeekStart(
        sameMonth(monthOfWeek(weekStart), monthStart) ? weekStart
          : sameMonth(now, monthStart) ? startOfWeek(now)
            : startOfWeek(monthStart)
      );
    }
    setZoom(next);
  }, [weekStart, monthStart]);

  const handleDragEnd = useCallback((event) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const due = dueDateFromDropId(over.id);
    if (due === undefined) return;
    const task = tasks.find(t => t.id === active.id);
    if (!task || (task.due_date || null) === due) return;
    onPatch(active.id, { due_date: due });
  }, [tasks, onPatch]);

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={e => setActiveId(e.active.id)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {/* Where you are, and how far you can see */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          type="button"
          onClick={() => step(-1)}
          title={isMonth ? 'Previous month' : 'Previous week'}
          className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-sm font-semibold text-gray-800 min-w-[130px]">
          {isMonth ? monthLabel(monthStart) : weekLabel(weekStart)}
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          title={isMonth ? 'Next month' : 'Next week'}
          className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
        >
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          onClick={today}
          className="text-xs font-semibold text-gray-500 hover:text-gray-800 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
        >
          Today
        </button>

        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 ml-1">
          {ZOOMS.map(z => (
            <button
              key={z.key}
              type="button"
              onClick={() => setZoomKeeping(z.key)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                zoom === z.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {z.label}
            </button>
          ))}
        </div>

        {elsewhere > 0 && (
          <span className="ml-auto text-[11px] text-gray-400">
            {elsewhere} scheduled {isMonth ? 'other months' : 'other weeks'}
          </span>
        )}
      </div>

      {isMonth
        ? <MonthGrid days={days} byDay={byDay} onOpen={onOpen} onAdd={onAdd} />
        : <WeekGrid days={days} byDay={byDay} listFor={listFor} onPatch={onPatch} onOpen={onOpen} onAdd={onAdd} />}

      {/* Overdue + Unscheduled rails, each the full width of the calendar above
          them. Side by side they read as a different measure to the week and
          leave a hole whenever one of them is empty. */}
      <div className="space-y-3 mt-3">
        {overdue.length > 0 && (
          <div className="rounded-2xl border border-red-100 bg-red-50/40 p-3">
            <div className="flex items-center gap-2 pb-2">
              <AlertTriangle size={13} className="text-red-500" />
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-red-500">Overdue</h3>
              <span className="text-[11px] font-semibold text-red-400">{overdue.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
              {overdue.map(task => (
                <DraggableCard key={task.id} task={task}>
                  {({ dragHandleProps }) => (
                    <TaskCard
                      task={task}
                      list={listFor ? listFor(task) : null}
                      onPatch={onPatch}
                      onOpen={onOpen}
                      dragHandleProps={dragHandleProps}
                      compact
                      dense
                    />
                  )}
                </DraggableCard>
              ))}
            </div>
          </div>
        )}

        <DropZone id="backlog" className="rounded-2xl border border-gray-100 bg-white p-3">
          <div className="flex items-center gap-2 pb-2">
            <Inbox size={13} className="text-gray-400" />
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Unscheduled</h3>
            <span className="text-[11px] font-semibold text-gray-400">{backlog.length}</span>
            <button
              type="button"
              onClick={() => onAdd(null)}
              className="ml-auto p-0.5 text-gray-300 hover:text-emerald-600 transition-colors"
              title="New task, no due date"
            >
              <Plus size={13} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
            {backlog.map(task => (
              <DraggableCard key={task.id} task={task}>
                {({ dragHandleProps }) => (
                  <TaskCard
                    task={task}
                    list={listFor ? listFor(task) : null}
                    onPatch={onPatch}
                    onOpen={onOpen}
                    dragHandleProps={dragHandleProps}
                    compact
                    dense
                  />
                )}
              </DraggableCard>
            ))}
            {backlog.length === 0 && <p className="text-xs text-gray-300 py-3">Everything is scheduled.</p>}
          </div>
        </DropZone>
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' }}>
        {activeTask ? (
          <div className="rotate-1 opacity-95 w-[240px]">
            <TaskCard
              task={activeTask}
              list={listFor ? listFor(activeTask) : null}
              onPatch={() => {}}
              onOpen={() => {}}
              compact
              dense
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
