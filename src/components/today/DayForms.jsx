'use client';

/*
  The two small forms the day is built with: SCHEDULE (put a task at a time) and
  COMMITMENT (the class / lunch / meeting the day already contains).

  They are one shape because they are one question asked about two things: when
  does it start, and how long is it. Dragging says both at once and says them
  roughly, which is right for "some time this afternoon" and useless for "2:15
  for forty-five minutes"; this is the other half of that pair, and every field
  in it is typed by you.

  Deliberately NOT the big two-column DialogShell the task dialogs use. That one
  is for the object itself, and this is for two numbers about it: a box that
  size, opened to set a start time, would read as if something much larger had
  been asked of you.
*/

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, Trash2, X } from 'lucide-react';
import { ESTIMATES } from '@/lib/tasks';
import { clockToMinutes, dayClock, dayMinutes, formatClockRange, formatDuration } from '@/lib/dates';
import { OVERLAY_Z } from '@/components/tasks/TaskPickers';

/*
  How long a block can be. The seven estimates, plus the longer runs a lecture
  or an afternoon of one thing actually takes: a block is a piece of your day,
  and pieces of a day are not always pieces of work.
*/
const DURATIONS = [
  ...ESTIMATES.map(e => e.minutes),
  240,
  300,
];

function SmallDialog({ title, onClose, children, footer }) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-task-overlay
      style={{ zIndex: OVERLAY_Z.dialog }}
      className="fixed inset-0 flex items-center justify-center px-4 bg-gray-900/25 backdrop-blur-[3px]"
      onMouseDown={onClose}
    >
      <div
        ref={ref}
        onMouseDown={e => e.stopPropagation()}
        className="w-full max-w-[380px] bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden animate-scale-in"
      >
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
          <Clock size={14} className="text-gray-400" />
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{title}</span>
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="ml-auto p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-4">{children}</div>

        <div className="px-4 py-2.5 border-t border-gray-100 flex items-center gap-2">{footer}</div>
      </div>
    </div>,
    document.body
  );
}

function FieldLabel({ children }) {
  return (
    <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">{children}</span>
  );
}

const inputClass =
  'w-full text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 outline-none '
  + 'focus:bg-white focus:border-gray-300 focus:ring-1 focus:ring-emerald-500/40 transition-colors';

/** Start time and length, side by side: the whole of what a block is. */
function WhenFields({ start, minutes, onStart, onMinutes }) {
  // Placed on the day, so a start typed as 1:00 reads back as "1:00 – 2:00 AM"
  // at the END of the day, which is where the block will actually be drawn.
  const startMinutes = dayMinutes(start);
  // A length that isn't one of the offered ones (dragged to 1h 45m on the
  // timeline, say) is added to the list rather than silently reset by a select
  // whose value matches no option.
  const choices = [...new Set([...DURATIONS, minutes])].sort((a, b) => a - b);

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <FieldLabel>Start time</FieldLabel>
          <input
            type="time"
            step={300}
            value={start}
            onChange={e => onStart(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block">
          <FieldLabel>Duration</FieldLabel>
          <select value={minutes} onChange={e => onMinutes(Number(e.target.value))} className={inputClass}>
            {choices.map(value => (
              <option key={value} value={value}>{formatDuration(value, { long: true })}</option>
            ))}
          </select>
        </label>
      </div>

      {/* What you have just said, said back: the one thing a start time and a
          duration do not tell you on their own is when the thing ENDS. */}
      {startMinutes !== null && (
        <p className="mt-3 text-[12px] text-gray-500 tabular-nums">
          {formatClockRange(startMinutes, minutes)}
        </p>
      )}
    </>
  );
}

/**
 * Put a task at a time. Opens on the first gap long enough to hold it (see
 * nextFreeStart in lib/agenda) and on its own estimate, so the commonest
 * answer is already filled in and the box is a confirmation rather than a
 * form.
 */
export function ScheduleDialog({ task, defaultStart, onSave, onUnschedule, onClose }) {
  const [start, setStart] = useState(() => task.scheduled_start || dayClock(defaultStart));
  const [minutes, setMinutes] = useState(() => (
    task.scheduled_minutes || task.estimated_minutes || 30
  ));

  const scheduled = !!task.scheduled_start;

  const save = () => {
    if (clockToMinutes(start) === null) return;
    onSave(task, start, minutes);
    onClose();
  };

  return (
    <SmallDialog
      title={scheduled ? 'Move this block' : 'Schedule for today'}
      onClose={onClose}
      footer={(
        <>
          {scheduled && (
            <button
              type="button"
              onClick={() => { onUnschedule(task); onClose(); }}
              className="text-[11px] font-semibold text-gray-500 hover:text-red-600 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
            >
              Unschedule
            </button>
          )}
          <button
            type="button"
            onClick={save}
            className="ml-auto text-sm font-semibold px-4 py-1.5 rounded-xl bg-gray-900 text-white hover:bg-gray-700 transition-colors"
          >
            {scheduled ? 'Save' : 'Add to the day'}
          </button>
        </>
      )}
    >
      <p className="text-[15px] font-semibold text-gray-900 leading-snug mb-4">{task.title}</p>
      <WhenFields start={start} minutes={minutes} onStart={setStart} onMinutes={setMinutes} />
      {!task.estimated_minutes && (
        <p className="mt-2 text-[11.5px] text-gray-400">
          This one has no estimate yet — the length you pick here is only its block.
        </p>
      )}
    </SmallDialog>
  );
}

/**
 * A fixed commitment. It is not a task and never becomes one: no status, no due
 * date, no list, nothing to tick off. It is here so the timeline can draw the
 * day you actually have, rather than the part of it that happens to be work.
 */
export function EventDialog({ event, defaultStart, defaultMinutes = 60, onSave, onRemove, onClose }) {
  const [title, setTitle] = useState(event?.title || '');
  const [start, setStart] = useState(event?.start || dayClock(defaultStart));
  const [minutes, setMinutes] = useState(event?.minutes || defaultMinutes);

  const save = () => {
    const name = title.trim();
    if (!name || clockToMinutes(start) === null) return;
    /*
      The tag and the note are carried through untouched. Both are set from the
      timeline's right-click menu and neither has a control here, so a save that
      rebuilt the event from this form's fields alone would silently strip
      something you wrote somewhere else.
    */
    onSave({
      id: event?.id || `event_${Date.now()}`,
      title: name,
      start,
      minutes,
      labelId: event?.labelId || null,
      notes: event?.notes || '',
    });
    onClose();
  };

  return (
    <SmallDialog
      title={event ? 'Edit commitment' : 'New commitment'}
      onClose={onClose}
      footer={(
        <>
          {event && (
            <button
              type="button"
              onClick={() => { onRemove(event); onClose(); }}
              title="Remove this commitment"
              className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!title.trim()}
            className="ml-auto text-sm font-semibold px-4 py-1.5 rounded-xl bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-30 transition-colors"
          >
            {event ? 'Save' : 'Add to the day'}
          </button>
        </>
      )}
    >
      <label className="block mb-3">
        <FieldLabel>What is it</FieldLabel>
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          placeholder="Class, lunch, standup…"
          className={inputClass}
        />
      </label>

      <WhenFields start={start} minutes={minutes} onStart={setStart} onMinutes={setMinutes} />
    </SmallDialog>
  );
}
