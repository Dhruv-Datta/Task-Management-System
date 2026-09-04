-- ============================================================================
--  Personal task manager: the whole database, in one file.
--
--  Run this ONCE against your Supabase project. Either:
--
--    · Dashboard → SQL Editor → New query → paste this whole file → Run
--    · psql "$DATABASE_URL" -f supabase/schema.sql
--        (Dashboard → Project Settings → Database → Connection string → URI)
--
--  If you prefer the Supabase CLI's migration workflow, copy this file to
--  supabase/migrations/<timestamp>_init.sql and run `supabase db push`.
--
--  It is idempotent: every statement is IF NOT EXISTS / OR REPLACE, so
--  re-running it is safe and never drops data.
--
--  TWO TABLES, and that is the whole story:
--
--    tasks         one row per task.
--    app_settings  small JSON blobs: your lists, which one is open, and the
--                  fixed commitments (class, lunch) drawn on a day's timeline.
--
--  There is deliberately NO users table, and no assignee column. The single
--  login lives in the environment, AUTH_USERNAME and a bcrypt
--  AUTH_PASSWORD_HASH (see src/lib/account.js), so signing in touches no
--  database at all. Exactly one person can sign in, so every task here is
--  theirs by definition and there is nobody to hand one to.
--
--  SECURITY MODEL
--  --------------
--  The app does NOT use Supabase Auth. It signs its own session cookie (a JWT,
--  see src/lib/auth.js), so there is no `auth.uid()` for row-level policies to
--  key off.
--
--  Instead: RLS is ENABLED on every table with NO POLICIES AT ALL. That means
--  the public anon key (the one that would be safe to ship to a browser) can
--  read and write exactly nothing. Every query runs server-side through the
--  service-role key (src/lib/supabaseServer.js), which never reaches the
--  browser. The browser talks to /api/*, and /api/* talks to Postgres.
--
--  If you ever add a client-side Supabase call, it will fail, by design. Add an
--  API route instead.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1. TASKS
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  title         text NOT NULL,
  notes         text NOT NULL DEFAULT '',

  -- The workflow. `done` is a MIRROR of (status = 'completed'), written
  -- together with it by the app (statusPatch in src/lib/tasks.js) so a row can
  -- never read as open in one column and finished in the other.
  status        text NOT NULL DEFAULT 'not_started',
  done          boolean NOT NULL DEFAULT false,
  completed_at  timestamptz,

  priority      text NOT NULL DEFAULT 'medium',

  -- When it is owed. DATE, not timestamp: the planner is day-grained.
  --
  -- `is_hard` is the one thing about a task the dates cannot tell you: not how
  -- important it is (that is `priority`) and not how long it takes (that is
  -- `estimated_minutes`), but whether it is going to be a FIGHT. It is what
  -- earns a task a place in Attention a week before it is owed, because the
  -- hard ones are the ones you cannot start on the morning they are due.
  --
  -- `check_in_date` is retained ONLY so an existing database keeps its data;
  -- nothing in the app reads or writes it any more. The day has one date on it.
  due_date      date,
  check_in_date date,
  is_hard       boolean NOT NULL DEFAULT false,

  -- ── The day you CHOSE it ──────────────────────────────────────────────────
  --
  -- `planned_date` is the whole of /today. It is deliberately its own column and
  -- not a derivation of anything else: a task can be owed on the 5th, sitting In
  -- progress in the Hedge Fund list, and be the thing you decided to do on the
  -- 2nd. Planning is a decision about YOUR day, so it must not move the due
  -- date, the status or the list, and none of those may move it back.
  --
  -- `daily_priority` splits that day in two: what you are committing to finish
  -- ('must_do') and what you will get to if the day allows ('optional'). It only
  -- means anything while `planned_date` is set, and defaults to must_do so a
  -- task can never land on the day in an undecided state.
  --
  -- `estimated_minutes` is how long you think it takes. Stored as minutes rather
  -- than as one of the seven labels the picker offers, so the day's total is a
  -- sum and not a lookup table.
  planned_date       date,
  daily_priority     text NOT NULL DEFAULT 'must_do',
  estimated_minutes  integer,

  -- ── Where it sits in the day ──────────────────────────────────────────────
  --
  -- The timeline block: local wall-clock 'HH:MM' and a length. Text rather than
  -- `time`, so what the app reads is exactly what the table editor shows, with
  -- no seconds to trim; minutes rather than an end time, because dragging the
  -- bottom edge of a block changes its LENGTH and an end time would have to be
  -- recomputed on every move.
  --
  -- A schedule belongs to `planned_date` and cannot outlive it: clearing the
  -- planned date clears both of these (plannedPatch in src/lib/tasks.js, and
  -- sanitizeWritableFields on the way in), so there is no such thing as a block
  -- on a day the task is not planned for.
  scheduled_start    text,
  scheduled_minutes  integer,

  -- One free-text tag: a project, a context, an area of life.
  tag           text,

  -- The checklist inside a task: [{ id, title, done }]
  subtasks      jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Manual order within a status column, maintained by drag & drop.
  position      integer NOT NULL DEFAULT 0,

  -- Which list this belongs to. Plain text, matching an id in the `task_lists`
  -- app_settings blob: a list is not a table, so creating one is one JSON write.
  list_id       text NOT NULL DEFAULT 'default',

  -- Optimistic concurrency: bumped by a trigger on every UPDATE, so two tabs
  -- editing the same task can't silently overwrite each other
  -- (src/lib/concurrency.js).
  version       integer NOT NULL DEFAULT 1,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────────────
--  1b. UPGRADING A DATABASE THAT ALREADY EXISTS
--
--  CREATE TABLE IF NOT EXISTS does nothing at all to a table that is already
--  there, so a column added to the block above would never reach a project this
--  file has been run against before. Everything added after the first release
--  is therefore ALSO listed here, as ADD COLUMN IF NOT EXISTS, which is the one
--  form that is both an upgrade and a no-op.
--
--  Added for /today (the planning day): planned_date, daily_priority,
--  estimated_minutes, scheduled_start, scheduled_minutes.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS planned_date      date;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS daily_priority    text NOT NULL DEFAULT 'must_do';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS estimated_minutes integer;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS scheduled_start   text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS scheduled_minutes integer;

-- Added for the day's planning flow: the "this one is going to be a fight" flag
-- that puts a task into Attention a week out.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS is_hard boolean NOT NULL DEFAULT false;


-- Constrain the enum-like columns. The app normalizes on the way in as well;
-- this is what stops a hand-edited row in the Supabase table editor from
-- putting a task into a state no view knows how to draw.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_status_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check
      CHECK (status IN ('not_started', 'in_progress', 'waiting_review', 'completed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_priority_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_priority_check
      CHECK (priority IN ('urgent', 'high', 'medium', 'low'));
  END IF;
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
  -- 24-hour wall clock, and nothing else. A block is drawn by arithmetic on this
  -- string, so a row that says '9am' has to be impossible rather than merely
  -- unlikely.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_scheduled_start_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_scheduled_start_check
      CHECK (scheduled_start IS NULL OR scheduled_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
END $$;

-- The board and the list: one list's tasks in status/manual order.
CREATE INDEX IF NOT EXISTS idx_tasks_list_status
  ON public.tasks (list_id, status, position);
-- The calendar: dated tasks, bucketed by day.
CREATE INDEX IF NOT EXISTS idx_tasks_due
  ON public.tasks (due_date);
-- Attention: the hard ones, which are asked for by due date a week out.
CREATE INDEX IF NOT EXISTS idx_tasks_hard
  ON public.tasks (due_date)
  WHERE is_hard;
-- Everything carrying one tag, across every list.
CREATE INDEX IF NOT EXISTS idx_tasks_tag
  ON public.tasks (lower(tag));
-- Today: the day you chose, across every list. Partial, because the column is
-- null for almost every row and the only question ever asked of it is "what did
-- I plan for this day".
CREATE INDEX IF NOT EXISTS idx_tasks_planned
  ON public.tasks (planned_date)
  WHERE planned_date IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────────
--  2. APP SETTINGS: small JSON blobs
--     Keys in use: 'task_lists', 'task_list_groups', 'active_task_list_id',
--     'day_events' (the fixed commitments on /today's timeline: one entry per
--     day, { 'YYYY-MM-DD': [{ id, title, start, minutes }] }, pruned as it is
--     written) and 'day_plans' (how far through the day's planning flow you
--     are: { 'YYYY-MM-DD': { step, started, finalized } }, pruned the same
--     way). An event is not a task and must never become one: it is something
--     the day already contains, not something you owe.
--
--     Two more arrive with the Google Calendar connection, and neither needs a
--     table for the same reason as the others — no lifecycle, nothing joins to
--     them, and the only question ever asked is "this account" or "this day":
--
--       'google_calendar'  the OAuth grant: { refresh_token, email, scope,
--                          connected_at }. THE ONE SECRET IN THIS TABLE. It is
--                          readable only by the service-role key (RLS below
--                          gives the anon key nothing at all), it is never sent
--                          to the browser, and disconnecting revokes it at
--                          Google as well as dropping it here.
--       'google_pushed'    what we have written INTO Google, so a re-send moves
--                          an event instead of adding a second one:
--                          { 'YYYY-MM-DD': { at, events: { taskId: { eventId,
--                          sig } } } }, pruned to the same 30 days. `sig` is
--                          the block as Google was last told it, which is what
--                          makes re-sending an unchanged day write nothing.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_settings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL UNIQUE,
  value      jsonb,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);


-- ────────────────────────────────────────────────────────────────────────────
--  3. TRIGGERS: updated_at and version are the database's job, not the app's
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.bump_version()
RETURNS trigger AS $$
BEGIN
  -- Guarded, so an explicit app-supplied version (which the app never sends)
  -- is not double-bumped.
  IF NEW.version IS NOT DISTINCT FROM OLD.version THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach both to every public table that has the matching column and doesn't
-- already carry the trigger. Written as a loop so a table added later is covered
-- by re-running this file.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
      AND t.table_type = 'BASE TABLE'
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_' || r.table_name) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
        'set_updated_at_' || r.table_name, r.table_name
      );
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'version'
      AND t.table_type = 'BASE TABLE'
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bump_version_' || r.table_name) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_version()',
        'bump_version_' || r.table_name, r.table_name
      );
    END IF;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
--  4. LOCK THE DATABASE DOWN
--     RLS on, no policies: the anon key can do nothing at all. Only the
--     server's service-role key (which bypasses RLS) can read or write.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.tasks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Belt and braces: revoke the API roles' table grants too, so the lockdown does
-- not rest on RLS alone. Guarded on the roles existing, so this file also runs
-- against a plain Postgres that has never heard of Supabase.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.tasks, public.app_settings FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.tasks, public.app_settings FROM authenticated;
  END IF;
END $$;


-- ============================================================================
--  VERIFY
--    SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname = 'public';                                -- true, true
--    SELECT count(*) FROM pg_policies WHERE schemaname = 'public'; -- 0
-- ============================================================================
