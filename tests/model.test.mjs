/*
  The task model, checked.

  Everything under test here is a PURE function (no fetch, no React, no
  database) which is the point of keeping the rules in src/lib/tasks.js rather
  than in the page: the definition of "overdue", "what order do these go in" and
  "what does dragging a card across a column mean" can be pinned down here once,
  and every view inherits it.

      npm test
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTask, normalizeStatus, statusPatch, filterTasks, groupTasks, clusterTasks,
  taskSummary, isOverdue, resolveListsPayload,
  createList, renameList, removeList, moveTaskToStatus, finalizeTaskDrag, columnId,
  compareTasks, createGroup, renameGroup, removeGroup, moveListToGroup, reorderLists,
  listTree,
} from '../src/lib/tasks.js';
import { sanitizeWritableFields } from '../src/lib/taskWrites.js';
import { monthOfWeek, sameMonth, startOfWeek, startOfMonth } from '../src/lib/weekPlanner.js';
import { todayISO, addDaysISO, dayClock, dayMinutes, nowDayMinutes } from '../src/lib/dates.js';

const today = todayISO();
const mk = (o) => normalizeTask({ id: o.id, title: o.title || 't', ...o });

// ─────────────────────────────────────────────────────────────────────────────
// What a day IS
// ─────────────────────────────────────────────────────────────────────────────

/*
  The boundary the whole task model hangs off. `todayISO` is the default for
  what is overdue, what is owed today, what "Tomorrow" means on a date chip and
  which day /today draws — so if it turns over at the wrong moment, every one of
  those is wrong together, at one in the morning, which is exactly when you are
  least able to tell.
*/
test('a day runs 4am to 4am, so at one in the morning you are still in yesterday', () => {
  const at = (h, m) => new Date(2026, 8, 4, h, m);   // local, 4 September 2026
  assert.equal(todayISO(at(1, 30)), '2026-09-03');
  assert.equal(todayISO(at(3, 59)), '2026-09-03');
  assert.equal(todayISO(at(4, 0)), '2026-09-04');    // and now it turns over
  assert.equal(todayISO(at(23, 59)), '2026-09-04');
});

test('a stored wall clock is placed on the day it belongs to', () => {
  // After 4am is where you would expect it.
  assert.equal(dayMinutes('04:00'), 4 * 60);
  assert.equal(dayMinutes('09:00'), 9 * 60);
  assert.equal(dayMinutes('23:30'), 23 * 60 + 30);
  // Before 4am can only mean the small hours at the END of the day.
  assert.equal(dayMinutes('01:30'), 25 * 60 + 30);
  assert.equal(dayMinutes('03:59'), 27 * 60 + 59);
  assert.equal(dayMinutes('nope'), null);

  // And back down again, because that is what gets written to the column.
  assert.equal(dayClock(25 * 60 + 30), '01:30');
  assert.equal(dayClock(9 * 60), '09:00');
  assert.equal(dayMinutes(dayClock(26 * 60)), 26 * 60);
});

test('now is expressed in the same minutes the timeline is drawn in', () => {
  assert.equal(nowDayMinutes(new Date(2026, 8, 4, 14, 0)), 14 * 60);
  // 1am is near the BOTTOM of the day, which is where the "now" line belongs.
  assert.equal(nowDayMinutes(new Date(2026, 8, 4, 1, 0)), 25 * 60);
});

test('status normalization + mirror columns', () => {
  assert.equal(normalizeStatus('working'), 'in_progress');
  assert.equal(normalizeStatus('', true), 'completed');
  assert.equal(normalizeStatus('nonsense'), 'not_started');
  const p = statusPatch('completed');
  assert.equal(p.done, true);
  assert.ok(p.completed_at);
  assert.deepEqual(statusPatch('in_progress'), { status: 'in_progress', done: false, completed_at: null });
});

test('overdue is an open task past its date, and nothing else', () => {
  assert.equal(isOverdue(mk({ id: '1', due_date: addDaysISO(today, -1) })), true);
  assert.equal(isOverdue(mk({ id: '1', due_date: today })), false);
  assert.equal(isOverdue(mk({ id: '1', due_date: addDaysISO(today, -1), status: 'completed' })), false);
});

test('hard is a boolean and defaults to false, whatever the row says', () => {
  assert.equal(mk({ id: '1' }).is_hard, false);
  assert.equal(mk({ id: '1', is_hard: true }).is_hard, true);
  // A row hand-edited in the table editor, or an older one with no column.
  assert.equal(mk({ id: '1', is_hard: 'yes' }).is_hard, true);
  assert.equal(mk({ id: '1', is_hard: null }).is_hard, false);
});

test('filtering: priority, query, completed, tag', () => {
  const tasks = [
    mk({ id: 'a', title: 'Buy milk', priority: 'urgent', tag: 'errands' }),
    mk({ id: 'b', title: 'File taxes', priority: 'low', tag: 'money' }),
    mk({ id: 'c', title: 'Old thing', status: 'completed' }),
  ];
  assert.deepEqual(filterTasks(tasks, { priority: 'urgent' }).map(t => t.id), ['a']);
  assert.deepEqual(filterTasks(tasks, { query: 'milk' }).map(t => t.id), ['a']);
  assert.deepEqual(filterTasks(tasks, { query: 'ERRANDS' }).map(t => t.id), ['a']);
  assert.deepEqual(filterTasks(tasks, { tag: 'MONEY' }).map(t => t.id), ['b']);
  assert.deepEqual(filterTasks(tasks, { showCompleted: true }).map(t => t.id), ['a', 'b', 'c']);
});

test('grouping: every status bucket is returned, empty or not', () => {
  const tasks = [mk({ id: 'a' }), mk({ id: 'b', priority: 'urgent' })];
  const byStatus = groupTasks(tasks, 'status');
  assert.equal(byStatus.length, 4);
  assert.deepEqual(byStatus.map(g => g.key), ['not_started', 'in_progress', 'waiting_review', 'completed']);
  const byPriority = groupTasks(tasks, 'priority');
  assert.deepEqual(byPriority.map(g => g.key), ['urgent', 'high', 'medium', 'low']);
});

/*
  Grouping by LIST is the one grouping whose sections are not a fixed vocabulary
  — they are your own lists, in your own order, and there may be thirty of them.
  So it is the one that hides its empty sections, and the one that has to cope
  with a task whose list is no longer there.
*/
test('grouping by list keeps a list together, in the order you keep your lists', () => {
  const lists = [
    { id: 'work', name: 'Work', color: '#111' },
    { id: 'home', name: 'Home', color: '#222' },
  ];
  const tasks = [
    mk({ id: 'a', list_id: 'home', priority: 'low' }),
    mk({ id: 'b', list_id: 'work', priority: 'low' }),
    mk({ id: 'c', list_id: 'work', priority: 'urgent' }),
  ];

  const byList = groupTasks(tasks, 'list', { lists });
  assert.deepEqual(byList.map(g => g.key), ['work', 'home']);
  assert.deepEqual(byList.map(g => g.label), ['Work', 'Home']);
  // Inside a list, the ordinary task order: what matters most, at the top.
  assert.deepEqual(byList[0].tasks.map(t => t.id), ['c', 'b']);
  assert.deepEqual(byList[1].tasks.map(t => t.id), ['a']);
});

test('an empty list is not a heading; an empty status still is', () => {
  const lists = [
    { id: 'work', name: 'Work' },
    { id: 'empty', name: 'Someday' },
  ];
  const byList = groupTasks([mk({ id: 'a', list_id: 'work' })], 'list', { lists });
  // Both sections come back, but the empty one is marked as not worth drawing
  // (TaskListView reads `alwaysShow`), because thirty lists means twenty-nine
  // headings over nothing.
  assert.deepEqual(byList.map(g => g.alwaysShow), [false, false]);
  assert.equal(byList.find(g => g.key === 'empty').tasks.length, 0);
  // Statuses are the opposite rule: "nothing is in review" is worth saying.
  assert.equal(groupTasks([], 'status').length, 4);
});

test('a task whose list has been deleted still lands somewhere', () => {
  const byList = groupTasks(
    [mk({ id: 'a', list_id: 'work' }), mk({ id: 'b', list_id: 'gone' })],
    'list',
    { lists: [{ id: 'work', name: 'Work' }] }
  );
  const other = byList[byList.length - 1];
  assert.equal(other.key, '__other__');
  assert.deepEqual(other.tasks.map(t => t.id), ['b']);
});

test('grouping by list with no lists yet leaves nothing behind', () => {
  // Every task is an orphan when the lists have not loaded, and all of them
  // still have to be somewhere: a grouping that silently dropped rows would
  // look exactly like an empty database.
  const byList = groupTasks([mk({ id: 'a', list_id: 'x' })], 'list');
  assert.equal(byList.length, 1);
  assert.deepEqual(byList[0].tasks.map(t => t.id), ['a']);
});

test('board clustering by tag puts "no tag" last', () => {
  const tasks = [mk({ id: 'a', tag: 'zoo' }), mk({ id: 'b' }), mk({ id: 'c', tag: 'apples' })];
  const runs = clusterTasks(tasks, 'tag');
  assert.deepEqual(runs.map(r => r.label), ['apples', 'zoo', 'No tag']);
});

test('summary counts what is on screen', () => {
  const tasks = [
    mk({ id: 'a', due_date: addDaysISO(today, -2) }),
    mk({ id: 'b', is_hard: true }),
    mk({ id: 'c', status: 'completed', completed_at: new Date().toISOString() }),
    mk({ id: 'd' }),
  ];
  const s = taskSummary(tasks);
  assert.equal(s.open, 3);
  assert.equal(s.overdue, 1);
  assert.equal(s.hard, 1);
  assert.equal(s.completedRecently, 1);
});

test('lists: resolve, create, rename, remove, never empty', () => {
  const empty = resolveListsPayload({});
  assert.deepEqual(empty.lists, [{ id: 'default', name: 'Personal', group: null }]);
  assert.equal(empty.activeListId, 'default');
  // an activeListId naming nothing falls back to the first list
  assert.equal(resolveListsPayload({ lists: [{ id: 'x', name: 'X' }], activeListId: 'gone' }).activeListId, 'x');

  const created = createList(empty.lists, 'Work', null, () => 123);
  assert.equal(created.lists.length, 2);
  assert.equal(created.activeListId, 'list_123');
  assert.equal(renameList(created.lists, 'list_123', 'Job')[1].name, 'Job');

  const removed = removeList(created.lists, 'list_123', 'list_123');
  assert.equal(removed.activeListId, 'default');
  assert.equal(removeList(empty.lists, 'default', 'default'), null); // last list is kept
});

test('groups: a folder of lists, and the flat order underneath it', () => {
  const groups = [{ id: 'g_school', name: 'School' }];
  const lists = [
    { id: 'a', name: 'Personal', group: null },
    { id: 'm', name: 'Math', group: 'g_school' },
    { id: 'p', name: 'Physics', group: 'g_school' },
  ];

  // The tree the switcher draws: loose lists, then folders, both in array order.
  const tree = listTree(lists, groups);
  assert.deepEqual(tree.ungrouped.map(l => l.id), ['a']);
  assert.deepEqual(tree.sections[0].lists.map(l => l.id), ['m', 'p']);

  // A group that no longer exists cannot swallow its lists.
  const orphaned = resolveListsPayload({ lists, groups: [], activeListId: 'a' });
  assert.deepEqual(orphaned.lists.map(l => l.group), [null, null, null]);

  // Dropping onto a row in another folder joins that folder, at that spot.
  // Dragging DOWN lands you under the row you dropped on, the way every other
  // sortable list behaves.
  const joined = reorderLists(lists, 'a', 'm');
  assert.deepEqual(joined.map(l => [l.id, l.group]), [['m', 'g_school'], ['a', 'g_school'], ['p', 'g_school']]);

  // Reordering inside one folder leaves membership alone.
  assert.deepEqual(reorderLists(lists, 'p', 'm').map(l => l.id), ['a', 'p', 'm']);

  // Filing a list puts it at the end of that folder's run; unfiling takes it out.
  assert.equal(moveListToGroup(lists, 'a', 'g_school').at(-1).id, 'a');
  assert.equal(moveListToGroup(lists, 'm', null).find(l => l.id === 'm').group, null);
  assert.equal(moveListToGroup(lists, 'm', 'g_school'), lists); // already there: untouched

  // Filing into an EMPTY group keeps the list where it was in the flat order
  // rather than shunting it to the front of everything.
  const emptied = moveListToGroup(lists, 'a', 'g_new');
  assert.deepEqual(emptied.map(l => l.id), ['m', 'p', 'a']);

  const named = createGroup(groups, 'Work', () => 7);
  assert.equal(named.id, 'group_7');
  assert.equal(renameGroup(named.groups, 'g_school', 'Uni')[0].name, 'Uni');

  // Deleting a folder keeps every list that was in it.
  const dropped = removeGroup(lists, groups, 'g_school');
  assert.deepEqual(dropped.groups, []);
  assert.deepEqual(dropped.lists.map(l => l.id), ['a', 'm', 'p']);
  assert.deepEqual(dropped.lists.map(l => l.group), [null, null, null]);
});

test('drag: moving across columns rewrites status and renumbers both', () => {
  const tasks = [
    mk({ id: 'a', status: 'not_started', position: 0 }),
    mk({ id: 'b', status: 'not_started', position: 1 }),
    mk({ id: 'c', status: 'in_progress', position: 0 }),
  ];
  const { tasks: moved } = moveTaskToStatus(tasks, 'a', columnId('in_progress'));
  const a = moved.find(t => t.id === 'a');
  assert.equal(a.status, 'in_progress');
  assert.equal(moved.find(t => t.id === 'b').position, 0); // renumbered behind it
  const { itemsToSave } = finalizeTaskDrag(moved, tasks, 'a', columnId('in_progress'));
  const savedA = itemsToSave.find(i => i.id === 'a');
  assert.equal(savedA.status, 'in_progress');
  assert.equal(savedA.done, false);
});

test('ordering: open before done, then priority, then due date', () => {
  const sorted = [
    mk({ id: 'done', status: 'completed', priority: 'urgent' }),
    mk({ id: 'low', priority: 'low' }),
    mk({ id: 'urgent', priority: 'urgent' }),
  ].sort(compareTasks);
  assert.deepEqual(sorted.map(t => t.id), ['urgent', 'low', 'done']);
});

test('write allow-list ignores anything it does not name', () => {
  const row = sanitizeWritableFields({
    title: '  Do it  ', tag: ' Kitchen ', status: 'completed',
    id: 'nope', version: 99, created_at: 'nope', position: 3,
  });
  assert.equal(row.title, 'Do it');
  assert.equal(row.tag, 'Kitchen');          // kept as typed, only trimmed
  assert.equal(row.done, true);              // status owns done + completed_at
  assert.ok(row.completed_at);
  assert.equal(row.position, 3);
  for (const forbidden of ['id', 'version', 'created_at']) {
    assert.equal(row[forbidden], undefined, `${forbidden} must not be writable`);
  }
});

/*
  The calendar's zoom switch. A week that straddles a month boundary belongs to
  the month holding its Thursday. Taking its Monday instead filed 31 Aug – 6 Sep
  under August, so switching to Month and back jumped you two months into the
  past. This is the rule that stops it, and it only ever bites on a straddling
  week, which is why it needs pinning down here rather than being noticed in June.
*/
test('a week belongs to the month holding its Thursday', () => {
  const weekOf = iso => startOfWeek(new Date(iso + 'T12:00:00'));
  // Mon 31 Aug – Sun 6 Sep 2026: Thursday is 3 Sep, so it is a September week.
  assert.equal(monthOfWeek(weekOf('2026-09-01')).getMonth(), 8);
  // Mon 26 Oct – Sun 1 Nov 2026: Thursday is 29 Oct, so it stays in October.
  assert.equal(monthOfWeek(weekOf('2026-11-01')).getMonth(), 9);
  // A week sitting wholly inside its month is unchanged.
  assert.equal(monthOfWeek(weekOf('2026-09-15')).getMonth(), 8);
});

test('zooming out to the month and back lands on the week you left', () => {
  // The rule CalendarView applies when you switch back to Week.
  const backToWeek = (weekStart, monthStart, now) =>
    sameMonth(monthOfWeek(weekStart), monthStart) ? weekStart
      : sameMonth(now, monthStart) ? startOfWeek(now)
        : startOfWeek(monthStart);

  for (const iso of ['2026-09-01', '2026-11-01', '2026-03-31', '2026-12-31']) {
    const now = new Date(iso + 'T12:00:00');
    const week = startOfWeek(now);
    assert.equal(
      backToWeek(week, monthOfWeek(week), now).getTime(), week.getTime(),
      `round trip lost the week for ${iso}`
    );
  }

  // Navigating to another month while zoomed out lands on its opening week.
  const now = new Date('2026-09-15T12:00:00');
  const week = startOfWeek(now);
  const december = startOfMonth(new Date('2026-12-10T12:00:00'));
  assert.equal(backToWeek(week, december, now).getTime(), startOfWeek(december).getTime());
});
