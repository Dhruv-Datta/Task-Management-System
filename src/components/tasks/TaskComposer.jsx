'use client';

/*
  New task. The same dialog as the editor next door (components/DialogParts):
  the work on the left, its properties in the rail, its status in the header,
  because writing a task and changing one are the same act at two moments, and
  nothing about the second should come as a surprise after the first.

  It opens Not started, unless you asked for it somewhere else: the + on the In
  progress column means "write me a task that is already underway", so the status
  comes in with the defaults and shows in the header, where you can still change
  it. A task belongs to the list you are looking at, so there is usually no
  list control; see `lists` below for the one page that is not inside a list.

  Enter in the title creates. "Create more" keeps the box open with the same
  dates and status, so a planning session is one sitting. Only the title,
  notes, checklist and tag are cleared, because those are the parts that
  describe this task rather than the batch.

  `lists` is the exception to "a task belongs to the list you are looking at":
  the overview looks at all of them, so when it opens this box it hands over the
  full set and a List control appears in the rail. /tasks passes nothing and the
  control stays away, because there it would only ever offer the answer you are
  already standing in.
*/

import { useEffect, useState } from 'react';
import { CalendarCheck, CalendarDays, Timer, X } from 'lucide-react';
import {
  DEFAULT_PRIORITY, DEFAULT_STATUS, addSubtask, estimateMeta, normalizeDailyPriority,
  priorityMeta, removeSubtask, subtaskProgress, toggleSubtask, updateSubtask,
} from '@/lib/tasks';
import { formatDateLong } from '@/lib/dates';
import {
  DailyPriorityToggle, DatePicker, EstimatePicker, HardToggle, ListPicker, PriorityIcon,
  PriorityPicker, StatusChip, StatusPicker, TagPicker,
} from './TaskPickers';
import {
  DialogShell, Field, MainColumn, NotesInput, Rail, SectionTitle, SubtaskChecklist, SubtaskCount,
  TitleInput, Value,
} from './DialogParts';

export default function TaskComposer({ defaults = {}, lists = null, planning = false, onCreate, onClose }) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState(defaults.status || DEFAULT_STATUS);
  const [priority, setPriority] = useState(defaults.priority || DEFAULT_PRIORITY);
  const [dueDate, setDueDate] = useState(defaults.due_date || null);
  const [hard, setHard] = useState(!!defaults.is_hard);
  const [tag, setTag] = useState(defaults.tag || '');
  const [estimate, setEstimate] = useState(defaults.estimated_minutes ?? null);
  const [plannedDate, setPlannedDate] = useState(defaults.planned_date || null);
  // Which half of the day it lands in, asked here for the same reason it is
  // asked everywhere else: a task on today that has not said whether it is a
  // commitment or a hope is the one you discover at 5pm.
  const [dailyPriority, setDailyPriority] = useState(
    normalizeDailyPriority(defaults.daily_priority)
  );
  const [subtasks, setSubtasks] = useState([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [createMore, setCreateMore] = useState(false);
  const [listId, setListId] = useState(defaults.list_id);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addPendingSubtask = () => {
    const next = newSubtask.trim();
    if (!next) return;
    setSubtasks(list => addSubtask(list, next));
    setNewSubtask('');
  };

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    // A subtask typed but never Entered still counts: you wrote it down.
    const pending = newSubtask.trim();
    onCreate({
      title: trimmed,
      notes,
      list_id: listId ?? defaults.list_id,
      status,
      priority,
      due_date: dueDate,
      is_hard: hard,
      tag,
      estimated_minutes: estimate,
      planned_date: plannedDate,
      daily_priority: dailyPriority,
      subtasks: pending ? addSubtask(subtasks, pending) : subtasks,
    });

    if (!createMore) { onClose(); return; }
    setTitle('');
    setNotes('');
    setTag(defaults.tag || '');
    setHard(false);
    setSubtasks([]);
    setNewSubtask('');
  };

  const progress = subtaskProgress(subtasks);

  return (
    <DialogShell
      onDismiss={onClose}
      header={(
        <>
          <StatusPicker status={status} onSelect={setStatus} align="left">
            <StatusChip status={status} interactive />
          </StatusPicker>
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">New task</span>
          <button
            onClick={onClose}
            title="Discard (Esc)"
            className="ml-auto p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </>
      )}
      footer={(
        <>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer select-none">
            <input type="checkbox" checked={createMore} onChange={e => setCreateMore(e.target.checked)} className="accent-emerald-500" />
            Create more
          </label>
          <button
            onClick={submit}
            disabled={!title.trim()}
            className="ml-auto text-sm font-semibold px-4 py-1.5 rounded-xl bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-30 transition-colors"
          >
            Create task
          </button>
        </>
      )}
    >
      <MainColumn>
        <TitleInput
          autoFocus
          value={title}
          onChange={setTitle}
          onEnter={submit}
          placeholder="Task title"
        />

        <div className="mt-5">
          <SectionTitle trailing={<SubtaskCount done={progress.done} total={progress.total} />}>
            Subtasks
          </SectionTitle>
          <SubtaskChecklist
            subtasks={subtasks}
            onTitleInput={(sub, value) => setSubtasks(list => updateSubtask(list, sub.id, { title: value }))}
            onTitleCommit={(sub, value) => {
              const next = value.trim();
              setSubtasks(list => next
                ? updateSubtask(list, sub.id, { title: next })
                : removeSubtask(list, sub.id));
            }}
            onToggle={sub => setSubtasks(list => toggleSubtask(list, sub.id))}
            onRemove={sub => setSubtasks(list => removeSubtask(list, sub.id))}
            newValue={newSubtask}
            onNewInput={setNewSubtask}
            onNewCommit={addPendingSubtask}
          />
        </div>

        <div className="mt-5">
          <SectionTitle>Notes</SectionTitle>
          <NotesInput value={notes} onChange={setNotes} />
        </div>
      </MainColumn>

      <Rail>
        {lists && lists.length > 0 && (
          <Field label="List">
            <ListPicker lists={lists} value={listId} onSelect={setListId} align="left" />
          </Field>
        )}

        <Field label="Priority">
          <PriorityPicker priority={priority} onSelect={setPriority} align="left">
            <Value>
              <PriorityIcon priority={priority} size={13} />
              {priorityMeta(priority).label}
            </Value>
          </PriorityPicker>
        </Field>

        <Field label="Due">
          <DatePicker value={dueDate} onSelect={setDueDate} label="Due date" align="left">
            <Value empty={!dueDate}>
              <CalendarDays size={14} className="text-gray-400" />
              {dueDate ? formatDateLong(dueDate) : 'No due date'}
            </Value>
          </DatePicker>
        </Field>

        <Field label="Difficulty">
          <HardToggle value={hard} onToggle={setHard} size={14} showLabel />
        </Field>

        <Field label="Tag">
          <span className="-ml-0.5">
            <TagPicker value={tag} onSelect={setTag} align="left" />
          </span>
        </Field>

        {/* Planning fields, only where planning is the job: see the same gate
            on the editor next door. Opening this box from /today with a day
            already chosen keeps that choice through "Create more", because a
            planning session writes several tasks onto the same day. */}
        {planning && (
          <div className="mt-3 pt-3 border-t border-gray-200/70">
            <Field label="Estimate">
              <EstimatePicker value={estimate} onSelect={setEstimate} align="left">
                <Value empty={!estimate}>
                  <Timer size={14} className="text-gray-400" />
                  {estimateMeta(estimate)?.label || 'No estimate'}
                </Value>
              </EstimatePicker>
            </Field>

            <Field label="Planned day">
              <DatePicker value={plannedDate} onSelect={setPlannedDate} label="Planned day" align="left">
                <Value empty={!plannedDate}>
                  <CalendarCheck size={14} className="text-gray-400" />
                  {plannedDate ? formatDateLong(plannedDate) : 'Not planned'}
                </Value>
              </DatePicker>
            </Field>

            {plannedDate && (
              <Field label="That day">
                <DailyPriorityToggle value={dailyPriority} onChange={setDailyPriority} />
              </Field>
            )}
          </div>
        )}
      </Rail>
    </DialogShell>
  );
}
