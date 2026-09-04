'use client';

/*
  STEP 1 of the day's flow: TODAY'S PLAN, and under it, IF THERE'S TIME.

  What you are choosing to finish today. Almost everything in it got here
  because you put it here, and the only way out is to take it out.

  The one exception is the seed: everything you already OWE is on it — due
  today, or late — and stays that way, so something that becomes due today at
  eleven lands here at eleven (see `owedTodaySeed` in lib/dayPlan). That is not
  the app planning for you — an arrived deadline is not a decision, it is a
  fact, and making you tick four boxes to acknowledge four of them is ceremony.
  Late is here rather than in Coming up for exactly that reason: it is the most
  owed thing you have, and a forecast is the wrong place to keep it. Every other
  route onto the day is a choice you make one task at a time, and anything the
  seed put here can be taken straight back off, for good: taking it off clears
  the date that put it here.

  The two sections are the same list held at two different strengths, so they
  are drawn as one column with a rule between them rather than as two panels.
  Rows expose that choice directly, because this page is always both the place
  you build the day and the place you live it.

  What the rows here do NOT carry is time: no estimate, no Schedule button, no
  running total of hours. This step is one question — what are you finishing
  today — and how long each thing takes is step 4's question, asked over a
  timeline where the answer is a block you drag rather than a number you guess
  from a menu. Anything placed there starts at half an hour and is resized by
  its edge (see `timing` in TodayRow, DEFAULT_BLOCK_MINUTES in lib/tasks).
*/

import {
  AddButton, EmptyNote, GroupLabel, ListBadge, Panel, PanelHead,
} from '@/components/dashboard/Panel';
import TodayRow from './TodayRow';

/** A finished commitment, kept on the day. Struck through and grey, which is
 *  the whole of what needs saying: the row opens the task, and the task is
 *  where a ✓ hit by mistake gets taken back. */
function DoneRow({ task, list, onOpen }) {
  return (
    <div
      onClick={() => onOpen(task)}
      className="group flex items-start gap-2 pl-[26px] pr-2 py-[6px] rounded-xl cursor-pointer hover:bg-gray-50 transition-colors"
    >
      <span className="flex-1 min-w-0 flex flex-col gap-[1px]">
        <span className="min-w-0 truncate text-[13px] leading-[18px] text-gray-400 line-through">
          {task.title}
        </span>
        <ListBadge list={list} sub />
      </span>
    </div>
  );
}

export default function CommitmentsPanel({
  day, listFor, onPatch, onOpen, onRemoveFromToday, onSetHalf, onNew, showDone = true,
}) {
  const nothing = day.planned.length === 0;

  const row = (task, optional) => (
    <TodayRow
      key={task.id}
      task={task}
      list={listFor(task)}
      optional={optional}
      timing={false}
      completable={false}
      showStatus={false}
      onPatch={onPatch}
      onOpen={onOpen}
      onRemove={onRemoveFromToday}
      onSetHalf={onSetHalf}
    />
  );

  return (
    <Panel>
      <PanelHead
        title="Today plan"
        count={day.open.length}
        action={<AddButton onClick={onNew} title="Write a new task, planned for today (N)" always />}
      />

      <div className="px-2 pb-4">
        {nothing ? (
          <p className="px-4 py-6 text-[13px] text-gray-400 text-center">
            Nothing owed today. Write one with +, or keep going.
          </p>
        ) : (
          <>
            {day.commitments.length > 0
              ? day.commitments.map(task => row(task, false))
              : (
                <EmptyNote>
                  Nothing you have committed to finish. What is below is optional.
                </EmptyNote>
              )}

            {/*
              The second half of the day. It only appears once something is in
              it: an empty heading over an empty list would say "you have not
              decided yet" about a decision you never had to make.
            */}
            {day.optional.length > 0 && (
              <div className="mt-2 pt-1 border-t border-gray-100">
                <GroupLabel count={day.optional.length}>If there&rsquo;s time</GroupLabel>
                {day.optional.map(task => row(task, true))}
              </div>
            )}

            {showDone && day.done.length > 0 && (
              <div className="mt-2 pt-1 border-t border-gray-100">
                <GroupLabel tone="emerald" count={day.done.length}>Finished today</GroupLabel>
                {day.done.map(task => (
                  <DoneRow key={task.id} task={task} list={listFor(task)} onOpen={onOpen} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
