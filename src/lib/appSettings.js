import 'server-only';

/*
  The key/value config table: `app_settings`, one row per `key` with a JSONB
  `value`.

  Two keys use it today: `task_lists` (the lists and which one is open) and
  `people_colors` (chosen avatar colours). Anything small, whole-blob and
  per-account belongs here rather than in a table of its own.

  `value` is JSONB, so PostgREST hands it back already parsed. `coerce()` also
  tolerates a stringified value, so a row someone edited by hand in the Supabase
  table editor can't break a read.
*/

function coerce(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/** Read one setting. */
export async function readSetting(supabase, key, fallback = null) {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return coerce(data?.value, fallback);
}

/** Upsert one setting. `value` is stored as native JSONB, so do NOT stringify it. */
export async function writeSetting(supabase, key, value) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  return value;
}
