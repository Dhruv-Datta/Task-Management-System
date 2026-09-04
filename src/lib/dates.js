// Day-grained date primitives, shared by the task model (lib/tasks.js) and the
// week planner (lib/weekPlanner.js). Split out so neither has to import the
// other for something this small.

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Spelt out, for the few places a month is a HEADING rather than part of a date:
// "Rest of September" is a section of your year, "Sep 23" is a due date.
export const MONTH_FULL_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MINUTES_PER_DAY = 1440;

/*
  WHERE A DAY BEGINS, and it is not midnight.

  Midnight is the calendar's answer and it is the wrong one for a planner: at
  one in the morning you are not starting a new day, you are finishing the one
  you are in. So the drawn day runs 4am to 4am — the top of the timeline is
  4:00, the bottom is 4:00 the following morning, and the small hours after
  midnight sit at the END of the day they actually belong to rather than at the
  top of the next one.

  Which means a position on the timeline can be up to 28 hours past the anchor
  date's midnight: 25:30 is half past one tomorrow morning, and reads that way
  on the rail because the hour labels wrap. Everything the timeline lays out is
  in that range, and DAY_WINDOW_END is where it stops.

  These live here, with the other clock primitives, rather than in the timeline
  model — because lib/googleEvents needs them to know which of Google's events
  belong to this day, and lib/agenda needs them to draw it, and those two must
  not import each other.
*/
export const DAY_ANCHOR_MINUTES = 4 * 60;                                 // 04:00
export const DAY_WINDOW_END = DAY_ANCHOR_MINUTES + MINUTES_PER_DAY;       // 28:00

// Local-timezone YYYY-MM-DD. Deliberately NOT toISOString(), which would shift
// the day across the UTC boundary for anyone west of GMT.
export function toISODate(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parse a 'YYYY-MM-DD' string into a local Date at midnight (avoids the UTC
// parsing browsers apply to bare date strings).
export function fromISODate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/*
  WHICH DAY YOU ARE IN, which is not the same question as what the date is.

  A day here runs 4am to 4am (see DAY_ANCHOR_MINUTES below), so at one in the
  morning you are still in yesterday: you have not been to bed, the plan you
  made is still the plan you are working through, and a deadline you set for
  "today" has not passed. Every default in the task model reads this — what is
  overdue, what is owed today, what "Tomorrow" means on a date chip, which day
  /today draws — so moving it here moves all of them together, and the tasks and
  the calendar cannot disagree about when the day turned over.

  `toISODate` is still the plain calendar date, for the places that genuinely
  mean one (a due date you picked off a date picker, a week grid's cells).
*/
export function todayISO(now = new Date()) {
  const at = new Date(now);
  if (Number.isNaN(at.getTime())) return null;
  if (at.getHours() * 60 + at.getMinutes() < DAY_ANCHOR_MINUTES) at.setDate(at.getDate() - 1);
  return toISODate(at);
}

// "Sat, Aug 22": a date a person reads. The year only appears when it isn't
// this one, because in a task list it almost never is anything else.
export function formatDateLong(iso, today = todayISO()) {
  const d = fromISODate(iso);
  if (!d) return '';
  const sameYear = String(iso).slice(0, 4) === String(today).slice(0, 4);
  const base = `${WEEKDAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
  return sameYear ? base : `${base}, ${d.getFullYear()}`;
}

export function addDaysISO(iso, days) {
  const d = fromISODate(iso);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/*
  A month later, still a real date. `setMonth` alone turns Jan 31 into Mar 3,
  which is nonsense on a calendar you are paging through: the header would skip
  February entirely. Clamping to the last day of the target month is the answer
  everyone means by "next month".
*/
export function addMonthsISO(iso, months) {
  const d = fromISODate(iso);
  if (!d) return null;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toISODate(d);
}

/**
 * The six-week grid a month is drawn on: 42 ISO dates starting at the Sunday on
 * or before the 1st, so the calendar's shape never changes as you page through
 * it. Always six rows, even for a February that fits in five — a grid that
 * grows and shrinks makes the buttons under it jump while you are aiming at one.
 */
export function monthGridISO(iso) {
  const anchor = fromISODate(iso);
  if (!anchor) return [];
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = toISODate(new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay()));
  return Array.from({ length: 42 }, (_, i) => addDaysISO(start, i));
}

// ─────────────────────────────────────────────────────────────────────────────
// The clock: minutes past midnight
// ─────────────────────────────────────────────────────────────────────────────

/*
  A day-grained planner still has to draw one day from the inside, and the
  timeline on /today is arithmetic all the way down: a block starts at a
  minute, is a number of minutes long, and is drawn that many pixels tall.
  So the working unit inside these helpers is MINUTES PAST MIDNIGHT, an
  integer, and 'HH:MM' is only how it is stored (tasks.scheduled_start) and
  how a native <input type="time"> wants it.

  Wall clock, not UTC: 9:00 is 9:00 wherever you are, and nothing here ever
  builds a Date, so nothing here can shift a block across a timezone.
*/

/** '09:15' → 555. Anything that isn't a real time of day is null. */
export function clockToMinutes(clock) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(clock ?? '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** 555 → '09:15', the form the column and <input type="time"> both want. */
export function minutesToClock(minutes) {
  if (minutes == null || Number.isNaN(minutes)) return null;
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/**
 * 555 → '9:15 AM': the clock as a person says it. `period: false` drops the
 * AM/PM, for the left-hand side of a range that ends in the same half of the
 * day ("1:15 – 2:45 PM").
 */
export function formatClock(minutes, { period = true } = {}) {
  if (minutes == null || Number.isNaN(minutes)) return '';
  const total = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h24 = Math.floor(total / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const time = `${h12}:${String(total % 60).padStart(2, '0')}`;
  return period ? `${time} ${h24 < 12 ? 'AM' : 'PM'}` : time;
}

/**
 * The hour, as a rail label: '9 AM', '12 PM'. The ':00' is the same on every
 * line of an hour rail, so it is only ever noise there, and dropping it is what
 * lets the label sit on one line beside the rule it belongs to.
 */
export function formatHourLabel(minutes) {
  const total = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h24 = Math.floor(total / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const rest = total % 60;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  return rest === 0 ? `${h12} ${suffix}` : `${h12}:${String(rest).padStart(2, '0')} ${suffix}`;
}

/** '9:00 – 10:00 AM'. The AM/PM is said once when both ends agree on it. */
export function formatClockRange(start, minutes) {
  const end = start + minutes;
  const sameHalf = Math.floor(start / 720) === Math.floor((end % MINUTES_PER_DAY) / 720);
  return `${formatClock(start, { period: !sameHalf })} – ${formatClock(end)}`;
}

/**
 * A length of time, as a person says it: '45m', '1h', '3h 45m'.
 *
 * Used for one estimate and for a whole day's worth of them, so it has to read
 * correctly at both sizes; `long` is the picker's wording ('1.5 hours'), where
 * the label is being chosen rather than scanned.
 */
export function formatDuration(minutes, { long = false } = {}) {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (long) {
    if (h === 0) return `${m} min`;
    const hours = m === 0 ? String(h) : String(h + m / 60);
    return `${hours} ${h === 1 && m === 0 ? 'hour' : 'hours'}`;
  }
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/*
  A WALL CLOCK, PLACED ON A DAY THAT RUNS 4am TO 4am.

  `scheduled_start` in the database is an ordinary 'HH:MM' wall clock, and it
  stays one: the column reads correctly in the Supabase table editor and needs
  no migration to say what it has always said. What changes is how it is READ.

  On a day anchored at 4am, a clock before 04:00 can only mean one thing — the
  small hours at the END of that day. There is no ambiguity to resolve, because
  "early on this date" is not a thing a 4am day contains: early is 04:00 and
  after. So '01:30' on the 3rd is half past one on the MORNING OF THE 4TH, drawn
  at minute 1530, sorted after the evening, and pushed to Google on the right
  date.

  `dayClock` is the inverse, for writing a position back down: minute 1530 is
  stored as '01:30'.
*/
export function dayMinutes(clock) {
  const minutes = clockToMinutes(clock);
  if (minutes === null) return null;
  return minutes < DAY_ANCHOR_MINUTES ? minutes + MINUTES_PER_DAY : minutes;
}

export function dayClock(minutes) {
  if (minutes == null || Number.isNaN(minutes)) return null;
  const total = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return minutesToClock(total);
}

/** Where the clock on the wall is, on the day you are actually in. */
export function nowDayMinutes(now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes < DAY_ANCHOR_MINUTES ? minutes + MINUTES_PER_DAY : minutes;
}

/** Snap to a grid (the timeline drags in quarter hours), kept inside the day. */
export function snapMinutes(minutes, step = 15) {
  const snapped = Math.round(minutes / step) * step;
  return Math.max(0, Math.min(DAY_WINDOW_END - step, snapped));
}

/*
  Snap FORWARD to the grid. The difference matters exactly once, and it matters
  a lot: looking for the next free moment after something that ends at 9:50,
  the nearest quarter hour is 9:45, which is still inside it. "Next" has to
  round up or it isn't next.
*/
export function snapUpMinutes(minutes, step = 15) {
  const snapped = Math.ceil(minutes / step) * step;
  return Math.max(0, Math.min(DAY_WINDOW_END - step, snapped));
}
