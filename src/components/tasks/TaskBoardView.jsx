'use client';

/*
  Board layout: one column per status, drag a card across to move it. The four
  columns ARE the workflow you are asked to keep current, so the board is
  the fastest way to answer "what is in review right now".

  Grouping happens INSIDE a column, never to the columns themselves: group by
  priority and the urgent work rises to the top of every column, by tag and one
  project's work reads as one block. The statuses stay put through all of it:
  they are the board, and the only axis a drag can change.

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
  lands (that's a field on the task, not a place in a list). Neither is used by
  /tasks today; both are kept so a filtered rail can be added without touching
  this file.
*/

import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, DragOverlay, PointerSensor, closestCenter, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import {
  STATUSES, clusterTasks, columnId, compareByPosition, findColumn, finalizeTaskDrag, moveTaskToStatus,
} from '@/lib/tasks';
import { TaskCard } from './TaskItems';
import { OVERLAY_Z, ShowCompletedToggle } from './TaskPickers';

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
  status, tasks, runs, onPatch, onOpen, onAdd, showCompleted, onToggleCompleted,
  vertical = false, showTag = true,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId(status.key) });

  const card = (task) => (
    <SortableCard key={task.id} task={task}>
      {({ dragHandleProps }) => (
        <TaskCard
          task={task}
          onPatch={onPatch}
          onOpen={onOpen}
          dragHandleProps={dragHandleProps}
          dense={vertical}
          showTag={showTag}
          compact
        />
      )}
    </SortableCard>
  );

  return (
    <div className={`flex flex-col ${vertical ? '' : 'min-w-[260px] flex-1'}`}>
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
        ref={setNodeRef}
        className={`flex-1 rounded-2xl p-2 transition-colors ${vertical ? 'min-h-[52px]' : 'min-h-[120px]'} ${
          isOver ? 'bg-emerald-50/70 ring-2 ring-emerald-200 ring-inset' : 'bg-gray-50/70'
        }`}
      >
        {/* One SortableContext per column, in display order, whether or not the
            cards are broken into runs; the runs are drawn between them. */}
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
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
  tasks, clusterBy = null, onPatch, onOpen, onAdd, onDragCommit, showCompleted, onToggleCompleted,
  vertical = false, showTag = true, reorderable = true,
}) {
  const [draftTasks, setDraftTasks] = useState(null);
  const snapshot = useRef(null);
  const [activeId, setActiveId] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const list = draftTasks ?? tasks;

  // Each status column, and the runs its cards are drawn in.
  const columns = useMemo(() => STATUSES.map(status => {
    const columnTasks = list.filter(t => t.status === status.key).sort(compareByPosition);
    return { status, tasks: columnTasks, runs: clusterTasks(columnTasks, clusterBy) };
  }), [list, clusterBy]);

  const handleDragStart = useCallback((event) => {
    setActiveId(event.active.id);
    snapshot.current = tasks;
    setDraftTasks(tasks);
  }, [tasks]);

  const handleDragOver = useCallback((event) => {
    const { active, over } = event;
    if (!over) return;
    setDraftTasks(prev => {
      const current = prev ?? tasks;
      const from = findColumn(current, active.id);
      const to = findColumn(current, over.id);
      if (!from || !to || from === to) return current;
      return moveTaskToStatus(current, active.id, over.id).tasks;
    });
  }, [tasks]);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    const base = snapshot.current;
    snapshot.current = null;
    setActiveId(null);
    const current = draftTasks ?? tasks;
    const { tasks: settled, itemsToSave, shouldRevert } = finalizeTaskDrag(current, base, active.id, over?.id);
    setDraftTasks(null);
    if (shouldRevert || !itemsToSave?.length) return;

    /*
      Two cases where a within-column drag doesn't mean anything, and only the
      moves that crossed into another status are saved:

        · the column is GROUPED, so its order is the grouping's, not yours, and a
          within-column drag would be undone by the next render anyway;
        · the view isn't `reorderable`, because it is holding a slice of the
          list and can't renumber it without disturbing the rows it isn't
          showing.
    */
    if (clusterBy || !reorderable) {
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
  }, [draftTasks, tasks, clusterBy, reorderable, onDragCommit]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    snapshot.current = null;
    setDraftTasks(null);
  }, []);

  const activeTask = activeId ? list.find(t => t.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
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
            onPatch={onPatch}
            onOpen={onOpen}
            onAdd={onAdd}
            showCompleted={showCompleted}
            onToggleCompleted={status.key === 'completed' ? onToggleCompleted : null}
            vertical={vertical}
            showTag={showTag}
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
              <TaskCard
                task={activeTask}
                onPatch={() => {}}
                onOpen={() => {}}
                dense={vertical}
                showTag={showTag}
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
