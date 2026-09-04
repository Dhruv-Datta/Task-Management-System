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
      event   it in, and — where it is yours to change — moved, resized, renamed,
              retagged and deleted exactly like everything else here, with the
              write going straight back to Google (/api/google/event). A
              read-only calendar's events, and a meeting somebody else
              organized, are still drawn and still taggable but do not pick up
              under the pointer; see `movable` in lib/googleEvents. All-day ones
              have no hour to sit at, so they go in a strip above the grid, the
              way every calendar draws them.

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
    right-click a block           the tag menu: the coloured labels you keep
                                  your calendar in, and — on one of Google's own
                                  events — rename and delete (see BlockMenu).

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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { CalendarPlus, Clock, X } from 'lucide-react';
import {
  DAY_WINDOW_END, MINUTES_PER_DAY, clockToMinutes, dayMinutes, formatClock, formatClockRange,
  formatHourLabel,
} from '@/lib/dates';
import { descriptionPreview, labelColor } from '@/lib/googleEvents';
import { TASK_COLOR, inkOn } from '@/lib/colors';
import { Panel, PanelHead } from '@/components/dashboard/Panel';
import BlockMenu from './BlockMenu';

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
  tight: { pad: 'px-1.5 py-0',     title: 'text-[10px] leading-[13px]', time: 'text-[10px] leading-[13px]', note: 'text-[10px] leading-[13px]' },
  snug:  { pad: 'px-1.5 py-[1px]', title: 'text-[11px] leading-[13px]', time: 'text-[10px] leading-[12px]', note: 'text-[10px] leading-[13px]' },
  roomy: { pad: 'px-2 py-[3px]',   title: 'text-[12px] leading-[15px]', time: 'text-[11px] leading-[14px]', note: 'text-[11px] leading-[14px]' },
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
  THE DESCRIPTION ON THE BLOCK ITSELF, and the two numbers that decide it.

  AN HOUR is the threshold, and it is a duration rather than a pixel count on
  purpose: it is the same rule at any zoom, and it is the honest one — under an
  hour there is one line spare, and a single clipped line of prose under a title
  is not information, it is a smudge that makes the block look broken. At an
  hour there is room for a real sentence, and above it the block grows a line at
  a time until it is showing the lot.

  How many lines that is, is measured rather than guessed: the box's own height,
  less what the title and the clock already take, divided by the line it is set
  in. So a 90-minute block shows three lines and a four-hour block shows ten,
  without a table of special cases — and CSS puts the ellipsis on the last one,
  at whatever height the block actually is, which is the only place that can
  know where the text ran out.
*/
const DESCRIPTION_MIN_MINUTES = 60;

/** What the title and the clock have already spent, in pixels. */
const FACE_HEAD = 40;
const MAX_DESCRIPTION_LINES = 10;

/** The words under a block's clock, wherever that kind of block keeps them. */
function descriptionOf(block) {
  if (block.kind === 'task') return block.task?.notes || '';
  if (block.kind === 'event') return block.event?.notes || '';
  return block.external?.description || '';
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
function BlockFace({
  title, start, minutes, type, strong = false, action = null, description = '', lines = 0,
}) {
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

      {/*
        Clamped by the browser rather than cut by us, because only the browser
        knows how wide this block ended up — two overlapping blocks split the
        column between them, and the same sentence is two lines in one and four
        in the other. `-webkit-line-clamp` is what puts the … on the last line
        it kept; every engine this runs in supports it under that name.

        Quieter than the clock above it: it is the thing you read when you have
        already found the block, not the thing you find it by.
      */}
      {description && lines > 0 && (
        <div
          style={{
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: lines,
            overflow: 'hidden',
            opacity: 0.75,
          }}
          className={`mt-[2px] ${type.note}`}
        >
          {description}
        </div>
      )}
    </>
  );
}

/*
  WHAT A BLOCK IS DRAWN IN.

  A tag first, wherever there is one: the whole point of tagging an hour is that
  you recognise what kind of hour it is by its colour, and that colour has to be
  the one Google draws it in or the two calendars are telling you different
  things about the same afternoon.

  Failing that, the three defaults, which are three different sentences:

    a task        Tomato, the one red every task block has always been (see
                  TASK_COLOR). Untagged, the useful distinction on a day is
                  between the hours you gave yourself and the hours somebody
                  else already owns, and one colour for all of yours draws that
                  line in a glance.
    a commitment  slate. It is the shape of the day rather than something you
                  chose, which is the job Google gives its own graphite.
    an event      whatever Google says, which is the label, the event's own
                  colour, or its calendar's — resolved on the way in
                  (`eventColor` in lib/googleEvents) so a lecture is the colour
                  you know it by.
*/
function fillFor(block, labels) {
  const tagged = labelColor(labels, block.labelId);
  if (tagged) return tagged;
  if (block.kind === 'external') return block.external.color;
  return block.kind === 'task' ? TASK_COLOR : COMMITMENT_COLOR;
}

/*
  The hover text, which is where the detail that will not fit in a
  fourteen-pixel box lives: what it is, when, whose calendar, where — and, for
  one that spills over a midnight, which midnight.
*/
function tooltipFor(block, start, minutes) {
  const when = `${block.title} · ${formatClockRange(start, minutes)}`;
  // Under an hour the block has no room to draw it, and a quarter-hour with a
  // note on it should not be the one thing here you cannot read at all.
  const note = descriptionPreview(descriptionOf(block), 200);
  if (block.kind !== 'external') return note ? `${when}\n${note}` : when;

  const event = block.external;
  const spill = event.clipped === 'both'
    ? 'started yesterday, runs into tomorrow'
    : event.clipped === 'start'
      ? 'started yesterday'
      : event.clipped === 'end'
        ? 'runs into tomorrow'
        : null;

  return [
    event.title,
    formatClockRange(start, minutes),
    note,
    spill,
    event.location,
    // What YOU called this colour. A block that says "Chill Vibes" explains
    // itself in a way "blue" never will.
    event.label,
    event.calendar && `on ${event.calendar}`,
    event.recurring && 'repeats — changes here apply to this one',
    event.movable ? 'Drag to move · right-click to tag' : 'Not moved from here — right-click to tag',
  ].filter(Boolean).join('\n');
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

  ONE COMPONENT FOR ALL THREE KINDS, including somebody else's meeting, which
  used to be a separate and deliberately gesture-less component. The argument for
  that was that a planner cannot honestly offer to move a thing it has nowhere to
  send the move to — and it was right until there was somewhere. Now there is
  (/api/google/event), so the honest thing is the opposite: a calendar where half
  the blocks move and half do not, with no way to tell which from looking, is a
  calendar you have to experiment on.

  What is still true is that not everything CAN move, and that is carried per
  block rather than per kind (see `movable` in lib/googleEvents): a read-only
  calendar and a meeting somebody else organized are both drawn, both taggable
  where the calendar allows it, and neither picks up under the pointer. A block
  that cannot move has no pointer handlers at all rather than handlers that
  decline — a thing you cannot drag is best built as a thing with no drag in it,
  and then it cannot start moving by accident three refactors from now.
*/
function Block({
  block, origin, toMinute, autoScroll, labels, movable,
  onOpen, onUnschedule, onChange, onEditEvent, onMenu,
}) {
  const isTask = block.kind === 'task';
  const isExternal = block.kind === 'external';

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

  const fill = fillFor(block, labels);
  const ink = inkOn(fill);

  /*
    An hour buys the first line of the description; every fourteen pixels after
    that buys another. Computed from the DRAFT height rather than the stored one,
    so a block resized past the hour grows its description while you are still
    holding the edge — the block on screen is always the block you are about to
    commit, which is the rule the whole of this component is built on.
  */
  const description = minutes >= DESCRIPTION_MIN_MINUTES ? descriptionPreview(descriptionOf(block)) : '';
  const descriptionLines = description
    ? clamp(Math.floor((box.height - FACE_HEAD) / 14), 1, MAX_DESCRIPTION_LINES)
    : 0;

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

  /*
    Where a block sits in the stack, and it is the same rule it has always been:
    yours on top of Google's, so a task you drop over a meeting is the one you
    can still see and click. The overlap IS the warning, and the thing you can
    act on should be the thing on top. Whatever is mid-gesture wins over both,
    because while you are holding it, it is the only block you are looking at.
  */
  const depth = moving ? 30 : isExternal ? 5 : 10;

  return (
    <div
      onPointerDown={movable ? begin('move') : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu(block, { x: e.clientX, y: e.clientY });
      }}
      onClick={() => {
        if (draggedRef.current) return;
        if (isTask) onOpen(block.task);
        else if (!isExternal) onEditEvent(block.event);
      }}
      title={tooltipFor(block, start, minutes)}
      style={{
        position: 'absolute',
        ...box,
        backgroundColor: fill,
        color: ink,
        touchAction: 'none',
        zIndex: depth,
      }}
      className={`group/block overflow-hidden rounded-md select-none shadow-sm transition-shadow hover:shadow-md ${type.pad} ${
        movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
      } ${moving ? 'shadow-xl ring-2 ring-white/80' : ''}`}
    >
      <BlockFace
        title={block.title}
        start={start}
        minutes={minutes}
        type={type}
        strong={moving}
        description={description}
        lines={descriptionLines}
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
      {movable && (
        <>
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
        </>
      )}
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

/*
  THE TAG VOCABULARY, and why it is one prop rather than a lookup per block.

  A tag is a Google event LABEL, and a label belongs to exactly one calendar
  (its id is a UUID that is unique within it). So which tags a block may take is
  decided entirely by where that block will be WRITTEN:

    a Google event    the labels of the calendar it lives on. Its own, and
                      nobody else's — offering a label from another calendar
                      would be offering an id the write is about to reject.
    a task, or a      the labels of the calendar the day is pushed to
    commitment        (GOOGLE_CALENDAR_NAME). That is where a task's block ends
                      up when you finish planning, so that is the only place its
                      tag can mean anything.

  `tags.own` is that second set, `tags.byCalendar` the first, and `tags.calendar`
  the write calendar's NAME, which is the only thing worth saying when it has no
  labels on it yet: "there are none" is unhelpful, "there are none on Personal /
  Work" tells you where to go and make some.
*/
const NO_TAGS = { own: [], byCalendar: {}, calendar: null, connected: false };

/*
  The line under the menu's title: WHEN, and WHOSE. Both, because the menu is
  opened over a wall of coloured boxes and "the one I right-clicked" deserves
  more confirmation than a name that may be truncated to two words.
*/
function menuSubtitle(block) {
  if (block.kind === 'external') {
    const when = block.start === null ? 'All day' : formatClockRange(block.start, block.minutes);
    return [when, block.external?.calendar && `on ${block.external.calendar}`].filter(Boolean).join(' · ');
  }
  const when = formatClockRange(block.start, block.minutes);
  return `${when} · ${block.kind === 'task' ? 'on today' : 'commitment'}`;
}

export default function Timeline({
  timeline, events, nowMinutes, canvasRef,
  onOpenTask, onUnschedule, onPlaceTask, onPlaceEvent, onAddEvent, onEditEvent,
  onPlaceExternal, onTagBlock, onRenameBlock, onDescribeBlock, onDeleteBlock,
  tags = NO_TAGS,
  dragPreview = null, sticky = false, maxHeight = 'calc(100vh - 230px)',
  googleControl = null, fill = false,
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

  /*
    THE MENU: which block it is about, and where the pointer was when you asked
    for it. One at a time, held here rather than on each block, because a
    context menu is a fact about the page — opening a second one while the first
    is up is not a thing any calendar does.

    The block is looked up FRESH on every render rather than captured, so a menu
    left open while its block is dragged, retagged or refreshed out from under
    it is about the block as it now is; and one whose block has gone entirely (a
    task unscheduled in another tab, an event deleted) closes itself rather than
    describing something that is no longer on the grid.
  */
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuBlock = menu ? timeline.blocks.find(b => b.key === menu.key) || menu.allDay || null : null;
  // Adjusted during render rather than in an effect: React re-renders before it
  // commits, so a menu whose block has gone never reaches the screen at all —
  // where an effect would let it draw once, pointed at nothing, and then vanish.
  if (menu && !menuBlock) setMenu(null);

  const labelsFor = block => (
    block.kind === 'external' ? (tags.byCalendar?.[block.external?.calendarId] || []) : (tags.own || [])
  );

  /*
    THE WORDS ON A BLOCK, which live in three different places and are one field
    in the menu: a task's title and notes, a commitment's title and notes, and a
    Google event's summary and description.

    A task IS renameable from here, and that is a change of mind since the menu
    was first written. The argument for keeping it out was that a name belongs
    to the task and not to an hour — but the menu no longer has a Rename item to
    mis-aim at; it has the name itself, sitting where the name already was, and
    refusing to let you fix a typo in the one place you are looking at it is not
    restraint, it is just a dead end. DELETE is still the line: removing a task
    is a decision about work, not about an hour.
  */
  const wordsOf = (block) => {
    // `descriptionOf` and not a second copy of the same three-way lookup: the
    // menu edits exactly the text the block draws a preview of.
    if (block.kind !== 'external') return { description: descriptionOf(block), editable: true };
    const event = block.external || {};
    return {
      description: descriptionOf(block),
      // Its words are yours unless somebody else organized it — and a
      // description we only have PART of is never editable, because saving an
      // edit to a truncated copy would drop the rest of it (see MAX_DESCRIPTION).
      editable: !!event.editable,
      clipped: !!event.descriptionClipped,
    };
  };

  /*
    Why the name and the description are not yours to change, when they are not.
    A field that is simply inert reads as a bug; a field that says "somebody else
    organized this" reads as Google, which is what it is.
  */
  const readOnlyNoteFor = (block) => {
    if (block.kind !== 'external') return null;
    const event = block.external || {};
    // A read-only calendar is deliberately NOT explained twice: `noteFor` says
    // it under the tag row, four lines further down, and two sentences saying
    // the same thing read as two different problems.
    if (!event.writable) return null;
    if (event.descriptionClipped) {
      return 'This description is longer than the day carries — edit it in Google Calendar.';
    }
    if (!event.editable) return 'Somebody else organized this, so its wording is theirs.';
    return null;
  };

  /*
    The one line under the tag pills, which exists because every empty or
    reduced menu here has a REASON and none of them are the same reason. A menu
    that just shows nothing is indistinguishable from a broken one.
  */
  const noteFor = (block) => {
    if (block.kind === 'external') {
      const event = block.external || {};
      // Three different reasons a block does not pick up, and they need three
      // different sentences: an empty menu that does not say which is a menu
      // that reads as broken.
      if (!event.writable) {
        return `“${event.calendar || 'That calendar'}” is shared with you read-only, so this event cannot be changed here.`;
      }
      if (event.clipped) {
        return 'This one crosses a midnight, so only part of it is on this day — move it in Google Calendar.';
      }
      if (!event.movable) return 'Somebody else organized this, so when it happens is theirs. Its tag is yours.';
      if (event.recurring) return 'This repeats — a change here applies to this one only.';
      return null;
    }
    if (!tags.connected) return 'Tags are Google Calendar’s. Connect it to use them.';
    if ((tags.own || []).length > 0) return null;
    return tags.calendar
      ? `No tags on “${tags.calendar}” yet. Make some in Google Calendar and they show up here.`
      : 'No calendar to write to yet, so there are no tags to give this.';
  };

  /*
    `fill`: on a wide screen the page around this is a fixed-height column (see
    /today), so the panel takes the height it is given and the hours scroll
    INSIDE it. That is the whole point — a calendar whose own scroll is also
    the page's scroll makes you scroll the page past nothing to reach 3pm.
  */
  return (
    <Panel
      className={`${sticky ? 'lg:sticky lg:top-24' : ''} ${
        fill ? 'lg:h-full lg:flex lg:flex-col lg:min-h-0' : ''
      }`}
    >
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
          {timeline.allDay.map((event) => {
            /*
              An all-day event is not a block — it has no hour to be drawn at —
              but it is still one of your events, and the two questions you ask
              about it are the two the menu answers. So it gets the same
              right-click, dressed as the block it never was: the same shape
              BlockMenu reads everywhere else, with no start and no length.
            */
            const asBlock = {
              key: `allday-${event.id}`,
              kind: 'external',
              title: event.title,
              labelId: event.labelId || null,
              external: event,
              start: null,
              minutes: 0,
            };
            const tint = labelColor(labelsFor(asBlock), event.labelId) || event.color;
            return (
              <span
                key={event.id}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ key: asBlock.key, point: { x: e.clientX, y: e.clientY }, allDay: asBlock });
                }}
                title={[
                  event.title, event.location, event.label,
                  event.calendar && `on ${event.calendar}`,
                  'Right-click to tag',
                ].filter(Boolean).join('\n')}
                style={{ backgroundColor: `${tint}1f`, borderColor: `${tint}55` }}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-600 border rounded-full pl-1.5 pr-2.5 py-[3px]"
              >
                <span
                  aria-hidden
                  className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                  style={{ backgroundColor: tint }}
                />
                <span className="truncate max-w-[170px]">{event.title}</span>
              </span>
            );
          })}
        </div>
      )}

      <div
        ref={scrollRef}
        // Narrow, the panel is one of two stacked cards and the page scrolls
        // past it, so it caps itself. Wide and filling, the height comes from
        // the column it is in and a cap of its own is what left the page with
        // a hundred spare pixels to scroll through.
        style={fill ? { '--tl-max': maxHeight } : { maxHeight }}
        className={`px-3 pb-3 overflow-y-auto ${
          fill
            ? 'max-h-[var(--tl-max)] min-h-[320px] lg:max-h-none lg:min-h-0 lg:flex-1'
            : 'min-h-[320px]'
        }`}
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

          {timeline.blocks.map(block => (
            <Block
              key={block.key}
              block={block}
              origin={origin}
              toMinute={toMinute}
              autoScroll={autoScroll}
              labels={labelsFor(block)}
              // Yours always; Google's only where Google will take the write.
              movable={block.kind !== 'external' || !!block.external?.movable}
              onOpen={onOpenTask}
              onUnschedule={onUnschedule}
              onChange={(b, start, minutes) => {
                if (b.kind === 'task') onPlaceTask(b.task, start, minutes);
                else if (b.kind === 'event') onPlaceEvent(b.event, start, minutes);
                else onPlaceExternal(b.external, start, minutes);
              }}
              onEditEvent={onEditEvent}
              onMenu={(b, point) => setMenu({ key: b.key, point })}
            />
          ))}

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

      {/*
        THE RIGHT-CLICK MENU, drawn once for whichever block asked for it.

        What it offers is decided here rather than inside it, because the rule is
        about this app's three kinds of block and not about menus. The name and
        the description are editable wherever the thing holding them will take
        the write — a task's on the task, a commitment's in the day's blob, a
        Google event's in Google. DELETE is the one that stays narrow: a task is
        not deleted from a calendar menu, because removing it is a decision
        about work rather than about an hour, and a right-click is easy to
        mis-aim.
      */}
      {menu && menuBlock && (() => {
        const words = wordsOf(menuBlock);
        return (
          <BlockMenu
            point={menu.point}
            title={menuBlock.title}
            subtitle={menuSubtitle(menuBlock)}
            description={words.description}
            labels={menuBlock.kind === 'external' && !menuBlock.external?.writable ? [] : labelsFor(menuBlock)}
            labelId={menuBlock.labelId || null}
            note={noteFor(menuBlock)}
            readOnlyNote={readOnlyNoteFor(menuBlock)}
            onTag={labelId => onTagBlock(menuBlock, labelId)}
            onRename={words.editable ? title => onRenameBlock(menuBlock, title) : null}
            // A truncated description is shown and not edited: the name above it
            // is still perfectly safe to change, which is why these are two
            // permissions rather than one.
            onDescribe={
              words.editable && !words.clipped ? text => onDescribeBlock(menuBlock, text) : null
            }
            onDelete={
              menuBlock.kind === 'task' || (menuBlock.kind === 'external' && !menuBlock.external?.writable)
                ? null
                : () => onDeleteBlock(menuBlock)
            }
            onClose={closeMenu}
          />
        );
      })()}

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
