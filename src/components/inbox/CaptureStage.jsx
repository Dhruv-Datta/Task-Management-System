'use client';

/*
  STAGE ONE: type it, and it is gone.

  This is the whole point of the tab, so it is the whole of the screen: one box,
  one key, nothing asked and nothing explained. Every field this app could ask
  for is asked in Organize instead, on the grounds that a form is a reason not
  to write the thought down at all.

  Four things make it fast enough to actually use:

    · The box KEEPS FOCUS after Enter, so ten thoughts are ten sentences and
      not ten round trips through a mouse.
    · The row appears the instant you press Enter and the save follows it. A
      capture that made you wait would be a capture you stopped trusting.
    · A MULTI-LINE PASTE becomes one task per line (lib/inbox's splitCaptures),
      because the pile you already have is usually a note full of bullets.
    · The box STICKS to the top of the screen as the pile grows under it, so
      the next thought never needs a scroll first.

  On a phone the box is 17px, which is over the 16px below which iOS Safari
  zooms the page on focus: a zoom that then has to be pinched back out before
  you can read anything, on the one screen you came to type on.
*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, RotateCw } from 'lucide-react';
import ConfirmDelete from './ConfirmDelete';
import { capturedAgo } from '@/lib/inbox';

// Rows are one line high and mostly the thought itself; the age and the delete
// button are quiet until the row is under the cursor, so twelve of them read as
// a list of things you thought rather than a table of records.
function CapturedRow({ title, meta, muted = false, children }) {
  return (
    <div className={`group flex items-center gap-3 px-4 py-2.5 min-h-[52px] transition-colors ${muted ? 'opacity-60' : 'hover:bg-gray-50/70'}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
      <span className="flex-1 min-w-0 text-[15px] text-gray-800 break-words">{title}</span>
      {meta && <span className="text-[11px] text-gray-400 tabular-nums whitespace-nowrap shrink-0">{meta}</span>}
      {children}
    </div>
  );
}

export default function CaptureStage({ items, pending, onCapture, onRetry, onDropPending, onDelete }) {
  const boxRef = useRef(null);
  // Only so the send button can stay away until there is something to send.
  // The text itself is the textarea's, uncontrolled, so typing costs no render.
  const [hasText, setHasText] = useState(false);

  // One line to start, growing with what you type. A thought two sentences long
  // should be readable while you are writing it, not scrolling sideways past
  // the left edge of a single-line input.
  const grow = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
    setHasText(el.value.trim().length > 0);
  }, []);

  /*
    Focus on arrival, but only where a keyboard is already there to type on. On
    a phone, stealing focus throws the on-screen keyboard up over the page
    before you have looked at it and scrolls the header out of view; the box is
    the biggest thing on the screen and one tap away.
  */
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)').matches) boxRef.current?.focus();
  }, []);

  const submit = () => {
    const text = boxRef.current?.value ?? '';
    if (!text.trim()) return;
    onCapture(text);
    if (boxRef.current) {
      boxRef.current.value = '';
      grow();
      boxRef.current.focus();
    }
  };

  return (
    <div>
      {/* The box follows you down the page. `top` is the app bar's own height at
          each width, so it parks directly under it rather than overlapping. */}
      <div className="sticky top-16 sm:top-20 z-30 -mx-1 px-1 pt-2 pb-3 bg-white/95 backdrop-blur-md">
        <div className="relative rounded-2xl border-2 border-gray-200 focus-within:border-emerald-500 bg-white shadow-sm transition-colors">
          <textarea
            ref={boxRef}
            rows={1}
            onInput={grow}
            onKeyDown={e => {
              // Enter saves. Shift+Enter is the escape hatch for the rare
              // thought that genuinely wants two lines.
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder="What's on your mind?"
            aria-label="Capture a thought"
            autoComplete="off"
            autoCorrect="on"
            spellCheck={false}
            className="w-full resize-none bg-transparent outline-none pl-4 pr-14 py-3.5 text-[17px] leading-6 text-gray-900 placeholder:text-gray-400"
          />
          {/* Absolute rather than in the flow, so an empty box is only a box and
              the first keystroke doesn't shove the page down by a button. */}
          {hasText && (
            <button
              type="button"
              onClick={submit}
              title="Save (Enter)"
              aria-label="Save"
              className="absolute right-2.5 bottom-2.5 flex items-center justify-center w-10 h-10 sm:w-9 sm:h-9 rounded-xl bg-gray-900 text-white hover:bg-gray-700 transition-colors"
            >
              <ArrowUp size={18} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {(items.length > 0 || pending.length > 0) && (
        <div className="mt-1 rounded-2xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100 overflow-hidden animate-fade-in">
          {/* In flight, and the ones that didn't make it. A capture that failed
              silently would be a thought you believe you have written down and
              have not, which is the one failure this screen cannot afford. */}
          {pending.map(p => (
            <CapturedRow
              key={p.tempId}
              title={p.title}
              muted={!p.error}
              meta={p.error ? null : 'saving'}
            >
              {p.error ? (
                <span className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onRetry(p)}
                    title={p.error}
                    aria-label="Retry"
                    className="flex items-center justify-center w-10 h-10 sm:w-9 sm:h-9 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 transition-colors"
                  >
                    <RotateCw size={15} />
                  </button>
                  {/* This one exists ONLY in this browser: it never reached the
                      server, so discarding it is the one delete with nothing at
                      all to recover from. Asked twice, like the rest. */}
                  <ConfirmDelete onConfirm={() => onDropPending(p)} />
                </span>
              ) : (
                <Loader2 size={13} className="text-gray-400 animate-spin shrink-0" />
              )}
            </CapturedRow>
          ))}

          {items.map(task => (
            <CapturedRow key={task.id} title={task.title} meta={capturedAgo(task)}>
              <ConfirmDelete
                onConfirm={() => onDelete(task)}
                className="sm:opacity-0 group-hover:opacity-100 focus:opacity-100"
              />
            </CapturedRow>
          ))}
        </div>
      )}
    </div>
  );
}
