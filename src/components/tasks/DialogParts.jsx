'use client';

/*
  The shape both task dialogs are built from: the one that writes a task and the
  one that edits it.

  They are the same object at two moments in its life, so they are the same
  dialog: a centred box over a blurred page, the work on the left, its properties
  in a rail on the right, its status in the header. Writing a task and changing
  one shouldn't feel like two different tools, and when the parts live here that
  can't quietly drift apart.
*/

import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, X } from 'lucide-react';
import { OVERLAY_Z } from './TaskPickers';

/** Backdrop, box, header, body, footer. Children are the body's columns. */
export function DialogShell({ onDismiss, header, footer, children, width = 'max-w-[880px]' }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    // The page behind stays visible but goes out of focus: you are on top of a
    // task, not somewhere else.
    <div
      /* Portalled to <body>, so a surface that closes on an outside click needs
         telling that a click in here is not "the page". Same mark MenuPortal
         carries. */
      data-task-overlay
      style={{ zIndex: OVERLAY_Z.dialog }}
      className="fixed inset-0 flex items-center justify-center px-4 py-[5vh] bg-gray-900/25 backdrop-blur-[3px]"
      onMouseDown={onDismiss}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        className={`w-full ${width} max-h-full bg-white rounded-2xl border border-gray-200 shadow-2xl flex flex-col overflow-hidden animate-scale-in`}
      >
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 flex-shrink-0">
          {header}
        </div>
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">{children}</div>
        {footer && (
          <div className="px-5 py-2.5 border-t border-gray-100 flex items-center gap-3 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/** The left column: what you write and tick off. */
export function MainColumn({ children }) {
  return <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5">{children}</div>;
}

/** The right column: what the task IS, glanced at rather than read. */
export function Rail({ children }) {
  return (
    <div className="w-full md:w-[248px] flex-shrink-0 overflow-y-auto border-t md:border-t-0 md:border-l border-gray-100 bg-gray-50/60 px-4 py-4">
      {children}
    </div>
  );
}

// One property in the rail: its name, then its value under it. The rail is
// narrow, so the label sits above rather than stealing half the width.
export function Field({ label, children }) {
  return (
    <div className="py-1.5">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">
        {label}
      </span>
      <div className="flex items-center gap-1.5 flex-wrap">{children}</div>
    </div>
  );
}

// The shared look of every editable value: no border, a hover surface, and text
// that greys out when there's nothing set yet.
export function Value({ empty = false, children }) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-sm px-2 py-1 -ml-2 rounded-lg hover:bg-gray-100 transition-colors ${
        empty ? 'text-gray-400' : 'text-gray-700'
      }`}
    >
      {children}
    </span>
  );
}

export function SectionTitle({ children, trailing }) {
  return (
    <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
      {children}
      {trailing}
    </h4>
  );
}

/**
 * The title, as tall as it needs to be. It fits itself on mount as well as on
 * every keystroke, because without the mount pass, a title long enough to wrap opens
 * showing one line and hides the rest until you happen to type in it.
 */
export function TitleInput({ value, onChange, onBlur, onEnter, placeholder, done = false, autoFocus = false }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      autoFocus={autoFocus}
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter?.(e); }
      }}
      rows={1}
      placeholder={placeholder}
      className={`w-full text-xl font-semibold bg-transparent outline-none resize-none leading-snug placeholder-gray-300 ${
        done ? 'text-gray-400 line-through' : 'text-gray-900'
      }`}
      style={{ overflow: 'hidden' }}
    />
  );
}

/**
 * The subtask checklist. Fully controlled: the caller decides what a title reads
 * as and what committing one means (a local edit in the new-task box, a
 * version-guarded patch in the editor) while the rows themselves are defined
 * once, here, so a checklist is a checklist wherever you meet it.
 */
export function SubtaskChecklist({
  subtasks,
  titleOf = sub => sub.title,
  onTitleInput, onTitleCommit, onToggle, onRemove,
  newValue, onNewInput, onNewCommit,
}) {
  return (
    <div className="space-y-0.5">
      {subtasks.map(sub => (
        <div key={sub.id} className="group flex items-center gap-2 px-2 py-1 -mx-2 rounded-lg hover:bg-gray-50 transition-colors">
          <button
            type="button"
            onClick={() => onToggle(sub)}
            title={sub.done ? 'Mark not done' : 'Mark done'}
            className={`w-[17px] h-[17px] rounded-[5px] border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
              sub.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 hover:border-emerald-400'
            }`}
          >
            {sub.done && <Check size={11} strokeWidth={3} />}
          </button>
          <input
            value={titleOf(sub)}
            onChange={e => onTitleInput(sub, e.target.value)}
            onBlur={e => onTitleCommit(sub, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
            className={`flex-1 min-w-0 bg-transparent text-sm outline-none ${sub.done ? 'text-gray-400 line-through' : 'text-gray-700'}`}
          />
          <button
            type="button"
            onClick={() => onRemove(sub)}
            title="Remove subtask"
            className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-300 hover:text-red-500 transition-all"
          >
            <X size={12} />
          </button>
        </div>
      ))}

      <div className="flex items-center gap-2 px-2 py-1 -mx-2 rounded-lg focus-within:bg-gray-50 transition-colors">
        <Plus size={13} className="text-gray-300 flex-shrink-0" />
        <input
          value={newValue}
          onChange={e => onNewInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && newValue.trim()) { e.preventDefault(); onNewCommit(); }
          }}
          placeholder="Add a subtask…"
          className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-300 outline-none"
        />
      </div>
    </div>
  );
}

/** How many of a checklist are done, as the badge beside its heading. */
export function SubtaskCount({ done, total }) {
  if (!total) return null;
  return (
    <span className={`text-[10px] font-bold tracking-normal rounded-full px-1.5 py-0.5 ${
      done === total ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
    }`}>
      {done}/{total}
    </span>
  );
}

/** The notes box, in both dialogs. */
export function NotesInput({ value, onChange, onBlur, rows = 5 }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder="Context, links, what 'done' means…"
      rows={rows}
      spellCheck
      className="w-full text-sm text-gray-700 placeholder-gray-300 bg-gray-50 border border-transparent rounded-xl px-3 py-2 outline-none hover:bg-gray-100/70 focus:bg-white focus:border-gray-200 focus:ring-1 focus:ring-emerald-500/40 resize-y transition-colors"
    />
  );
}
