'use client';

/*
  THE DAILY TIMELINE: the day drawn as a day.

  The fourth question, and the only one the rest of the page cannot answer:
  four commitments and three and a half hours of work is a list, but it is not a
  plan until you have said WHEN. A timeline makes two things visible that a list
  cannot: that two things are at the same time, and that the day has run out.

  One pixel is one minute. The window is 4am to 4am — a whole day, anchored
  where a day actually starts rather than where the calendar says it does. At
  one in the morning you are not starting a new day, you are finishing the one
  you are in, so the small hours sit at the BOTTOM of the evening they belong to
  and the rail runs on past midnight: 25:30 is half past one tomorrow. It still
  stretches to whatever you put outside it, so a 3am finish is drawn where it is
  rather than clamped to an edge and drawn as a lie.

  Three kinds of block sit on it:

    a task    something you planned and then gave a time to. Clicking it opens
              the task; dragging it moves it; either edge resizes it; the ×
              takes the time off and LEAVES THE TASK ON THE DAY, because
              "not at a particular hour" is a perfectly good plan.
    an event  class, lunch, a standing meeting: something the day already
              contains. Not a task, cannot be completed, has no due date, and
              lives in app_settings rather than in the task table (/api/events).
    a GOOGLE  an event off your real calendar. Drawn in the colour Google draws
      event   it in, and INERT — no drag, no resize, no ×, nothing to click. It
              is not yours to move from in here; it is the shape of the day you
              are planning into, and the only honest thing a planner can do with
              somebody else's ten o'clock is show it to you and stay out of the
              way. All-day ones have no hour to sit at, so they go in a strip
              above the grid, the way every calendar draws them.

  Overlapping blocks are drawn side by side rather than stacked, because a task
  hidden underneath a lecture is exactly the collision this exists to show.
  Overlap is allowed, deliberately: an overbooked day is a real state, and a
  planner that refuses to draw one just moves the problem somewhere you cannot
  see it.

  Everything here is manual. Nothing auto-arranges, nothing suggests, nothing
  fills the gaps in for you.

  Every gesture clamps to the END OF THE DAY rather than to midnight, because
  the day ends at 4am: a block can be dragged into the small hours and stored
  there (see `dayMinutes` and `dayClock` in lib/dates), and the only edge it
  cannot be pushed past is four in the morning.

  ─── THE GESTURES ───────────────────────────────────────────────────────────

  The ones every calendar has, because a calendar that invents its own has
  gestures you have to be taught:

    press a block and drag        move it. Vertically only, snapped to the
                                  quarter hour, and it stays under the cursor
                                  wherever on the block you took hold of it.
    drag its top or bottom edge   change when it starts, or when it ends. The
                                  other edge stays exactly where it was.
    drag empty canvas             draw a new commitment the length of the drag.
    click empty canvas            the same thing, an hour long.
    click a block                 open what it is.

  All of them are plain pointer events rather than dnd-kit, and that is not an
  accident. dnd-kit moves an ELEMENT by a transform: the right tool for carrying
  a task row across the page and onto this grid, which is still what it does
  here, and the wrong one for a block that lives in day-minutes and has to snap,
  clamp and resize in them. Done directly, the geometry is computed once, in
  minutes, from where the pointer is over the canvas — so the block on screen is
  always exactly the block you are about to commit, rather than a transform that
  gets reconciled into something else on drop.

  Measuring the pointer against the CANVAS on every move, rather than
  accumulating a delta from where the gesture began, is also what makes
  auto-scrolling work: drag towards either end of the column and it scrolls, the
  canvas slides under the cursor, and the block keeps following the cursor,
  because the only thing being measured is where the cursor is NOW.
*/

import { useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { CalendarPlus, Clock, X } from 'lucide-react';
import {
  DAY_WINDOW_END, MINUTES_PER_DAY, clockToMinutes, dayMinutes, formatClock, formatClockRange,
  formatHourLabel,
} from '@/lib/dates';
import { Panel, PanelHead } from '@/components/dashboard/Panel';

/** One minute, one pixel: the arithmetic and the drawing are the same numbers. */
export const PX_PER_MINUTE = 1;

/** The width of the hour rail down the left. */
const GUTTER = 52;

/** The grid every gesture lands on, and the smallest block one can leave behind. */
const SNAP = 15;
const MIN_BLOCK_MINUTES = 15;

/** Travel before a press becomes a drag, so a click stays a click. */
const SLOP = 4;

/** Auto-scroll: how close to the ends of the column, and how fast at the most. */
const SCROLL_ZONE = 56;
const SCROLL_SPEED = 16;

/** What a click on empty canvas is worth, the same as every other calendar. */
const NEW_EVENT_MINUTES = 60;

const snap = minutes => Math.round(minutes / SNAP) * SNAP;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// ─────────────────────────────────────────────────────────────────────────────

function HourLine({ minute, origin, major }) {
  return (
    <div
      className="absolute left-0 right-0 flex items-start pointer-events-none"
      style={{ top: (minute - origin) * PX_PER_MINUTE }}
    >
      <span
        style={{ width: GUTTER }}
        className={`shrink-0 -mt-[7px] pr-2 text-right text-[10px] font-semibold tabular-nums ${
          major ? 'text-gray-400' : 'text-gray-300'
        }`}
      >
        {formatHourLabel(minute)}
      </span>
      <span className="flex-1 h-px bg-gray-100" />
    </div>
  );
}

/*
  A block on the day.

  Three gestures, one function. `mode` decides which of the two numbers a block
  is — its start and its length — the pointer is holding on to:

    move    the pointer holds a POINT INSIDE the block, and the block keeps
            that point under the cursor. Grabbing a two-hour block by its
            middle and dragging it up an hour moves it an hour; it does not
            jump so its top edge meets the cursor, which is the thing that
            makes a calendar feel like it is fighting you.
    top     the pointer holds the start. The end stays where it is, so the
            length changes by however much the start moved.
    bottom  the pointer holds the end. The start stays where it is.

  Each records what it grabbed as an offset in MINUTES at pointerdown, and every
  move re-reads the pointer's absolute position over the canvas and adds that
  offset back. Absolute rather than incremental, so a mid-drag scroll (which
  moves the canvas but not the cursor) lands where you are pointing.
*/
function Block({ block, origin, list, toMinute, autoScroll, onOpen, onUnschedule, onChange, onEditEvent }) {
  const isTask = block.kind === 'task';

  // The geometry while a gesture is running; null when nothing is happening.
  const [draft, setDraft] = useState(null);
  const draftRef = useRef(null);
  // A drag ends with a pointerup on the block, which the browser then reports
  // as a click on it. Without this, moving a block would open the task every
  // single time.
  const draggedRef = useRef(false);

  const start = draft ? draft.start : block.start;
  const minutes = draft ? draft.minutes : block.minutes;
  const moving = draft !== null;

  const height = Math.max(MIN_BLOCK_MINUTES, minutes) * PX_PER_MINUTE;
  const width = `calc((100% - ${GUTTER}px) / ${block.columns})`;
  const left = `calc(${GUTTER}px + ((100% - ${GUTTER}px) / ${block.columns}) * ${block.column})`;

  /*
    No preventDefault on pointerdown, deliberately. Cancelling it also cancels
    the compatibility mouse events the browser generates from it — the click
    among them — and a block you cannot click is a block you cannot open. What
    preventDefault was there to stop is text selection, and `select-none` on the
    block does that without touching the event.
  */
  const begin = mode => (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();

    const from = { start: block.start, minutes: block.minutes };
    const end = from.start + from.minutes;
    const at = toMinute(event.clientY);
    if (at === null) return;

    // What the pointer is holding, in minutes, relative to the edge it moves.
    const grab = mode === 'bottom' ? end - at : from.start - at;
    const startY = event.clientY;
    let dragging = false;

    const apply = (clientY) => {
      const now = toMinute(clientY);
      if (now === null) return;

      let next;
      if (mode === 'move') {
        const top = clamp(snap(now + grab), 0, DAY_WINDOW_END - from.minutes);
        next = { start: top, minutes: from.minutes };
      } else if (mode === 'top') {
        const top = clamp(snap(now + grab), 0, end - MIN_BLOCK_MINUTES);
        next = { start: top, minutes: end - top };
      } else {
        const bottom = clamp(snap(now + grab), from.start + MIN_BLOCK_MINUTES, DAY_WINDOW_END);
        next = { start: from.start, minutes: bottom - from.start };
      }

      draftRef.current = next;
      setDraft(next);
    };

    const move = (e) => {
      if (!dragging && Math.abs(e.clientY - startY) < SLOP) return;
      dragging = true;
      autoScroll.track(e.clientY);
      apply(e.clientY);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      autoScroll.stop();

      const next = draftRef.current;
      draftRef.current = null;
      setDraft(null);
      if (!dragging || !next) return;

      // Cleared on the next tick, which is after the click this pointerup is
      // about to produce.
      draggedRef.current = true;
      setTimeout(() => { draggedRef.current = false; }, 0);

      if (next.start !== from.start || next.minutes !== from.minutes) {
        onChange(block, next.start, next.minutes);
      }
    };

    autoScroll.start(apply);
    autoScroll.track(event.clientY);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // 8px of grab area top and bottom: big enough to hit, small enough that the
  // middle of a 30-minute block is still the block.
  const edgeClass = 'absolute left-0 right-0 h-[8px] cursor-ns-resize z-10';
  const edgeBar = `mx-auto w-8 h-[3px] rounded-full bg-gray-400/70 transition-opacity ${
    moving ? 'opacity-0' : 'opacity-0 group-hover/block:opacity-100'
  }`;

  return (
    <div
      onPointerDown={begin('move')}
      onClick={() => {
        if (draggedRef.current) return;
        if (isTask) onOpen(block.task); else onEditEvent(block.event);
      }}
      title={`${block.title} · ${formatClockRange(start, minutes)}`}
      style={{
        position: 'absolute',
        top: (start - origin) * PX_PER_MINUTE,
        height,
        left,
        width,
        touchAction: 'none',
        borderLeftColor: isTask ? (list?.color || '#94a3b8') : undefined,
        zIndex: moving ? 30 : 10,
      }}
      className={`group/block overflow-hidden rounded-lg px-2 py-1 cursor-grab active:cursor-grabbing select-none transition-shadow ${
        isTask
          ? 'bg-white border border-gray-200 border-l-[3px] shadow-sm hover:shadow-md'
          : 'bg-gray-100 border border-gray-200/80 hover:bg-gray-200/70'
      } ${moving ? 'shadow-xl ring-2 ring-emerald-400/60' : ''}`}
    >
      <div className="flex items-start gap-1">
        <span className={`flex-1 min-w-0 text-[11.5px] font-semibold leading-[14px] truncate ${
          isTask ? 'text-gray-800' : 'text-gray-600'
        }`}>
          {block.title}
        </span>
        {isTask && (
          <button
            type="button"
            onPointerDown={e => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onUnschedule(block.task); }}
            title="Take the time off (stays on today)"
            className="flex-shrink-0 -mr-1 -mt-0.5 p-0.5 rounded text-gray-300 opacity-0 group-hover/block:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all"
          >
            <X size={11} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* The times when the block is tall enough to hold them without crowding
          the name — or always, while it is moving, because that is the one
          moment they are the thing you are reading. */}
      {(height >= 34 || moving) && (
        <div className={`text-[10px] tabular-nums leading-[13px] truncate ${
          moving ? 'font-bold text-emerald-700' : 'text-gray-400'
        }`}>
          {formatClockRange(start, minutes)}
        </div>
      )}

      {/* Both edges, like every other calendar, with a hairline handle drawn in
          them on hover so they are findable without being loud. */}
      <span
        onPointerDown={begin('top')}
        onClick={e => e.stopPropagation()}
        title="Drag to change when it starts"
        style={{ top: 0, touchAction: 'none' }}
        className={`${edgeClass} flex items-start pt-[1px]`}
      >
        <span className={edgeBar} />
      </span>
      <span
        onPointerDown={begin('bottom')}
        onClick={e => e.stopPropagation()}
        title="Drag to change when it ends"
        style={{ bottom: 0, touchAction: 'none' }}
        className={`${edgeClass} flex items-end pb-[1px]`}
      >
        <span className={edgeBar} />
      </span>
    </div>
  );
}

/*
  SOMEBODY ELSE'S HOUR.

  A Google event, and the shortest component on the page, because almost all of
  Block above is gestures — and this one has none. Not disabled gestures: NO
  gestures. There is no pointer handler to stop, no click to swallow, no × to
  hide behind a permission check. A thing you cannot move is best built as a
  thing that has no way to move, and then it cannot start moving by accident
  three refactors from now.

  It carries its own colour from Google, as a tint with the full-strength colour
  down its left edge: strong enough that the calendar you recognise by colour is
  recognisable here, quiet enough that your own blocks still read as the
  foreground. It sits UNDER the task blocks (a lower z-index), so a task you
  drop on top of a meeting is the one you can still see and click — the overlap
  is the warning, and the thing you can act on should be the thing on top.
*/
function ExternalBlock({ block, origin }) {
  const event = block.external;
  const height = Math.max(MIN_BLOCK_MINUTES, block.minutes) * PX_PER_MINUTE;
  const width = `calc((100% - ${GUTTER}px) / ${block.columns})`;
  const left = `calc(${GUTTER}px + ((100% - ${GUTTER}px) / ${block.columns}) * ${block.column})`;

  // The tooltip is where the detail lives, since the block itself does nothing
  // when you click it: what it is, when, whose calendar, where — and, for one
  // that spills over a midnight, which midnight.
  const spill = block.external.clipped === 'both'
    ? 'started yesterday, runs into tomorrow'
    : block.external.clipped === 'start'
      ? 'started yesterday'
      : block.external.clipped === 'end'
        ? 'runs into tomorrow'
        : null;
  const tooltip = [
    event.title,
    formatClockRange(block.start, block.minutes),
    spill,
    event.location,
    // What YOU called this colour. A block that says "Chill Vibes" explains
    // itself in a way "blue" never will.
    event.label,
    event.calendar && `on ${event.calendar}`,
    'Google Calendar — not editable here',
  ].filter(Boolean).join('\n');

  return (
    <div
      title={tooltip}
      style={{
        position: 'absolute',
        top: (block.start - origin) * PX_PER_MINUTE,
        height,
        left,
        width,
        backgroundColor: `${event.color}1f`,
        borderColor: `${event.color}55`,
        borderLeftColor: event.color,
        zIndex: 5,
      }}
      className="overflow-hidden rounded-lg px-2 py-1 border border-l-[3px] select-none cursor-default"
    >
      <span className="block text-[11.5px] font-semibold leading-[14px] truncate text-gray-700">
        {event.title}
      </span>
      {height >= 34 && (
        <span className="block text-[10px] tabular-nums leading-[13px] truncate text-gray-500">
          {formatClockRange(block.start, block.minutes)}
        </span>
      )}
    </div>
  );
}

/*
  WHERE IT WOULD LAND, drawn while you are still holding it.

  A dashed outline the size of the block you are about to make, a rule running
  the width of the day at its top edge, and the time in the gutter where the
  hour labels are — so the number you are aiming at appears in the column you
  were already reading. This is the whole of the "did I mean 2:00 or 2:15"
  problem, answered before you commit rather than after.

  It draws for a task carried in from the list, and for the range you are
  dragging out on empty canvas. A block already on the grid needs none of it:
  it moves under the cursor and re-reads its own clock, so a ghost behind it
  would be the same fact drawn twice.
*/
function DropGhost({ preview, origin }) {
  const top = (preview.start - origin) * PX_PER_MINUTE;

  return (
    <div aria-hidden className="absolute left-0 right-0 pointer-events-none z-40" style={{ top }}>
      <div className="flex items-start">
        <span
          style={{ width: GUTTER }}
          className="shrink-0 -mt-[8px] pr-2 text-right text-[10px] font-bold tabular-nums text-emerald-700"
        >
          {formatClock(preview.start)}
        </span>
        <span className="flex-1 h-px bg-emerald-500/70" />
      </div>

      <div
        style={{
          height: Math.max(MIN_BLOCK_MINUTES, preview.minutes) * PX_PER_MINUTE,
          marginLeft: GUTTER,
        }}
        className="rounded-lg border-2 border-dashed border-emerald-400 bg-emerald-50/70 px-2 py-1 overflow-hidden"
      >
        <p className="text-[11.5px] font-semibold leading-[14px] truncate text-emerald-900">
          {preview.title}
        </p>
        <p className="text-[10px] font-bold tabular-nums text-emerald-700 leading-[13px] truncate">
          {formatClockRange(preview.start, preview.minutes)}
        </p>
      </div>
    </div>
  );
}

export default function Timeline({
  timeline, events, nowMinutes, listFor, canvasRef,
  onOpenTask, onUnschedule, onPlaceTask, onPlaceEvent, onAddEvent, onEditEvent,
  dragPreview = null, sticky = false, maxHeight = 'calc(100vh - 230px)',
  googleControl = null,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'timeline' });
  const scrollRef = useRef(null);
  const canvasEl = useRef(null);

  const origin = timeline.startMinute;
  const height = (timeline.endMinute - timeline.startMinute) * PX_PER_MINUTE;

  /*
    Open on the working part of the day rather than at 7am. The page is read in
    the morning and again at three in the afternoon, and the second of those
    should not begin with a scroll.
  */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const focus = nowMinutes ?? timeline.blocks[0]?.start ?? origin;
    el.scrollTop = Math.max(0, (focus - origin) * PX_PER_MINUTE - 80);
    // Once, on mount: after that where you have scrolled to is your business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Where a screen y is in the day, in minutes. The one measurement. */
  const toMinute = (clientY) => {
    const el = canvasEl.current;
    if (!el) return null;
    return origin + (clientY - el.getBoundingClientRect().top) / PX_PER_MINUTE;
  };

  /*
    AUTO-SCROLL, while a gesture is running.

    Drag towards either end of the column and it scrolls, faster the closer to
    the edge you hold. Each frame that actually moves the scroll re-runs the
    gesture's own geometry against the last known pointer position, because the
    canvas has just slid under a cursor that did not move — and a calendar where
    the block stops following your cursor the moment the page scrolls is the
    thing that makes long drags impossible.
  */
  const auto = useRef({ raf: 0, y: 0, apply: null });

  const frame = () => {
    const state = auto.current;
    const el = scrollRef.current;
    if (!el) { state.raf = 0; return; }

    const rect = el.getBoundingClientRect();
    let step = 0;
    if (state.y < rect.top + SCROLL_ZONE) {
      step = -SCROLL_SPEED * ((rect.top + SCROLL_ZONE - state.y) / SCROLL_ZONE);
    } else if (state.y > rect.bottom - SCROLL_ZONE) {
      step = SCROLL_SPEED * ((state.y - (rect.bottom - SCROLL_ZONE)) / SCROLL_ZONE);
    }

    if (step) {
      const before = el.scrollTop;
      el.scrollTop = clamp(before + step, 0, el.scrollHeight - el.clientHeight);
      if (el.scrollTop !== before) state.apply?.(state.y);
    }
    state.raf = requestAnimationFrame(frame);
  };

  const autoScroll = {
    start: (apply) => {
      const state = auto.current;
      state.apply = apply;
      if (!state.raf) state.raf = requestAnimationFrame(frame);
    },
    track: (y) => { auto.current.y = y; },
    stop: () => {
      const state = auto.current;
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
      state.apply = null;
    },
  };

  useEffect(() => () => autoScroll.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  /*
    DRAW A COMMITMENT ON EMPTY CANVAS.

    Press and drag to say both numbers at once; a plain click says the start and
    takes the hour as read. Either way the dialog opens with the range already
    filled in, so the gesture is the answer and the form is the confirmation.

    The guard is `event.target === event.currentTarget`: the hour lines and the
    now-line are pointer-events-none and never targets, and a block stops the
    event before it reaches here, so this fires only on the canvas itself.
  */
  const [drawn, setDrawn] = useState(null);
  const drawnRef = useRef(null);

  const beginCreate = (event) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const at = toMinute(event.clientY);
    if (at === null) return;

    const anchor = clamp(snap(at), 0, DAY_WINDOW_END - MIN_BLOCK_MINUTES);
    const startY = event.clientY;
    let dragging = false;

    const apply = (clientY) => {
      const now = toMinute(clientY);
      if (now === null) return;
      const edge = clamp(snap(now), 0, DAY_WINDOW_END);
      const top = Math.min(anchor, edge);
      const bottom = Math.max(Math.max(anchor, edge), top + MIN_BLOCK_MINUTES);
      const next = { start: top, minutes: bottom - top, title: 'New commitment' };
      drawnRef.current = next;
      setDrawn(next);
    };

    const move = (e) => {
      if (!dragging && Math.abs(e.clientY - startY) < SLOP) return;
      dragging = true;
      autoScroll.track(e.clientY);
      apply(e.clientY);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      autoScroll.stop();

      const drawnRange = drawnRef.current;
      drawnRef.current = null;
      setDrawn(null);

      const range = dragging && drawnRange
        ? { start: drawnRange.start, minutes: drawnRange.minutes }
        : { start: clamp(anchor, 0, DAY_WINDOW_END - NEW_EVENT_MINUTES), minutes: NEW_EVENT_MINUTES };
      onAddEvent(range);
    };

    autoScroll.start(apply);
    autoScroll.track(event.clientY);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const ghost = drawn || dragPreview;

  return (
    <Panel className={sticky ? 'lg:sticky lg:top-24' : ''}>
      <PanelHead
        title="Timeline"
        hint={timeline.blocks.length === 0 ? 'drag a task across' : null}
        action={(
          <>
            {googleControl}
            <button
              type="button"
              onClick={() => onAddEvent()}
              title="Add a fixed commitment: class, lunch, a meeting"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <CalendarPlus size={12} strokeWidth={2.5} />
              Commitment
            </button>
          </>
        )}
      />

      {/*
        ALL DAY, above the grid.

        A day-long event has no hour, so drawing it as a block would mean
        inventing one — either a bar down the whole column, which buries the day
        underneath it, or a fake nine-o'clock start, which is a lie. Every
        calendar solves this the same way and so does this one: a strip on top,
        outside the hours entirely.
      */}
      {timeline.allDay?.length > 0 && (
        <div className="px-4 pb-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">All day</span>
          {timeline.allDay.map(event => (
            <span
              key={event.id}
              title={[event.title, event.location, event.label, event.calendar && `on ${event.calendar}`]
                .filter(Boolean).join('\n')}
              style={{ backgroundColor: `${event.color}1f`, borderColor: `${event.color}55` }}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-600 border rounded-full pl-1.5 pr-2.5 py-[3px]"
            >
              <span
                aria-hidden
                className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                style={{ backgroundColor: event.color }}
              />
              <span className="truncate max-w-[170px]">{event.title}</span>
            </span>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        style={{ maxHeight }}
        className="px-3 pb-3 min-h-[320px] overflow-y-auto"
      >
        <div
          ref={(node) => {
            setNodeRef(node);
            canvasEl.current = node;
            if (canvasRef) canvasRef.current = node;
          }}
          onPointerDown={beginCreate}
          style={{ height, touchAction: 'pan-y' }}
          className={`relative rounded-xl select-none transition-colors ${isOver ? 'bg-emerald-50/40' : ''}`}
        >
          {timeline.hours.map(minute => (
            <HourLine key={minute} minute={minute} origin={origin} major={minute % 120 === 0} />
          ))}

          {/*
            MIDNIGHT, said out loud.

            Past this line the hour rail starts over at 12 AM, 1 AM, 2 AM — and
            without something to mark the turn they read as the top of the day
            rather than the far end of it. One rule and one word is enough;
            tinting the whole band would make four hours of your evening look
            like a disabled region.

            It is drawn only when it is inside the window, which it always is
            unless something has stretched the day past 4am tomorrow.
          */}
          {MINUTES_PER_DAY > timeline.startMinute && MINUTES_PER_DAY < timeline.endMinute && (
            <div
              aria-hidden
              className="absolute left-0 right-0 pointer-events-none z-[15] flex items-center"
              style={{ top: (MINUTES_PER_DAY - origin) * PX_PER_MINUTE }}
            >
              <span style={{ width: GUTTER }} className="shrink-0" />
              <span className="flex-1 h-px bg-gray-300" />
              <span className="pl-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                Tomorrow
              </span>
            </div>
          )}

          {/* Where you actually are in the day. The one moving thing on the
              page, and the reason "3h 45m left" is a different sentence at
              nine in the morning and at four in the afternoon. */}
          {nowMinutes !== null && nowMinutes >= timeline.startMinute && nowMinutes <= timeline.endMinute && (
            <div
              aria-hidden
              className="absolute left-0 right-0 pointer-events-none z-20"
              style={{ top: (nowMinutes - origin) * PX_PER_MINUTE }}
            >
              <div className="flex items-center">
                <span className="text-[9.5px] font-bold uppercase tracking-wider text-emerald-600 pr-1.5 text-right" style={{ width: GUTTER }}>
                  Now
                </span>
                <span className="flex-1 h-[1.5px] bg-emerald-500/70" />
              </div>
            </div>
          )}

          {ghost && <DropGhost preview={ghost} origin={origin} />}

          {timeline.blocks.map(block => (block.kind === 'external' ? (
            <ExternalBlock key={block.key} block={block} origin={origin} />
          ) : (
            <Block
              key={block.key}
              block={block}
              origin={origin}
              list={block.kind === 'task' ? listFor(block.task) : null}
              toMinute={toMinute}
              autoScroll={autoScroll}
              onOpen={onOpenTask}
              onUnschedule={onUnschedule}
              onChange={(b, start, minutes) => (b.kind === 'task'
                ? onPlaceTask(b.task, start, minutes)
                : onPlaceEvent(b.event, start, minutes))}
              onEditEvent={onEditEvent}
            />
          )))}

          {timeline.blocks.length === 0 && !ghost && (
            <div className="absolute inset-0 flex items-start justify-center pt-16 pointer-events-none">
              <p className="max-w-[240px] rounded-2xl bg-white/90 px-4 py-3 text-center text-[13px] text-gray-400 leading-relaxed">
                <Clock size={16} className="inline-block mb-1 text-gray-300" />
                <br />
                Nothing placed yet. Drag a task across from the right, or drag
                out an hour here to add a commitment.
              </p>
            </div>
          )}
        </div>
      </div>

      {events.length > 0 && (
        <div className="px-5 py-2.5 border-t border-gray-100 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Fixed</span>
          {events.map(event => (
            <button
              key={event.id}
              type="button"
              onClick={() => onEditEvent(event)}
              title="Edit this commitment"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-full pl-2 pr-2.5 py-[3px] transition-colors"
            >
              <span className="tabular-nums text-gray-400">{formatClock(dayMinutes(event.start))}</span>
              <span className="truncate max-w-[120px]">{event.title}</span>
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}
