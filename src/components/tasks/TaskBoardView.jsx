'use client';

/*
  Board layout: one column per status, drag a card across to move it. The four
  columns ARE the workflow you are asked to keep current, so the board is
  the fastest way to answer "what is in review right now".

  Grouping happens INSIDE a column, never to the columns themselves: group by
  priority and the urgent work rises to the top of every column. The statuses
  stay put through all of it: they are the board, and the only axis a drag can
  change.

  Ordering and the cross-column move live in lib/tasks (clusterTasks /
  moveTaskToStatus / finalizeTaskDrag), so this file is the dnd wiring and the
  column chrome. During a drag it keeps a local draft of the list so the card
  follows the pointer without a round-trip; on drop it hands the parent both the
  settled list and the minimal set of rows to persist.

  `vertical` stacks the four columns instead of laying them across, for a narrow
  rail rather than a full page. `reorderable` turns manual ordering off for a
  view holding only a SLICE of the list: `position` is one manual order per list,
  so renumbering the few cards a slice can see would shove them to the top of the
  real board, past work it never showed you. Moving a card between statuses still
  lands (that's a field on the task, not a place in a list).

  That slice is what /today's finished day is (see DayView): the day, across
  every list, drawn as the same four columns. Four more props exist for it and
  are the whole of the difference. `listFor` puts the list's badge on each card,
  because a board spanning thirteen projects has to say which one a card is
  from; `sort` hands the columns a comparator of their own, because a day reads
  in the order it happens rather than in a manual order that a slice cannot
  keep; `onRemove` puts a × on each card, because being IN a slice is a
  decision — this task is today's — and a decision the day makes has to be
  reversible from where you can see it; and `onSetHalf` puts the must-do star
  there, which is the one thing a day says about a task that a board of statuses
  otherwise cannot show. All four are `null` on /tasks, which is exactly the
  board this file has always drawn: its cards ARE the list, there is nothing to
  take them out of, and no day for them to be half of.
*/

import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, DragOverlay, PointerSensor, closestCenter, pointerWithin, useDroppable, useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import {
  STATUSES, boardSort, clusterTasks, columnId, findColumn, finalizeTaskDrag, isColumnId,
  moveTaskToStatus,
} from '@/lib/tasks';
import { TaskCard } from './TaskItems';
import { OVERLAY_Z, ShowCompletedToggle } from './TaskPickers';

/*
  THE COLUMN THAT DOES NOT SHUFFLE.

  A sorting strategy is what draws the PREVIEW of a within-column reorder: the
  cards below the gap slide down to open it, so you can see where the one in
  your hand is about to land. That is right when the order is yours — you
  dragged the cards into it, and the drop keeps them there.

  It is a lie everywhere else. A column that is SORTED (by due date, or by the
  day's own order on /today) or that belongs to a SLICE the board cannot
  renumber will re-render in exactly the order it was already in, so the preview
  opens a gap the drop then closes: cards jump under the cursor, the card you
  are holding springs back to where it started, and the whole board reads as
  broken while the one thing that did work — carrying a card into another
  column — is buried under the noise.

  So those columns get no preview at all. Nothing moves until something has
  actually changed, which for these boards means crossing into another status.
  The card is still a drop target (that is `useSortable`, not the strategy), so
  dropping ONTO a card in another column still lands, and the card in flight is
  still the DragOverlay under the cursor.
*/
const noSorting = () => null;

/*
  WHICH COLUMN YOU MEANT, and it is the one under the POINTER.

  `closestCenter` — what this board used to ask — answers a different question:
  which droppable's CENTRE is nearest the centre of the card in your hand. On a
  row of four full-height columns that is barely a question about columns at
  all. Every column stretches to the tallest pile, so all four centres sit at
  the same height, half way down the longest one; a card near the top or the
  bottom of the board is hundreds of pixels from every one of them, while the
  card directly above or below the one you picked up is a few dozen. Drag from
  the top of a long column and the nearest centre is a card in the column you
  are trying to LEAVE, so the drop lands back where it started.

  What is left working is a band across the middle of the board, plus whichever
  columns happen to hold a card at the height you are dragging at — and a column
  that does hold one also steals the drops aimed past it at its neighbours. One
  column takes cards reliably and the other three refuse, which is the bug this
  replaces and reads as nothing to do with geometry at all.

  It also MOVES while you hold the card. Every cross-column move re-heights the
  columns, which slides all four centres, which can hand the card straight back
  to the column it just left.

  So: whatever is under the pointer, which is the only thing a person dragging a
  card is aiming with. `pointerWithin` sorts what it finds by how tightly the
  rectangle wraps the pointer, so a card wins over the column containing it —
  that is a within-column reorder, and it still works where a board allows one —
  and an empty stretch of column is the column.

  The one place the pointer can be over nothing while still plainly meaning
  something is the gutter between two columns, so a miss falls back to the
  nearest column by EDGE distance, within a gutter's width. Let go anywhere
  further out and there is no collision at all, which is what makes dragging a
  card off the board the way to change your mind about it.
*/
const GUTTER = 24;

/*
  The four column ids, and why they are a constant rather than a lookup.

  A column's rectangle is measured when the drag starts and then only again if
  that column RESIZES — and on this board a column resizing is never a private
  event. The columns stretch to the tallest pile, so a card crossing from one to
  another re-heights all four at once, and the three that were only following
  along get no resize of their own to notice. Their stored rectangles go stale
  mid-drag, and the pointer test above starts asking about columns that have
  moved.

  `updateMeasurementsFor` is dnd-kit's answer: any one of them changing shape
  re-measures the set.
*/
const COLUMN_IDS = STATUSES.map(status => columnId(status.key));

function boardCollision(args) {
  const { droppableContainers, droppableRects, pointerCoordinates } = args;

  const under = pointerWithin(args);
  if (under.length) return under;
  // Only a keyboard drag has no pointer to ask about.
  if (!pointerCoordinates) return closestCenter(args);

  let nearest = null;
  let nearestDistance = Infinity;
  for (const container of droppableContainers) {
    // Columns only: a card is never the thing you were aiming at from outside
    // the column that holds it.
    if (!isColumnId(container.id)) continue;
    const rect = droppableRects.get(container.id);
    if (!rect) continue;
    const dx = Math.max(rect.left - pointerCoordinates.x, 0, pointerCoordinates.x - rect.right);
    const dy = Math.max(rect.top - pointerCoordinates.y, 0, pointerCoordinates.y - rect.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance <= GUTTER && distance < nearestDistance) {
      nearest = container;
      nearestDistance = distance;
    }
  }

  return nearest
    ? [{ id: nearest.id, data: { droppableContainer: nearest, value: nearestDistance } }]
    : [];
}

function SortableCard({ task, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 220ms cubic-bezier(0.25, 1, 0.5, 1)',
    opacity: isDragging ? 0.35 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children({ dragHandleProps: listeners })}
    </div>
  );
}

/** The label above a run of cards, only drawn when a column is grouped. */
function RunHeader({ run }) {
  return (
    <div className="flex items-center gap-1.5 px-1 pt-1 first:pt-0">
      {run.color && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: run.color }} />}
      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 truncate">{run.label}</span>
      <span className="text-[10px] font-semibold text-gray-300">{run.tasks.length}</span>
      <span className="flex-1 h-px bg-gray-200/70 ml-1" />
    </div>
  );
}

function Column({
  status, tasks, runs, listFor, strategy, isOver, onPatch, onOpen, onAdd, onRemove, onSetHalf,
  showCompleted, onToggleCompleted, vertical = false,
}) {
  /*
    `isOver` is the board's, not this droppable's, and the difference is the
    whole point of it: point at a CARD and the card is what you are over, so a
    column that has anything in it would lose its tint the moment you dragged
    across one. What you are being shown is where the card would LAND, and a
    card landing on another card lands in the column that holds it.
  */
  const { setNodeRef } = useDroppable({
    id: columnId(status.key),
    resizeObserverConfig: { updateMeasurementsFor: COLUMN_IDS },
  });

  const card = (task) => (
    <SortableCard key={task.id} task={task}>
      {({ dragHandleProps }) => (
        <TaskCard
          task={task}
          // Only when the board spans more than one list: /tasks stands inside
          // one, so the badge would be the same word on every card there.
          list={listFor ? listFor(task) : null}
          onPatch={onPatch}
          onOpen={onOpen}
          // Only where being on this board is a decision you can take back —
          // /today's day, not /tasks' list. See TaskCard.
          onRemove={onRemove}
          removeLabel="Take off today"
          // The must-do star, on a board that is a day. See TaskCard.
          onSetHalf={onSetHalf}
          dragHandleProps={dragHandleProps}
          dense={vertical}
          compact
        />
      )}
    </SortableCard>
  );

  return (
    /*
      THE DROP TARGET IS THE WHOLE COLUMN, not just the box the cards sit in.

      The heading is part of the column you are pointing at — you read the word
      "In progress" and drag to it — and a target that stops an inch below the
      word it is named after is a target you can miss while looking straight at
      it. Same for the strip under the last card, which is where a drop onto a
      column "at the end" naturally goes.

      The tint stays on the box below, because that is the shape a card would
      join; the column is what ACCEPTS the drop, the box is what SHOWS it.
    */
    <div ref={setNodeRef} className={`flex flex-col ${vertical ? '' : 'min-w-[260px] flex-1'}`}>
      <div className="flex items-center gap-2 px-2 pb-2">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: status.color }} />
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{status.label}</h3>
        <span className="text-[11px] font-semibold text-gray-400">{tasks.length}</span>
        {onToggleCompleted && (
          <ShowCompletedToggle value={showCompleted} onToggle={onToggleCompleted} />
        )}
        <button
          type="button"
          onClick={() => onAdd(status.key)}
          className="ml-auto p-1 text-gray-300 hover:text-emerald-600 transition-colors"
          title={`New task in ${status.label}`}
        >
          <Plus size={14} />
        </button>
      </div>

      <div
        className={`flex-1 rounded-2xl p-2 transition-colors ${vertical ? 'min-h-[52px]' : 'min-h-[120px]'} ${
          isOver ? 'bg-emerald-50/70 ring-2 ring-emerald-200 ring-inset' : 'bg-gray-50/70'
        }`}
      >
        {/* One SortableContext per column, in display order, whether or not the
            cards are broken into runs; the runs are drawn between them. */}
        <SortableContext items={tasks.map(t => t.id)} strategy={strategy}>
          {runs.map(run => (
            <div key={run.key ?? 'all'} className="space-y-2 [&:not(:first-child)]:mt-3">
              {run.label && <RunHeader run={run} />}
              {run.tasks.map(card)}
            </div>
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <p className={`text-center text-xs text-gray-300 ${vertical ? 'py-2' : 'py-6'}`}>
            {onToggleCompleted && !showCompleted ? 'Completed work is hidden' : 'Drop here'}
          </p>
        )}
      </div>
    </div>
  );
}

export default function TaskBoardView({
  tasks, clusterBy = null, sortBy = 'priority', sort: sortOverride = null, listFor = null,
  onPatch, onOpen, onAdd, onRemove = null, onSetHalf = null, onDragCommit,
  showCompleted, onToggleCompleted, vertical = false, reorderable = true,
}) {
  const [draftTasks, setDraftTasks] = useState(null);
  const snapshot = useRef(null);
  const [activeId, setActiveId] = useState(null);
  // Which column would take the card if you let go now. See Column.
  const [overStatus, setOverStatus] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const list = draftTasks ?? tasks;

  /*
    The order inside a column: what you dragged, or what you asked for instead
    (`boardSort`). It is handed to `clusterTasks` as well as used here, or a
    grouped column would re-sort its runs back into drag order underneath the
    sort you chose.
  */
  const sort = sortOverride || boardSort(sortBy);
  // An order of your own is one a drag can still rearrange. Any other is the
  // board telling you where a card goes, and a within-column drop under it
  // would be undone by the next render.
  const imposed = sort !== boardSort('priority');

  /*
    And a column whose order cannot change must not animate as though it can:
    the same three cases `handleDragEnd` refuses to save a reorder for are the
    three that draw no preview of one. See `noSorting`.
  */
  const strategy = (clusterBy || imposed || !reorderable) ? noSorting : verticalListSortingStrategy;

  // Each status column, and the runs its cards are drawn in.
  const columns = useMemo(() => STATUSES.map(status => {
    const columnTasks = list.filter(t => t.status === status.key).sort(sort);
    return { status, tasks: columnTasks, runs: clusterTasks(columnTasks, clusterBy, { sort }) };
  }), [list, clusterBy, sort]);

  const handleDragStart = useCallback((event) => {
    setActiveId(event.active.id);
    setOverStatus(findColumn(tasks, event.active.id));
    snapshot.current = tasks;
    setDraftTasks(tasks);
  }, [tasks]);

  const handleDragOver = useCallback((event) => {
    const { active, over } = event;
    setOverStatus(over ? findColumn(draftTasks ?? tasks, over.id) : null);
    if (!over) return;
    setDraftTasks(prev => {
      const current = prev ?? tasks;
      const from = findColumn(current, active.id);
      const to = findColumn(current, over.id);
      if (!from || !to || from === to) return current;
      return moveTaskToStatus(current, active.id, over.id).tasks;
    });
  }, [draftTasks, tasks]);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    const base = snapshot.current;
    snapshot.current = null;
    setActiveId(null);
    setOverStatus(null);
    const current = draftTasks ?? tasks;
    const { tasks: settled, itemsToSave, shouldRevert } = finalizeTaskDrag(current, base, active.id, over?.id);
    setDraftTasks(null);
    if (shouldRevert || !itemsToSave?.length) return;

    /*
      Three cases where a within-column drag doesn't mean anything, and only the
      moves that crossed into another status are saved:

        · the column is GROUPED, so its order is the grouping's, not yours, and a
          within-column drag would be undone by the next render anyway;
        · it is SORTED, which is the same thing said about the order rather than
          about the runs: a card dropped above another one springs back to where
          its due date puts it;
        · the view isn't `reorderable`, because it is holding a slice of the
          list and can't renumber it without disturbing the rows it isn't
          showing.
    */
    if (clusterBy || imposed || !reorderable) {
      let crossed = itemsToSave.filter(item => item.status !== undefined);
      if (!crossed.length) return;
      // A slice can't be trusted with positions at all, not even the ones that
      // came along with a status change. Send the status and leave the row where
      // it sits in the real order.
      if (!reorderable) {
        crossed = crossed.map(({ position, ...rest }) => rest);
      }
      onDragCommit(settled, crossed);
      return;
    }
    onDragCommit(settled, itemsToSave);
  }, [draftTasks, tasks, clusterBy, imposed, reorderable, onDragCommit]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setOverStatus(null);
    snapshot.current = null;
    setDraftTasks(null);
  }, []);

  const activeTask = activeId ? list.find(t => t.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollision}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={vertical ? 'flex flex-col gap-3' : 'flex gap-3 overflow-x-auto pb-2'}>
        {columns.map(({ status, tasks: columnTasks, runs }) => (
          <Column
            key={status.key}
            status={status}
            tasks={columnTasks}
            runs={runs}
            listFor={listFor}
            strategy={strategy}
            isOver={activeId != null && overStatus === status.key}
            onPatch={onPatch}
            onOpen={onOpen}
            onAdd={onAdd}
            onRemove={onRemove}
            onSetHalf={onSetHalf}
            showCompleted={showCompleted}
            onToggleCompleted={status.key === 'completed' ? onToggleCompleted : null}
            vertical={vertical}
          />
        ))}
      </div>

      {/*
        Portalled to <body>, and it has to be.

        DragOverlay is `position: fixed`, positioned from the card's viewport
        coordinates. That only lines up if the viewport really is what "fixed"
        resolves against, and ANY ancestor with a transform becomes the
        containing block for its fixed descendants instead. An entrance animation
        is enough to cause it: `animate-fade-in-up` has
        `animation-fill-mode: both`, which leaves `transform: translateY(0)` on
        the element for good, and the dragged card then trails the pointer by
        that ancestor's offset.

        Leaving the tree fixes it wherever this board is rendered, rather than
        making every future host promise never to transform itself. It also
        leaves the host's stacking context, so the card being dragged needs to
        say for itself that it is above everything.
      */}
      {typeof document === 'undefined' ? null : createPortal(
        <DragOverlay
          dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' }}
          style={{ zIndex: OVERLAY_Z.drag }}
        >
          {activeTask ? (
            <div className="rotate-1 opacity-95">
              {/* The same card, drawn the same way — the list badge included.
                  An overlay a line shorter than the card it came from is a card
                  that changes size the moment you pick it up. */}
              <TaskCard
                task={activeTask}
                list={listFor ? listFor(activeTask) : null}
                onPatch={() => {}}
                onOpen={() => {}}
                onSetHalf={onSetHalf ? () => {} : null}
                dense={vertical}
                compact
              />
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
