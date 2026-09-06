import { CalendarRange, Inbox, LayoutGrid, List, Sun } from 'lucide-react';
import { ROUTES } from './routes';

/*
  Single source of truth for the app bar.

  Two registries, because the bar does two different things and they must not be
  confused for each other:

  NAV_AREAS are PLACES. There are three, and they are in the order you meet
  them: the inbox, where a thought is caught before it is anything else; the
  planning day, which reads every list at once and arranges the day you chose;
  and the task list, which is one list drawn three ways. Clicking one navigates.

  The inbox is FIRST because it is the one you reach for without deciding to —
  something occurs to you, you open the app, you type. Everything to its right
  is work you sat down to do.

  TASK_VIEWS are WAYS OF LOOKING at /tasks: the same body of work, drawn three
  ways. Board first, because it shows the workflow itself and is where most
  people land; then the list; then the calendar (which picks its own zoom, week
  or month, inside itself). Clicking one changes nothing about where you are, so
  they are buttons and not links, and the switcher only appears on the page it
  switches.

  The chosen view lives in lib/taskView.js, not in the URL, because it is a way
  of looking at one page rather than a place you can be.
*/

export const NAV_AREAS = [
  { key: 'inbox', label: 'Inbox', href: ROUTES.inbox, icon: Inbox, hint: 'Catch a thought now, file it later' },
  { key: 'today', label: 'Today', href: ROUTES.today, icon: Sun, hint: 'What you are doing today, and when' },
  { key: 'tasks', label: 'Tasks', href: ROUTES.tasks, icon: List, hint: 'One list, in full' },
];

/** Which area a pathname belongs to. `/tasks/anything` is still Tasks. */
export function areaForPath(pathname = '') {
  return NAV_AREAS.find(area => pathname === area.href || pathname.startsWith(`${area.href}/`)) || null;
}

export const TASK_VIEWS = [
  { key: 'board', label: 'Board', icon: LayoutGrid, hint: 'Status columns, drag to move' },
  { key: 'list', label: 'List', icon: List, hint: 'Grouped rows' },
  { key: 'calendar', label: 'Calendar', icon: CalendarRange, hint: 'By due date' },
];

export const DEFAULT_TASK_VIEW = 'board';

// Anything unrecognised (a stale value in localStorage, a typo) falls back to
// the default rather than rendering nothing at all.
export function normalizeTaskView(key) {
  return TASK_VIEWS.some(v => v.key === key) ? key : DEFAULT_TASK_VIEW;
}
