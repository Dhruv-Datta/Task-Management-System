'use client';

/*
  The small controls every task surface shares: the anchored menu primitive, the
  status / priority / date / estimate pickers built on it, and the read-only
  chips that display those same values.

  One definition each, used by the list, the board, the week grid and the detail
  panel, so a status looks and behaves identically wherever you meet it, and
  there is exactly one place to change how (say) a due date reads.
*/

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, Flag, Star, Timer,
} from 'lucide-react';
import {
  DAILY_PRIORITIES, ESTIMATES, PRIORITIES, STATUSES, dateMeta, estimateMeta,
  normalizeDailyPriority, priorityMarks, priorityMeta, statusMeta,
} from '@/lib/tasks';
import {
  MONTH_FULL_NAMES, WEEKDAY_NAMES, addDaysISO, addMonthsISO, formatDateLong, fromISODate,
  monthGridISO, todayISO,
} from '@/lib/dates';

/*
  ─── Where the task overlays sit ─────────────────────────────────────────────

  Everything below portals to <body>, so what they stack against is the whole
  app, not the surface that opened them. Three levels, in the order they open:

    drag    a card mid-drag, above the page it was lifted out of
    dialog  the New task box / task detail: a modal is above everything the
            page draws, including a dragged card left mid-flight
    menu    a picker's dropdown: it opens from inside the dialog, so above it

  Named numbers rather than guesses, because the ordering only reads correctly
  when all three are decided in one place. They start above the navbar (9999) so
  a dialog is never drawn under it.
*/
/*
  HOW TALL A MENU OF YOUR LISTS IS ALLOWED TO GET.

  The generic menu height (MenuPortal's 320) is sized for a picker with four or
  seven answers in it — a status, a priority, an estimate. A list of LISTS is
  not that: people keep one per class, per project, per side of their life, and
  a dozen is ordinary. At 320 a dozen lists scroll, and a menu that scrolls
  before it has shown you everything makes you hunt for a list you can see the
  name of in your head.

  So the three menus that draw your lists share this: enough for about fourteen
  rows before anything scrolls, with room for the "New list…" footer where there
  is one. MenuPortal still clamps it to the screen it actually has, so on a
  short window it is the window that decides, not this.
*/
export const LIST_MENU_HEIGHT = 560;

export const OVERLAY_Z = {
  drag: 10000,
  dialog: 10010,
  menu: 10020,
};

// ─── Menu primitive ──────────────────────────────────────────────────────────

/**
 * A dropdown pinned to `anchorRef`, portalled to <body> so it escapes any
 * overflow/transform ancestor (cards and kanban columns both clip). Closes on
 * outside click or Escape.
 */
export function MenuPortal({ anchorRef, onClose, align = 'left', width = 200, maxHeight = 320, fit = 240, rigid = false, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = anchorRef?.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const left = align === 'right'
        ? Math.max(8, rect.right - width)
        : Math.min(rect.left, window.innerWidth - width - 8);
      const below = window.innerHeight - rect.bottom;

      /*
        A RIGID menu is one drawing a fixed object rather than a list of rows —
        the calendar. A list can give up its bottom half to a scrollbar and
        still be a list; half a month grid is not a month grid, and hunting for
        the 28th by scrolling a box the size of a postage stamp is worse than
        the native picker this replaced. So it is never shrunk to fit the gap
        under its trigger: it takes its full height (`fit`), and only a window
        shorter than the menu itself can make one scroll.

        It is also CENTRED ON ITS TRIGGER rather than hung below it. A 430px
        panel dropped under a row halfway down the screen ends up pressed
        against the bottom edge, which is both an awkward place to read a month
        and a long way from where you were looking. Straddling the row keeps it
        near the middle of the screen, and means unfolding the grid grows the
        panel evenly in both directions instead of lurching downwards. It
        covers the trigger doing so, which is fine: that is a control you have
        just used, and the menu's own footer says what it currently reads.
      */
      if (rigid) {
        const height = Math.min(fit, window.innerHeight - 16);
        const centred = rect.top + rect.height / 2 - height / 2;
        const top = Math.min(Math.max(8, centred), window.innerHeight - 8 - height);
        setPos({ top, bottom: null, left, room: window.innerHeight - 16 });
        return;
      }

      // Flip above the anchor when there isn't room below, and report how much
      // room the chosen side actually has: a menu that is allowed to be tall
      // should use the screen it has before it starts scrolling.
      const flip = below < fit && rect.top > below;
      setPos({
        top: flip ? null : rect.bottom + 6,
        bottom: flip ? window.innerHeight - rect.top + 6 : null,
        left,
        room: Math.max(180, (flip ? rect.top : below) - 16),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, align, width, fit, rigid]);

  /*
    Both listeners are CAPTURE phase, on purpose. A menu can be opened from
    inside a modal whose own chrome stops mousedown from bubbling (the composer
    stops it so a click inside doesn't dismiss the modal), and a bubble-phase
    listener here would then never see the click, and the menu would only close
    by clicking its trigger again. Capturing also means Escape closes the menu
    and nothing else: stopping propagation during capture keeps the event from
    ever reaching the modal's own bubble-phase Escape handler.
  */
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !anchorRef?.current?.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchorRef, onClose]);

  if (!pos || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ref}
      /* Portalled out of the tree, so a surface that closes on an outside click
         can't tell this menu is its own unless it's labelled. Every task
         overlay carries the same mark. */
      data-task-overlay
      style={{
        position: 'fixed',
        top: pos.top ?? undefined,
        bottom: pos.bottom ?? undefined,
        left: pos.left,
        width,
        // A menu long enough to scroll is a menu you have to hunt through, so
        // the taller ones say how tall they are allowed to get, bounded by the
        // room actually below (or above) the anchor.
        maxHeight: Math.min(maxHeight, pos.room),
        zIndex: OVERLAY_Z.menu,
      }}
      className="bg-white border border-gray-200 rounded-xl shadow-xl py-1 overflow-y-auto"
    >
      {children}
    </div>,
    document.body
  );
}

/*
  A picker's trigger. When a caller supplies its own child (a chip, a row of
  text) that child IS the affordance, so the button must add nothing: its own
  padding and hover fill would otherwise draw a second, differently-shaped
  surface behind the one you can see.
*/
function triggerClass(hasChildren, chrome, full = false) {
  // `min-w-0` all the way down: a trigger wrapping a chip that truncates (the
  // person pill) only shrinks if every flex box between the card and the text
  // agrees to. Without it the pill keeps its full width and the name spills out
  // over whatever sits beside it.
  //
  // `full` is the rail's shape: there the trigger is a row you can click
  // anywhere along, not a word you have to aim at, so it takes the whole width
  // it is given instead of shrinking to its text.
  return hasChildren
    ? `${full ? 'flex w-full' : 'inline-flex'} items-center min-w-0 max-w-full`
    : chrome;
}

// The anchor a full-width trigger hangs off has to stretch too, or the button
// inside it has nothing to fill.
const anchorClass = full => (full ? 'flex min-w-0' : 'inline-flex');

function MenuItem({ active, onClick, children, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-gray-50 transition-colors ${
        active ? 'font-semibold text-gray-900' : 'text-gray-600'
      } ${className}`}
    >
      {children}
    </button>
  );
}

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * The status dot: an empty ring that fills as the task moves through the
 * pipeline. The fraction is the status's own `progress` (lib/tasks), so
 * "Not started" is a bare outline, "In progress" is half, "Waiting review" is
 * nearly round and "Completed" is a filled disc with a check in it.
 */
export function StatusDot({ status, size = 14, className = '' }) {
  const meta = statusMeta(status);
  const done = meta.key === 'completed';
  const pct = meta.progress ?? 0;
  const r = size / 2 - 1.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden>
      {done ? (
        /*
          One disc, filled, out to where the ring's outer edge would be, so
          Completed is the same size as the other three.

          It was drawn as the same 100% arc as the rest, stroked at the circle's
          own radius to fake a fill. A stroke straddles its path, so that leaves
          an untouched hole of radius r/2 in the middle: the white dot under the
          check. A circle you want filled is `fill`, never a fat stroke.
        */
        <circle cx={size / 2} cy={size / 2} r={r + 0.75} fill={meta.color} />
      ) : (
        <>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={meta.color} strokeWidth="1.5" opacity={pct > 0 ? 0.3 : 0.55} />
          {pct > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={meta.color}
              strokeWidth="1.75"
              strokeDasharray={`${c * pct} ${c}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          )}
        </>
      )}
      {done && (
        <path
          d={`M${size * 0.29} ${size * 0.52} L${size * 0.43} ${size * 0.66} L${size * 0.72} ${size * 0.35}`}
          fill="none"
          stroke="#fff"
          strokeWidth={Math.max(1.35, size * 0.125)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/**
 * The status, as a word.
 *
 * One definition for all three places one is drawn, because a status that looks
 * like three different objects reads as three different things: the header of
 * both task dialogs, where the chip IS the control, and a list row when the
 * sections are not statuses.
 *
 * It is a soft tinted label with a hairline of its own hue and a squared-off
 * radius, rather than the outlined lozenge it was. A status is something the
 * task IS, so it should read as a label; a pill with a hard border reads as a
 * button you have not pressed yet.
 *
 * `dense` is the row version: the short word, no dot, because a row is already
 * a line of small type. `interactive` adds the chevron and hover the dialog
 * triggers need.
 */
export function StatusChip({ status, dense = false, interactive = false, className = '' }) {
  const meta = statusMeta(status);
  return (
    <span
      className={`inline-flex items-center border font-semibold ${meta.chip} ${
        dense
          ? 'gap-1 rounded-md px-1.5 py-[2px] text-[10px] uppercase tracking-wider'
          : 'gap-1.5 rounded-lg py-1 pl-2 text-[11px]'
      } ${dense ? '' : interactive ? 'pr-1.5 hover:brightness-[0.98] transition-all' : 'pr-2'} ${className}`}
    >
      {!dense && <StatusDot status={status} size={11} />}
      {dense ? meta.short : meta.label}
      {interactive && <ChevronDown size={11} className="opacity-50" />}
    </span>
  );
}

export function StatusPicker({ status, onSelect, children, align = 'left' }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <span ref={anchorRef} className="inline-flex">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          title={statusMeta(status).label}
          className={triggerClass(!!children, 'inline-flex items-center rounded-md hover:bg-gray-100 transition-colors')}
        >
          {children ?? <StatusDot status={status} />}
        </button>
      </span>
      {open && (
        <MenuPortal anchorRef={anchorRef} onClose={() => setOpen(false)} align={align} width={190}>
          {STATUSES.map(s => (
            <MenuItem key={s.key} active={s.key === statusMeta(status).key} onClick={() => { onSelect(s.key); setOpen(false); }}>
              <StatusDot status={s.key} />
              {s.label}
            </MenuItem>
          ))}
        </MenuPortal>
      )}
    </>
  );
}

/**
 * The one control over finished work. Completed tasks are shown by default
 * (what landed is part of the picture), so this button's job is to get them out
 * of the way, and it goes dark when it is doing so, the way an active filter
 * should. It lives on the Completed section itself (its column header on the
 * board, its group header in the list), because that is the only section it
 * changes: everywhere else it would be noise.
 */
export function ShowCompletedToggle({ value, onToggle, className = '' }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={value ? 'Hide completed tasks' : 'Show completed tasks'}
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest rounded-full border px-2 py-0.5 transition-colors ${
        value
          ? 'border-gray-200 text-gray-400 hover:text-gray-700 hover:bg-gray-50'
          : 'border-gray-900 bg-gray-900 text-white'
      } ${className}`}
    >
      {value ? <EyeOff size={11} /> : <Eye size={11} />}
      {value ? 'Hide completed' : 'Show completed'}
    </button>
  );
}

// ─── Priority ────────────────────────────────────────────────────────────────

/**
 * Exclamation marks, one per level: !!! urgent down to a dash for low. Colour
 * and count carry the same message, so it reads at a glance and still reads when
 * the card is small.
 */
export function PriorityIcon({ priority, size = 12 }) {
  const meta = priorityMeta(priority);
  return (
    <span
      style={{ color: meta.color, fontSize: size + 2, minWidth: size + 4 }}
      className="inline-flex items-center justify-center font-black leading-none tracking-[-0.06em] select-none"
      title={`Priority: ${meta.label}`}
      aria-hidden
    >
      {priorityMarks(meta.key)}
    </span>
  );
}

export function PriorityPicker({ priority, onSelect, showLabel = false, align = 'left', full = false, children }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const meta = priorityMeta(priority);
  return (
    <>
      <span ref={anchorRef} className={anchorClass(full)}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          title={`Priority: ${meta.label}`}
          className={triggerClass(!!children, 'inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-gray-100 transition-colors', full)}
        >
          {children ?? (
            <>
              <PriorityIcon priority={priority} />
              {showLabel && <span className="text-xs text-gray-600">{meta.label}</span>}
            </>
          )}
        </button>
      </span>
      {open && (
        <MenuPortal anchorRef={anchorRef} onClose={() => setOpen(false)} align={align} width={160}>
          {PRIORITIES.map(p => (
            <MenuItem key={p.key} active={p.key === meta.key} onClick={() => { onSelect(p.key); setOpen(false); }}>
              <PriorityIcon priority={p.key} />
              {p.label}
            </MenuItem>
          ))}
        </MenuPortal>
      )}
    </>
  );
}

/*
  THE SAME FOUR LEVELS, ALL ON SCREEN AT ONCE.

  PriorityPicker above is a trigger you press to reveal a menu, and that is the
  right shape on a card or a row, where the priority is one mark among a dozen
  competing for the width. In a FORM it is the wrong shape: there are only four
  answers, they are two characters wide, and a menu that must be opened to find
  that out costs a press, a jump of focus, and a second press, to set a field
  you were looking straight at.

  So in the two dialogs, and in the inbox's triage card, priority is this: one
  recessed group of the same !!! / !! / ! / – the rest of the app writes it as,
  where the answer is already visible and setting it is one press.

  It runs QUIETEST TO LOUDEST, left to right. PRIORITIES is declared the other
  way round because that is the order a sorted list wants; read as a bar you
  slide along, it wants nothing on the left and urgent on the right, so that the
  group fills up as the answer gets worse.

  `full` is the rail's shape: there every value is a row you can press anywhere
  along, so the four share the width instead of huddling at the left of it. It
  also buys the bar a little air top and bottom: it is 36px of solid control
  where the rail's other values are text on a transparent row, so at the rail's
  ordinary spacing it sits hard against its own label and the one beneath it.

  It is a size taller on a PHONE, where four marks two characters wide are the
  smallest thing on the screen you are asked to hit with a thumb. The mouse gets
  the tighter version back at `sm`.
*/
export function PriorityBar({ priority, onSelect, full = false, className = '' }) {
  const current = priorityMeta(priority).key;
  return (
    <div
      role="group"
      aria-label="Priority"
      className={`flex items-center gap-0.5 h-10 sm:h-9 p-1 rounded-xl bg-gray-100 ${full ? 'w-full my-1.5' : 'shrink-0'} ${className}`}
    >
      {[...PRIORITIES].reverse().map(p => {
        const active = p.key === current;
        return (
          <button
            key={p.key}
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(p.key); }}
            title={p.label}
            aria-label={p.label}
            aria-pressed={active}
            style={active ? { backgroundColor: p.color } : undefined}
            className={`h-8 sm:h-7 px-1.5 rounded-lg text-[12.5px] font-bold leading-none transition-colors ${
              full ? 'flex-1' : 'min-w-[34px] sm:min-w-[30px]'
            } ${active ? 'text-white shadow-sm' : 'text-gray-400 hover:text-gray-700'}`}
          >
            {priorityMarks(p.key)}
          </button>
        );
      })}
    </div>
  );
}

// ─── Dates ───────────────────────────────────────────────────────────────────

/*
  Tinted fills, no outlines: a border around an 11px pill is a third line of
  detail on a card that already has plenty, and the fill alone carries the
  colour. Overdue is the one that inverts, solid red, because "late" should
  not look like a slightly warmer version of "due soon".
*/
const DATE_TONE = {
  late: 'bg-red-600 text-white',
  urgent: 'bg-red-50 text-red-600',
  soon: 'bg-amber-50 text-amber-700',
  clear: 'bg-emerald-50 text-emerald-700',
  muted: 'bg-gray-100 text-gray-400',
};

/*
  `dense` is the calendar's size. A day column is a seventh of the screen, so a
  chip that fits comfortably on a board card is wide enough there to claim a line
  of its own, and a card whose chips are four stacked lines reads as clutter.
  The smaller size is the same chip, just tight enough that two of them share a
  row.
*/
const CHIP_SIZE = {
  normal: 'text-[11.5px] px-2 py-[5px] gap-1',
  dense: 'text-[10.5px] px-1.5 py-1 gap-0.5',
};

/**
 * A date on a card. There is one kind of date in this app — when it is owed —
 * so the calendar glyph needs no qualifying and the pill says only the date.
 */
export function DateChip({ iso, done = false, dense = false, className = '' }) {
  const meta = dateMeta(iso, todayISO(), { done });
  if (!meta) return null;
  return (
    <span
      title={`Due ${meta.abs}${meta.tone === 'late' ? ' (overdue)' : ''}`}
      className={`inline-flex items-center font-semibold leading-none rounded-md whitespace-nowrap ${
        CHIP_SIZE[dense ? 'dense' : 'normal']
      } ${DATE_TONE[meta.tone]} ${className}`}
    >
      <CalendarDays size={dense ? 11 : 12} strokeWidth={2.5} className="flex-shrink-0" />
      {meta.label}
    </span>
  );
}

/*
  ─── Hard ────────────────────────────────────────────────────────────────────

  One boolean, and the only field in the app that is about how a task will FEEL
  rather than what it is. Priority says how much it matters and the estimate
  says how long it takes; neither of those tells you that a task is the one you
  will put off, and putting it off is the failure mode the whole planning flow
  exists to catch. So a hard task is pulled into Attention a week before it is
  owed, while there is still time for it to be difficult.

  It draws as a FLAG and never as a word — in the dialogs too, where it is one
  of the two marks in the header rather than a labelled row in the rail. It sits
  beside the priority marks, because it is read the way they are — a glyph you
  take in while scanning a column, not a label you stop and read — and because
  the two together are the whole of "how much is this going to cost me". A pill
  saying "Hard" on every other row is three times the width for the same fact,
  and it turns a scan into a sentence.

  `box` is the padding and hit area, because the same flag is a 11px mark tucked
  against a row's priority icon in one place and a 16px header button with a
  hover surface of its own in another.

  Red, and always drawn: a hollow outline when it is not set, the same flag
  filled solid when it is. The shape is constant so the column never reflows,
  and only the weight changes. Red because this is the mark that says a task
  will fight you — it is a warning, not a highlight, and it should not read as
  a quieter version of the amber star next door, which means something else
  entirely.
*/

/** Read-only: the mark a hard task carries. Nothing at all when it is not. */
export function HardFlag({ hard, size = 14, className = '' }) {
  if (!hard) return null;
  return (
    <Flag
      size={size}
      strokeWidth={2.5}
      fill="currentColor"
      aria-label="Hard"
      className={`flex-shrink-0 text-red-500 ${className}`}
    />
  );
}

/** The same mark, as the switch that sets it. Quiet until it is on, or hovered. */
export function HardToggle({ value, onToggle, size = 16, box = 'rounded-md p-1 -m-1', className = '' }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(!value); }}
      title={value ? 'Hard — click to unflag' : 'Flag as hard: it needs a run-up'}
      aria-pressed={!!value}
      aria-label="Hard"
      className={`inline-flex items-center transition-colors active:scale-90 ${box} ${
        value ? 'text-red-500 hover:text-red-600' : 'text-red-300 hover:text-red-500'
      } ${className}`}
    >
      <Flag size={size} strokeWidth={2.5} fill={value ? 'currentColor' : 'none'} className="flex-shrink-0" />
    </button>
  );
}

/*
  ─── The two halves of a planned day ─────────────────────────────────────────

  Must finish, or if there's time. ONE STAR, filled or not.

  It used to be a segmented control spelling out both answers, and on a page
  that is ten of these rows stacked up that is ten copies of the word OPTIONAL
  competing with the titles they are attached to. A binary field does not need
  two labels; it needs one mark you can see the presence or absence of, and
  starring what you are actually committing to is a gesture everyone already
  knows. Down a list the filled stars ARE the shape of the commitment, which is
  the comparison the split exists for — you just read it in one column instead
  of in prose.

  The label comes back wherever the control is alone in a form (the composer and
  the detail panel), because a lone star with no list around it is a mark with
  nothing to compare it to.

  It only means anything while a task is planned for a day. Where that is not
  yet true the caller passes `disabled` rather than dropping the star: the mark
  still belongs to the row, it is simply not yours to set until the task is on
  the day, and a control that appears out of nowhere the moment you press the
  thing next to it is a control you have to re-find every time. Faded, with no
  value drawn, is the honest picture — nothing to read, nothing to press.
*/
export function DailyPriorityToggle({
  value, onChange, dense = false, showLabel = !dense, disabled = false, className = '',
}) {
  // A missing value is NOT must_do here. Normalizing would default it to one,
  // and a filled star over a task nobody has planned is a claim, not a default.
  const must = !!value && normalizeDailyPriority(value) === 'must_do';
  const meta = DAILY_PRIORITIES.find(d => d.key === (must ? 'must_do' : 'optional'));

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(must ? 'optional' : 'must_do'); }}
      title={disabled
        ? 'Put it on today first, then say how firmly'
        : must
          ? "Must finish today — click to drop it to \"if there's time\""
          : "If there's time — click to commit to finishing it today"}
      aria-pressed={must}
      aria-disabled={disabled}
      aria-label="Must finish today"
      className={`inline-flex items-center gap-1.5 flex-shrink-0 rounded-md p-1 -m-1 transition-colors ${
        disabled
          ? 'text-gray-200 cursor-not-allowed'
          : `active:scale-90 ${must ? 'text-amber-500 hover:text-amber-600' : 'text-gray-300 hover:text-amber-400'}`
      } ${className}`}
    >
      <Star
        size={dense ? 13 : 15}
        strokeWidth={2.5}
        fill={must ? 'currentColor' : 'none'}
        className="flex-shrink-0"
      />
      {showLabel && (
        <span className="text-[12px] font-semibold text-gray-600">{meta.label}</span>
      )}
    </button>
  );
}

/*
  ─── The calendar ────────────────────────────────────────────────────────────

  A month you can see, drawn here rather than handed to <input type="date">.

  The native field was one line of chrome that opens a calendar the browser
  draws: a different size, shape and colour in every browser, no idea which day
  is today, no idea which day you already picked, and on Firefox and Safari it
  is not the same control twice. Picking a due date is the one thing this picker
  exists for, so it should be the thing you land on — not a text field you have
  to click a second time to get a calendar out of.

  What it draws that the native one cannot: today, marked; the day currently
  chosen, filled; the days already behind you, faded, so an accidental "last
  Tuesday" is visible before you commit to it rather than after; and the two
  answers that need no counting — today and tomorrow — as buttons above it, so
  the commonest due dates are never a hunt across a grid. Anything further out
  IS a date you have to look at, so it comes off the calendar.

  Six rows always, even when the month fits in five: a grid that changes height
  moves the footer under your cursor between one month and the next.
*/

// One day. Selected wins over today wins over the month it belongs to, because
// that's the order you read them in: what you picked, then where you are now.
function DayCell({ iso, month, value, today, focused, onPick }) {
  const d = fromISODate(iso);
  const inMonth = iso.slice(0, 7) === month.slice(0, 7);
  const isToday = iso === today;
  const selected = iso === value;
  const past = iso < today;

  return (
    <button
      type="button"
      data-day={iso}
      tabIndex={focused ? 0 : -1}
      onClick={() => onPick(iso)}
      aria-label={formatDateLong(iso, today)}
      aria-current={isToday ? 'date' : undefined}
      aria-pressed={selected}
      className={`h-8 rounded-lg text-[12.5px] leading-none transition-colors outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 ${
        selected
          ? 'bg-gray-900 text-white font-bold hover:bg-gray-800'
          : isToday
            ? 'bg-emerald-50 text-emerald-700 font-bold hover:bg-emerald-100'
            : inMonth
              ? `${past ? 'text-gray-400' : 'text-gray-700'} font-medium hover:bg-gray-100`
              : 'text-gray-300 font-medium hover:bg-gray-50'
      }`}
    >
      {d.getDate()}
    </button>
  );
}

function MonthGrid({ value, today, onPick }) {
  // Open on the month you are already in — the one you picked, or this one.
  const [month, setMonth] = useState(value || today);
  const [cursor, setCursor] = useState(value || today);
  const gridRef = useRef(null);
  // Only the ARROW KEYS move focus. Setting focus after a click too would drag
  // the page to the menu on every pick, and the menu is closing anyway.
  const keyboard = useRef(false);

  useEffect(() => {
    if (!keyboard.current) return;
    keyboard.current = false;
    gridRef.current?.querySelector(`[data-day="${cursor}"]`)?.focus();
  }, [cursor]);

  const go = (iso) => {
    keyboard.current = true;
    setCursor(iso);
    if (iso.slice(0, 7) !== month.slice(0, 7)) setMonth(iso);
  };

  const step = (months) => {
    const next = addMonthsISO(month, months);
    setMonth(next);
    setCursor(next);
  };

  const onKeyDown = (e) => {
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (by) { e.preventDefault(); go(addDaysISO(cursor, by)); return; }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      go(addMonthsISO(cursor, e.key === 'PageUp' ? -1 : 1));
    }
  };

  const anchor = fromISODate(month);

  return (
    <div className="px-2.5 pt-1.5 pb-2">
      <div className="flex items-center justify-between pb-1">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="Previous month"
          className="p-1 rounded-md text-gray-400 hover:text-gray-800 hover:bg-gray-100 transition-colors"
        >
          <ChevronLeft size={15} strokeWidth={2.5} />
        </button>
        {/* The heading is also the way back: on a calendar you have paged three
            months into, "this month" is otherwise three clicks away. */}
        <button
          type="button"
          onClick={() => { setMonth(today); setCursor(today); }}
          title="Jump to this month"
          className="px-2 py-0.5 rounded-md text-[12.5px] font-bold text-gray-800 hover:bg-gray-100 transition-colors"
        >
          {MONTH_FULL_NAMES[anchor.getMonth()]} {anchor.getFullYear()}
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label="Next month"
          className="p-1 rounded-md text-gray-400 hover:text-gray-800 hover:bg-gray-100 transition-colors"
        >
          <ChevronRight size={15} strokeWidth={2.5} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-[2px] pb-1">
        {WEEKDAY_NAMES.map(w => (
          <div key={w} className="text-center text-[9.5px] font-bold uppercase tracking-wide text-gray-400">
            {w.slice(0, 2)}
          </div>
        ))}
      </div>

      {/* One tab stop, not forty-two: the grid is entered once and walked with
          the arrows, the way a grid of dates is meant to be read. */}
      <div ref={gridRef} onKeyDown={onKeyDown} aria-label="Calendar" className="grid grid-cols-7 gap-[2px]">
        {monthGridISO(month).map(iso => (
          <DayCell
            key={iso}
            iso={iso}
            month={month}
            value={value}
            today={today}
            focused={iso === cursor}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

/*
  Quick answers, then a month grid on request: when a task is owed.

  `quick` is for the one caller that has already offered Today and Tomorrow as
  buttons of its own (the inbox's triage card). Passing false drops both rows
  and the fold with them, and the menu opens straight onto the month, which is
  the only thing it is being asked for there. Offering the same two answers a
  second time inside a menu makes that menu look like it holds something the
  buttons beside it do not.
*/
export function DatePicker({
  value, onSelect, label = 'Due date', align = 'right', full = false, quick = true, children,
}) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const today = todayISO();
  const quickDays = quick
    ? [{ label: 'Today', iso: today }, { label: 'Tomorrow', iso: addDaysISO(today, 1) }]
    : [];
  /*
    The grid is FOLDED AWAY until asked for. Most due dates are today or
    tomorrow, and making you look at a whole month to say "tomorrow" is the same
    mistake as making you count days to say "the 23rd" — just in the other
    direction. So the menu opens as the two short answers and one button, and
    the month appears under that button when the answer is a real date.

    Already on a date, though, and the month opens with it: you came to move a
    date you can see, and folding it away would hide the very thing you are
    moving. With no quick answers there is nothing to fold it behind either, so
    it is simply open.
  */
  const [showGrid, setShowGrid] = useState(!quick || !!value);
  const pick = (iso) => { onSelect(iso); setOpen(false); };
  const meta = dateMeta(value, today);

  return (
    <>
      <span ref={anchorRef} className={anchorClass(full)}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          className={triggerClass(!!children, 'inline-flex items-center rounded-md hover:bg-gray-100 transition-colors', full)}
          title={label}
        >
          {children ?? (
            value
              ? <DateChip iso={value} />
              : <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 border border-dashed border-gray-300 rounded-full px-1.5 py-0.5">
                  <CalendarDays size={11} />
                </span>
          )}
        </button>
      </span>
      {open && (
        // Rigid: a month grid is one object, so it is placed whole rather than
        // trimmed to the room under whatever row you opened it from. `fit`
        // follows the fold, because the menu is two very different heights.
        <MenuPortal
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          align={align}
          width={276}
          maxHeight={520}
          fit={showGrid ? 430 : 176}
          rigid
        >
          <div className="px-3 pt-2 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</div>

          {/* Tinted rather than outlined: these two are the answer most of the
              time, so they should read as the offer and not as two more empty
              boxes. Emerald is the calendar's colour for "now" — it marks today
              in the grid below. Picked, a row goes the same solid dark as the
              selected day, so "chosen" looks the same wherever you chose it. */}
          <div className={`flex flex-col gap-1 px-2.5 ${quickDays.length ? 'pb-2' : ''}`}>
            {quickDays.map(q => {
              const d = fromISODate(q.iso);
              const active = value === q.iso;
              return (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => pick(q.iso)}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                    active
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-emerald-100 bg-emerald-50 text-emerald-800 hover:border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  <CalendarDays size={13} strokeWidth={2.5} className={active ? 'text-white/70' : 'text-emerald-500'} />
                  <span className="text-[12.5px] font-semibold leading-none">{q.label}</span>
                  <span className={`ml-auto text-[11px] leading-none ${active ? 'text-white/60' : 'text-emerald-600/80'}`}>
                    {WEEKDAY_NAMES[d.getDay()]} {d.getDate()}
                  </span>
                </button>
              );
            })}
          </div>

          {/* The third answer: a date you have to look at. Nothing to unfold
              when the grid is all there is, so the button goes with the rows. */}
          {quick && (
            <button
              type="button"
              onClick={() => setShowGrid(g => !g)}
              aria-expanded={showGrid}
              className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-[12.5px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <CalendarDays size={14} className="text-gray-400" />
              Pick a date
              <ChevronDown size={14} className={`ml-auto text-gray-400 transition-transform ${showGrid ? 'rotate-180' : ''}`} />
            </button>
          )}

          {showGrid && (
            <div className={quick ? 'border-t border-gray-100' : ''}>
              <MonthGrid value={value} today={today} onPick={pick} />
            </div>
          )}

          {/* What you have actually chosen, spelt out — the grid says which
              square is filled, not which day that is — and the one way back to
              no date at all. */}
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-1.5">
            {value ? (
              <span className="min-w-0 truncate text-[11.5px] font-semibold text-gray-700">
                {formatDateLong(value, today)}
                {meta && <span className={`ml-1.5 font-medium ${meta.tone === 'late' ? 'text-red-500' : 'text-gray-400'}`}>{meta.label}</span>}
              </span>
            ) : (
              <span className="text-[11.5px] text-gray-400">No {label.toLowerCase()}</span>
            )}
            {value && (
              <button
                type="button"
                onClick={() => pick(null)}
                className="flex-shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </MenuPortal>
      )}
    </>
  );
}

// ─── Estimate ────────────────────────────────────────────────────────────────

/*
  How long a task takes, in the only vocabulary a person actually estimates in:
  seven options between a quarter hour and "more than three hours". A free
  minutes box would turn estimating into data entry, and nobody can feel the
  difference between 40 minutes and 45.

  It is what /today adds up. The day's total is the one number on that page you
  cannot get from the task list itself, and the one that can tell you a day does
  not fit BEFORE you live it, so the chip is quiet on a card and the picker is
  two clicks anywhere a task is drawn.
*/
export function EstimateChip({ minutes, dense = false, className = '' }) {
  const meta = estimateMeta(minutes);
  if (!meta) return null;
  return (
    <span
      title={`Estimated ${meta.label}`}
      className={`inline-flex items-center flex-shrink-0 font-semibold leading-none text-gray-600 bg-gray-100 rounded-md whitespace-nowrap ${
        CHIP_SIZE[dense ? 'dense' : 'normal']
      } ${className}`}
    >
      <Timer size={dense ? 11 : 12} strokeWidth={2.5} className="flex-shrink-0 text-gray-400" />
      {meta.short}
    </span>
  );
}

export function EstimatePicker({ value, onSelect, align = 'right', dense = false, full = false, children }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const meta = estimateMeta(value);

  return (
    <>
      <span ref={anchorRef} className={anchorClass(full)}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          className={triggerClass(!!children, 'inline-flex items-center rounded-md hover:opacity-80 transition-opacity', full)}
          title={meta ? `Estimated ${meta.label}` : 'Estimate how long this takes'}
        >
          {children ?? (
            meta
              ? <EstimateChip minutes={value} dense={dense} />
              : <span className="inline-flex items-center gap-1 text-[11px] font-semibold tracking-wide leading-none text-gray-400 border border-dashed border-gray-300 rounded-md px-1.5 py-1">
                  <Timer size={11} strokeWidth={2.5} />
                  Est
                </span>
          )}
        </button>
      </span>
      {open && (
        <MenuPortal anchorRef={anchorRef} onClose={() => setOpen(false)} align={align} width={180}>
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">
            How long?
          </div>
          {ESTIMATES.map(option => (
            <MenuItem
              key={option.minutes}
              active={meta?.minutes === option.minutes}
              onClick={() => { onSelect(option.minutes); setOpen(false); }}
            >
              <Timer size={12} className="text-gray-400" />
              {option.label}
            </MenuItem>
          ))}
          {meta && (
            <button
              type="button"
              onClick={() => { onSelect(null); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 border-t border-gray-100 mt-1 transition-colors"
            >
              Clear
            </button>
          )}
        </MenuPortal>
      )}
    </>
  );
}

// ─── List ────────────────────────────────────────────────────────────────────

/*
  Which list a task belongs to.

  /tasks never needs this (you are inside one list and everything you write
  lands in it), so this exists for the overview, where you are looking at all of
  them at once and "which one" is a real question with no answer implied by
  where you are standing.

  The dot is the colour lib/agenda.js gives that list, so a list looks the same
  in this menu as it does on every row of the dashboard behind it.
*/
export function ListPicker({ lists = [], value, onSelect, align = 'left' }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const current = lists.find(l => l.id === value) || lists[0];

  return (
    <>
      <span ref={anchorRef} className="flex min-w-0">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          title="List"
          className="flex w-full items-center min-w-0"
        >
          {/* The rail's row, drawn by hand: this is the one picker that lives
              nowhere else, so it wears DialogParts' Value rather than taking
              one as a child. Keep the two in step. */}
          <span className="flex w-full items-center gap-2.5 min-w-0 px-2 py-[7px] rounded-lg border border-transparent text-[15px] leading-6 font-medium text-gray-700 hover:bg-white hover:border-gray-200/80 transition-colors">
            <span className="w-[18px] flex items-center justify-center flex-shrink-0">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: current?.color || '#94a3b8' }}
              />
            </span>
            <span className="truncate">{current?.name || 'No list'}</span>
          </span>
        </button>
      </span>
      {open && (
        <MenuPortal
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          align={align}
          width={210}
          maxHeight={LIST_MENU_HEIGHT}
          fit={LIST_MENU_HEIGHT}
        >
          {lists.map(list => (
            <MenuItem key={list.id} active={list.id === current?.id} onClick={() => { onSelect(list.id); setOpen(false); }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: list.color || '#94a3b8' }} />
              <span className="truncate">{list.name}</span>
            </MenuItem>
          ))}
        </MenuPortal>
      )}
    </>
  );
}
