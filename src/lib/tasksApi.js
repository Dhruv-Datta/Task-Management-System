// Client calls behind /tasks. Thin wrappers around /api/tasks + /api/lists;
// all shaping and merging lives in lib/tasks.js so this file stays boring.

import { normalizeTasks } from './tasks.js';
import { normalizeDayPlan } from './dayPlan.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function readJson(res) {
  return res.json().catch(() => ({}));
}

/*
  The READS throw on a failed response, rather than handing back an error body
  that normalizeTasks would quietly flatten to []. An empty board and a broken
  database look identical on screen otherwise, which is exactly the confusion
  worth avoiding: the caller catches this and says what went wrong.

  `status` rides along so the caller can tell "not configured yet" (503) from a
  genuine fault.
*/
async function readJsonOrThrow(res) {
  const data = await readJson(res);
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function fetchLists() {
  const res = await fetch('/api/lists');
  return readJsonOrThrow(res);
}

export async function saveListsMeta({ lists, groups, activeListId }) {
  const payload = {};
  if (lists !== undefined) payload.lists = lists;
  if (groups !== undefined) payload.groups = groups;
  if (activeListId !== undefined) payload.activeListId = activeListId;
  return fetch('/api/lists', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

/**
 * A slice of the task list: `{ listId }` is one list, and nothing is
 * everything.
 */
export async function fetchTasks({ listId } = {}) {
  const params = new URLSearchParams();
  if (listId) params.set('list_id', listId);
  const qs = params.toString();
  const res = await fetch(qs ? `/api/tasks?${qs}` : '/api/tasks');
  return normalizeTasks(await readJsonOrThrow(res));
}

export async function createTask(fields) {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(fields),
  });
  const data = await readJson(res);
  return { ok: res.ok, data: res.ok ? normalizeTasks([data])[0] : data };
}

// `baseVersion` is the optimistic-concurrency token the caller loaded for this
// task. On a stale write the server returns 409 { conflict, current }, surfaced
// here as { ok:false, conflict:true, current } so the caller can adopt the fresh
// row instead of clobbering an edit made in another tab.
export async function updateTask(taskId, updates, baseVersion) {
  const res = await fetch('/api/tasks', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ id: taskId, ...updates, baseVersion }),
  });
  const data = await readJson(res);
  if (res.status === 409 && data.conflict) {
    return { ok: false, conflict: true, current: normalizeTasks([data.current])[0], data };
  }
  return { ok: res.ok, data: res.ok && data?.id ? normalizeTasks([data])[0] : data };
}

export async function deleteTask(taskId) {
  return fetch(`/api/tasks?id=${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

// Returns the rows the server wrote, so the caller can adopt their new
// `version`: a dragged card whose version stayed stale would 409 on its next
// edit and lose it.
export async function reorderTasks(items) {
  const res = await fetch('/api/tasks/reorder', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ items }),
  });
  const data = await readJson(res);
  return { ok: res.ok, error: data.error, tasks: normalizeTasks(data.tasks) };
}

// Deleting a list takes its tasks with it. One call, so a long list doesn't
// become a hundred round-trips.
export async function deleteTasksForList(listId) {
  return fetch(`/api/tasks?list_id=${encodeURIComponent(listId)}`, { method: 'DELETE' });
}

/*
  One day's fixed commitments (class, lunch): the things on /today's timeline
  that are not tasks. Read and written a whole day at a time, because that is
  what the timeline draws and there is never a reason to fetch one of them.
*/
export async function fetchDayEvents(date) {
  const res = await fetch(`/api/events?date=${encodeURIComponent(date)}`);
  const data = await readJsonOrThrow(res);
  return Array.isArray(data.events) ? data.events : [];
}

export async function saveDayEvents(date, events) {
  const res = await fetch('/api/events', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ date, events }),
  });
  const data = await readJson(res);
  return { ok: res.ok, events: Array.isArray(data.events) ? data.events : [], error: data.error };
}

/*
  One day's planning state: which step of the flow you are on, which tasks owed
  today you have taken back off it, whether it is finished. Read once when the
  page opens and written on every step, which is a handful of writes a day.
*/
export async function fetchDayPlan(date) {
  const res = await fetch(`/api/day-plan?date=${encodeURIComponent(date)}`);
  const data = await readJsonOrThrow(res);
  return normalizeDayPlan(data.plan);
}

export async function saveDayPlan(date, plan) {
  const res = await fetch('/api/day-plan', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ date, plan }),
  });
  const data = await readJson(res);
  return { ok: res.ok, plan: normalizeDayPlan(data.plan), error: data.error };
}

/*
  GOOGLE CALENDAR, both directions, in two calls.

  `fetchGoogleDay` is asked for on every visit to /today and must never be the
  reason the page fails: the server answers "not configured", "not connected"
  and "access revoked" as ordinary 200s carrying `connected: false`, so the only
  thing that throws here is a real fault — and even then /today catches it and
  keeps its own timeline.

  `pushGoogleDay` returns the day AS IT NOW STANDS, not just a receipt. The
  blocks it has written come back from Google stamped as ours and are dropped
  before they reach the browser, so the timeline redraws showing each thing
  exactly once.
*/
export async function fetchGoogleDay(date, timeZone) {
  const params = new URLSearchParams({ date, tz: timeZone || '' });
  const res = await fetch(`/api/google/day?${params.toString()}`);
  return readJsonOrThrow(res);
}

export async function pushGoogleDay(date, timeZone, items) {
  const res = await fetch('/api/google/day', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ date, tz: timeZone, items }),
  });
  const data = await readJson(res);
  return { ok: res.ok, ...data, error: res.ok ? null : (data.error || 'The day could not be sent.') };
}

export async function disconnectGoogle() {
  const res = await fetch('/api/google', { method: 'DELETE' });
  return readJsonOrThrow(res);
}
