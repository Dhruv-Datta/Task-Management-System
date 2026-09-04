'use client';

/*
  STEP 3 of the day's flow: Add from projects.

  Attention (step 2) is what the dates and the flags decided you should look at.
  This is the opposite: every open task you own, in one list, with nothing
  filtered out and nothing ranked for you. It is where the work that is not
  shouting gets a chance — the thing with no due date that you actually care
  about, the project you have not touched in a week.

  `excludePlanned: false`, deliberately: what you have already put on today
  stays visible here, ticked, so this step reads as a checklist of everything
  rather than a shrinking pile you cannot verify. Un-choosing something you just
  chose is the second-commonest thing to do in a picker, and it has to be
  possible in the place you chose it.
*/

import { useMemo, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { taskCatalog } from '@/lib/agenda';
import { Panel, PanelHead } from '@/components/dashboard/Panel';
import TaskBrowser from './TaskBrowser';

export default function ProjectPickerPanel({
  tasks, lists, today, onPlan, onRemove, onOpen, maxHeight = 460,
}) {
  const [query, setQuery] = useState('');

  const catalog = useMemo(
    () => taskCatalog(tasks, lists, { today, query }),
    [tasks, lists, today, query]
  );

  const count = catalog.reduce((sum, group) => sum + group.tasks.length, 0);
  const chosen = useMemo(
    () => catalog.reduce(
      (sum, group) => sum + group.tasks.filter(task => task.planned_date === today).length,
      0
    ),
    [catalog, today]
  );

  return (
    <Panel>
      <PanelHead
        title="Add from projects"
        count={count}
        hint={chosen > 0 ? `${chosen} of them already on today` : 'every open task you own'}
        action={<FolderPlus size={14} className="text-gray-400" />}
      />

      <div className="px-2 pb-3">
        <TaskBrowser
          groups={catalog}
          query={query}
          onQuery={setQuery}
          autoFocus
          plannedHalf={task => (task.planned_date === today ? task.daily_priority : null)}
          onPlan={onPlan}
          onRemove={onRemove}
          onOpen={onOpen}
          maxHeight={maxHeight}
          emptyNote={query ? 'Nothing matches that.' : 'Nothing open anywhere. Enjoy it.'}
        />
      </div>
    </Panel>
  );
}
