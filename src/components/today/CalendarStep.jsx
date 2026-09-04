'use client';

/*
  STEP 4: put the day in the day.

  By now you know WHAT you are doing. This is the only remaining question, and
  it is the one a list genuinely cannot answer: four commitments and three and a
  half hours of work is not a plan until the hours exist. A timeline makes two
  things visible that no list can — that two things are at the same time, and
  that the day has run out.

  So the calendar is the main object here, wide, and beside it sits exactly one
  thing: the work that has NO time on it yet. That column empties as you drag,
  which is the whole feedback loop of the step: it is finished when the column
  is empty, or when you decide the rest of it happens whenever it happens.

  Nothing here is compulsory. A task can stay on today with no block — "some
  time this afternoon" is a real plan, and refusing to let you leave until every
  row has an hour would turn a planner into a timesheet.

  If Google Calendar is connected, your real day is ALREADY on the grid before
  you place anything: the lecture, the standup, the dentist. That is what makes
  this step a decision rather than a guess — the hours you have are the ones
  that are still empty, and you can see which those are.
*/

import { CalendarClock } from 'lucide-react';
import { GroupLabel, Panel, PanelHead } from '@/components/dashboard/Panel';
import Timeline from './Timeline';
import TodayRow from './TodayRow';

export default function CalendarStep({
  day, timeline, events, nowMinutes, listFor, canvasRef, dragPreview,
  onPatch, onOpen, onSchedule, onRemoveFromToday, onSetHalf,
  onUnschedule, onPlaceTask, onPlaceEvent, onPlaceExternal, onAddEvent, onEditEvent,
  onTagBlock, onRenameBlock, onDescribeBlock, onDeleteBlock, tags,
  googleControl = null,
}) {
  const unplaced = day.open.filter(task => !task.scheduled_start);
  const placed = day.open.filter(task => task.scheduled_start);

  return (
    /*
      Wide, this is the page: the two columns are exactly as tall as what is
      left of the window, and each one scrolls inside itself. Stacked on a
      narrow screen they go back to being two cards on a scrolling page.
    */
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] gap-5 items-start lg:h-full lg:min-h-0 lg:items-stretch lg:grid-rows-[minmax(0,1fr)]">
      <Timeline
        timeline={timeline}
        events={events}
        nowMinutes={nowMinutes}
        canvasRef={canvasRef}
        onOpenTask={onOpen}
        onUnschedule={onUnschedule}
        onPlaceTask={onPlaceTask}
        onPlaceEvent={onPlaceEvent}
        onPlaceExternal={onPlaceExternal}
        onAddEvent={onAddEvent}
        onEditEvent={onEditEvent}
        onTagBlock={onTagBlock}
        onRenameBlock={onRenameBlock}
        onDescribeBlock={onDescribeBlock}
        onDeleteBlock={onDeleteBlock}
        tags={tags}
        dragPreview={dragPreview}
        googleControl={googleControl}
        maxHeight="calc(100vh - 300px)"
        fill
      />

      <Panel className="lg:h-full lg:flex lg:flex-col lg:min-h-0">
        {/*
          Title and count, and nothing else. Not a hint, and not a total of the
          hours still to place: a sum of guesses is a number you cannot act on,
          and the grid beside this column already shows whether the day fits.
        */}
        <PanelHead title="Not placed yet" count={unplaced.length} />

        <div className="px-2 pb-3 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
          {unplaced.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <CalendarClock size={18} className="inline-block mb-2 text-gray-300" />
              <p className="text-[13px] text-gray-400">
                {day.open.length === 0
                  ? 'Nothing on today to place.'
                  : 'Everything on today has an hour. Finish up.'}
              </p>
            </div>
          ) : (
            unplaced.map(task => (
              <TodayRow
                key={task.id}
                task={task}
                list={listFor(task)}
                optional={task.daily_priority === 'optional'}
                completable={false}
                showStatus={false}
                onPatch={onPatch}
                onOpen={onOpen}
                onSchedule={onSchedule}
                onRemove={onRemoveFromToday}
                onSetHalf={onSetHalf}
              />
            ))
          )}

          {/*
            What is already on the grid, listed under a rule rather than hidden:
            the column would otherwise empty out into nothing and give you no way
            to move something back without hunting for its block.
          */}
          {placed.length > 0 && (
            <div className="mt-2 pt-1 border-t border-gray-100">
              <GroupLabel tone="emerald" count={placed.length}>On the grid</GroupLabel>
              {placed.map(task => (
                <TodayRow
                  key={task.id}
                  task={task}
                  list={listFor(task)}
                  optional={task.daily_priority === 'optional'}
                  completable={false}
                  showStatus={false}
                  onPatch={onPatch}
                  onOpen={onOpen}
                  onSchedule={onSchedule}
                  onRemove={onRemoveFromToday}
                  onSetHalf={onSetHalf}
                />
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
