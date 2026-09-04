'use client';

/*
  The two verbs the planning flow is built out of, defined once because they
  appear on every step of it and have to mean the same thing on each.

    Plan              put this task on today, or take it off, and once it is on
                      say which half of the day it is in. It writes
                      `planned_date` and `daily_priority`, and nothing else: not
                      the due date, not the status, not the list. (plannedPatch
                      in lib/tasks.js is what guarantees that.)
    Schedule          give a task on today a time and a length: its block on the
                      timeline. A task can be on today without one; that is a
                      thing you are doing at no particular hour, not an
                      unfinished decision.

  Neither of them ever says how many HOURS the day adds up to. A running total
  of estimated work is a number you cannot act on — it does not tell you which
  thing to drop — and it is wrong more often than not, because it is a sum of
  guesses. The timeline says the same thing honestly: if the blocks do not fit
  in the day, you can see that they do not fit.

  Both are MANUAL, everywhere, always. Nothing on this page moves a task onto
  your day because it noticed a due date: the whole point of the page is that
  the day is chosen, and a page that chooses for you is a page you stop
  trusting the moment it chooses wrong.
*/

import { CalendarCheck, CalendarPlus, Clock } from 'lucide-react';
import { DailyPriorityToggle } from '@/components/tasks/TaskPickers';
import { clockToMinutes, formatClock, formatDuration } from '@/lib/dates';

/**
 * THE ONLY WAY ONTO THE DAY: a calendar button, and the star beside it.
 *
 * Two questions, two controls, in the order you answer them:
 *
 *   calendar  is this yours today? Off, it is an outline with a + in it and one
 *             click puts the task on the day. On, it is a tick, and one click
 *             takes it back off.
 *   star      and how firmly? Exactly the star from step 1 — filled is a
 *             commitment, hollow is if there's time — so the mark means the
 *             same thing on every screen it appears on.
 *
 * The star is always drawn, and greyed out until the task is on the day —
 * because until then it is a question about nothing, but a control that
 * appears out of nowhere the moment you press the thing beside it is one you
 * have to re-find on every row. Faded and unpressable says the same thing and
 * keeps the row the shape it was.
 *
 * This replaced a [ Must ][ Optional ] pair. Two words of chrome on every row
 * of a list you are meant to be READING is the wrong weight for a decision you
 * make on a handful of them, and it left "put it on the day" and "how firmly"
 * looking like one control with two answers when they are two questions, the
 * second of which only exists if the first was yes.
 *
 * What it writes is `planned_date` and `daily_priority`, and NOTHING else. Not
 * the due date — a task owed on Friday that you are doing today is still owed
 * on Friday, and a planner that quietly moved it would be lying about your
 * deadlines. Not the status, not the list. (plannedPatch in lib/tasks.js is
 * what guarantees that.)
 */
export function PlanChoice({ half, onPlan, onRemove, dense = false, className = '' }) {
  const on = !!half;
  const size = dense ? 13 : 15;

  return (
    <span className={`inline-flex items-center gap-1.5 flex-shrink-0 ${className}`}>
      {/* The span swallows the click, so a press on the greyed-out star is not
          quietly answered by the row underneath it opening the task. */}
      <span
        onClick={e => e.stopPropagation()}
        className="inline-flex items-center justify-center flex-shrink-0"
        style={{ width: size }}
      >
        <DailyPriorityToggle
          value={half}
          onChange={onPlan}
          dense={dense}
          showLabel={false}
          disabled={!on}
        />
      </span>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (on) onRemove();
          else onPlan('must_do');
        }}
        title={on ? 'On today — click to take it off' : 'Put this on today'}
        aria-pressed={on}
        aria-label="On today"
        className={`inline-flex items-center flex-shrink-0 rounded-md p-1 -m-1 transition-colors active:scale-90 ${
          on ? 'text-emerald-600 hover:text-emerald-700' : 'text-gray-300 hover:text-gray-700'
        }`}
      >
        {on
          ? <CalendarCheck size={size + 1} strokeWidth={2.5} />
          : <CalendarPlus size={size + 1} strokeWidth={2.5} />}
      </button>
    </span>
  );
}

/**
 * When a planned task is happening, as the row says it: the block's start, or
 * the offer of one. Same slot either way, so the times line up down the section
 * and an unscheduled task reads as a gap rather than as a shorter row.
 */
export function ScheduleChip({ task, onSchedule }) {
  const start = task.scheduled_start;
  const minutes = task.scheduled_minutes || task.estimated_minutes;

  if (!start) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onSchedule(task); }}
        title="Put this somewhere in the day"
        className="inline-flex items-center gap-1 flex-shrink-0 text-[10.5px] font-semibold text-gray-500 px-1.5 py-1 rounded-md bg-gray-100/70 hover:bg-gray-200/80 hover:text-gray-800 transition-all active:scale-90"
      >
        <Clock size={11} strokeWidth={2.5} />
        Schedule
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onSchedule(task); }}
      title={`Scheduled ${formatClock(clockToMinutes(start))}${minutes ? ` for ${formatDuration(minutes)}` : ''} — click to change`}
      className="inline-flex items-center gap-1 flex-shrink-0 text-[10.5px] font-bold tabular-nums px-1.5 py-1 rounded-md bg-gray-900 text-white hover:bg-gray-700 transition-all active:scale-90"
    >
      <Clock size={11} strokeWidth={2.5} />
      {formatClock(clockToMinutes(start))}
    </button>
  );
}
