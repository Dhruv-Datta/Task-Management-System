'use client';

/*
  RIGHT-CLICK A BLOCK: what it is called, what it says, what kind of thing it is,
  and — where it applies — the one destructive thing you can do to it.

  The tag row is Google Calendar's own menu, deliberately: a row of coloured
  pills with the names you gave them. That is not imitation for its own sake —
  the tags ARE Google's event labels (see lib/googleEvents), so a menu that
  looked like something else would be a second vocabulary for the same six
  words, and you would have to remember which of your two calendars you were
  currently looking at.

  WHY A RIGHT-CLICK, when everything else on this grid is a drag. Because the
  block is already saturated with gestures: press and move, press the top edge,
  press the bottom edge, click to open, press the × to unschedule. There is no
  room left on it for "and also change what this is", and a seventh affordance
  drawn on a fourteen-pixel strip would be a smudge. A context menu is the one
  place a calendar has always kept its second sentence, and the pointer is
  already on the thing it is about.

  THE NAME IS THE FIELD, rather than a Rename button that opens one. A menu item
  called Rename is a promise that something else will happen next, and what
  happens next is an input appearing exactly where the name already was — so the
  name is that input from the start. Click it and type. The description under it
  works the same way and is there for the same reason: it is one more thing the
  block is, not an action you take on it, and both of them read as what they
  are before you touch them.

  Everything else here — portalled to <body>, closing on Escape or an outside
  click, capture phase so a dialog underneath cannot swallow either — is the
  same contract as MenuPortal, whose anchored placement is the one thing that
  does not apply: this opens AT THE POINTER, which is what says it is about the
  block you just pressed and not about the page.
*/

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Tag, Trash2 } from 'lucide-react';
import { OVERLAY_Z } from '@/components/tasks/TaskPickers';
import { inkOn } from '@/lib/colors';

const WIDTH = 268;
/* Kept off the edge of the window, so a menu opened on the last block of the
   evening is not half underneath the taskbar. */
const MARGIN = 8;

/*
  One tag, drawn as the pill Google draws it as: the colour first and big enough
  to recognise across the menu, the name beside it in ordinary text.

  The SELECTED one is not a tick in a distant column but the pill itself filled
  in its own colour, because the question this menu answers is "what colour is
  this hour", and answering it in the colour is one glance rather than two.
*/
function TagPill({ label, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={selected ? `${label.name} — click to take it off` : `Tag as ${label.name}`}
      style={selected
        ? { backgroundColor: label.backgroundColor, color: inkOn(label.backgroundColor) }
        : undefined}
      className={`inline-flex items-center gap-1.5 max-w-full text-[12px] font-medium rounded-full pl-1.5 pr-2.5 py-[3px] border transition-colors ${
        selected
          ? 'border-transparent shadow-sm'
          : 'border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
      }`}
    >
      <span
        aria-hidden
        className="w-[11px] h-[11px] rounded-full flex-shrink-0 border border-black/10"
        style={{ backgroundColor: label.backgroundColor }}
      />
      <span className="truncate">{label.name}</span>
      {selected && <Check size={11} strokeWidth={3} className="flex-shrink-0 -mr-0.5" />}
    </button>
  );
}

const FIELD = 'w-full text-gray-800 bg-white border border-gray-300 rounded-lg px-2 py-1 outline-none '
  + 'focus:ring-1 focus:ring-emerald-500/40 resize-none';

/**
 * @param point       where the pointer was: { x, y } in viewport coordinates.
 * @param title       what it is called now.
 * @param description what it says now, or ''.
 * @param labels      the tags this block may take — the ones on the calendar it
 *                    will be written to, and never a mixture (an id from another
 *                    calendar is an id the write would reject).
 * @param labelId     the tag it carries now, or null.
 * @param onRename    (title) → present only where a rename can actually land.
 * @param onDescribe  (text) → likewise; '' is a real value and clears it.
 * @param onDelete    present only where a delete can land; always last.
 * @param readOnlyNote  why the words cannot be edited, when they cannot.
 * @param note        one line of why something else is missing: a read-only
 *                    calendar, no tags defined yet, one occurrence of a repeat.
 */
export default function BlockMenu({
  point, title, subtitle, description = '', labels = [], labelId = null,
  note = null, readOnlyNote = null,
  onTag, onRename, onDescribe, onDelete, onClose,
}) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  /*
    WHICH FIELD IS OPEN, and what is in it — one at a time, because both are the
    same object's words and editing them at once is a form, which this is not.

    `null` is the resting state: both read as text, and the menu is a menu. It
    is deliberately not "always two inputs", which would make a right-click on a
    block you only wanted to recolour look like a dialog box.
  */
  const [editing, setEditing] = useState(null);   // null | 'title' | 'description'
  const [draft, setDraft] = useState('');

  const open = (field, value) => { setDraft(value || ''); setEditing(field); };

  /*
    COMMITTING, and why it is a ref.

    An edit is saved by clicking away from it, which is the same gesture that
    dismisses the menu — so the outside-click handler has to save before it
    closes, and it is a listener installed once that would otherwise be holding
    a stale copy of the draft. The ref is how the handler reaches the CURRENT
    one. Without it, typing a name and clicking on the calendar would lose it,
    which is the single worst thing a click-to-edit field can do.
  */
  const commit = useCallback(() => {
    if (editing === 'title') {
      const name = draft.trim();
      if (name && name !== title) onRename(name);
    } else if (editing === 'description') {
      if (draft !== description) onDescribe(draft);
    }
    setEditing(null);
  }, [description, draft, editing, onDescribe, onRename, title]);

  const commitRef = useRef(commit);
  useEffect(() => { commitRef.current = commit; });

  /*
    Placed after it has been drawn, because how far it would hang off the bottom
    depends on how many tags you have and whether a field is open — neither of
    which anything knows until it has been laid out. Measured, then flipped: up
    when there is no room below, left when there is none to the right, the two
    corrections every context menu makes.
  */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(MARGIN, Math.min(point.x, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(point.y, window.innerHeight - height - MARGIN)),
    });
    // `editing` is in here because opening a field changes the menu's height,
    // and a menu that grew off the bottom of the screen is one you cannot
    // finish typing in. Not `draft`: repositioning on every keystroke would
    // make the box crawl up the screen as you type.
  }, [point.x, point.y, editing, labels.length]);

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      // Save first, then close. See `commitRef`.
      commitRef.current();
      onClose();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // Escape backs out of the field first and the menu second, which is the
      // order everything else escapes in — and it CANCELS the edit, because
      // that is the one word Escape has ever meant.
      setEditing(prev => {
        if (prev === null) onClose();
        return null;
      });
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  const editable = !!onRename;
  const describable = !!onDescribe;

  return createPortal(
    <div
      ref={ref}
      data-task-overlay
      // Right-clicking the menu itself is not a second context menu.
      onContextMenu={e => e.preventDefault()}
      style={{
        position: 'fixed',
        width: WIDTH,
        left: pos ? pos.left : point.x,
        top: pos ? pos.top : point.y,
        // Drawn but not seen until it has been measured, so it cannot flash in
        // the wrong corner for one frame on its way to the right one.
        visibility: pos ? 'visible' : 'hidden',
        zIndex: OVERLAY_Z.menu,
      }}
      className="bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden animate-scale-in"
    >
      <div className="px-3 pt-2.5 pb-2.5 border-b border-gray-100">
        {editing === 'title' ? (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
            className={`${FIELD} text-[12.5px] font-semibold`}
          />
        ) : (
          /*
            A button, not a heading with a click handler: it is focusable, it
            takes Enter, and it says out loud that it does something — which is
            the whole of what the Rename item used to be for.
          */
          <button
            type="button"
            disabled={!editable}
            onClick={() => open('title', title)}
            title={editable ? 'Click to rename' : (readOnlyNote || undefined)}
            className={`block w-full text-left text-[12.5px] font-semibold text-gray-800 truncate rounded-lg -mx-1 px-1 py-[3px] transition-colors ${
              editable ? 'hover:bg-gray-100 cursor-text' : 'cursor-default'
            }`}
          >
            {title}
          </button>
        )}

        {subtitle && <p className="mt-0.5 px-0.5 text-[11px] text-gray-400 truncate">{subtitle}</p>}

        {/*
          THE DESCRIPTION, under the name, in the shape it will have when you
          are done with it. Empty, it is one grey line of placeholder rather
          than an open box: a right-click on a block you only meant to recolour
          should not look like a form waiting to be filled in.
        */}
        {editing === 'description' ? (
          <textarea
            autoFocus
            rows={4}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            // Enter is a NEW LINE here and not a save, because this is the field
            // that is allowed to have more than one. Click away, or press
            // Escape to throw it away.
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
            }}
            placeholder="Anything worth remembering about it…"
            className={`${FIELD} mt-2 text-[12px] leading-[17px]`}
          />
        ) : (
          <button
            type="button"
            disabled={!describable}
            onClick={() => open('description', description)}
            title={describable ? 'Click to edit' : (readOnlyNote || undefined)}
            className={`block w-full text-left mt-1.5 text-[12px] leading-[17px] rounded-lg -mx-1 px-1 py-[3px] transition-colors ${
              describable ? 'hover:bg-gray-100 cursor-text' : 'cursor-default'
            } ${description ? 'text-gray-600 whitespace-pre-wrap line-clamp-4' : 'text-gray-400'}`}
          >
            {description || (describable ? 'Add a description…' : 'No description')}
          </button>
        )}

        {/* Why the words above are not yours to change. Said once, under both
            of them, rather than twice in two tooltips nobody hovers over — and
            said whenever EITHER is inert, since a truncated description locks
            only itself and leaves the name above it perfectly editable. */}
        {readOnlyNote && (!editable || !describable) && (
          <p className="mt-1.5 text-[11px] text-gray-400 leading-snug">{readOnlyNote}</p>
        )}
      </div>

      <div className="px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
          <Tag size={10} strokeWidth={2.5} />
          Tag
        </p>

        {labels.length === 0 ? (
          <p className="text-[11.5px] text-gray-400 leading-snug">
            {note || 'No tags on this calendar yet. Make some in Google Calendar and they show up here.'}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {labels.map(label => (
                <TagPill
                  key={label.id}
                  label={label}
                  selected={label.id === labelId}
                  /* Pressing the tag it already has takes it off, the way every
                     toggle in this app does — otherwise "none" would need a
                     seventh pill nobody would look for. */
                  onSelect={() => { onTag(label.id === labelId ? null : label.id); onClose(); }}
                />
              ))}
            </div>

            {/* Said in words as well, because a tag you have to know to click
                twice to remove is a tag you cannot remove. */}
            {labelId && (
              <button
                type="button"
                onClick={() => { onTag(null); onClose(); }}
                className="mt-2 text-[11.5px] font-semibold text-gray-400 hover:text-gray-700 transition-colors"
              >
                No tag
              </button>
            )}
          </>
        )}

        {note && labels.length > 0 && (
          <p className="mt-2 text-[11px] text-gray-400 leading-snug">{note}</p>
        )}
      </div>

      {onDelete && (
        <div className="border-t border-gray-100 py-1">
          <button
            type="button"
            onClick={() => { onDelete(); onClose(); }}
            className="w-full text-left px-3 py-1.5 text-[13px] text-gray-600 flex items-center gap-2 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      )}
    </div>,
    document.body
  );
}
