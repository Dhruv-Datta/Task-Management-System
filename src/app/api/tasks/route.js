import { getDb } from '@/lib/db';
import { apiBadRequest, apiCreated, apiError, apiJson, apiOk, conflictResponse } from '@/lib/apiResponses';
import { versionedWrite, VersionConflictError } from '@/lib/concurrency';
import { DEFAULT_PRIORITY, DEFAULT_STATUS, normalizePriority, normalizeStatus, statusPatch } from '@/lib/tasks';
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

/*
  GET: the tasks, or a slice of them:
    ?list_id=  one list.
    ?tag=      one tag's work, across every list.
*/
export async function GET(req) {
  try {
    const { supabase } = await getDb();
    const { searchParams } = new URL(req.url);
    const listId = searchParams.get('list_id');
    const tag = searchParams.get('tag')?.trim();

    let query = supabase
      .from(TABLE)
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    if (tag) query = query.ilike('tag', tag);
    if (listId) query = query.eq('list_id', listId);

    const { data, error } = await query;
    if (error) return apiError(error);
    return apiJson(data);
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

    // Next slot at the bottom of the list.
    const { data: existing } = await supabase
      .from(TABLE)
      .select('position')
      .eq('list_id', listId)
      .order('position', { ascending: false })
      .limit(1);
    const nextPos = existing?.length ? (existing[0].position || 0) + 1 : 0;

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
