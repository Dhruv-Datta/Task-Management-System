'use client';

/*
  STAGE TWO: the pile, decided.

  Capture asked one question. This is where the rest get asked, but in a pass,
  all at once, which is the only arrangement in which answering them is cheap.

  The card is WHAT YOU WROTE, four controls, and a button. The writing comes
  first and is borderless, so the title and the description read as one block of
  prose rather than as two form fields; the description is one line high until
  you use it, because most thoughts do not need one and a five-row box sitting
  empty on every card is five rows of nothing on a phone.

  NOTHING HERE IS A DRAFT. Every answer is written to the row as you give it, so
  collapsing the card, switching stages or reloading the page all leave it
  exactly as you left it. The one exception is the list, which is what Save
  itself writes; TriageCard below has the whole of why.

  The controls are laid out by how often each is touched, not by how important
  each sounds:

    list       a menu. Almost always already right (it opens on the one you
               saved the last thing into), and a menu holds thirteen lists
               without becoming four rows of chips.
    priority   four marks in one recessed group (PriorityBar, shared with both
               task dialogs), quietest on the left, loudest on the right.
    hard       the flag, exactly as it is drawn everywhere else in the app: this
               one is going to be a fight. Not how important and not how long,
               which are the two fields either side of it.
    due        the only field that gets chips, because its answers are dates and
               a date has to be readable to be chosen. Tapping the chosen one
               again clears it, which is why there is no "None".

  No field labels. Coloured dots and list names, priority marks, a red flag and
  two day chips are each unmistakable as the thing they are, and four uppercase
  captions above them were four lines of furniture.

  ONE CARD OPEN AT A TIME, with the rest as one-line rows under it. Saving
  removes the card and opens the next, so a pass is: Save, Save, Save.

  OLDEST FIRST, because a captured thought decays. Capture shows the same pile
  newest-first for the opposite reason (see lib/inbox.js).
*/

import { useCallback, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { capturedAgo, filePayload, quickDues } from '@/lib/inbox';
import { formatDateLong, todayISO } from '@/lib/dates';
import { DatePicker, HardToggle, LIST_MENU_HEIGHT, MenuPortal, PriorityBar } from '@/components/tasks/TaskPickers';
import ConfirmDelete from './ConfirmDelete';

/*
  A date, offered. Chips are buttons that are either the answer or not, and a
  chosen one goes solid; pressing it again takes the date off, so clearing is
  the same gesture as setting and needs no button of its own.
*/
function Chip({ active, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 h-10 sm:h-9 px-3 rounded-full border text-[13px] font-semibold whitespace-nowrap transition-colors ${
        active
          ? 'bg-gray-900 border-gray-900 text-white'
          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

// Which list it is going to. A menu rather than chips: it is right by default
// far more often than it is wrong, and it has to hold as many lists as you own.
function ListMenuButton({ lists, value, onSelect }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const current = lists.find(l => l.id === value) || lists[0];

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        title="List"
        className="inline-flex items-center gap-2 min-w-0 h-10 sm:h-9 pl-3 pr-2 rounded-xl border border-gray-200 bg-white text-[13.5px] font-semibold text-gray-800 hover:border-gray-300 hover:bg-gray-50 transition-colors"
      >
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: current?.color || '#94a3b8' }} />
        <span className="truncate max-w-[38vw] sm:max-w-[200px]">{current?.name || 'No list'}</span>
        <ChevronDown size={14} className="text-gray-400 shrink-0" />
      </button>
      {open && (
        <MenuPortal
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          align="left"
          width={230}
          maxHeight={LIST_MENU_HEIGHT}
          fit={LIST_MENU_HEIGHT}
        >
          {lists.map(list => (
            <button
              key={list.id}
              type="button"
              onClick={() => { onSelect(list.id); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 transition-colors ${
                list.id === current?.id ? 'font-semibold text-gray-900' : 'text-gray-600'
              }`}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: list.color }} />
              <span className="truncate">{list.name}</span>
            </button>
          ))}
        </MenuPortal>
      )}
    </>
  );
}

/*
  ONE THOUGHT, being decided.

  EVERY ANSWER IS WRITTEN THE MOMENT YOU GIVE IT. Priority, the due date, the
  flag, the title and the description all go straight to the row, the way the
  task editor next door works and for the same reason: a field you set, and then
  lost by collapsing the card or reloading the page, is a field you stop
  trusting. The card holds no copy of them — it reads them back off `task`, so
  what is on screen is what the database has.

  Which is possible because a thought is ALREADY A ROW while it sits in the
  inbox (lib/inbox.js). It is not a form waiting to become one, so it can be
  edited in place like anything else.

  THE LIST IS THE EXCEPTION, and it has to be: `list_id` is the field that takes
  a thought OUT of the inbox, so writing it the moment you pressed it would file
  the thought before you had finished deciding anything else about it. It is not
  a field of the task here; it is the destination of the Save button. It is held
  by the page (so it survives collapsing the card and switching stages) and it
  starts on whichever list you filed the last thing into, which is what makes
  Save one press for most of a pass.

  The two TEXT fields keep a local draft while you type and commit on blur, so a
  patch landing from another control does not yank the cursor out of a
  half-written sentence.
*/
function TriageCard({ task, lists, listId, onPickList, onPatch, onFile, onDelete }) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes || '');
  const [filing, setFiling] = useState(false);
  const dues = quickDues(todayISO());
  const pickedOffGrid = task.due_date && !dues.some(d => d.iso === task.due_date);

  /*
    Keep the drafts in step with the row WITHOUT throwing away what is being
    typed. Every write bumps `version` and hands this component a fresh row, so
    setting a priority while the cursor is in the description must not rewind
    the description. Only a field whose committed value actually moved is
    adopted, and only while the draft is still that committed value: an edit in
    progress always wins. Done during render rather than in an effect, which
    would commit one frame of the old text before correcting itself.
  */
  const [committed, setCommitted] = useState({ title: task.title, notes: task.notes || '' });
  if (task.title !== committed.title || (task.notes || '') !== committed.notes) {
    if (title === committed.title) setTitle(task.title);
    if (notes === committed.notes) setNotes(task.notes || '');
    setCommitted({ title: task.title, notes: task.notes || '' });
  }

  const commitTitle = () => {
    const next = title.trim();
    // An emptied title is not a rename, it is a slip: the row keeps its own.
    if (!next) { setTitle(task.title); return; }
    if (next !== task.title) onPatch(task.id, { title: next });
  };

  const commitNotes = () => {
    if (notes !== (task.notes || '')) onPatch(task.id, { notes });
  };

  /*
    The description grows with what is in it, and is sized once as it mounts so
    a thought that already has one opens at its full height rather than at one
    line with the rest scrolled out of sight.

    It carries `no-scrollbar` because it is a borderless field sitting under a
    borderless title, and the app's grey scrollbar track down the side of it
    drew a box around a thing that is deliberately not a box. Only the rare
    description long enough to hit the cap scrolls at all, and the caret takes
    you through that one on its own.
  */
  const sizeNotes = useCallback((el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  /*
    Save is the one write that moves the thought. The three fields the controls
    already wrote are read back off the row; the two drafts are sent as they
    stand, which is also what commits them if you press Save without blurring
    out of the box you are typing in.
  */
  const file = () => {
    const payload = filePayload({
      title,
      listId,
      priority: task.priority,
      dueDate: task.due_date,
      hard: task.is_hard,
      notes,
    });
    if (!payload || filing) return;
    setFiling(true);
    onFile(task, payload);
  };

  return (
    <div
      className="p-4 sm:p-5"
      // Cmd/Ctrl+Enter saves from anywhere on the card, which is the one
      // shortcut worth having here.
      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); file(); } }}
    >
      {/* Editable, because capture was fast and fast typing is approximate.
          Enter saves: the title is the last thing you fix before you are done. */}
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={e => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); file(); } }}
        placeholder="What is it?"
        aria-label="Title"
        className="w-full text-[17px] font-semibold text-gray-900 bg-transparent outline-none border-b border-transparent focus:border-gray-200 pb-1"
      />

      {/* Enter is a newline here, not Save: a description is prose, and the one
          field on this card you might want two lines of is this one. Cmd/Ctrl+
          Enter still saves, from the handler on the card.

          16px, and not a pixel under. Below that, iOS Safari zooms the whole
          page the moment the field takes focus, and leaves you pinching back
          out to see the buttons you were about to press. The title above stays
          the louder of the two on weight and colour rather than on size. */}
      <textarea
        ref={sizeNotes}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        onInput={e => sizeNotes(e.target)}
        onBlur={commitNotes}
        rows={1}
        placeholder="Description"
        aria-label="Description"
        spellCheck
        className="mt-2 w-full resize-none no-scrollbar bg-transparent outline-none text-[16px] leading-6 text-gray-600 placeholder:text-gray-300 border-b border-transparent focus:border-gray-200 pb-1"
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ListMenuButton lists={lists} value={listId} onSelect={next => onPickList(task.id, next)} />
        <PriorityBar priority={task.priority} onSelect={p => onPatch(task.id, { priority: p })} />
        {/* The app's own flag, not a lookalike: same icon, same red, same
            filled-when-set, so what you set here is what you will recognise on
            the board tomorrow. */}
        <HardToggle
          value={task.is_hard}
          onToggle={next => onPatch(task.id, { is_hard: next })}
          size={16}
          box="w-10 h-10 sm:w-9 sm:h-9 justify-center rounded-xl border shrink-0"
          className={task.is_hard ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200 hover:border-gray-300'}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {dues.map(d => (
          <Chip
            key={d.key}
            active={task.due_date === d.iso}
            // Pressing the chosen date again is how you take it off.
            onClick={() => onPatch(task.id, { due_date: task.due_date === d.iso ? null : d.iso })}
          >
            {d.label}
          </Chip>
        ))}
        {/* `quick={false}`: this picker's Today and Tomorrow rows are the two
            chips immediately to its left, and offering them twice on one line
            makes the menu look like it holds an answer the chips do not. It
            opens straight onto the month, which is the only thing it is for
            here. */}
        <DatePicker
          value={task.due_date}
          onSelect={d => onPatch(task.id, { due_date: d })}
          label="Due date"
          align="left"
          quick={false}
        >
          <span
            className={`inline-flex items-center gap-1.5 h-10 sm:h-9 px-3 rounded-full border text-[13px] font-semibold whitespace-nowrap transition-colors ${
              pickedOffGrid
                ? 'bg-gray-900 border-gray-900 text-white'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <CalendarDays size={14} />
            {pickedOffGrid && formatDateLong(task.due_date)}
          </span>
        </DatePicker>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <ConfirmDelete
          onConfirm={() => onDelete(task)}
          size={17}
          box="w-11 h-11 sm:w-10 sm:h-10 rounded-xl"
          className="text-gray-400"
        />
        <button
          type="button"
          onClick={file}
          disabled={!title.trim() || !listId || filing}
          className="ml-auto flex items-center gap-2 h-10 px-5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-40 transition-colors"
        >
          <Check size={16} strokeWidth={2.75} />
          Save
        </button>
      </div>
    </div>
  );
}

export default function OrganizeStage({ items, lists, listFor, onPickList, onPatch, onFile, onDelete }) {
  const [picked, setPicked] = useState(null);

  /*
    WHICH CARD IS OPEN is derived, not stored: the one you picked, for exactly
    as long as it is still in the pile, and the top of the queue otherwise.
    Saving the open card takes it out of `items`, so the next one opens on the
    very same render, which is what makes a pass read as Save, Save, Save
    rather than Save, click, Save, click.
  */
  const openId = items.some(t => t.id === picked) ? picked : items[0]?.id ?? null;

  if (items.length === 0) {
    return (
      <div className="flex justify-center py-20 animate-fade-in">
        <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-500 flex items-center justify-center">
          <Check size={24} strokeWidth={2.5} />
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100 overflow-hidden">
        {items.map(task => (
          <div key={task.id}>
            {task.id === openId ? (
              <TriageCard
                task={task}
                lists={lists}
                listId={listFor(task.id)}
                onPickList={onPickList}
                onPatch={onPatch}
                onFile={onFile}
                onDelete={onDelete}
              />
            ) : (
              <button
                type="button"
                onClick={() => setPicked(task.id)}
                aria-expanded={false}
                className="w-full text-left flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-gray-50 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                <span className="flex-1 min-w-0 truncate text-[15px] text-gray-700">{task.title}</span>
                <span className="text-[11px] text-gray-400 tabular-nums whitespace-nowrap shrink-0">
                  {capturedAgo(task)}
                </span>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
