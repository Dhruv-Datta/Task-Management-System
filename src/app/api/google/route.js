import { getDb } from '@/lib/db';
import { apiJson, withApiError } from '@/lib/apiResponses';
import { clearConnection, readConnection, revokeToken } from '@/lib/googleAuth';
import { forgetPushed } from '@/lib/googleCalendar';

/*
  /api/google: THE CONNECTION ITSELF, as one resource.

  DELETE is the only verb it needs. Whether you are connected, and to which
  account, comes back with the day (/api/google/day) — the page asks that
  question at the same moment it asks for your events, so a separate status
  request would be a second round trip for a fact it is about to be handed
  anyway.

  Disconnecting does three things, in the order that makes each one safe to
  interrupt:

    1. hand the grant back to Google, so this app also disappears from the
       account's own third-party access list. It is not enough to forget a
       token: a token you have forgotten is still a token that works.
    2. drop our copy of it.
    3. forget which Google events we wrote, because they live in an account we
       can no longer reach, and a later reconnect must not try to move events by
       ids that have since been reused or revoked.

  What it deliberately does NOT do is delete the events already in your
  calendar. They are yours; the day happened. Removing a fortnight of blocks
  from someone's calendar because they unhooked an integration is not a cleanup,
  it is data loss with a friendly name.
*/

export async function DELETE() {
  return withApiError(async () => {
    const { supabase } = await getDb();

    const connection = await readConnection(supabase);
    if (connection?.refresh_token) await revokeToken(connection.refresh_token);

    await clearConnection(supabase);
    await forgetPushed(supabase);

    return apiJson({ connected: false, email: null, connectedAt: null });
  });
}
