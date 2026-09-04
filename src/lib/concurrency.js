/*
  Optimistic concurrency control (OCC) for task rows.

  The problem it solves: a task is read into the browser, edited, and written
  back. Two tabs (or a phone and a laptop) that both loaded version N would
  otherwise silently overwrite each other: last write wins, one edit gone.

  The mechanism: every row carries a monotonic `version`, maintained by the
  bump_version trigger in supabase/schema.sql. A save is a compare-and-swap:

      UPDATE ... WHERE id = <id> AND version = <baseVersion>

  Postgres row locking makes that atomic, so of two racing saves that both
  started from version N, exactly one lands (row → N+1) and the other matches
  zero rows. The loser gets a VersionConflictError carrying the current row; the
  route turns that into HTTP 409 and the client adopts the fresh row instead of
  clobbering it.

  baseVersion contract (the client echoes it from the last GET / successful
  save): a number guards the write; `undefined` (a caller that never loaded one)
  falls back to a plain unguarded update.

  `values` must NOT include `version`; the trigger owns it.

  Deliberately not `server-only`: it holds no secrets and operates purely on the
  client the caller passes in.
*/

export class VersionConflictError extends Error {
  constructor(current = null) {
    super('version conflict: the row was changed by another writer');
    this.name = 'VersionConflictError';
    this.current = current; // the fresh server row (or null if it vanished)
  }
}

async function fetchCurrent(client, table, match) {
  let q = client.from(table).select('*');
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data } = await q.maybeSingle();
  return data ?? null;
}

/**
 * Version-guarded write of a single row keyed by `match`.
 *
 * @param client            Supabase client
 * @param table             table name
 * @param opts.match        equality key identifying the row, e.g. { id }
 * @param opts.values       column values to write (must NOT include `version`)
 * @param opts.baseVersion  see the contract above
 * @returns the persisted row (including its new `version`)
 * @throws  VersionConflictError on a stale / racing write
 */
export async function versionedWrite(client, table, { match, values, baseVersion }) {
  const guarded = typeof baseVersion === 'number';

  let upd = client.from(table).update(values);
  for (const [k, v] of Object.entries(match)) upd = upd.eq(k, v);
  if (guarded) upd = upd.eq('version', baseVersion);

  const { data, error } = await upd.select('*').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    // Zero rows matched: the row advanced past baseVersion, or was deleted.
    // Both are "reload and look again".
    throw new VersionConflictError(await fetchCurrent(client, table, match));
  }
  return data;
}
