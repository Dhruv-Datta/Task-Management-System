'use client';

/*
  The pieces every panel on the overview is built from, and the row every task
  on it is drawn as.

  The page is a wall of small type, so the only thing holding it together is
  that a heading is always a heading and a task row is always a task row. One
  definition each, here.
*/

import { CalendarArrowDown, Plus } from 'lucide-react';
import { priorityMeta } from '@/lib/tasks';
import { DateChip, DatePicker, HardToggle, PriorityPicker } from '@/components/tasks/TaskPickers';

/*
  The surface.

  White on white, like everything else in the app, so the edge is the card's own
  job. The shadow is two layers: a hairline that gives the edge definition, and a
  wide soft one that lifts the whole thing off the page. One heavy shadow reads
  as a popup; this reads as paper.
*/
export function Panel({ children, className = '' }) {
  return (
    <section
      className={`bg-white rounded-3xl border border-gray-200/70 ${className}`}
      style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 16px 36px -20px rgba(16,24,40,0.16)' }}
    >
      {children}
    </section>
  );
}

/**
 * A panel's heading: what it is, how much of it there is, and whatever the panel
 * lets you do to it. The count sits with the title rather than out to the right,
 * because it is part of the sentence ("unscheduled, twelve") not a separate
 * fact.
 */
export function PanelHead({ title, count, hint, action }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-3 pb-2">
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{title}</h2>
      {count > 0 && <span className="text-[11px] font-bold text-gray-300 tabular-nums">{count}</span>}
      {hint && <span className="text-[11px] text-gray-400 truncate">{hint}</span>}
      {action && <div className="ml-auto flex items-center gap-1">{action}</div>}
    </div>
  );
}

/** A heading inside a panel: one of the questions a panel is asking. */
export function GroupLabel({ children, count, tone = 'gray', trailing }) {
  const tones = {
    gray: 'text-gray-400',
    red: 'text-red-600',
    amber: 'text-amber-600',
    blue: 'text-blue-600',
    orange: 'text-orange-600',
    violet: 'text-violet-600',
    emerald: 'text-emerald-600',
  };
  return (
    <div className="flex items-center gap-1.5 px-2.5 pt-2.5 pb-1">
      <span className={`text-[10px] font-bold uppercase tracking-widest ${tones[tone]}`}>{children}</span>
      {count > 0 && <span className="text-[10px] font-bold text-gray-300 tabular-nums">{count}</span>}
      {trailing && <span className="ml-auto flex items-center gap-1">{trailing}</span>}
    </div>
  );
}

/** The + that every panel and every day carries. Quiet until you're near it. */
export function AddButton({ onClick, title = 'Add a task here', always = false }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className={`p-1 rounded-md text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-all active:scale-90 ${
        always ? '' : 'opacity-0 group-hover/row:opacity-100 focus:opacity-100'
      }`}
    >
      <Plus size={14} />
    </button>
  );
}

/*
  The height of a row's title line, given to every control beside it.

  A row is two lines — the title, and the list it came from under it — and a
  control centred on that BLOCK sits in the gap between the two, attached to
  neither. Everything you can press belongs to the task, which is the first
  line. Kept in step with TodayRow, which uses the same number for the same
  reason.
*/
const TITLE_LINE = 'h-[18px]';

/*
  Which list a task came from.

  This is the one thing a row here says that a row on /tasks never has to: over
  there you are inside a list and the label would repeat on every line. The
  colour is what you actually scan; the name is for when the colour isn't
  enough, so the dot never disappears and the name is what gives up width
  first.

  `sub` is the same fact said UNDER the title, in the place a description would
  sit, rather than as a chip filed with the row's controls. A badge in the
  right-hand cluster reads as another button you have not pressed yet; a quiet
  second line reads as what it is — something the task tells you about itself.
  The rows that are mostly title (the day's own lists) use that one; the denser
  overview rows keep the chip.
*/
export function ListBadge({ list, sub = false }) {
  if (!list) return null;

  if (sub) {
    return (
      <span
        title={`List: ${list.name}`}
        className="flex items-center gap-1 min-w-0 max-w-full text-[10px] text-gray-400 leading-tight"
      >
        <span
          aria-hidden
          className="w-[4px] h-[4px] rounded-full flex-shrink-0"
          style={{ backgroundColor: list.color }}
        />
        <span className="truncate">{list.name}</span>
      </span>
    );
  }

  return (
    <span
      title={`List: ${list.name}`}
      className="hidden sm:inline-flex items-center gap-1.5 flex-shrink-0 max-w-[100px] text-[10.5px] font-semibold text-gray-500"
    >
      <span className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ backgroundColor: list.color }} />
      <span className="truncate">{list.name}</span>
    </span>
  );
}

/*
  A task, on the overview.

  THE SAME ROW AS THE DAY'S. Attention is the one place this is drawn, and it is
  read three seconds after you have finished reading a screen full of TodayRow —
  so it is laid out the same way, down to the numbers: the title on an 18px
  line, the list it came from under it in the place a description sits, the
  priority glyph and the hard flag squared up against the title rather than
  centred on the pair of lines, and no status ring in front of any of it. A
  four-state pipeline is a report on work; this step is a decision about work.

  What differs is the verb, and only the verb. `action` is drawn at the tail: in
  Attention it is the must-do / optional pair, which is the entire point of that
  step — you are looking at work from every list in order to DECIDE, one task at
  a time, whether it is yours today and how firmly. Nothing in this app plans a
  task for you. There is no ✓ here for the same reason there is none on the
  day's own rows: you are choosing the day, not working through it.

  The Hard flag is a toggle rather than a label, because Attention is exactly
  where you find out that something is going to be a fight — a week before it is
  owed, which is the last moment that discovery is any use. The due date is a
  picker for the same reason: a late task wants to be today's problem instead of
  last week's, and that should not be a trip to another page.
*/
export function AgendaRow({
  task, list, showDate = true, showHard = true, quickDates = null,
  action = null, onPatch, onOpen,
}) {
  const value = task.due_date;
  const stop = e => e.stopPropagation();
  const urgent = task.priority === 'urgent';

  return (
    <div
      onClick={() => onOpen(task)}
      className="group relative flex items-start gap-1.5 pl-1 pr-1.5 py-1 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors"
    >
      {/* Urgent work gets a mark down the edge of the row. The glyphs already
          say it, but at a glance you read the shape of a list before you read
          any of it, and this is what makes the urgent ones a shape. */}
      {urgent && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
          style={{ backgroundColor: priorityMeta('urgent').color }}
        />
      )}

      <span onClick={stop} className={`flex-shrink-0 flex items-center gap-1 pl-1 pr-1 ${TITLE_LINE}`}>
        <PriorityPicker priority={task.priority} onSelect={p => onPatch(task.id, { priority: p })} />
        {showHard && (
          <HardToggle
            value={task.is_hard}
            onToggle={next => onPatch(task.id, { is_hard: next })}
            size={11}
          />
        )}
      </span>

      <span className="min-w-0 flex-1 flex flex-col gap-[1px]">
        <span className={`min-w-0 truncate text-[13px] leading-[18px] ${
          task.done ? 'text-gray-400 line-through' : urgent ? 'text-gray-950 font-semibold' : 'text-gray-800'
        }`}>
          {task.title}
        </span>
        <ListBadge list={list} sub />
      </span>

      <span onClick={stop} className={`flex items-center gap-1 flex-shrink-0 ${TITLE_LINE}`}>

        {/*
          Triage, in one click. A late task almost never wants a date picker; it
          wants to be today's problem instead of last week's, and an undated one
          wants a day, not a dialog. Making either of those two clicks through a
          menu is why overdue lists and backlogs both grow.
        */}
        {quickDates?.length > 0 && !task.done && (
          <span className="hidden group-hover:inline-flex items-center gap-1 flex-shrink-0">
            {quickDates.map(quick => (
              <button
                key={quick.label}
                type="button"
                onClick={(e) => { stop(e); onPatch(task.id, { due_date: quick.iso }); }}
                title={quick.title || `Move to ${quick.label.toLowerCase()}`}
                className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider text-gray-500 px-1.5 py-1 rounded-md hover:bg-gray-900 hover:text-white transition-all active:scale-90"
              >
                {quick.icon && <CalendarArrowDown size={11} strokeWidth={2.5} />}
                {quick.label}
              </button>
            ))}
          </span>
        )}

        {showDate && (
          <span className="flex justify-end flex-shrink-0 mr-1">
            <DatePicker
              value={value}
              onSelect={d => onPatch(task.id, { due_date: d })}
              label="Due date"
            >
              {value
                ? <DateChip iso={value} done={task.done} dense />
                : (
                  <span className="opacity-0 group-hover:opacity-100 text-[10.5px] font-semibold text-gray-400 rounded-md px-1.5 py-1 hover:bg-gray-100 transition-all">
                    Set a date
                  </span>
                )}
            </DatePicker>
          </span>
        )}

        {action}
      </span>
    </div>
  );
}

/**
 * A chapter heading inside a long panel: the label, how much is under it, and a
 * rule running out to the edge. Ahead is one continuous axis rather than a stack
 * of cards, so these are what stop it reading as an undifferentiated list.
 */
export function SectionRule({ label, count, action }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-5 pb-1.5">
      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{label}</span>
      {count > 0 && <span className="text-[10px] font-bold text-gray-300 tabular-nums">{count}</span>}
      <span className="flex-1 h-px bg-gray-100" />
      {action}
    </div>
  );
}

/** What a panel says when it has nothing to show. Deliberately not a graphic. */
export function EmptyNote({ children }) {
  return <p className="px-5 py-6 text-[13px] text-gray-400 text-center">{children}</p>;
}
