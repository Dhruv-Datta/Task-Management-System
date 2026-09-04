-- ============================================================================
--  EVERYTHING /today NEEDS, in one paste.
--
--  Run this once:  Supabase → SQL Editor → New query → paste → Run.
--
--  Running the whole of supabase/schema.sql does exactly the same thing and is
--  equally safe; this file is the short version, for a database that already
--  has the two tables and is only missing the planning columns.
--
--  Idempotent throughout: ADD COLUMN IF NOT EXISTS is both the upgrade and a
--  no-op, and every constraint and index is guarded. Nothing is ever dropped.
--
--  Afterwards:  npm run db:check   -- should be all ✓
-- ============================================================================


-- ── The day you CHOSE ───────────────────────────────────────────────────────
--
-- `planned_date` is the whole of /today, and it is deliberately its OWN column:
-- a task can be owed on the 5th, sitting In progress in the Hedge Fund list,
-- and be the thing you decided to do on the 2nd. Planning is a decision about
-- your day, so it must not move the due date, the status or the list.
--
-- `daily_priority` splits that day in two: what you are committing to finish
-- ('must_do') and what you will get to if the day allows ('optional').
--
-- `estimated_minutes` is how long you think it takes, in minutes, so a day's
-- total is a sum and not a lookup table.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS planned_date      date;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS daily_priority    text NOT NULL DEFAULT 'must_do';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS estimated_minutes integer;

-- ── Where it sits in that day ───────────────────────────────────────────────
--
-- The timeline block: local wall-clock 'HH:MM' and a LENGTH (not an end time,
-- because dragging a block's bottom edge changes its length).
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS scheduled_start   text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS scheduled_minutes integer;

-- ── Is it going to be a fight? ──────────────────────────────────────────────
--
-- Not how important it is (that is `priority`) and not how long it takes (that
-- is `estimated_minutes`), but whether it is the one you will put off. It is
-- what earns a task a place in Attention a week before it is owed.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS is_hard boolean NOT NULL DEFAULT false;


-- ── Keep the new columns honest ─────────────────────────────────────────────
--
-- The app normalizes on the way in as well; this is what stops a hand-edited
-- row in the Supabase table editor putting a task into a state no view knows
-- how to draw.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_daily_priority_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_daily_priority_check
      CHECK (daily_priority IN ('must_do', 'optional'));
  END IF;
  -- Zero minutes is not an estimate and not a block; a negative one is a typo.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_estimate_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_estimate_check
      CHECK (estimated_minutes IS NULL OR estimated_minutes > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_scheduled_minutes_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_scheduled_minutes_check
      CHECK (scheduled_minutes IS NULL OR scheduled_minutes > 0);
  END IF;
  -- 24-hour wall clock and nothing else: a block is drawn by arithmetic on this
  -- string, so a row that says '9am' has to be impossible rather than unlikely.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_scheduled_start_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_scheduled_start_check
      CHECK (scheduled_start IS NULL OR scheduled_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
END $$;


-- ── The two questions these columns are asked ───────────────────────────────
--
-- "What did I plan for this day", across every list. Partial, because the
-- column is null for almost every row.
CREATE INDEX IF NOT EXISTS idx_tasks_planned
  ON public.tasks (planned_date)
  WHERE planned_date IS NOT NULL;

-- "What hard thing is coming up", asked by due date, a week out.
CREATE INDEX IF NOT EXISTS idx_tasks_hard
  ON public.tasks (due_date)
  WHERE is_hard;


-- ============================================================================
--  VERIFY  (expect one row per column: 6)
--
--    SELECT column_name FROM information_schema.columns
--     WHERE table_schema = 'public' AND table_name = 'tasks'
--       AND column_name IN ('planned_date','daily_priority','estimated_minutes',
--                           'scheduled_start','scheduled_minutes','is_hard');
--
--  NOTE: nothing here drops `check_in_date`. It keeps its data; the app simply
--  no longer reads or writes it.
-- ============================================================================
