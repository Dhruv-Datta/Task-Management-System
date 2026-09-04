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
import { TASK_COLOR, inkOn } from '@/lib/colors';
import { Panel, PanelHead } from '@/components/dashboard/Panel';

/** One minute, one pixel: the arithmetic and the drawing are the same numbers. */
export const PX_PER_MINUTE = 1;

/** The width of the hour rail down the left. */
const GUTTER = 52;

/*
  The two gaps that make a wall of blocks read as separate things.

  RAIL_PAD holds the blocks clear of the rule the hours hang off, so the grid
  has an edge rather than the colour running into the numbers. BLOCK_GAP is a
  single pixel off the bottom of every block: back to back, a 7:30 and an 8:15
  would otherwise meet as one unbroken band of colour, and the hairline between
  them is what says there are two.
*/
const RAIL_PAD = 8;
const BLOCK_GAP = 1;

/** The colour a commitment of your own is drawn in — no list, so no list
    colour. Neutral on purpose: it is the shape of the day rather than a
    thing you chose, the same job Google gives its graphite. */
const COMMITMENT_COLOR = '#64748b';

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

/*
  WHERE A BLOCK SITS: the same four numbers for a task, a commitment of your own
  and somebody else's meeting, so the three cannot drift apart. Overlapping
  blocks split the width between them — `column` of `columns`, worked out in
  lib/agenda — and each keeps its own gap at the bottom.
*/
function blockBox({ start, minutes, column, columns }, origin) {
  const lane = `((100% - ${GUTTER + RAIL_PAD}px) / ${columns})`;
  return {
    top: (start - origin) * PX_PER_MINUTE,
    height: Math.max(MIN_BLOCK_MINUTES * PX_PER_MINUTE - BLOCK_GAP, minutes * PX_PER_MINUTE - BLOCK_GAP),
    left: `calc(${GUTTER + RAIL_PAD}px + ${lane} * ${column})`,
    width: `calc(${lane} - ${BLOCK_GAP}px)`,
  };
}

/*
  HOW A BLOCK IS SET, decided by how tall it is.

  A quarter of an hour is fourteen pixels and the type that fits a half hour
  does not fit that, so the type shrinks to the box rather than the box hiding
  the type — a smaller name is still a name, a clipped one is a smudge. Three
  sizes, which is all the shapes there are: a strip that holds one line, a half
  hour that holds the name over the times tightly, and three quarters and up,
  which has room to breathe.
*/
const TYPE = {
  tight: { pad: 'px-1.5 py-0',     title: 'text-[10px] leading-[13px]', time: 'text-[10px] leading-[13px]' },
  snug:  { pad: 'px-1.5 py-[1px]', title: 'text-[11px] leading-[13px]', time: 'text-[10px] leading-[12px]' },
  roomy: { pad: 'px-2 py-[3px]',   title: 'text-[12px] leading-[15px]', time: 'text-[11px] leading-[14px]' },
};
const typeFor = height => (height < 22 ? TYPE.tight : height < 40 ? TYPE.snug : TYPE.roomy);

// ─────────────────────────────────────────────────────────────────────────────

/*
  One hour: its name in the rail, and the rule it starts on running the width of
  the day. Every hour is drawn the same weight — an emphasis every second hour
  turns the rail into a pattern to decode, and the numbers are already there to
  be read.
*/
function HourLine({ minute, origin }) {
  return (
    <div
      className="absolute left-0 right-0 flex items-start pointer-events-none"
      style={{ top: (minute - origin) * PX_PER_MINUTE }}
    >
      <span
        style={{ width: GUTTER }}
        className="shrink-0 -mt-[6px] pr-2.5 text-right text-[10px] font-medium tabular-nums text-gray-500"
      >
        {formatHourLabel(minute)}
      </span>
      <span className="flex-1 h-px bg-gray-200/80" />
    </div>
  );
}

/*
  THE TWO LINES a block carries, at the size its height allows.

  Shared by all three things drawn on this grid — a task, somebody else's
  meeting, and the block you are in the middle of putting down — because they
  are the same object seen at different moments, and the moment a preview stops
  looking exactly like the thing it previews is the moment it stops being one.

  `strong` is the in-flight state: the times go bold and full-strength, because
  while something is moving the clock is what you are reading rather than what
  you are checking. On a strip, where there is only ever one line, it replaces
  the name with the range for the same reason.
*/
function BlockFace({ title, start, minutes, type, strong = false, action = null }) {
  const range = formatClockRange(start, minutes);

  if (type === TYPE.tight) {
    return (
      <div className="flex items-start gap-1">
        <span className={`flex-1 min-w-0 truncate ${type.title} ${
          strong ? 'font-bold tabular-nums' : 'font-semibold'
        }`}>
          {strong ? range : `${title}, ${formatClock(start)}`}
        </span>
        {action}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start gap-1">
        <span className={`flex-1 min-w-0 font-semibold truncate ${type.title}`}>{title}</span>
        {action}
      </div>
      <div
        style={{ opacity: strong ? 1 : 0.85 }}
        className={`tabular-nums truncate ${type.time} ${strong ? 'font-bold' : ''}`}
      >
        {range}
      </div>
    </>
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
function Block({ block, origin, toMinute, autoScroll, onOpen, onUnschedule, onChange, onEditEvent }) {
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

  const box = blockBox({ start, minutes, column: block.column, columns: block.columns }, origin);
  const type = typeFor(box.height);

  /*
    SOLID, and the same red for every task you own (see TASK_COLOR): the day
    reads as yours against everybody else's. A commitment of your own is not a
    task and takes the neutral.
  */
  const fill = isTask ? TASK_COLOR : COMMITMENT_COLOR;
  const ink = inkOn(fill);

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

  const tight = type === TYPE.tight;

  // 8px of grab area top and bottom: big enough to hit, small enough that the
  // middle of a 30-minute block is still the block.
  const edgeClass = 'absolute left-0 right-0 h-[8px] cursor-ns-resize z-10';

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
        ...box,
        backgroundColor: fill,
        color: ink,
        touchAction: 'none',
        zIndex: moving ? 30 : 10,
      }}
      className={`group/block overflow-hidden rounded-md cursor-grab active:cursor-grabbing select-none shadow-sm transition-shadow hover:shadow-md ${type.pad} ${
        moving ? 'shadow-xl ring-2 ring-white/80' : ''
      }`}
    >
      <BlockFace
        title={block.title}
        start={start}
        minutes={minutes}
        type={type}
        strong={moving}
        action={isTask ? (
          <button
            type="button"
            onPointerDown={e => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onUnschedule(block.task); }}
            title="Take the time off (stays on today)"
            style={{ color: ink }}
            className={`flex-shrink-0 rounded opacity-0 group-hover/block:opacity-75 hover:bg-black/15 transition-all ${
              tight ? '-mr-0.5' : '-mr-1 -mt-[1px] p-0.5'
            }`}
          >
            <X size={tight ? 10 : 11} strokeWidth={2.5} />
          </button>
        ) : null}
      />

      {/* Both edges, like every other calendar, and drawn as NOTHING: the
          block is small and the day is a wall of them, so two handles appearing
          on every one you pass the pointer over is clutter on top of the ×
          that is already there. The zone still announces itself — the cursor
          turns to ns-resize on the 8px that resize and stays a grab hand on the
          middle that moves, which is the same signal a window edge gives and
          costs the block no ink. */}
      <span
        onPointerDown={begin('top')}
        onClick={e => e.stopPropagation()}
        title="Drag to change when it starts"
        style={{ top: 0, touchAction: 'none' }}
        className={edgeClass}
      />
      <span
        onPointerDown={begin('bottom')}
        onClick={e => e.stopPropagation()}
        title="Drag to change when it ends"
        style={{ bottom: 0, touchAction: 'none' }}
        className={edgeClass}
      />
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

  It is drawn solid in the colour Google draws it in, exactly like everything
  else on the grid, because a lecture at nine is as real a fact as the hour you
  gave yourself and half-drawing it would say otherwise — and because the whole
  point of the colour is that the calendar you recognise by it is recognisable
  here. What separates yours from theirs is not weight, it is behaviour: yours
  lift under the pointer and carry an ×, this does nothing at all.

  It sits UNDER the task blocks (a lower z-index), so a task you drop on top of
  a meeting is the one you can still see and click — the overlap is the warning,
  and the thing you can act on should be the thing on top.
*/
function ExternalBlock({ block, origin }) {
  const event = block.external;
  const box = blockBox(block, origin);
  const type = typeFor(box.height);
  const ink = inkOn(event.color);

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
        ...box,
        backgroundColor: event.color,
        color: ink,
        zIndex: 5,
      }}
      className={`overflow-hidden rounded-md select-none cursor-default shadow-sm ${type.pad}`}
    >
      <BlockFace title={event.title} start={block.start} minutes={block.minutes} type={type} />
    </div>
  );
}

/*
  WHERE IT WOULD LAND, drawn while you are still holding it — as THE BLOCK IT IS
  ABOUT TO BE, not as a sketch of one.

  Same width, same height, same colour, same two lines: a task carried in from
  the list stops being a card the moment it crosses onto the grid and becomes
  the hour it is going to occupy, which is the only preview worth having. You
  are choosing between 2:00 and 2:15 and between a half hour and an hour, and
  both of those are questions about a SHAPE — a dashed outline in some other
  colour answers the first one and lies about the second.

  It is snapped to the quarter hour while the pointer is not, so it also does
  the job the old outline did: what you see is exactly what will be written, a
  quarter of an hour before you commit to it. The rule and the time in the
  gutter say the same number in the column you were already reading.

  It draws for a task carried in from the list, and for the range you are
  dragging out on empty canvas. A block already on the grid needs none of it: it
  moves under the cursor and re-reads its own clock, so a ghost behind it would
  be the same fact drawn twice.
*/
function DropGhost({ preview, origin, fill }) {
  const box = blockBox({ start: preview.start, minutes: preview.minutes, column: 0, columns: 1 }, origin);
  const type = typeFor(box.height);

  return (
    <div aria-hidden className="absolute left-0 right-0 pointer-events-none z-40" style={{ top: box.top }}>
      <div className="absolute inset-x-0 top-0 flex items-start">
        <span
          style={{ width: GUTTER, color: fill }}
          className="shrink-0 -mt-[6px] pr-2.5 text-right text-[10px] font-bold tabular-nums"
        >
          {formatClock(preview.start)}
        </span>
        <span className="flex-1 h-px" style={{ backgroundColor: fill }} />
      </div>

      <div
        style={{
          position: 'absolute',
          top: 0,
          left: box.left,
          width: box.width,
          height: box.height,
          backgroundColor: fill,
          color: inkOn(fill),
        }}
        className={`overflow-hidden rounded-md shadow-xl ring-2 ring-white/80 ${type.pad}`}
      >
        <BlockFace
          title={preview.title}
          start={preview.start}
          minutes={preview.minutes}
          type={type}
          strong
        />
      </div>
    </div>
  );
}

export default function Timeline({
  timeline, events, nowMinutes, canvasRef,
  onOpenTask, onUnschedule, onPlaceTask, onPlaceEvent, onAddEvent, onEditEvent,
  dragPreview = null, sticky = false, maxHeight = 'calc(100vh - 230px)',
  googleControl = null,
}) {
  // No `isOver` styling: the canvas used to tint green while something was over
  // it, which was the only feedback back when the drop preview was a dashed
  // outline nobody had wired up. The ghost is the whole answer now — it is the
  // block, in the block's colour, at the minute it will land on — and a green
  // wash behind it is a second thing saying less.
  const { setNodeRef } = useDroppable({ id: 'timeline' });
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
          className="relative rounded-xl select-none"
        >
          {timeline.hours.map(minute => (
            <HourLine key={minute} minute={minute} origin={origin} />
          ))}

          {/* The rule the day hangs off. The hours are a column of numbers and
              the grid begins where they end, which is a line — without it the
              blocks float in the same space as the labels. */}
          <div
            aria-hidden
            className="absolute top-0 bottom-0 w-px bg-gray-200 pointer-events-none"
            style={{ left: GUTTER }}
          />

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

          {/*
            Where you actually are in the day. The one moving thing on the page,
            and the reason "3h 45m left" is a different sentence at nine in the
            morning and at four in the afternoon.

            Red, with a dot on the rail, because that is what the line means
            everywhere else a day is drawn — and it has to win against blocks
            that are now solid colour themselves, which a green hairline over a
            teal block does not. The rail says the actual time rather than the
            word "now": the gutter is a column of times, and this is one.
          */}
          {nowMinutes !== null && nowMinutes >= timeline.startMinute && nowMinutes <= timeline.endMinute && (
            <div
              aria-hidden
              className="absolute left-0 right-0 pointer-events-none z-20"
              style={{ top: (nowMinutes - origin) * PX_PER_MINUTE }}
            >
              <div className="flex items-center">
                <span
                  style={{ width: GUTTER }}
                  className="shrink-0 pr-2.5 text-right text-[10px] font-bold tabular-nums text-red-600"
                >
                  {formatClock(nowMinutes)}
                </span>
                <span className="relative flex-1 h-[1.5px] bg-red-500">
                  <span className="absolute -left-px -top-[4px] w-[10px] h-[10px] rounded-full bg-red-500" />
                </span>
              </div>
            </div>
          )}

          {/* Drawing a range on empty canvas makes a commitment; carrying
              something in from the list places a task. Two different things,
              and the ghost is each of them in its own colour rather than a
              third colour that is neither. */}
          {ghost && (
            <DropGhost
              preview={ghost}
              origin={origin}
              fill={drawn ? COMMITMENT_COLOR : TASK_COLOR}
            />
          )}

          {timeline.blocks.map(block => (block.kind === 'external' ? (
            <ExternalBlock key={block.key} block={block} origin={origin} />
          ) : (
            <Block
              key={block.key}
              block={block}
              origin={origin}
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
