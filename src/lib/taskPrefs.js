'use client';

import { useSyncExternalStore } from 'react';
import { CLUSTER_BY, GROUP_BY, SORT_BY } from './tasks';

/*
  How you like to LOOK at a list: what the list view's sections are, and how a
  board column gathers its cards inside itself.

  Both of these used to be component state, which meant the page forgot them the
  moment you left it: you grouped by priority, went to Today, came back, and it
  was by status again. Nothing about that is a per-visit decision. They are
  standing preferences, exactly like which view you are in, so they are kept the
  way lib/taskView.js keeps that one: in localStorage, read through
  useSyncExternalStore so the first (hydrating) render still matches what the
  server rendered, and the stored value arrives a beat later.

  Deliberately NOT saved to the database. This is how one browser likes to read
  the page, not a fact about the work, and it should not follow you onto a
  screen of a different size.
*/

// Distinct from any stored value, including `null`, which is what "no grouping"
// legitimately reads as on the board.
const UNREAD = Symbol('unread');

function choice(storageKey, normalize) {
  let current = UNREAD;
  const listeners = new Set();

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    get() {
      if (current === UNREAD) {
        try {
          current = normalize(window.localStorage.getItem(storageKey));
        } catch {
          // Private mode, storage disabled. The default is a fine answer.
          current = normalize(null);
        }
      }
      return current;
    },
    server() {
      return normalize(null);
    },
    write(next) {
      const value = normalize(next);
      if (value === current) return;
      current = value;
      try {
        if (value === null) window.localStorage.removeItem(storageKey);
        else window.localStorage.setItem(storageKey, value);
      } catch {
        // Not being able to remember the choice shouldn't stop us making it.
      }
      listeners.forEach(fn => fn());
    },
  };
}

// A stored key that no longer exists (a renamed axis, a hand-edited value) reads
// as the default rather than as a section nothing can ever land in.
const groupByStore = choice('tasks.groupBy', value => (
  GROUP_BY.some(g => g.key === value) ? value : 'status'
));

// `null` is a real answer here: the board's columns are the statuses, and "no
// grouping" is the plain column.
const clusterByStore = choice('tasks.clusterBy', value => (
  CLUSTER_BY.some(c => c.key === value) ? value : null
));

// The order inside those sections. Always something, and the something it
// defaults to is the order the list has always read in.
const sortByStore = choice('tasks.sortBy', value => (
  SORT_BY.some(o => o.key === value) ? value : 'priority'
));

/** What the list view's sections are. Always something; defaults to status. */
export function useGroupBy() {
  const groupBy = useSyncExternalStore(groupByStore.subscribe, groupByStore.get, groupByStore.server);
  return [groupBy, groupByStore.write];
}

/** How a board column gathers its cards, or `null` for one plain column. */
export function useClusterBy() {
  const clusterBy = useSyncExternalStore(clusterByStore.subscribe, clusterByStore.get, clusterByStore.server);
  return [clusterBy, clusterByStore.write];
}

/*
  THE LIST YOU LAST FILED A THOUGHT INTO.

  Triage is a pass, not a decision per item: nine of the ten things you catch on
  a Tuesday belong in the same list, so the tenth is the one worth a tap. The
  card opens on whatever the last one went to, and File is one press.

  Free-form rather than a fixed set, because the value is a list id and the
  lists are yours. A list since deleted reads as a list that isn't there, which
  the card falls back out of on its own.
*/
const lastFiledListStore = choice('inbox.lastList', value => value || null);

/** What the list reads in order of: 'priority' (the default) or 'due'. */
export function useSortBy() {
  const sortBy = useSyncExternalStore(sortByStore.subscribe, sortByStore.get, sortByStore.server);
  return [sortBy, sortByStore.write];
}

/** Which list the inbox's triage card opens on, or `null` before you file one. */
export function useLastFiledList() {
  const listId = useSyncExternalStore(
    lastFiledListStore.subscribe, lastFiledListStore.get, lastFiledListStore.server
  );
  return [listId, lastFiledListStore.write];
}
