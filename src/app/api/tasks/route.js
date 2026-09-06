import { getDb } from '@/lib/db';
import { apiBadRequest, apiCreated, apiError, apiJson, apiOk, conflictResponse } from '@/lib/apiResponses';
import { versionedWrite, VersionConflictError } from '@/lib/concurrency';
import { DEFAULT_PRIORITY, DEFAULT_STATUS, normalizePriority, normalizeStatus, statusPatch } from '@/lib/tasks';
import { INBOX_LIST_ID } from '@/lib/inbox';
import { sanitizeWritableFields } from '@/lib/taskWrites';

/*
  /api/tasks: the task list.

  There is one account, so there is no owner column and nothing to scope by:
  this database holds one person's tasks because exactly one person can sign in
  (src/lib/account.js), and every route here is behind a verified session: the
  edge proxy 401s an unauthenticated request before the handler runs, and
  getDb() throws if one ever slipped through.

  Schema: supabase/schema.sql.
*/

const TABLE = 'tasks';

/** The next slot at the bottom of a list. */
async function nextPosition(supabase, listId) {
  const { data } = await supabase
    .from(TABLE)
    .select('position')
    .eq('list_id', listId)
    .order('position', { ascending: false })
    .limit(1);
  return data?.length ? (data[0].position || 0) + 1 : 0;
}

/*
  GET: the tasks, or one list's worth of them with ?list_id=. `?count=1` asks
  for the number rather than the rows, which is what the app bar's inbox badge
  wants — a count of unfiled thoughts, not the thoughts themselves.

  THE INBOX IS HIDDEN UNLESS YOU NAME IT. An unfiled thought is not a task yet
  (see lib/inbox.js): it has no list, no considered priority and no date, and
  every other view in this app would draw it as if it did. So an unscoped read —
  which is what /today and the comprehensive views make — excludes the reserved
  inbox list, and ?list_id=inbox is the one read that returns it.
*/
export async function GET(req) {
  try {
    const { supabase } = await getDb();
    const { searchParams } = new URL(req.url);
    const listId = searchParams.get('list_id');
    const countOnly = searchParams.get('count') === '1';

    let query = countOnly
      ? supabase.from(TABLE).select('id', { count: 'exact', head: true })
      : supabase
          .from(TABLE)
          .select('*')
          .order('position', { ascending: true })
          .order('created_at', { ascending: true });

    query = listId ? query.eq('list_id', listId) : query.neq('list_id', INBOX_LIST_ID);

    const { data, count, error } = await query;
    if (error) return apiError(error);
    return apiJson(countOnly ? { count: count ?? 0 } : data);
  } catch (e) {
    return apiError(e);
  }
}

// POST: create a task (optionally already assigned, dated and prioritized)
export async function POST(req) {
  try {
    const { supabase } = await getDb();
    const body = await req.json();
    const title = String(body.title || '').trim();

    if (!title) return apiBadRequest('Title is required');

    const listId = body.list_id || 'default';
    const nextPos = await nextPosition(supabase, listId);

    const row = {
      ...sanitizeWritableFields(body),
      ...statusPatch(normalizeStatus(body.status ?? DEFAULT_STATUS)),
      title,
      priority: normalizePriority(body.priority ?? DEFAULT_PRIORITY),
      list_id: listId,
      position: nextPos,
      subtasks: Array.isArray(body.subtasks) ? body.subtasks : [],
    };

    const { data, error } = await supabase.from(TABLE).insert(row).select().single();
    if (error) return apiError(error);
    return apiCreated(data);
  } catch (e) {
    return apiError(e);
  }
}

// PUT: update a task (status, priority, dates, notes, subtasks, …)
export async function PUT(req) {
  try {
    const { supabase } = await getDb();
    const body = await req.json();
    const { id, baseVersion } = body;

    if (!id) return apiBadRequest('id is required');

    const updates = sanitizeWritableFields(body);
    if (Object.keys(updates).length === 0) return apiBadRequest('nothing to update');

    /*
      A task that has just CHANGED LISTS carries a `position` that meant
      something in the list it came from and means nothing in the one it has
      landed in — two rows deep in the inbox is row two of Personal, above work
      that has been sitting there for a month. So a move is given the bottom of
      its new list, which is where a task you have only just filed belongs.

      One extra read, on the one write that changes a list. A move that isn't a
      move (the same id it already had) is left alone, so re-saving a task never
      quietly reorders it.
    */
    if (updates.list_id !== undefined && updates.position === undefined) {
      const { data: before } = await supabase.from(TABLE).select('list_id').eq('id', id).maybeSingle();
      if (before && before.list_id !== updates.list_id) {
        updates.position = await nextPosition(supabase, updates.list_id);
      }
    }

    // Version-guarded, so the same task open in two tabs can't lose an edit →
    // canonical 409 on a stale write, which the client reconciles.
    const row = await versionedWrite(supabase, TABLE, {
      match: { id },
      values: updates,
      baseVersion,
    });
    return apiJson(row);
  } catch (e) {
    if (e instanceof VersionConflictError) return conflictResponse(e.current);
    return apiError(e);
  }
}

/*
  DELETE: remove one task (?id=) or a whole list's tasks (?list_id=, which is
  what deleting a list does).
*/
export async function DELETE(req) {
  try {
    const { supabase } = await getDb();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const listId = searchParams.get('list_id');

    if (!id && !listId) return apiBadRequest('id or list_id is required');

    const query = id
      ? supabase.from(TABLE).delete().eq('id', id)
      : supabase.from(TABLE).delete().eq('list_id', listId);

    const { error } = await query;
    if (error) return apiError(error);
    return apiOk();
  } catch (e) {
    return apiError(e);
  }
}
