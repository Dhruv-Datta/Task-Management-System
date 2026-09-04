'use client';

/*
  THE SHELL THE DAY IS PLANNED IN: one question on screen at a time.

  Everything this component does is a consequence of one decision — that
  planning a day is a sequence and not a dashboard. The four things you have to
  do (see what is owed, look at what is asking, add what you want, put it in the
  hours) are four separate acts of judgement, and showing all four at once means
  you do none of them properly: your eye goes to whichever panel is loudest,
  which is generally the one full of red.

  So: a rail across the top saying where you are, one step's worth of page under
  it, and Back / Next at the bottom.

  AND NOTHING ELSE. There is no headline asking "What are you finishing today?"
  above a panel already titled Today plan, and no paragraph under that
  explaining what the panel does. Chrome that restates the thing it sits on top
  of is not guidance, it is a second thing to read on the way to the first —
  and it is worst exactly where it is loudest, on a page you open every morning
  and already know your way around. The numbered rail says where you are; the
  panel says what it is; the step itself is the explanation.

  The rail's steps are clickable, because a flow you cannot move around inside
  is a wizard, and a wizard is a thing people learn to click through without
  reading.

  The last step's Next is "Finish planning", and it is the only button here that
  changes what /today IS: after it, the page stops being a form and becomes the
  day (see DayView).
*/

import { ArrowLeft, ArrowRight, Check, CalendarCheck } from 'lucide-react';
import { PLAN_STEPS, stepIndex } from '@/lib/dayPlan';

/*
  The rail.

  Three states per step, legible without relying on colour: DONE is a tick,
  CURRENT is a filled dark pill carrying its number and name, AHEAD is a bare
  number in grey. Only the current step spends width on its name at small
  sizes — four labels on a phone is a wrapped line, and the one you are standing
  on is the only one you need to read.

  The connector between two steps fills in as you pass it, so the rail reads as
  a distance travelled rather than as four tabs.
*/
function StepRail({ current, onStep }) {
  const currentIndex = stepIndex(current);

  return (
    <ol className="flex items-center gap-0.5 min-w-0">
      {PLAN_STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;

        return (
          <li key={step.key} className="flex items-center gap-0.5 min-w-0">
            {i > 0 && (
              <span
                aria-hidden
                className={`h-px w-2.5 sm:w-4 flex-shrink-0 transition-colors ${
                  done || active ? 'bg-gray-300' : 'bg-gray-200'
                }`}
              />
            )}
            <button
              type="button"
              onClick={() => onStep(step.key)}
              aria-current={active ? 'step' : undefined}
              title={step.hint}
              className={`group flex items-center gap-1.5 min-w-0 rounded-full py-1 transition-all active:scale-95 ${
                active
                  ? 'bg-gray-900 text-white pl-1.5 pr-3'
                  : 'px-1.5 hover:bg-gray-100'
              }`}
            >
              <span
                className={`w-[17px] h-[17px] rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold tabular-nums transition-colors ${
                  active
                    ? 'bg-white/20 text-white'
                    : done
                      ? 'text-emerald-600'
                      : 'text-gray-400 group-hover:text-gray-600'
                }`}
              >
                {done ? <Check size={12} strokeWidth={3.5} /> : i + 1}
              </span>
              <span
                className={`truncate text-[12px] font-semibold ${
                  active
                    ? 'block'
                    : `hidden sm:block ${done ? 'text-gray-500' : 'text-gray-400'} group-hover:text-gray-700`
                }`}
              >
                {step.label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The flow around a step's body.
 *
 * `summaryLine` is the one number the current step is about — how much is on
 * the day, how much is asking, how much is placed. It sits beside Next rather
 * than in the header, because it is the thing you check just before you decide
 * you are done with this step.
 */
export default function PlanFlow({
  step, onStep, onBack, onNext, onFinish, dateLine, summaryLine, nextLabel, children,
}) {
  const index = stepIndex(step);
  const first = index === 0;
  const last = index === PLAN_STEPS.length - 1;

  return (
    <div>
      {/*
        A bar, not a card. It carries where you are in the app and where you are
        in the flow, in one line: the panel below is the object on this page, and
        chrome that needs its own surface and its own shadow is competing with
        it.
      */}
      <div className="flex items-center gap-3 pb-3 mb-4 border-b border-gray-200/70">
        <StepRail current={step} onStep={onStep} />
        <span className="ml-auto text-[11px] font-semibold text-gray-400 truncate flex-shrink min-w-0">
          {dateLine}
        </span>
      </div>

      {children}

      {/*
        Back and Next at the bottom, where the step ends: a Next button in the
        header would be a button you press before you have read the thing it is
        asking you about.
      */}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={first}
          className="flex items-center gap-1 text-[13px] font-semibold pl-2 pr-3 py-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-0 disabled:pointer-events-none transition-all active:scale-95"
        >
          <ArrowLeft size={14} strokeWidth={2.5} />
          Back
        </button>

        {summaryLine && (
          <span className="text-[12px] text-gray-400 truncate min-w-0">{summaryLine}</span>
        )}

        <button
          type="button"
          onClick={last ? onFinish : onNext}
          className={`ml-auto flex items-center gap-1.5 flex-shrink-0 text-[13px] font-semibold pl-3.5 pr-3 py-1.5 rounded-lg text-white shadow-sm transition-all active:scale-95 ${
            last ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-900 hover:bg-gray-700'
          }`}
        >
          {last && <CalendarCheck size={14} strokeWidth={2.5} />}
          {nextLabel || (last ? 'Finish planning' : 'Next')}
          {!last && <ArrowRight size={14} strokeWidth={2.5} />}
        </button>
      </div>
    </div>
  );
}
