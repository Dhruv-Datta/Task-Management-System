'use client';

/*
  STEP 3: everything you have, by the project it lives in.

  The other way onto the day. Attention shows you what is shouting; this shows
  you everything, quietly, so the thing that matters but is not due can still be
  chosen. Grouped by list because that is how your responsibilities are actually
  divided, and searched across title and notes because after a dozen projects
  browsing stops being the fast way.

    Personal
      Finish internship application        [ Must ][ Optional ]
    Hedge Fund
      Complete Ratings research            [ Must ][ Optional ]

  Two buttons per task, and between them they do exactly one thing: set
  `planned_date` to today and say which half of the day it lands in. The DUE
  DATE IS NOT TOUCHED. A task owed on Friday that you have decided to work on
  today is still owed on Friday, and a picker that quietly moved the deadline to
  match the plan would be the app lying to you about your own commitments.

  It is the body of Add from projects, and the only place in the app that lists
  every project's work at once without asking you to go to any of them.
*/

import { useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { DateChip, HardFlag, PriorityIcon } from '@/components/tasks/TaskPickers';
import { PlanChoice } from './PlanControls';

function BrowserRow({ task, half, onPlan, onRemove, onOpen }) {
  const planned = !!half;
  return (
    <div
      onClick={() => onOpen?.(task)}
      className={`group w-full flex items-center gap-2 pl-2.5 pr-1.5 py-[6px] rounded-lg text-left transition-colors ${
        planned ? 'bg-emerald-50/60' : 'hover:bg-gray-50'
      } ${onOpen ? 'cursor-pointer' : ''}`}
    >
      <PriorityIcon priority={task.priority} />
      <HardFlag hard={task.is_hard} size={11} />

      <span className={`flex-1 min-w-0 truncate text-[13px] ${planned ? 'text-gray-600' : 'text-gray-800'}`}>
        {task.title}
      </span>

      {task.due_date && <DateChip iso={task.due_date} dense />}

      <PlanChoice half={half} onPlan={h => onPlan(task, h)} onRemove={() => onRemove(task)} dense />
    </div>
  );
}

export default function TaskBrowser({
  groups, plannedHalf, onPlan, onRemove, onOpen, query, onQuery, autoFocus = false,
  maxHeight = 320, emptyNote = 'Nothing left to choose from.', className = '',
}) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mx-2 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50/70 focus-within:bg-white focus-within:border-gray-300 transition-colors">
        <Search size={14} className="text-gray-400 flex-shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => onQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onQuery(''); } }}
          placeholder="Search every project…"
          className="flex-1 min-w-0 bg-transparent text-[13px] text-gray-800 placeholder-gray-400 outline-none"
        />
      </div>

      <div style={{ maxHeight }} className="mt-1 overflow-y-auto px-2 pb-1">
        {groups.length === 0 ? (
          <p className="px-3 py-6 text-[13px] text-gray-400 text-center">{emptyNote}</p>
        ) : (
          groups.map(group => (
            <div key={group.list.id ?? 'orphaned'} className="pt-2 first:pt-1">
              <div className="flex items-center gap-1.5 px-2 pb-1">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: group.list.color }} />
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 truncate">
                  {group.list.name}
                </span>
                <span className="text-[10px] font-bold text-gray-300 tabular-nums">{group.tasks.length}</span>
              </div>
              {group.tasks.map(task => (
                <BrowserRow
                  key={task.id}
                  task={task}
                  half={plannedHalf(task)}
                  onPlan={onPlan}
                  onRemove={onRemove}
                  onOpen={onOpen}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
