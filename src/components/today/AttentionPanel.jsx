'use client';

/*
  STEP 2 — COMING UP: what is asking for a decision, from every project at once.

  The only step of the flow whose contents you do not control: it is filled by
  facts (a date passed, a date is tomorrow, you flagged it hard) rather than by
  choices. Which is exactly why every row's only verb is the must-do / optional
  pair. You look, and then you decide, one at a time. Nothing here moves onto
  your day by itself.

  Three ways in and no fourth — due tomorrow, hard within the week, high
  priority within the week (the rules live in `attention`, lib/agenda). A task
  appears in one section only, claimed in that order, so the counts add up and
  you never have to work out whether the thing under Due tomorrow is the same
  thing you already read under Hard.

  Nothing LATE is here, and that is the point of the step's name. Work you are
  already behind on is not coming up; it is owed now, so it is seeded straight
  onto step 1 with the rest of today (see `owedTodaySeed` in lib/dayPlan). This
  step is only ever a forecast, which is what makes it safe to skim.

  Sections you have nothing in are not drawn at all: an empty "Due tomorrow" is
  a heading over good news, and good news does not need a row. Long ones are cut
  to the first few, because a backlog of forty is a thing to work through on the
  Tasks page, not a wall to scroll past on the way to your day.
*/

import { useState } from 'react';
import { AgendaRow, EmptyNote, GroupLabel, Panel, PanelHead } from '@/components/dashboard/Panel';
import { PlanChoice } from './PlanControls';

// Enough to see the shape of it. More than this and you are reading a list, not
// checking one.
const PREVIEW = 5;

export default function AttentionPanel({
  sections, listFor, today, onPatch, onOpen, onPlan, onRemoveFromToday,
}) {
  const [expanded, setExpanded] = useState(() => new Set());
  const total = sections.reduce((n, section) => n + section.tasks.length, 0);

  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <Panel>
      <PanelHead title="Coming up" count={total} />

      <div className="px-2 pb-3">
        {sections.length === 0 ? (
          <EmptyNote>
            Nothing due tomorrow, nothing hard on the horizon. Genuinely clear.
          </EmptyNote>
        ) : (
          sections.map(section => {
            const open = expanded.has(section.key);
            const shown = open ? section.tasks : section.tasks.slice(0, PREVIEW);
            const hidden = section.tasks.length - shown.length;

            const rows = (
              <>
                <GroupLabel tone={section.tone} count={section.tasks.length}>
                  {section.label}
                </GroupLabel>

                {shown.map(task => (
                  <AgendaRow
                    key={task.id}
                    task={task}
                    list={listFor(task)}
                    onPatch={onPatch}
                    onOpen={onOpen}
                    action={(
                      <PlanChoice
                        half={task.planned_date === today ? task.daily_priority : null}
                        onPlan={half => onPlan(task, half)}
                        onRemove={() => onRemoveFromToday(task)}
                        dense
                      />
                    )}
                  />
                ))}

                {(hidden > 0 || open) && (
                  <button
                    type="button"
                    onClick={() => toggle(section.key)}
                    className="ml-3 mt-0.5 px-1.5 py-0.5 text-[11.5px] font-semibold text-gray-400 hover:text-gray-800 transition-colors"
                  >
                    {open ? 'Show fewer' : `Show ${hidden} more`}
                  </button>
                )}
              </>
            );

            // No section here is allowed colour behind it any more. The one
            // that had it was Late, and Late is on the day now; everything left
            // is a forecast, and a forecast that shouts is a forecast you learn
            // to ignore.
            return <div key={section.key} className="pb-1">{rows}</div>;
          })
        )}
      </div>
    </Panel>
  );
}
