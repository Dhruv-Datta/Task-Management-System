'use client';

/*
  One copy of the tasks, and one way to write one.

  Two pages now hold a list of tasks: /tasks (one list, drawn three ways) and
  /today (every list, arranged by when). What they have in common is not the
  shape of the list but the RULES for changing it: an edit is optimistic, guarded
  by the version the row was loaded at, and reconciled against whatever the
  server says came back. Getting that subtly different in two places is how one
  page starts quietly losing edits the other keeps.

  So the rules live here and the pages own only what they draw. `setTasks` comes
  back out because loading, creating and reordering are each page's own business:
  this hook is the writer, not the store's only door.
*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { plannedPatch, statusPatch } from './tasks';
import { deleteTask, updateTask } from './tasksApi';

export function useTaskStore() {
  const [tasks, setTasks] = useState([]);

  /*
    The last write that did NOT land, or null.

    An optimistic edit that fails rolls back, and a row that silently springs
    back to what it was is the single most confusing thing this app can do: it
    looks exactly like a button that does nothing. The commonest cause is not a
    network at all — it is a database missing a column this release writes (the
    schema is applied by hand), which fails every write of that field forever
    while every read still looks perfectly healthy. So the failure is kept, and
    the pages say it out loud.
  */
  const [writeError, setWriteError] = useState(null);

  // The current list, readable from a callback without making every callback
  // depend on it (which would re-create them on each keystroke). Kept in sync
  // after commit; the callbacks that read it all run from user events, so it is
  // never behind by the time they fire.
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  /*
    One version-guarded save behind every edit. Sends the task's loaded
    `version`; on a 409 it adopts the server's fresh row (rather than clobbering
    an edit made in another tab), on a plain failure it rolls back, and on
    success it stamps the new version so the next edit guards against the right
    row.
  */
  const patchTask = useCallback(async (id, updates) => {
    const before = tasksRef.current.find(t => t.id === id);
    if (!before) return { ok: false, error: 'That task is no longer here.' };

    /*
      Two fields imply others, and both are expanded here so the optimistic row
      matches exactly what the server is about to write. Without this the row
      would jump: it would draw one way for a beat, then re-draw from the
      response.

        status        implies `done` + `completed_at`
        planned_date  implies the rest of the day: clearing it clears the
                      timeline block and the must-do/optional half with it
    */
    let optimistic = updates;
    if (updates.status !== undefined) {
      optimistic = { ...optimistic, ...statusPatch(updates.status) };
    }
    if (updates.planned_date !== undefined) {
      // The same two arguments the server's allow-list passes, and deliberately
      // not `before.daily_priority`: a planned_date arriving without a half of
      // the day means must_do on both sides, and an optimistic row that guessed
      // otherwise would flip a beat later when the response landed.
      optimistic = { ...optimistic, ...plannedPatch(updates.planned_date, updates.daily_priority) };
    }

    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...optimistic } : t));

    let res;
    try {
      res = await updateTask(id, updates, before.version);
    } catch (err) {
      setTasks(prev => prev.map(t => t.id === id ? before : t));
      const error = err?.message || 'The write did not reach the server.';
      setWriteError(error);
      return { ok: false, error };
    }
    // Not a failure: another tab got there first, and adopting its row is the
    // whole point of the guard. Nothing to report.
    if (res.conflict && res.current) {
      setTasks(prev => prev.map(t => t.id === id ? res.current : t));
      return { ok: true, conflict: true };
    }
    if (!res.ok) {
      setTasks(prev => prev.map(t => t.id === id ? before : t));
      const error = res.data?.error || 'The server refused the change.';
      setWriteError(error);
      return { ok: false, error };
    }
    if (res.data?.id) setTasks(prev => prev.map(t => t.id === id ? res.data : t));
    // One good write clears the banner: whatever it was, it is not still true.
    setWriteError(null);
    return { ok: true };
  }, []);

  // Optimistic too, and it puts the whole list back if the delete doesn't land.
  // A row that vanishes and stays vanished while the database still has it is
  // the one failure you would never think to check for.
  const removeTask = useCallback(async (task) => {
    const before = tasksRef.current;
    setTasks(prev => prev.filter(t => t.id !== task.id));
    try {
      await deleteTask(task.id);
    } catch (err) {
      console.error('Failed to delete the task', err);
      setTasks(before);
      setWriteError(err?.message || 'The task could not be deleted.');
    }
  }, []);

  return { tasks, setTasks, tasksRef, patchTask, removeTask, writeError, setWriteError };
}
