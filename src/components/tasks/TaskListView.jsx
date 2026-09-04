'use client';

/*
  List layout, the default. Sections come pre-grouped from lib/tasks
  (`groupTasks`), so this file only decides how a section looks: a sticky-feeling
  header with a count and its rows.

  The + on a section opens the same New task box the header button does, with
  whatever the section is grouped by filled in.
*/

import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { TaskRow } from './TaskItems';
import { ShowCompletedToggle } from './TaskPickers';

function GroupHeader({ group, collapsed, onToggle, onAdd, showCompleted, onToggleCompleted }) {
  return (
    <div className="flex items-center gap-2 px-1.5 py-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 text-gray-500 hover:text-gray-800 transition-colors"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        {group.color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: group.color }} />}
        <span className="text-[11px] font-bold uppercase tracking-widest">{group.label}</span>
        <span className="text-[11px] font-semibold text-gray-400">{group.tasks.length}</span>
      </button>
      {onToggleCompleted && (
        <ShowCompletedToggle value={showCompleted} onToggle={onToggleCompleted} className="ml-2" />
      )}
      <button
        type="button"
        onClick={onAdd}
        className="ml-auto opacity-0 group-hover/section:opacity-100 p-1 text-gray-400 hover:text-emerald-600 transition-all"
        title="Add a task here"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

export default function TaskListView({
  groups,
  showStatus = false,
  // Given, every row says which list it came from. The page hands this over
  // only when the view is showing more than one list — inside a single list the
  // label would be the same word on every row.
  listFor = null,
  onPatch,
  onOpen,
  onDelete,
  onAdd,
  showCompleted,
  onToggleCompleted,
  emptyHint = 'Nothing here yet.',
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());

  const toggle = (key) => setCollapsed(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const visible = groups.filter(g => g.tasks.length > 0 || g.alwaysShow !== false);

  if (visible.every(g => g.tasks.length === 0)) {
    return (
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm py-16 text-center">
        <p className="text-sm text-gray-400">{emptyHint}</p>
        {/* Everything here may simply be finished, so keep the way to see it. */}
        {onToggleCompleted && !showCompleted && (
          <div className="mt-3">
            <ShowCompletedToggle value={showCompleted} onToggle={onToggleCompleted} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm divide-y divide-gray-50">
      {visible.map(group => {
        const isCollapsed = collapsed.has(group.key);
        return (
          <div key={group.key} className="group/section px-3 py-1.5">
            <GroupHeader
              group={group}
              collapsed={isCollapsed}
              onToggle={() => toggle(group.key)}
              onAdd={() => onAdd(group.key)}
              showCompleted={showCompleted}
              onToggleCompleted={group.key === 'completed' ? onToggleCompleted : null}
            />

            {!isCollapsed && (
              <div>
                {group.tasks.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    list={listFor ? listFor(task) : null}
                    showStatus={showStatus}
                    onPatch={onPatch}
                    onOpen={onOpen}
                    onDelete={onDelete}
                  />
                ))}

                {group.tasks.length === 0 && (
                  <p className="px-3 py-3 text-xs text-gray-300">
                    {group.key === 'completed' && onToggleCompleted && !showCompleted
                      ? 'Completed work is hidden.'
                      : `Nothing in ${group.label.toLowerCase()}`}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
