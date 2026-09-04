'use client';

/*
  /tasks: your work, in full.

  The other half of the app is /today, which reads every list at once and
  arranges it by DAY. This page is the other axis: the whole of the work,
  including the parts of it that are not due for months. Go to /today to plan a
  day; come here to work on a body of work.

  ONE of the three views is scoped to a single list, and it is the BOARD. Its
  columns are the four statuses and the drag between them is a write, so it is
  the view you stand INSIDE a body of work to use — four projects poured into
  one In-progress column is a wall, not a workflow.

  The other two are everything you own, from every list at once. A LIST is rows
  and sections, and a CALENDAR is days; both of those shapes survive holding
  thirteen projects, and "what do I actually have on" is a question no single
  list can answer. Each row and card there says which list it came from, which
  is the only thing telling two similarly-named tasks apart.

  So the list switcher belongs to the board, and it is only drawn there. It
  still decides one thing elsewhere — which list a new task lands in by default
  — but where the page is showing everything, the New task box asks outright
  instead of leaving it to a control that is no longer on screen.

  Adapted from AlphaOS's task workspace, cut down to one person's work. The
  model (lib/tasks.js): a task belongs to a LIST, may name a PERSON, and moves
  through four STATUSES (not started, in progress, waiting review, completed).
  Due dates, the hard flag, priority and an optional tag are metadata you
  filter and sort by.

  The list switcher always has exactly one list open, so the page only ever
  shows one body of work. It renders in one of three views, chosen in the app
  bar (the Navbar reads and writes lib/taskView.js; the registry is
  lib/navigation.js): board (status columns, drag to move, the default), list,
  and calendar (by due date, a week or a month at a time, drag to schedule).

  There is one person here, you, so a task has no owner: no assignees, no
  roster, no avatars. Everything on the board is yours by definition.

  There is one way to write a task: the New task box, opened by the header
  button, by T, or by any + on the page. Every task starts Not started, so a + on
  a status column or section is a shortcut to the same box, not a different one.

  This file owns state and persistence and nothing else: every piece of chrome is
  a component under components/tasks, every rule about ordering, grouping or what
  counts as overdue lives in lib/tasks.js, and how a task is actually WRITTEN
  (optimistic, version-guarded, reconciled) lives in lib/taskStore.js, shared
  with /today so the two pages cannot drift apart on it.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Flame, Plus, Search, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useTaskView } from '@/lib/taskView';
import { useClusterBy, useGroupBy } from '@/lib/taskPrefs';
import {
  CLUSTER_BY, GROUP_BY, PRIORITIES,
  createGroup as createGroupState,
  createList as createListState,
  filterTasks, groupTasks, isOverdue,
  moveListToGroup, removeGroup as removeGroupState,
  removeList as removeListState,
  renameGroup as renameGroupState,
  renameList as renameListState,
  reorderLists, resolveListsPayload,
  taskSummary,
} from '@/lib/tasks';
import {
  createTask, deleteTasksForList, fetchTasks, fetchLists,
  reorderTasks, saveListsMeta,
} from '@/lib/tasksApi';
import { listIndex, listOf } from '@/lib/agenda';
import { useTaskStore } from '@/lib/taskStore';
import ListMenu from '@/components/tasks/ListMenu';
import LoadError from '@/components/tasks/LoadError';
import TaskListView from '@/components/tasks/TaskListView';
import TaskBoardView from '@/components/tasks/TaskBoardView';
import CalendarView from '@/components/tasks/CalendarView';
import TaskDetailPanel from '@/components/tasks/TaskDetailPanel';
import TaskComposer from '@/components/tasks/TaskComposer';
import { MenuPortal, ShowCompletedToggle } from '@/components/tasks/TaskPickers';

function SummaryStat({ icon: Icon, value, label, tone = 'gray', active, onClick }) {
  const tones = {
    gray: 'text-gray-500 hover:text-gray-800',
    red: 'text-red-500 hover:text-red-600',
    amber: 'text-amber-600 hover:text-amber-700',
    emerald: 'text-emerald-600 hover:text-emerald-700',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`inline-flex items-center gap-1.5 text-xs transition-colors ${tones[tone]} ${
        active ? 'font-bold underline underline-offset-4' : ''
      } ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {Icon && <Icon size={12} />}
      <span className="font-semibold">{value}</span>
      <span className="text-gray-400">{label}</span>
    </button>
  );
}

/*
  A filter chip and its menu.

  `clearable` is what separates a filter from a choice: Priority can be set to
  "any", so its menu opens with that escape hatch. Group by is always SOMETHING,
  so offering "By status" as the clear option on top of "By status" in the list
  was the same line twice, so it has no clear row at all.

  A set filter wears the colour of what it selected (`opt.color`), so the bar
  says "urgent only" at a glance instead of just "something is filtered".
*/
function FilterMenu({ label, anyLabel, value, options, onSelect, width = 170, clearable = true }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.key === value);
  const tint = current?.color;
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        style={tint ? { backgroundColor: tint, borderColor: tint } : undefined}
        className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
          tint
            ? 'text-white hover:brightness-95'
            : value
              ? 'border-gray-900 bg-gray-900 text-white'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
        }`}
      >
        {current ? current.label : label}
      </button>
      {open && (
        <MenuPortal anchorRef={anchorRef} onClose={() => setOpen(false)} width={width}>
          {clearable && (
            <button
              type="button"
              onClick={() => { onSelect(null); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${!value ? 'font-semibold text-gray-900' : 'text-gray-600'}`}
            >
              {anyLabel || `Any ${label.toLowerCase()}`}
            </button>
          )}
          {options.map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => { onSelect(opt.key); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                value === opt.key ? 'font-semibold text-gray-900' : 'text-gray-600'
              }`}
            >
              {opt.color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color }} />}
              {opt.label}
            </button>
          ))}
        </MenuPortal>
      )}
    </>
  );
}

export default function TasksPage() {
  const { username } = useAuth();

  // The tasks, and the one way a task is written. Shared with /today
  // (lib/taskStore.js). Loading, creating and reordering stay here, because
  // those are this page's own business.
  const { tasks, setTasks, patchTask, removeTask } = useTaskStore();

  const [lists, setLists] = useState([]);
  const [listGroups, setListGroups] = useState([]);
  const [activeListId, setActiveListId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null); // why the list is empty, when it is

  // Board / list / calendar is chosen in the app bar, so it lives above this
  // page. Called `layout` here because that is what it selects: how the one
  // body of work is drawn.
  const { view: layout } = useTaskView();
  // Both remembered across visits (lib/taskPrefs), the same way the view is.
  const [groupBy, setGroupBy] = useGroupBy();          // list: what the sections are
  const [clusterBy, setClusterBy] = useClusterBy();    // board: how each column is gathered
  const [query, setQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState(null);
  // Completed work shows by default: what landed this week is part of the
  // picture. The toggle on the Completed section is what puts it away.
  const [showCompleted, setShowCompleted] = useState(true);
  const [quickFilter, setQuickFilter] = useState(null); // 'overdue' | 'hard'
  const [openTaskId, setOpenTaskId] = useState(null);
  const [composer, setComposer] = useState(null);      // null | defaults object

  const searchRef = useRef(null);

  // ─── Loading ───────────────────────────────────────────────────────────────

  /*
    WHAT IS LOADED, which is the one thing the three views genuinely disagree
    about.

    The BOARD draws one list. Its columns are the four statuses and dragging
    between them writes to the task, so it is the view you stand inside one body
    of work to use; every project you own in a single In-progress column is a
    wall rather than a workflow.

    The list and the calendar draw EVERYTHING. Rows-with-sections and
    days-of-the-week both hold thirteen projects without losing their shape, and
    what you go to them for — "what have I got on", "what is landing this week"
    — is a question about all of it and not about one list.

    One boolean, read off the layout, and every load below is scoped by it.
  */
  const everything = layout !== 'board';

  // `loadAll` must not be re-created when the layout flips (it would re-fetch
  // the lists for nothing), so it reads the scope through a ref rather than
  // closing over it. The effect below owns every later change.
  const everythingRef = useRef(everything);

  /** `listId` null means every list. */
  const loadTasks = useCallback(async (listId) => {
    setLoading(true);
    try {
      setTasks(await fetchTasks(listId ? { listId } : {}));
      setLoadError(null);
    } catch (err) {
      console.error('Failed to load tasks', err);
      setTasks([]);
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [setTasks]);

  /*
    Lists first (they say which list is open), then the tasks. A failed lists
    call is NOT fatal (the default list is a fine assumption) so it falls
    through to loadTasks, which is where a dead database actually gets reported.
  */
  const loadAll = useCallback(async () => {
    let listId = 'default';
    try {
      const resolved = resolveListsPayload(await fetchLists());
      setLists(resolved.lists);
      setListGroups(resolved.groups);
      setActiveListId(resolved.activeListId);
      listId = resolved.activeListId;
    } catch (err) {
      console.error('Failed to load lists', err);
      setLists(resolveListsPayload({}).lists);
      setListGroups([]);
      setActiveListId('default');
    }
    await loadTasks(everythingRef.current ? null : listId);
  }, [loadTasks]);

  useEffect(() => {
    // Fired from inside an async closure, so nothing in loadAll's chain can set
    // state synchronously during the effect and cascade a second render.
    (async () => { await loadAll(); })();
  }, [loadAll]);

  /*
    RELOAD WHEN THE SCOPE CHANGES, and only then.

    The scope is the pair (which layout, which list), collapsed to one value:
    a list id, or null for everything. Switching from the board to the list
    changes it; switching lists WHILE in the list view does not, and re-fetching
    every task to draw the identical page would be a request for nothing.

    `scopeRef` starts undefined, which is how the first run knows `loadAll` has
    already fetched this scope and there is nothing to do. It is also why the
    stored layout arriving a beat after hydration (see lib/taskView) costs at
    most one extra read rather than a wrong page.
  */
  const scopeRef = useRef(undefined);

  useEffect(() => {
    everythingRef.current = everything;
    if (!activeListId) return;                 // the lists have not landed yet

    const scope = everything ? null : activeListId;
    if (scopeRef.current === undefined) {
      scopeRef.current = scope;                // loadAll's own fetch
      return;
    }
    if (scopeRef.current === scope) return;
    scopeRef.current = scope;
    loadTasks(scope);
  }, [activeListId, everything, loadTasks]);

  // ─── Lists ─────────────────────────────────────────────────────────────────

  const persistLists = useCallback(async (nextLists, nextActiveId, nextGroups) => {
    try {
      await saveListsMeta({ lists: nextLists, activeListId: nextActiveId, groups: nextGroups });
    } catch (err) {
      console.error('Failed to save lists', err);
    }
  }, []);

  // No fetch here: changing the open list changes the SCOPE, and the effect
  // above owns that — which is also what stops the list view, whose scope is
  // every list, from re-reading the same page when you switch.
  const switchList = (listId) => {
    if (listId === activeListId) return;
    setActiveListId(listId);
    persistLists(undefined, listId);
  };

  const handleCreateList = (name, group = null) => {
    const next = createListState(lists, name, group);
    setLists(next.lists);
    setActiveListId(next.activeListId);
    persistLists(next.lists, next.activeListId);
  };

  const handleRenameList = (id, name) => {
    const next = renameListState(lists, id, name);
    setLists(next);
    persistLists(next, undefined);
  };

  /*
    Order and grouping are the same write: the lists are one flat ordered array
    and a list's folder is a field on it (see lib/tasks.js), so both of these
    hand back a whole new array and save it.
  */
  const handleReorderLists = (draggedId, overId) => {
    const next = reorderLists(lists, draggedId, overId);
    setLists(next);
    persistLists(next, undefined, undefined);
  };

  const handleMoveListToGroup = (id, group) => {
    const next = moveListToGroup(lists, id, group);
    setLists(next);
    persistLists(next, undefined, undefined);
  };

  const handleCreateGroup = (name) => {
    const next = createGroupState(listGroups, name);
    setListGroups(next.groups);
    persistLists(undefined, undefined, next.groups);
  };

  const handleRenameGroup = (id, name) => {
    const next = renameGroupState(listGroups, id, name);
    setListGroups(next);
    persistLists(undefined, undefined, next);
  };

  // The folder goes; the lists in it come back out to the top level.
  const handleDeleteGroup = (id) => {
    const next = removeGroupState(lists, listGroups, id);
    setLists(next.lists);
    setListGroups(next.groups);
    persistLists(next.lists, undefined, next.groups);
  };

  const handleDeleteList = async (id) => {
    const next = removeListState(lists, activeListId, id);
    if (!next) return;
    setLists(next.lists);
    setActiveListId(next.activeListId);
    persistLists(next.lists, next.activeListId);
    /*
      No reload here. Lists are managed from the switcher, which is the board's,
      so this only ever runs on the board: deleting the OPEN list changes the
      scope and the effect above reloads it, and deleting any other list cannot
      change what is on screen, because the board draws the open one. The
      comprehensive views re-read when you next switch into them.
    */
    try {
      await deleteTasksForList(id);
    } catch (err) {
      console.error("Failed to delete the list's tasks", err);
    }
  };

  // ─── Task writes ───────────────────────────────────────────────────────────

  const handleCreate = useCallback(async (fields) => {
    const listId = fields.list_id || activeListId || 'default';
    try {
      const { ok, data } = await createTask({ ...fields, list_id: listId });
      if (ok && data?.id) setTasks(prev => [...prev, data]);
    } catch (err) {
      console.error('Failed to create the task', err);
    }
  }, [activeListId, setTasks]);

  // Closing the dialog on the way out is this page's part; the delete itself is
  // the store's.
  const handleDelete = useCallback(async (task) => {
    if (openTaskId === task.id) setOpenTaskId(null);
    await removeTask(task);
  }, [openTaskId, removeTask]);

  /*
    A drag settles locally first, then persists. What comes back matters: every
    write bumps the row's `version`, so adopting the server's copies keeps the
    next edit to a dragged card from colliding with a version it no longer has.
  */
  const handleDragCommit = useCallback(async (settled, itemsToSave) => {
    setTasks(prev => prev.map(t => settled.find(s => s.id === t.id) || t));
    try {
      const res = await reorderTasks(itemsToSave);
      if (!res.ok) {
        console.error('Reorder failed', res.error);
        return;
      }
      if (res.tasks.length) {
        const saved = new Map(res.tasks.map(t => [t.id, t]));
        setTasks(prev => prev.map(t => saved.get(t.id) || t));
      }
    } catch (err) {
      console.error('Failed to reorder', err);
    }
  }, [setTasks]);

  // ─── Derived view state ────────────────────────────────────────────────────

  const visible = useMemo(() => {
    let list = filterTasks(tasks, { priority: priorityFilter, query, showCompleted });
    if (quickFilter === 'overdue') list = list.filter(t => isOverdue(t));
    if (quickFilter === 'hard') list = list.filter(t => t.is_hard && !t.done);
    return list;
  }, [tasks, priorityFilter, query, showCompleted, quickFilter]);

  const summary = useMemo(() => taskSummary(visible), [visible]);

  // Where "Show completed" lives: on the Completed section, whenever there is
  // one: the board always has that column, the list only when grouped by status.
  const hasCompletedSection = layout === 'board' || (layout === 'list' && groupBy === 'status');

  /*
    Which list a row or card came from, and its colour — the same positional
    palette /today gives them, so one list is the same colour everywhere in the
    app. Handed to the two views that show more than one list; the board is
    inside one, where it would be the same word on every card.
  */
  const listMeta = useMemo(() => listIndex(lists), [lists]);
  const listOptions = useMemo(() => [...listMeta.values()], [listMeta]);
  const listFor = useCallback(task => listOf(listMeta, task.list_id), [listMeta]);

  /*
    `lists` is only read by the "by list" grouping, and it is passed as METADATA
    (id, name, colour) rather than as the raw lists — lib/tasks has no opinion
    about how a list comes by its colour, and should not acquire one just to be
    able to group by it.
  */
  const groups = useMemo(
    () => groupTasks(visible, groupBy, { lists: listOptions }),
    [visible, groupBy, listOptions]
  );

  const openTask = openTaskId ? tasks.find(t => t.id === openTaskId) : null;

  /*
    Every + on the page opens the same New task box; this is what it opens with.
    A + always means "put one here", so the section you clicked hands over what it
    stands for: its status or priority. The box shows all of it, so an inherited
    status is visible before you create, not a surprise afterwards.
  */
  const defaultsForGroup = useCallback((groupKey) => {
    const base = {};
    if (groupBy === 'status' && groupKey) base.status = groupKey;
    if (groupBy === 'priority' && groupKey) base.priority = groupKey;
    // Grouped by list, the section key IS a list id. '__other__' is the
    // catch-all for tasks whose list has gone, and it names no real list, so it
    // is the one section whose + has nothing to inherit.
    if (groupBy === 'list' && groupKey && groupKey !== '__other__') base.list_id = groupKey;
    if (priorityFilter && !base.priority) base.priority = priorityFilter;
    return base;
  }, [groupBy, priorityFilter]);

  const openComposer = useCallback((groupKey = null) => {
    setComposer(defaultsForGroup(groupKey));
  }, [defaultsForGroup]);

  // The board's columns are always statuses, whatever the list happens to be
  // grouped by, so its + names the status directly.
  const openComposerForStatus = useCallback((status) => {
    setComposer({ ...defaultsForGroup(null), status });
  }, [defaultsForGroup]);

  // The calendar's + carries the day you clicked as the due date.
  const openComposerForDate = useCallback((dueDate) => {
    setComposer({ ...defaultsForGroup(null), due_date: dueDate });
  }, [defaultsForGroup]);

  // ─── Keyboard: t = new task, / = search ────────────────────────────────────

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // `c` still works for anyone with the Linear reflex.
      if (e.key === 't' || e.key === 'c') { e.preventDefault(); openComposer(); }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openComposer]);

  const toggleQuick = (key) => setQuickFilter(prev => (prev === key ? null : key));

  return (
    <div className="max-w-[1400px] mx-auto px-6 lg:px-12 pb-16">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4 animate-fade-in-up">
        <div>
          {/*
            The switcher is the board's, so it is only drawn there. A dropdown
            offering to choose between thirteen lists, above a page already
            showing all thirteen, is a control that appears to do something and
            does not — and the name of one list as the heading over every task
            you own is worse than that: it is wrong.

            List management (make, rename, reorder, file into a group, delete)
            lives inside that menu, so it lives on the board too.
          */}
          {everything ? (
            <h1 className="text-2xl font-bold text-gray-900">All tasks</h1>
          ) : (
            <ListMenu
              lists={lists}
              groups={listGroups}
              activeListId={activeListId}
              onSwitch={switchList}
              onCreate={handleCreateList}
              onRename={handleRenameList}
              onDelete={handleDeleteList}
              onReorder={handleReorderLists}
              onMoveToGroup={handleMoveListToGroup}
              onCreateGroup={handleCreateGroup}
              onRenameGroup={handleRenameGroup}
              onDeleteGroup={handleDeleteGroup}
            />
          )}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <SummaryStat value={summary.open} label="open" />
            {summary.overdue > 0 && (
              <SummaryStat
                icon={AlertTriangle}
                value={summary.overdue}
                label="late"
                tone="red"
                active={quickFilter === 'overdue'}
                onClick={() => toggleQuick('overdue')}
              />
            )}
            {summary.hard > 0 && (
              <SummaryStat
                icon={Flame}
                value={summary.hard}
                label="hard"
                tone="amber"
                active={quickFilter === 'hard'}
                onClick={() => toggleQuick('hard')}
              />
            )}
            {summary.completedRecently > 0 && (
              <SummaryStat icon={CheckCircle2} value={summary.completedRecently} label="done this week" tone="emerald" />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => openComposer()}
            title="New task (T)"
            className="flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-xl bg-gray-900 text-white hover:bg-gray-700 transition-colors"
          >
            <Plus size={15} />
            New task
          </button>
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.target.blur(); } }}
            placeholder="Search tasks…  /"
            className="w-56 text-xs pl-7 pr-6 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500 focus:border-transparent transition-all"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X size={12} />
            </button>
          )}
        </div>

        <FilterMenu
          label="Priority"
          anyLabel="Any priority"
          value={priorityFilter}
          onSelect={setPriorityFilter}
          options={PRIORITIES.map(p => ({ key: p.key, label: p.label, color: p.color }))}
        />

        {/* The list's sections ARE the grouping, so it always has one. */}
        {layout === 'list' && (
          <FilterMenu
            label="Group by"
            value={groupBy}
            onSelect={key => setGroupBy(key || 'status')}
            clearable={false}
            options={GROUP_BY.map(g => ({ key: g.key, label: `By ${g.label.toLowerCase()}` }))}
          />
        )}

        {/* The board's columns are always the statuses; this gathers the cards
            INSIDE each column, so it starts at "no grouping". */}
        {layout === 'board' && (
          <FilterMenu
            label="Group by"
            anyLabel="No grouping"
            value={clusterBy}
            onSelect={setClusterBy}
            options={CLUSTER_BY.map(c => ({ key: c.key, label: `By ${c.label.toLowerCase()}` }))}
          />
        )}

        {/*
          Completed work is revealed from the Completed section itself (see
          hasCompletedSection). The calendar and the non-status groupings have
          no such section, so there the toggle stays here.
        */}
        {!hasCompletedSection && (
          <ShowCompletedToggle value={showCompleted} onToggle={() => setShowCompleted(s => !s)} />
        )}

        {(quickFilter || priorityFilter || query) && (
          <button
            onClick={() => { setQuickFilter(null); setPriorityFilter(null); setQuery(''); }}
            className="text-xs text-gray-400 hover:text-gray-700 px-1.5 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      {loadError && <LoadError error={loadError} onRetry={loadAll} />}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm animate-pulse">
              <div className="h-3 bg-gray-100 rounded w-40 mb-4" />
              <div className="h-3 bg-gray-50 rounded w-full mb-2" />
              <div className="h-3 bg-gray-50 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : layout === 'board' ? (
        <TaskBoardView
          tasks={visible}
          clusterBy={clusterBy}
          onPatch={patchTask}
          onOpen={t => setOpenTaskId(t.id)}
          onAdd={openComposerForStatus}
          onDragCommit={handleDragCommit}
          showCompleted={showCompleted}
          onToggleCompleted={() => setShowCompleted(s => !s)}
        />
      ) : layout === 'calendar' ? (
        <CalendarView
          tasks={visible}
          listFor={listFor}
          onPatch={patchTask}
          onOpen={t => setOpenTaskId(t.id)}
          onAdd={openComposerForDate}
        />
      ) : (
        <TaskListView
          groups={groups}
          showStatus={groupBy !== 'status'}
          /*
            Grouped by list, the section heading above the row already carries
            the list's dot and name; repeating it on every row under it would be
            the same fact twice, once per line.
          */
          listFor={groupBy === 'list' ? null : listFor}
          onPatch={patchTask}
          onOpen={t => setOpenTaskId(t.id)}
          onDelete={handleDelete}
          onAdd={openComposer}
          showCompleted={showCompleted}
          onToggleCompleted={hasCompletedSection ? () => setShowCompleted(s => !s) : null}
          emptyHint="Nothing in any list yet. Press T to write the first one."
        />
      )}

      {/* ── Overlays ───────────────────────────────────────────────────────── */}
      {openTask && (
        <TaskDetailPanel
          task={openTask}
          onPatch={patchTask}
          onDelete={handleDelete}
          onClose={() => setOpenTaskId(null)}
        />
      )}

      {composer && (
        <TaskComposer
          // `composer` last: a + pressed on a list's section has already said
          // which list it means, and the open list is only the fallback.
          defaults={{ list_id: activeListId, ...composer }}
          /*
            A list picker only where there is a choice to make. In the board and
            the calendar you are standing IN a list and a new task belongs to it;
            in the comprehensive list view you are standing in all of them, so
            the box has to ask — it still opens on the one the switcher names.
          */
          lists={everything ? listOptions : null}
          onCreate={handleCreate}
          onClose={() => setComposer(null)}
        />
      )}
    </div>
  );
}
