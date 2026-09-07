'use client';

/*
  STEP 4: put the day in the day.

  By now you know WHAT you are doing. This is the only remaining question, and
  it is the one a list genuinely cannot answer: four commitments and three and a
  half hours of work is not a plan until the hours exist. A timeline makes two
  things visible that no list can — that two things are at the same time, and
  that the day has run out.

  So the calendar is the main object here, wide, and beside it sits exactly one
  thing: the work that has NO time on it yet, under the star it was given —
  what you have to finish, then what happens if there is room. That column
  empties as you drag, which is the whole feedback loop of the step: it is
  finished when the top half is empty, or when you decide the rest of it
  happens whenever it happens.

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

/*
  One task in the column, drawn the same way wherever in it it sits: the three
  groups differ in what they MEAN, not in how a row behaves.
*/
function UnplacedRow({ task, listFor, onPatch, onOpen, onSchedule, onRemoveFromToday, onSetHalf }) {
  return (
    <TodayRow
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
  );
}

export default function CalendarStep({
  day, timeline, nowMinutes, listFor, canvasRef, dragPreview,
  onPatch, onOpen, onSchedule, onRemoveFromToday, onSetHalf,
  onUnschedule, onPlaceTask, onPlaceEvent, onPlaceExternal, onCreateEvent,
  onStatusBlock, onTagBlock, onRenameBlock, onDescribeBlock, onDeleteBlock, tags,
  googleControl = null,
}) {
  const unplaced = day.open.filter(task => !task.scheduled_start);
  const placed = day.open.filter(task => task.scheduled_start);

  /*
    THE STAR, SPLIT OUT. What is left to place is two different questions and
    not one queue: a commitment with no hour yet is unfinished business — the
    day has said it WILL happen and has not yet said when — while an optional
    one is work you would like the leftovers to go to. Read as a single list
    they compete for the same attention, and the "if there's time" rows are
    exactly the ones you end up placing first because they are easy.

    So the mark you set in step 1 and 2 decides which half of this column a task
    is in, and the top half is the one that has to reach zero. Same star, same
    words as the finished day's column (see DayView), so a task does not change
    what it is on the way between two screens.
  */
  const mustPlace = unplaced.filter(task => task.daily_priority !== 'optional');
  const ifTime = unplaced.filter(task => task.daily_priority === 'optional');
  const rowProps = { listFor, onPatch, onOpen, onSchedule, onRemoveFromToday, onSetHalf };

  return (
    /*
      Two columns wide, one under the other on a narrow screen, and NEITHER of
      them scrolls: the grid is drawn at its full height and the column beside
      it is as long as your unplaced work is. The page is what moves, so the
      hour you are looking at and the task you are about to drag into it move
      together — which is the whole gesture this step is made of.

      Not pinned, either. A column stuck to the top of the screen that is longer
      than the screen is a column whose last few rows you can never reach; the
      drag that needs a far-off hour is served by the auto-scroll instead (see
      Timeline), which moves the page under the task you are already holding.
    */
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] gap-5 items-start">
      <Timeline
        timeline={timeline}
        nowMinutes={nowMinutes}
        canvasRef={canvasRef}
        onOpenTask={onOpen}
        onUnschedule={onUnschedule}
        // The × on a block takes the HOUR off; this is the other half of the
        // same sentence — off the day entirely — said where the block is,
        // rather than only on the row in the column beside it.
        onRemoveTask={onRemoveFromToday}
        onPlaceTask={onPlaceTask}
        onPlaceEvent={onPlaceEvent}
        onPlaceExternal={onPlaceExternal}
        onCreateEvent={onCreateEvent}
        onStatusBlock={onStatusBlock}
        onTagBlock={onTagBlock}
        onRenameBlock={onRenameBlock}
        onDescribeBlock={onDescribeBlock}
        onDeleteBlock={onDeleteBlock}
        tags={tags}
        dragPreview={dragPreview}
        googleControl={googleControl}
      />

      <Panel>
        {/*
          Title and count, and nothing else. Not a hint, and not a total of the
          hours still to place: a sum of guesses is a number you cannot act on,
          and the grid beside this column already shows whether the day fits.
        */}
        <PanelHead title="Not placed yet" count={unplaced.length} />

        <div className="px-2 pb-3">
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
            <>
              {/*
                Each heading only when it has something under it. A label over
                nothing is a section you read as empty and then have to check
                again — and "Must finish: 0" is a sentence about the wrong day.
              */}
              {mustPlace.length > 0 && (
                <>
                  <GroupLabel count={mustPlace.length}>Must finish</GroupLabel>
                  {mustPlace.map(task => (
                    <UnplacedRow key={task.id} task={task} {...rowProps} />
                  ))}
                </>
              )}

              {ifTime.length > 0 && (
                <div className={mustPlace.length > 0 ? 'mt-2 pt-1 border-t border-gray-100' : ''}>
                  <GroupLabel count={ifTime.length}>If there&rsquo;s time</GroupLabel>
                  {ifTime.map(task => (
                    <UnplacedRow key={task.id} task={task} {...rowProps} />
                  ))}
                </div>
              )}
            </>
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
                <UnplacedRow key={task.id} task={task} {...rowProps} />
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
