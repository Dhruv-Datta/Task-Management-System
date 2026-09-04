'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_TASK_VIEW, normalizeTaskView } from './navigation';

/*
  Which view of the task list is showing.

  It lives here rather than inside /tasks because the switcher is in the app bar
  and the thing being switched is the page, two components either side of the
  layout, so the state belongs to neither of them.

  It is kept in localStorage, read through useSyncExternalStore: the view you
  work in is a standing preference, not a per-visit decision. That hook is what
  makes reading it SAFE: `getServerSnapshot` hands the server (and the first,
  hydrating client render) the default, and React re-renders with the stored
  value immediately after. Reading localStorage during render instead would
  hydrate as a mismatch; reading it in an effect would be a cascading render.

  The store is module-level rather than a context: there is exactly one task
  view in the app, the same way there is exactly one localStorage.
*/

const STORAGE_KEY = 'tasks.view';

// `null` until first read on the client, since the browser is the source of
// truth and it isn't there to ask until then.
let currentView = null;
const listeners = new Set();

function getSnapshot() {
  if (currentView === null) {
    try {
      currentView = normalizeTaskView(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      // Private mode, storage disabled. The default view is a fine answer.
      currentView = DEFAULT_TASK_VIEW;
    }
  }
  return currentView;
}

// No localStorage on the server, so everyone starts on the default and the
// stored choice arrives a beat later, after hydration.
function getServerSnapshot() {
  return DEFAULT_TASK_VIEW;
}

function subscribe(onChange) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function writeView(next) {
  const key = normalizeTaskView(next);
  if (key === currentView) return;
  currentView = key;
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Not being able to remember the choice shouldn't stop us making it.
  }
  listeners.forEach(fn => fn());
}

export function useTaskView() {
  const view = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // `writeView` is a module function, so it is already stable; no useCallback.
  return { view, setView: writeView };
}
