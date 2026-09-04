'use client';

/*
  Task detail: the task, blown up. The same dialog the new-task box is built from
  (components/DialogParts): the work on the left (title, checklist, notes), its
  properties in a rail on the right, its status in the header. Opening a task
  never navigates, so you keep your place in the list underneath.

  Two columns, not a slide-over, because the two halves are read differently: the
  left is where you write and tick things off and wants the width; the right is a
  reference card you glance at. A single tall column made you scroll past the
  properties to reach the checklist, which is the thing you actually came to
  change.

  The dialog is built out of type and space, not boxes. Every property is an
  invisible control that only draws itself when you point at it, so what you read
  is the task (a name, an owner, two dates) instead of a stack of outlined
  pills. The status lives in the header, where it is both the label and the
  control, rather than being stated twice, and the hard flag sits beside it for
  the same reason: a yes/no with no value to read is a mark, not a labelled row.

  A task's list is not editable here: you are always inside one list, so moving
  work between lists is not something this dialog does. The overview is the one
  place that isn't inside a list, so it passes the task's `list` in and the rail
  states it, read-only, as a fact about the task rather than a control. It
  passes `planning` for the same reason: how long a task takes and which day you
  chose for it are /today's questions, so they appear in the rail there and
  nowhere else.

  Writes go straight out through `onPatch` as you make them (no Save button);
  the page handles optimistic update + version-guarded persistence.
*/

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Trash2, X } from 'lucide-react';
import {
  addSubtask, priorityMeta, removeSubtask, subtaskProgress, toggleSubtask, updateSubtask,
} from '@/lib/tasks';
import { formatDateLong } from '@/lib/dates';
import {
  DailyPriorityToggle, DateChip, DatePicker, HardToggle, PriorityIcon,
  PriorityPicker, StatusChip, StatusPicker,
} from './TaskPickers';
import {
  DialogShell, Field, MainColumn, NotesInput, Rail, SectionTitle, SubtaskChecklist, SubtaskCount,
  TitleInput, Value, ValueIcon,
} from './DialogParts';

export default function TaskDetailPanel({ task, list = null, planning = false, onPatch, onDelete, onClose }) {
  const [title, setTitle] = useState(task?.title || '');
  const [notes, setNotes] = useState(task?.notes || '');
  const [subDrafts, setSubDrafts] = useState({});   // subtask id → title being edited
  const [newSubtask, setNewSubtask] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  /*
    Keep the dialog in step with the row underneath it, WITHOUT throwing away
    what you are in the middle of typing.

    Two different things can bring a new `task` in:

      a different task    you closed one and opened another → reset everything.
      the same task, moved every save bumps `version`, so ticking a subtask
                          hands this component a fresh row while your cursor is
                          still in the title. Only fields whose committed value
                          actually changed are adopted, and only when your local
                          copy is still the committed one: an edit in progress
                          always wins, and closing writes it.

    Done during render rather than in an effect: an effect would commit one frame
    of the previous task's text before correcting itself, which reads as a
    flicker when you move from one task to the next.
  */
  const [committed, setCommitted] = useState({
    id: task?.id,
    title: task?.title || '',
    notes: task?.notes || '',
  });

  if (task && task.id !== committed.id) {
    setCommitted({ id: task.id, title: task.title || '', notes: task.notes || '' });
    setTitle(task.title || '');
    setNotes(task.notes || '');
    setSubDrafts({});
    setNewSubtask('');
    setConfirmDelete(false);
  } else if (task && (task.title !== committed.title || task.notes !== committed.notes)) {
    if (title === committed.title) setTitle(task.title || '');
    if (notes === committed.notes) setNotes(task.notes || '');
    setCommitted({ id: task.id, title: task.title || '', notes: task.notes || '' });
  }

  /*
    Leave the dialog, keeping everything you typed.

    Each field also saves on its own blur, which covers the ordinary case of
    moving from one to the next. It does NOT cover leaving: clicking the backdrop
    or pressing Escape tears the field down before the browser fires blur, and
    what you typed goes with it. So closing collects whatever is still
    outstanding (the title, the notes, a renamed subtask, even a subtask typed
    but never Entered) and writes it.

    One patch, not four. Every write is version-guarded, so four back-to-back
    saves would race: the first bumps the version and the rest 409 against a row
    they no longer match, and are dropped.
  */
  const closeAndSave = useCallback(() => {
    if (!task) { onClose(); return; }
    const updates = {};

    const nextTitle = title.trim();
    if (nextTitle && nextTitle !== task.title) updates.title = nextTitle;
    if (notes !== (task.notes || '')) updates.notes = notes;

    let subtasks = task.subtasks;
    let touched = false;
    for (const sub of task.subtasks) {
      const draft = subDrafts[sub.id];
      if (draft === undefined) continue;
      const next = draft.trim();
      if (next && next !== sub.title) {
        subtasks = updateSubtask(subtasks, sub.id, { title: next });
        touched = true;
      }
    }
    const pending = newSubtask.trim();
    if (pending) {
      subtasks = addSubtask(subtasks, pending);
      touched = true;
    }
    if (touched) updates.subtasks = subtasks;

    if (Object.keys(updates).length > 0) onPatch(task.id, updates);
    onClose();
  }, [task, title, notes, subDrafts, newSubtask, onPatch, onClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeAndSave(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeAndSave]);

  if (!task || typeof document === 'undefined') return null;

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== task.title) onPatch(task.id, { title: next });
    else setTitle(task.title);
  };

  const commitNotes = () => {
    if (notes !== (task.notes || '')) onPatch(task.id, { notes });
  };

  const patchSubtasks = (subtasks) => onPatch(task.id, { subtasks });

  const subtasks = subtaskProgress(task.subtasks);

  return (
    <DialogShell
      onDismiss={closeAndSave}
      header={(
        <>
          {/* The status chip IS the status control. */}
          <StatusPicker status={task.status} onSelect={s => onPatch(task.id, { status: s })} align="left">
            <StatusChip status={task.status} interactive />
          </StatusPicker>
          <button
            onClick={closeAndSave}
            title="Close (Esc)"
            className="ml-auto p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </>
      )}
      footer={(
        <>
          <span className="text-[11px] text-gray-400 truncate">
            {task.created_by ? `Added by ${task.created_by}` : 'Added'}
            {task.created_at ? ` · ${formatDateLong(String(task.created_at).slice(0, 10))}` : ''}
          </span>
          {confirmDelete ? (
            <span className="ml-auto flex items-center gap-1.5">
              <span className="text-[11px] text-gray-400">Delete this task?</span>
              <button onClick={() => setConfirmDelete(false)} className="text-[11px] font-semibold text-gray-500 bg-gray-100 px-2 py-1 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
              {/* Closes without flushing, deliberately: saving edits into a row
                  on its way out is pointless, and racy against the delete. */}
              <button onClick={() => { onDelete(task); onClose(); }} className="text-[11px] font-semibold text-white bg-red-500 px-2 py-1 rounded-lg hover:bg-red-600 transition-colors">Delete</button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="ml-auto p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
              title="Delete task"
            >
              <Trash2 size={14} />
            </button>
          )}
        </>
      )}
    >
      <MainColumn>
        <TitleInput
          value={title}
          onChange={setTitle}
          onBlur={commitTitle}
          onEnter={e => e.target.blur()}
          placeholder="Untitled task"
          done={task.done}
        />

        {/* Subtasks before notes: the checklist is what you came to tick off,
            and notes are as long as they need to be. */}
        <div className="mt-5">
          <SectionTitle trailing={<SubtaskCount done={subtasks.done} total={subtasks.total} />}>
            Subtasks
          </SectionTitle>
          <SubtaskChecklist
            subtasks={task.subtasks}
            titleOf={sub => subDrafts[sub.id] ?? sub.title}
            onTitleInput={(sub, value) => setSubDrafts(d => ({ ...d, [sub.id]: value }))}
            onTitleCommit={(sub, value) => {
              const next = value.trim();
              if (next && next !== sub.title) patchSubtasks(updateSubtask(task.subtasks, sub.id, { title: next }));
            }}
            onToggle={sub => patchSubtasks(toggleSubtask(task.subtasks, sub.id))}
            onRemove={sub => patchSubtasks(removeSubtask(task.subtasks, sub.id))}
            newValue={newSubtask}
            onNewInput={setNewSubtask}
            onNewCommit={() => {
              patchSubtasks(addSubtask(task.subtasks, newSubtask.trim()));
              setNewSubtask('');
            }}
          />
        </div>

        <div className="mt-5">
          <SectionTitle>Notes</SectionTitle>
          <NotesInput value={notes} onChange={setNotes} onBlur={commitNotes} />
        </div>
      </MainColumn>

      <Rail>
        {list && (
          /* Not a control here — the same row shape as its neighbours so the
             rail reads as one column, just without the hover. */
          <Field label="List">
            <span className="flex w-full items-center gap-2.5 min-w-0 px-2 py-[7px] text-[15px] leading-6 font-medium text-gray-700">
              <ValueIcon>
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: list.color }} />
              </ValueIcon>
              <span className="truncate">{list.name}</span>
            </span>
          </Field>
        )}

        {/* Hard rides the priority label, the same place the composer puts it:
            a mark and not a row, because a field whose answer is the words
            "Not hard" spends a third of the rail saying nothing — but on the
            line it belongs to rather than up beside the close button. */}
        <Field
          label="Priority"
          trailing={(
            <HardToggle
              value={task.is_hard}
              onToggle={next => onPatch(task.id, { is_hard: next })}
              size={17}
              box="rounded-md p-1 -my-1 hover:bg-red-50"
            />
          )}
        >
          <PriorityPicker priority={task.priority} onSelect={p => onPatch(task.id, { priority: p })} align="left" full>
            <Value>
              <ValueIcon><PriorityIcon priority={task.priority} size={14} /></ValueIcon>
              {priorityMeta(task.priority).label}
            </Value>
          </PriorityPicker>
        </Field>

        <Field label="Due">
          <DatePicker value={task.due_date} onSelect={d => onPatch(task.id, { due_date: d })} label="Due date" align="left" full>
            <Value empty={!task.due_date}>
              <ValueIcon><CalendarDays size={15} /></ValueIcon>
              <span className="truncate">{task.due_date ? formatDateLong(task.due_date) : 'No due date'}</span>
            </Value>
          </DatePicker>
          {/* How near it is, under the date rather than beside it. Both want
              the width — "Monday, September 8" and "3d late" are the same fact
              in two tenses — and squeezing them onto one 200px line only
              truncates the half that names the day. */}
          {task.due_date && <DateChip iso={task.due_date} done={task.done} className="self-start ml-2" />}
        </Field>

        {/*
          One planning field, and only where planning is what you are doing.
          /today passes `planning`; /tasks passes nothing and the rail is
          unchanged, because /tasks is a place you work ON a body of work and a
          day-planning control there is a second, quieter way to do the thing
          the day's own page is designed for.

          There is no "planned day" picker and no estimate here, and that is the
          same argument twice. Which day a task is on is a decision the day's
          page makes with the day in front of you; a date menu in a dialog is
          the same write with none of the context, and the two of them
          disagreeing is how a task ends up on a Tuesday nobody chose. How long
          it takes is not a number you pick off a menu either — it is the length
          of the block you drag on step 4, which is the one place the answer is
          worth anything, because it is the one place you can see what else has
          to fit around it.
        */}
        {planning && task.planned_date && (
          <div className="mt-3 pt-3 border-t border-gray-200/70">
            <Field label="That day">
              <DailyPriorityToggle
                value={task.daily_priority}
                onChange={half => onPatch(task.id, { daily_priority: half })}
                className="self-start"
              />
            </Field>
          </div>
        )}
      </Rail>
    </DialogShell>
  );
}
