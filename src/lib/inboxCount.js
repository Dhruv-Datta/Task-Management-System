'use client';

/*
  HOW MANY THOUGHTS ARE WAITING, so the app bar can say so.

  The number is the whole reason the inbox works. Capture is free, which means
  the pile grows without you noticing, and a pile you don't notice is a pile you
  never come back to. A badge on the tab is the reminder — the same one an email
  client gives you, for the same reason.

  It is a module-level store rather than state on a page, because the two things
  that know it are on opposite sides of the layout: /inbox changes it (a
  capture, a filing, a delete) and the Navbar draws it. Read through
  useSyncExternalStore, like lib/taskView.js, so the server render and the first
  client render agree — they agree on `null`, which means "not known yet" and
  draws no badge at all, rather than on `0`, which would flash "inbox empty"
  over an inbox that is not.

  The page pushes the exact number as it works, so the badge tracks a capture or
  a filing immediately and no write costs a round trip to re-count.
*/

import { useEffect, useSyncExternalStore } from 'react';
import { fetchInboxCount } from './tasksApi';

let count = null;         // null = not known yet
let loading = false;      // one fetch, however many components ask
const listeners = new Set();

function subscribe(onChange) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot() {
  return count;
}

// Nothing to count on the server: the number is per-account data behind a
// session, and the badge appears a beat after hydration.
function getServerSnapshot() {
  return null;
}

/** The count, as the page now knows it to be. */
export function setInboxCount(next) {
  const value = Math.max(0, Math.round(Number(next) || 0));
  if (value === count) return;
  count = value;
  listeners.forEach(fn => fn());
}

/*
  Ask the server. Swallows its failure on purpose: a badge that cannot be
  fetched is a missing badge, not a broken page, and everything that actually
  matters about the inbox is reported by the page itself.
*/
export async function refreshInboxCount() {
  if (loading) return;
  loading = true;
  try {
    setInboxCount(await fetchInboxCount());
  } catch {
    // Leave the last known number (or none) standing.
  } finally {
    loading = false;
  }
}

/** `null` until it is known; a number after that. */
export function useInboxCount() {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Once per page load, from whoever asks first. Later changes come from the
  // page, which knows the answer without asking.
  useEffect(() => { if (count === null) refreshInboxCount(); }, []);
  return value;
}
