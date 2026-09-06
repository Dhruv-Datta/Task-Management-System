'use client';

/*
  DELETE, ASKED TWICE.

  A captured thought is the one thing in this app with no copy anywhere else:
  it has not been filed, it is not on a board or a day, and it is often the
  only record that you thought it at all. Deleting one by mis-tapping a
  hover-revealed icon — which on a phone is not hover-revealed at all, it is
  simply there — loses it silently and completely.

  So the icon arms rather than fires, and the second press is a button that
  says the word. Deliberately not a modal: a dialog thrown over the screen to
  ask about one line is heavier than the thing it is protecting.

  And no question above the two buttons either. "Delete this thought?" over a
  Cancel and a red Delete is the answer written out twice — the pair of buttons
  IS the question, and on a one-line row the sentence was the only part that
  had to fight for width.

  Cancel is a real button rather than a timeout or an outside-click, because
  both of those leave you unsure whether the armed state is still armed. Both
  are a thumb tall on a phone: two 24px buttons a few pixels apart, one of which
  deletes something unrecoverable, is a mis-tap waiting to happen.
*/

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

export default function ConfirmDelete({ onConfirm, size = 15, box = 'w-10 h-10 sm:w-9 sm:h-9', className = '' }) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        title="Delete"
        aria-label="Delete"
        className={`flex items-center justify-center rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0 ${box} ${className}`}
      >
        <Trash2 size={size} />
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="h-9 sm:h-7 px-3 sm:px-2 rounded-lg text-[12px] sm:text-[11px] font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={() => { setArmed(false); onConfirm(); }}
        className="h-9 sm:h-7 px-3 sm:px-2 rounded-lg text-[12px] sm:text-[11px] font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors"
      >
        Delete
      </button>
    </span>
  );
}
