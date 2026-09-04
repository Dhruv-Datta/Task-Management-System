import { getDb } from '@/lib/db';
import { apiBadRequest, apiError, apiOk } from '@/lib/apiResponses';
import { normalizeStatus, statusPatch } from '@/lib/tasks';

/*
  PATCH: bulk position (and status) updates from a drag on the board layout.

  items: [{ id, position?, status? }]. Dropping a card into another column is a
  status change, so `status` arrives alongside the new positions and is expanded
  through statusPatch. `done` and `completed_at` are re-derived here, never
  taken from the client.

  Deliberately unguarded by `version`: a reorder is a positional nudge, not a
  document edit, and blocking a drag because the task was renamed in another tab
  would be worse than the (harmless) reorder landing.

  It DOES return the rows it wrote, though. Every update bumps `version`, so
  without handing the new ones back the client would hold a stale version for
  every card it just dragged, and the next edit to one of them would 409 and be
  thrown away in favour of the server's copy. The client merges what comes back.
*/

export async function PATCH(req) {
  try {
    const { supabase } = await getDb();
    const { items } = await req.json();

    if (!Array.isArray(items) || items.length === 0) {
      return apiBadRequest('items array is required');
    }

    const results = await Promise.all(
      items.map(({ id, position, status }) => {
        const row = {};
        if (position !== undefined) row.position = position;
        if (status) Object.assign(row, statusPatch(normalizeStatus(status)));
        if (Object.keys(row).length === 0) return { data: null, error: null };
        return supabase
          .from('tasks')
          .update(row)
          .eq('id', id)
          .select('*')
          .maybeSingle();
      })
    );

    const error = results.find(r => r.error)?.error;
    if (error) return apiError(error);
    return apiOk({ ok: true, tasks: results.map(r => r.data).filter(Boolean) });
  } catch (e) {
    return apiError(e);
  }
}
