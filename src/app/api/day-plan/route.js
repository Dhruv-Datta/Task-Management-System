import { getDb } from '@/lib/db';
import { apiBadRequest, apiJson, withApiError } from '@/lib/apiResponses';
import { readSetting, writeSetting } from '@/lib/appSettings';
import { normalizeDayPlan, prunePlans } from '@/lib/dayPlan';

/*
  /api/day-plan: how far through the day's planning flow you are.

  A step name, a flag and a short list of ids per day — which is exactly why it
  is not a table. It has no lifecycle, nothing joins to it, and the only
  question ever asked of it is "this day, please", so it lives in
  `app_settings` under one key, the same way the lists and the day's events do:

      day_plans → { 'YYYY-MM-DD': { step, dropped, finalized } }

  Why the server at all, rather than localStorage: planning on the laptop and
  then opening the app on the phone should not present you with an empty form
  for a day you already planned. The plan is a fact about the day, not about the
  browser you happened to make it in.

  Pruned on every write (PLAN_PRUNE_DAYS), relative to the day being written
  rather than to this box's clock, so a server in another timezone can never
  drop the day you are editing.

  Shape: GET ?date= → { date, plan }, PUT { date, plan } → { date, plan }.
*/

const PLANS_KEY = 'day_plans';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function readAll(supabase) {
  const stored = await readSetting(supabase, PLANS_KEY, {});
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

// GET ?date=YYYY-MM-DD → that day's plan (a fresh one if it has none)
export async function GET(req) {
  return withApiError(async () => {
    const { supabase } = await getDb();
    const date = new URL(req.url).searchParams.get('date');
    if (!ISO_DATE.test(String(date))) return apiBadRequest('date=YYYY-MM-DD is required');

    const blob = await readAll(supabase);
    return apiJson({ date, plan: normalizeDayPlan(blob[date]) });
  });
}

/*
  PUT { date, plan } → that day, replaced wholesale.

  The whole plan every time rather than a patch: it is three fields, so a merge
  would be more code than the thing being merged, and "the client sends the
  state it is in" is the rule that keeps two tabs from composing a state neither
  of them was ever in.
*/
export async function PUT(req) {
  return withApiError(async () => {
    const { supabase } = await getDb();
    const { date, plan } = await req.json();
    if (!ISO_DATE.test(String(date))) return apiBadRequest('date=YYYY-MM-DD is required');

    const clean = normalizeDayPlan(plan);
    const next = prunePlans(await readAll(supabase), date);
    next[date] = clean;

    await writeSetting(supabase, PLANS_KEY, next);
    return apiJson({ date, plan: clean });
  });
}
