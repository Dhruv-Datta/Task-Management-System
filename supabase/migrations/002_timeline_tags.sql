-- ============================================================================
--  THE TIMELINE'S TAGS, in one paste.
--
--  Run this once:  Supabase → SQL Editor → New query → paste → Run.
--
--  Running the whole of supabase/schema.sql does exactly the same thing and is
--  equally safe; this file is the short version, for a database that is only
--  missing this one column.
--
--  Afterwards:  npm run db:check   -- should be all ✓
-- ============================================================================


-- ── The tag a task's block is drawn in ──────────────────────────────────────
--
-- Right-click a block on /today's timeline and you get the coloured labels you
-- keep your calendar in — "Work", "Classes", "Chill Vibes". They are not words
-- of this app's own: a tag IS a Google Calendar event label, defined on the
-- calendar the day is written to, so a block you retag here is that colour on
-- your phone as well, and means there what it means here.
--
-- ONLY THE ID IS KEPT. The name and the colour belong to Google, are read with
-- the day (/api/google/day), and renaming a label there must not leave a stale
-- copy of the old name sitting in this table. Nothing is a foreign key, so a
-- label you later delete in Google reads as exactly what it is — no tag.
--
-- NULL is the ordinary state, and means the block is drawn in Tomato: the one
-- red every task block was before this existed.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS google_label_id text;


-- ── Nothing else changes ────────────────────────────────────────────────────
--
-- A commitment's tag (class, lunch) rides along in the `day_events` blob in
-- app_settings, and a Google event's tag lives on the event, in Google. Neither
-- needs a column, which is why this file is one line long.
