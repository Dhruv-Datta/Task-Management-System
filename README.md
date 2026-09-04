# Tasks

A personal task manager: Next.js on Vercel, Supabase for storage, one login,
your tasks.

Two pages, on two different axes:

| | |
|---|---|
| **Today** (`/today`) | Every list at once, arranged by the day you *chose*. A four-step flow — the plan, what is asking, what else you could add, and when each of it happens — that finishes as the day itself. Where you start. |
| **Tasks** (`/tasks`) | One list, in full, drawn as a board, a list or a calendar. Where you work. |

The Tasks experience (the board / list / calendar layouts, the four-state
workflow, priorities, due dates, subtasks, drag & drop, the filter
bar, the detail dialog) is carried over from the `AlphaOS` project's `/tasks`
page, with its multi-tenant machinery removed. Where AlphaOS had workspaces,
roles, per-user feature flags and a `users` table per tenant, this has one
account defined by two environment variables and two database tables.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill it in (below)
# paste supabase/schema.sql into the Supabase SQL editor and run it
npm run db:check               # confirms everything is wired up
npm run dev                    # → http://localhost:3000
```

Other scripts: `npm run build`, `npm test`, `npm run lint`,
`npm run hash -- 'a password'`.

---

## 1. The login

There is **no users table and no Supabase Auth**. The account is two
environment variables:

```
AUTH_USERNAME=dhruv
AUTH_PASSWORD_HASH=\$2b\$12\$/42Hc4EHXhAXZVUIG6Nao.XyTM8gbLqiKISTOcoZFBsWeIFtAFOSe
```

That hash is `dhruv`, already set in `.env.local`. Signing in compares against
these two values and touches nothing else: no database round-trip on any
request in the app.

To change the password:

```bash
npm run hash -- 'your new password'
```

It prints the hash in two spellings; paste the one it labels for the place you
are pasting into, then restart the dev server (or redeploy).

> ### ⚠️ The `$` in a bcrypt hash
>
> A `.env` file is parsed by dotenv, which expands `$name` as a variable
> reference. A bcrypt hash is full of `$`, so an unescaped one becomes an
> **empty string**, and quoting does not help; expansion happens inside single
> and double quotes alike.
>
> | Where | Form |
> |---|---|
> | `.env.local` | escaped: `AUTH_PASSWORD_HASH=\$2b\$12\$abc…` |
> | Vercel, or an exported shell variable | raw: `$2b$12$abc…` |
>
> `npm run hash` prints both, labelled. The app strips stray backslashes, so the
> escaped form also works where the raw one is expected. `npm run db:check`
> reads your env exactly the way Next does and will tell you if the value
> arrived mangled.

**Changing the password signs out every existing session.** The session cookie
is signed with a key derived from `AUTH_JWT_SECRET` *and* the current password
hash, so changing either one invalidates every cookie ever issued under the old
pair. That is this app's "sign out everywhere"; there is no session table to
revoke.

## 2. Set up Supabase

Supabase stores tasks and settings. It has nothing to do with signing in.

1. Create a project at [supabase.com](https://supabase.com) (any region; the
   free tier is plenty for one person's tasks).
2. **Run the schema.** Dashboard → **SQL Editor** → New query → paste the whole
   of [`supabase/schema.sql`](supabase/schema.sql) → **Run**. It is idempotent:
   safe to re-run, never drops data. It creates two tables, `tasks` and
   `app_settings`.
   *Prefer the command line?* `psql "$DATABASE_URL" -f supabase/schema.sql`,
   with the URI from Project Settings → Database → Connection string.
3. **Copy the credentials.** Dashboard → **Project Settings → API**:
   - *Project URL* → `NEXT_PUBLIC_SUPABASE_URL`
   - *service_role* secret → `SUPABASE_SERVICE_ROLE_KEY`

> **On the service-role key.** It bypasses Row Level Security, so it must stay
> on the server: never prefix it with `NEXT_PUBLIC_`, and never import
> `src/lib/supabaseServer.js` from a client component (the `server-only` guard
> in that file will fail the build if you do). This is deliberate: the schema
> turns RLS on with **no policies at all**, so the public anon key can read and
> write nothing, and every query goes through an API route under `src/app/api`.

## 3. Environment variables

Five required, in `.env.local` locally and in Vercel's project settings for
production. `.env.local` is gitignored, so keep it that way.

| Variable | What it is |
|---|---|
| `AUTH_USERNAME` | Your username. |
| `AUTH_PASSWORD_HASH` | bcrypt hash of your password. **Secret.** Mind the escaping. |
| `AUTH_JWT_SECRET` | Signs the login cookie. **Secret.** `openssl rand -hex 32`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Your project URL. Public. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase key. **Secret.** |
| `GOOGLE_CLIENT_ID` | *Optional.* OAuth client for Google Calendar. |
| `GOOGLE_CLIENT_SECRET` | *Optional.* **Secret.** |
| `GOOGLE_CALENDAR_NAME` | *Optional.* Which calendar the day is written to. Defaults to `Personal / Work`. |
| `GOOGLE_REDIRECT_URI` | *Optional.* Only when the app cannot work out its own URL. |

`AUTH_JWT_SECRET` is required in production; in local development an insecure
fallback is used when it is unset, so `npm run dev` works before you have one.

The four Google ones are entirely optional — leave them blank and the app is
exactly what it was, with no Connect button and no requests to Google. Filled
in, Today draws your real calendar and sends your plan back to it: see
[Google Calendar](#google-calendar) below for the five-minute setup.

## 4. Deploy to Vercel

1. Push this directory to a Git repository.
2. Vercel → **Add New → Project** → import it. The defaults are correct
   (Next.js, `npm run build`, no root directory to set).
3. **Settings → Environment Variables**: add all five (plus the two Google ones
   if you are using them), for Production, Preview and Development.
   `AUTH_PASSWORD_HASH` goes in **raw** here, with no backslashes.
4. Deploy.

The same Supabase project serves local and production, so a task you write on
your laptop is on your phone. If you would rather they were separate, make a
second Supabase project, run the schema against it, and point production there.

---

## Using it

| | |
|---|---|
| `T` or `C` | New task (on either page) |
| `/` | Focus the search box (Tasks) |
| `Esc` | Close a dialog (saving what you typed) or clear the search |

### A day is 4am to 4am

Not midnight to midnight, and this is a fact about the whole app rather than a
setting on the calendar. At one in the morning you are not starting a new day —
you have not been to bed, the plan you made is the plan you are still working
through, and a deadline you set for "today" has not passed.

So `todayISO` (`src/lib/dates.js`) turns over at four, and because every default
in the task model reads it — what is overdue, what is owed today, what
"Tomorrow" means on a date chip, which day /today draws and writes
`planned_date` for — all of them move together. There is no moment where the
tasks think it is Thursday and the calendar is still drawing Wednesday.

On the timeline the same rule makes the grid a full 24 hours, 4am at the top and
4am at the bottom, with a rule marked **Tomorrow** where it crosses midnight.
The rail runs on past it: 25:30 is half past one tomorrow morning.

`scheduled_start` stays an ordinary `HH:MM` wall clock in the database — no
migration, and the column still reads correctly in the Supabase table editor.
What changed is how it is READ: on a day anchored at 4am, a clock before 04:00
can only mean the small hours at the *end* of that day, because "early on this
date" is not something a 4am day contains. So `'01:30'` planned for the 3rd is
half past one on the morning of the 4th — drawn at 26:30, sorted after the
evening, and pushed to Google on the right date. `dayMinutes` and `dayClock`
(`src/lib/dates.js`) are the two halves of that conversion, and every read and
write of a block goes through one of them.

### Today

The planning page. It loads **every** list at once — no list filter, no active
list, no way to be "in" one of them here, which is the whole point: your day is
not sorted by which project you filed something under. Every row says which
project it came from, as a dot and a name, and that is the only place a project
appears on this page.

It is a **flow**, not a dashboard. Four panels on screen at once is not four
steps, it is one wall, and you end up reading whichever of them is loudest
instead of the one you are on. So the day is planned in order, one question at a
time, under a thin numbered rail — `1 Today — 2 Attention — 3 Projects —
4 Calendar` — and nothing else. No headline restating what the panel below it
already says, no paragraph explaining a list you are looking at. The steps are
clickable —
you can go back to any of them at any point — and where you got to is stored per
day (`app_settings.day_plans`), so planning on the laptop and opening the app on
your phone does not present you with an empty form for a day you already did.

**Step 1 — What are you finishing today?**

Everything you **already owe** is on it: due today, and anything **late** — a
due date that has been and gone. That is the one and only write this app makes
without being asked, and the rule is the narrowest one that is still useful: the
deadline has arrived, and nothing else. Not high priority, not hard, not
yesterday's undated leftovers — a day that inherits every leftover is a day you
did not plan; only a deadline brings work forward by itself.

Late is here rather than one step further on in *Coming up*, and that is
deliberate: work you are behind on is not a forecast. A step called "coming up"
is read as one, and keeping the most overdue thing you own inside it meant the
day on your screen was quietly missing the part of it you were furthest behind
on.

**This is worked out, not stored.** What is on today is the union of what you
*chose* (`planned_date = today`) and what you *owe* (`isOwedToday` in
`lib/tasks`), computed every time the page reads your tasks. The membership does
not wait on a write. Change a due date to today over on **Tasks**, come back,
and it is on the day — no round trip to complete, nothing to refresh, and no
way for a failed write to hand you a day with your deadlines missing from it.
There *is* still a write — it stamps the date so an owed task can be given a
time on the calendar, reordered, and taken off — but it follows the day rather
than deciding it.

A stale stamp is not a hiding place either: a task still carrying **last**
Tuesday is owed, that day is over, so it comes forward to today (leaving last
Tuesday's time block behind — a schedule belongs to the day it was made for).
The single exception is a plan for a *later* day: park something on Thursday on
purpose and it stays on Thursday. Taking a task off today clears the arrived
due date along with the day, so what you take off stays off — and setting the
date back to today brings it straight back.

Underneath, **If there's time** is the same decision held more loosely. Every
row carries the same controls Tasks uses (status dot, priority marks, due date,
estimate, and the **Hard** flag), plus the four things you do to a commitment:
**✓** finish it, **Schedule** give it a time, the **Must do / Optional** toggle,
**×** take it off today. Taking it off clears the planned day and its time block
and *nothing else*: not the project, not the status, not the due date.

The one-line box at the top writes a new task straight onto today. It carries
two pickers: which project it belongs to (the one thing that cannot be inferred
on a page that is in all of them), and which half of the day it lands in.

**Step 2 — What else is asking for today?**

The one step you do not fill yourself, and it is only ever a **forecast**.
Three ways in, and there is no fourth:

| | |
|---|---|
| **Due tomorrow** | the last morning on which starting it is still a choice. |
| **Hard, due this week** | flagged **Hard** and owed within seven days. |
| **High priority this week** | urgent or high, and owed within seven days. |

Nothing else gets in. Not "waiting on someone", not high priority with no date
attached, and nothing undated at all — an undated task cannot be late, cannot be
soon, and has no business interrupting a decision about today. It is in step 3,
where you go looking. Due *today* is missing because step 1 already put it on
the plan, and so is anything **late**, for the same reason: it is owed, so it is
on the day, not in a list of what is coming.

A task appears in exactly one bucket, so the counts add up. Every row's only
verb is **Must / Optional** — you look, and then you choose, one at a time.

**Step 3 — Anything else you want to get to?**

Every open task you own, grouped by the project it lives in, searched across
title, notes and tag. The step for the work that is not shouting: the thing with
no due date that you actually care about. What you have already chosen stays
visible and ticked, so it reads as a checklist of everything rather than a
shrinking pile you cannot verify.

Adding something here sets its planned day and which half it is in, and **does
not touch its due date**. A task owed on Friday that you are doing today is
still owed on Friday.

**Step 4 — When is each of these happening?**

The day drawn as a day, one pixel to the minute, **4am to 4am** and wider if you
put something outside it.

Beside it sits the work that has no time on it yet;
that column empties as you drag, which is the whole feedback loop of the step.
Blocks move by dragging, resize from either edge, unschedule with **×** (which
leaves the task on today: "at no particular hour" is a plan), and **right-click**
for the name, a description and the tag row.

**A block an hour or longer shows its description** under the clock, growing a
line at a time as the block gets taller and clamped with a `…` where it runs out
— the browser puts the ellipsis, since only it knows how wide the block ended up
once overlaps have split the column. An hour is the threshold because under one
there is a single line spare, and one clipped line of prose is a smudge rather
than information; shorter blocks keep it in the tooltip. HTML is stripped for
the preview (a meeting invitation's description genuinely is HTML) — display
only, so editing still works on the real text. Overlapping
blocks are drawn side by side rather than hidden under each other.

Everything is drawn **while you are still holding it**. A block you are moving
re-reads its own clock as it goes, snapped to the quarter hour the drop will
actually use, so what you read in your hand is what you get; a block you are
resizing does the same with its range. A task dragged in from the list puts a
dashed ghost the right size at the spot it would land, with a rule across the
day and the time in the hour gutter — because "did I mean 2:00 or 2:15" is the
one question here you cannot answer after the fact. A
**Commitment** is the other kind of block: class, lunch, a standing meeting. It
is not a task and never becomes one (no status, no due date, nothing to tick
off); it lives in `app_settings`, one small array per day.

Nothing here is compulsory — a task can stay on today with no block.

**Then: the finished day.** **Finish planning** ends the flow, and `/today`
stops being a form. It becomes the calendar, full width, with the day's work
beside it **in priority order** — the list you fall back on the moment the
schedule slips, because it answers "the next hour got eaten, what actually
matters". It stays that way until tomorrow, or until you press **Re-plan the
day**, which reopens the flow at step one.

**Hard** is the one field that is about how a task will *feel*. Priority says
how much it matters and the estimate says how long it takes; neither tells you
that a task is the one you will put off, and putting it off is the failure the
flow exists to catch. A hard task is pulled into Attention a week before it is
owed, while there is still time for it to be difficult. It is off by default: a
flag that ends up on everything flags nothing.

It draws as a **flag** beside the priority marks — filled amber when set, a
hollow outline when not — and never as a word. It is read the way the priority
marks are, a glyph you take in while scanning a column, and the two together are
the whole of "what is this going to cost me". On a board card it sits in the top
right, at the other end of the title's line from the marks.

**None of it is automatic**, apart from the due-today seed. Nothing else plans a
task for you, nothing auto-arranges the timeline, and there is no suggested
pile. The app knows what is late and how long you said things take; you say what
today is.

### Google Calendar

Optional, and off until you connect it. Connected, it closes the loop at both
ends of the day.

**Your real day is already on the timeline.** Every event on the calendars you
have ticked in Google Calendar's own sidebar — the lecture, the standup, the
dentist — is drawn for the day you are planning, in the colour Google draws it
in, with all-day things in a strip above the grid.

Colour is resolved the way Google's own UI resolves it, narrowest first: the
event's **label** (a named colour you defined on the calendar — "Chill Vibes",
"Classes"), then its own `colorId`, then the colour of the calendar it lives on.
The label has to come first and it is easy to miss: it lives on the *calendar*
resource rather than the event (`calendars.get` → `labelProperties.eventLabels`),
Google's docs say it supersedes `colorId`, and a labelled event usually carries
no `colorId` at all — so reading `colorId` first draws a blue "Chill Vibes" event
in the red of whatever calendar happens to hold it. The label's name rides along
into the block's tooltip, since "Chill Vibes" says more about an hour than blue
does.

**And they are yours to rearrange.** Drag one to move it, drag an edge to
resize it, right-click it to rename, describe, retag or delete it — every one of
those goes straight back to Google, to the event it came from. Three different
permissions decide how far it goes, because Google draws the same three lines:
you can **tag or delete** anything on a calendar you can write to (both act on
your own copy, which is why Google offers them on a meeting you were merely
invited to); you can **rename or describe** it if you are not merely a guest;
and you can **move** it if it is also not clipped to this day — what you can see
of an event that spills over a midnight is half of it, and a drag could only say
where that half goes. A calendar you can only read is drawn and completely
inert. (Declined invitations and cancelled events are left out entirely.)

**Right-click anything on the grid** and you get its name, its description and
the tag row — the coloured labels you keep your calendar in, exactly as Google's
own menu offers them. The name and the description are the fields themselves
rather than buttons that open one: click the name and type. Picking a tag
recolours the block here and in Google at once, because they are the same fact.

It works on all three kinds of block — your tasks, your typed commitments, and
Google's own events — and each writes to whatever that thing already has: a
task's title and **notes** (the same text the task detail panel shows), a
commitment's, or a Google event's summary and description. Only **Delete** stays
narrow: it is not offered on a task, because removing a task is a decision about
work rather than about an hour, and a right-click is easy to mis-aim.

Which tags a menu offers depends on where that block gets written:

| Block | Tags it can take | Where the tag is kept |
|---|---|---|
| A Google event | the labels of **its own** calendar | on the event, in Google |
| A task's block | the labels of **`Personal / Work`** (the calendar the day is pushed to) | `tasks.google_label_id`, and sent with the next *Send changes* |
| A commitment | the same | the day's own events blob; it never goes to Google |

Label ids are unique *within one calendar*, so a menu that mixed them would be
offering ids the write is about to reject. Google's own unnamed palette swatches
are filtered out — a tag is a word before it is a colour — so what you see is the
list you actually named. If a menu comes up empty it says which of the two
reasons it is: no tags on that calendar yet, or no Google.

One description is shown but not editable: a meeting invitation's kilobyte of
generated HTML is truncated on the way down (two hundred of those is a megabyte
a page load), and letting you save an edit to a truncated copy would drop the
rest of it. The menu says so, and the name above it is still yours to change.

Tagging a task's block needs one column that older databases do not have:

```sql
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS google_label_id text;
```

`supabase/migrations/002_timeline_tags.sql` is that one line with its reasoning,
re-running `supabase/schema.sql` does the same thing, and `npm run db:check`
tells you whether you need to.

They are ordinary blocks in every other respect, which is the useful part: a
task dropped on top of your standup is drawn beside it rather than underneath,
and **Schedule** already knows to suggest a gap rather than the middle of a
meeting.

**Finishing the day sends it back.** Press *Finish planning* and every task you
gave an hour to is written to Google — so the day you decided on at nine is on
your phone at eleven. Blocks with no time on them are not sent: "some time this
afternoon" is a real plan and not an appointment, and inventing a slot for it
would be the app making up a commitment for you.

It goes into **one calendar of its own, called `Personal / Work`** — never your
main one. That calendar has to exist in your Google account (make it in the
sidebar: *Other calendars → + → Create new calendar*); if it doesn't, the send
fails and says so rather than quietly putting a fortnight of blocks somewhere
you didn't ask for them. `GOOGLE_CALENDAR_NAME` changes which name it looks for.
Writing somewhere of its own is what keeps the whole thing reversible: your plan
is one checkbox away from hidden and one deletion away from gone, and it is
never tangled up with the meetings other people booked.

Sent blocks are **Tomato** — Google's red — unless you have tagged one, in which
case it goes in that tag's colour. Either way a glance at your phone tells your
own hours apart from everything else at a distance, and they carry **no
reminders**: six popups for the afternoon you arranged yourself is a plan that
interrupts you all day.

**A must-do block arrives with a star on it.** A task on the day is either
something you are committing to finish (the filled star on its row) or something
you will get to if the day allows — and on your phone at eleven that distinction
is otherwise nothing at all, six identical boxes with no way to tell the two you
promised yourself from the four you did not. So the title carries it: `Essay ⭐`.
The task's own title is untouched; the star is appended to the copy that goes to
Google, and appended rather than prefixed because a calendar truncates a block
from the right, and the star is the right thing to lose when there is no room
for it. Unstar the task and re-send, and it comes off again.

**Sending again is a reconciliation, not an upload.** Move a block and re-send:
the same Google event moves. Retag or star one and re-send: the same event is
recoloured or renamed. Unschedule one, or take the task off the day, and its
event is removed. Change nothing and re-send: nothing is written at all.
Change `GOOGLE_CALENDAR_NAME` and re-send, and a day already in Google *moves*
to the new calendar rather than being left behind in the old one — the finished
day notices by itself and offers *Send changes*.
Every event this app creates is stamped with its task's id, which is what makes
all of that possible and what makes it **safe** — a delete can only ever reach
an event this app put there, so a real meeting cannot be touched however wrong
anything else goes. The same stamp is why you never see your plan twice: when
the day is read back, the app recognises its own events and drops them, leaving
your meetings from Google and your own blocks, each drawn exactly once.

The finished day says which state it is in, top right: *In Google Calendar*, or
*Send changes* once you have rearranged something since. The day changes at
eleven o'clock more often than any planner likes to admit, and a sent day and a
sent-then-rearranged day look identical on a timeline.

**Setting it up** takes about five minutes, once, at
[console.cloud.google.com](https://console.cloud.google.com):

1. New project → **APIs & Services → Library** → enable **Google Calendar API**.
2. **OAuth consent screen** → *External* is right for a personal Google account.
   Add yourself under **Test users**. An app in testing needs no verification;
   it just has to be re-consented every six months.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
   Under *Authorized redirect URIs* add both, exactly:

   ```
   http://localhost:3000/api/google/callback
   https://<your-app>.vercel.app/api/google/callback
   ```

4. Put the client id and secret in `.env.local` (and in Vercel) as
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and restart `npm run dev`.
5. In Google Calendar, make the calendar the plan is written to: *Other
   calendars → + → Create new calendar*, named exactly **`Personal / Work`**.
   (Or name it whatever you like and set `GOOGLE_CALENDAR_NAME` to match.)
6. Open **/today** and press **Connect Google** in the timeline's header.

`redirect_uri_mismatch` on the consent screen is always step 3: Google matches
those URIs character for character, so a missing `/api`, a trailing slash, or
`http` where you deployed `https` is the whole of it.

**Where the grant lives**: one refresh token, server-side, in `app_settings`
under `google_calendar` — a table whose anon key can read nothing at all. No
Google token ever reaches the browser, which is why neither variable is
`NEXT_PUBLIC_`. **Disconnect** (in the chip's menu) hands the grant back to
Google as well as dropping it here, so the app also disappears from your
account's third-party access list. It does **not** delete the events already in
your calendar: those days happened.

### Tasks

**Lists** are contexts: Personal, Work, Someday. The switcher belongs to the
**board** — it is the page title there, and it selects which list the board
shows. It is also where lists are made, renamed, reordered, filed into groups
and deleted. The list and calendar views show every list at once, so the switcher
is not drawn on them and the title simply reads **All tasks**.

**Statuses** are the spine: Not started → In progress → Waiting review →
Completed. On the board they are the columns, and dragging a card between them
is how a task moves.

**Views**, chosen in the app bar, in the recessed group that appears only on
this page (the two tabs beside it are places; this is a way of looking):

- **Board** — status columns, drag to change status and order. **One list**, the
  one the switcher names.
- **List** — **every task, from every list**, in sections by status, priority or
  **list**. Grouped by list, a project's work is together and its most important
  task is at the top of it; only lists with something in them get a heading.
- **Calendar** — **every task, from every list**, by due date: a week or a month
  at a time, drag a card onto a day to schedule it, with Overdue and Unscheduled
  rails underneath.

Only the board is scoped, and it is scoped because dragging between its columns
is a write: it is the view you stand *inside* one body of work to use, and every
project you own in a single In-progress column is a wall rather than a workflow.
Rows-and-sections and days-of-the-week both hold thirteen projects without
losing their shape, so the other two show everything — and every row and card
there carries a coloured dot and the name of the list it came from, which is the
only thing telling two similarly-named tasks apart.

Where the page is showing everything there is no switcher to say where a new
task goes, so the **New task** box asks outright, opening on the list the board
last had.

**Tags** are one free-text label per task: a project, a context, an area of
life. The board can gather each column's cards by tag.

**Hard** (`is_hard`) is a flag you set anywhere, and it means one thing: put
this in Attention a week before it is owed. See Today, above.

**The planning fields** (`estimated_minutes`, `planned_date`, `daily_priority`,
`scheduled_start`, `scheduled_minutes`) belong to Today and appear there: on its
rows, and in the task dialogs when they are opened from that page. They are
deliberately independent of everything above. A task can be due September 5, sit
In progress in the Hedge Fund list, and be the thing you decided to do on
September 2.

**One person**: there are no assignees, no roster and no avatars. Exactly one
account can sign in, so every task here is yours by definition.

---

## How it is built

```
src/
  proxy.js                  edge gate: redirects unauthenticated pages to /login,
                            401s every non-auth API route
  app/
    (auth)/login            the sign-in screen
    (dashboard)/today       the planning day: every list, by the day you chose
    (dashboard)/tasks       the task page: one list, three views
    api/auth/{login,logout,me}
    api/tasks               the task list (+ /reorder for drag & drop)
    api/lists               the lists, and which one is open
    api/events              one day's fixed commitments (class, lunch)
    api/day-plan            how far through the day's planning flow you are
    api/google              the Google connection (DELETE = disconnect)
    api/google/{connect,callback}
                            the OAuth round trip: consent, then the code swap
    api/google/day          one day, both ways: GET what Google has, POST the
                            day you planned
  components/
    AuthGate.jsx            client-side redirect + "session expired" overlay
    Navbar.jsx              the app shell: two area tabs, plus the view
                            switcher when you are on /tasks
    tasks/                  every piece of task chrome, shared by both pages.
                            TaskItems.jsx is the two shapes a task takes, the
                            dense row and the board/calendar card; both label
                            their list only in the views that span more than one
    dashboard/              the Panel primitives (surface, heading, agenda row,
                            quick add) the Today panels are built from
    today/                  the planning flow: PlanFlow (the stepper shell) and
                            its four bodies — the commitments panel, Attention,
                            the project browser, the calendar step — plus
                            DayView (the finished day), the timeline, and the
                            schedule and commitment forms; GoogleCalendar.jsx
                            holds the two controls the connection needs and
                            nothing resembling a settings page
  lib/
    account.js             the one login, read from the environment
    auth.js                the session cookie: sign, verify, set, clear
    db.js                  session → identity, then the Supabase client
    supabaseServer.js      the service-role client (server-only)
    routes.js              the page paths, as bare strings (the edge proxy
                           reads these, so nothing in here imports anything)
    navigation.js          the app bar: NAV_AREAS (places) and TASK_VIEWS
                           (ways of looking at /tasks)
    tasks.js               the task model: statuses, priorities, grouping,
                           ordering, overdue, what counts as OWED TODAY, drag
                           resolution. Pure functions.
    agenda.js              /today's model: what is on the day (chosen OR owed,
                           derived — never read out of a written column) and
                           what it adds up to, the three Attention rules, the
                           catalog you choose from, and the timeline layout
                           (blocks, columns, the next free slot). Pure functions.
    dayPlan.js             the planning FLOW: the four steps and their order,
                           the per-day state that is stored, and the seed that
                           writes the owed day down. Pure functions.
    googleEvents.js        the Google model: a raw event turned into the day's
                           own shape (wall clock in your timezone, colour,
                           clipped at midnight), what is dropped from a day and
                           why, and what a finished day sends back. Pure
                           functions — no fetch, no environment, shared by both
                           sides of the wire.
    googleAuth.js          the one stored grant: the consent URL, the code
                           swap, and access tokens minted from a refresh token
                           kept server-side. Server-only.
    googleCalendar.js      the Calendar API itself: reading every calendar you
                           look at, and reconciling the day you planned into one
                           of its own, found by name. Server-only.
    dates.js               day-grained dates, and the clock: minutes past
                           midnight, 'HH:MM', durations, snapping — and WHERE A
                           DAY BEGINS. `todayISO` turns over at 4am, and
                           `dayMinutes`/`dayClock` convert between a stored wall
                           clock and a position on a day that runs 4am to 4am.
    taskStore.js           how a task is WRITTEN: optimistic, version-guarded,
                           reconciled. Shared by both pages so they cannot
                           drift apart on it.
    concurrency.js         version-guarded writes
supabase/schema.sql         the entire database: two tables
scripts/                    hash-password.mjs, check-db.mjs
tests/model.test.mjs        the task model: `npm test`
tests/agenda.test.mjs       the planning day's arrangement
tests/dayPlan.test.mjs      the flow: step order, stored state, the seed
tests/googleEvents.test.mjs the Google model: what the day draws, what it drops,
                            and what it sends back
```

`npm test` runs Node's built-in test runner over the pure model: statuses,
filtering, grouping, ordering, the summary counts, list management, the drag
resolution, the write allow-list, and the planning day (what is on it, which
Attention section claims a task, how the timeline lays out, where the next free
slot is), the planning flow (step order, what survives a reload, and exactly
which tasks a fresh day seeds itself with), and the Google model (which events
land on which local day across a midnight, which are dropped and why — our own
copies above all — and exactly when a re-send is a no-op). No database, browser
or network needed, so it runs in under a second.

**Still two tables.** Today added six columns to `tasks` (`planned_date`,
`daily_priority`, `estimated_minutes`, `scheduled_start`, `scheduled_minutes`,
and now `is_hard`) and two `app_settings` keys: `day_events` for the fixed
commitments on the timeline, and `day_plans` for how far through the flow each
day is. Google Calendar added **no columns and no tables** — two more
`app_settings` keys, `google_calendar` (the grant) and `google_pushed` (which
event we wrote for which task), so connecting it needs no migration at all. If the app has been running since before any of that, **re-run
`supabase/schema.sql`**: it is idempotent, and the columns are listed a second
time as `ADD COLUMN IF NOT EXISTS`, which is the one form that is both an
upgrade and a no-op. (`supabase/migrations/001_planning_day.sql` is the
short version: just the six columns, their constraints and their indexes.) `npm run db:check` says so if they are
missing.

`check_in_date` is still on the table and still holds whatever it held. Nothing
reads or writes it any more: the day has one date on it, and a second date whose
only job was to nag you was a date you had to maintain in order to be nagged.

`planned_date` is the field the whole page rests on. It is deliberately separate
from the due date, the status and the list, and `plannedPatch` (`src/lib/tasks.js`)
is the single definition of what changing it may touch — used by the optimistic
client update and by the server's write allow-list, so the two cannot drift.

### Authentication

The same shape as AlphaOS, minus the tenancy and minus the database:

1. `POST /api/auth/login`: rate-limited by IP and username (5 failures per 15
   minutes), bcrypt-compared against `AUTH_PASSWORD_HASH`, and on success sets
   `session_token`: an HS256 JWT in an `httpOnly`, `sameSite=lax`, 30-day
   cookie.
2. `src/proxy.js` runs on the edge for every request. It verifies the cookie's
   signature and either lets the request through, redirects a page to `/login`
   (carrying `?next=` so a deep link survives), or answers an API route with
   401.
3. Because the signing key is derived from the password hash, "does this cookie
   verify" *is* "was this issued under the password configured right now".
   There is no revocation table and no per-request database lookup.
4. `AuthGate` + `AuthContext` are the client half: no flash of an empty
   dashboard, and a clear prompt when a session dies while the tab is open.

That short password is only as safe as the number of guesses someone gets, so
the rate limiter is load-bearing. It is per server instance and in-memory, which
on Vercel means per warm lambda, enough to make online guessing impractical,
not a distributed guarantee. A longer password is the real answer.

### Concurrent edits

Every task row carries a `version`, bumped by a database trigger. A save is a
compare-and-swap (`UPDATE … WHERE version = <what I loaded>`), so the same task
open in two tabs cannot silently lose an edit: the loser gets a 409 carrying the
fresh row and adopts it. Drags are deliberately unguarded (a reorder is a
nudge, not a document edit) but the reorder endpoint returns the rows it wrote
so the client's versions stay current.

### Adding a feature later

The app shell is built for it. A new area (notes, habits, money) is:

1. a folder under `src/app/(dashboard)/`,
2. its path in `ROUTES` (`src/lib/routes.js`) and an entry in `NAV_AREAS`
   (`src/lib/navigation.js`), which is what puts a tab in the app bar,
3. its route added to the `matcher` in `src/proxy.js`: **a page missing from
   that matcher is one anybody can load without signing in**,
4. a table in `supabase/schema.sql` (the `updated_at` and `version` triggers
   pick it up automatically when you re-run the file).

`routes.js` is deliberately separate from `navigation.js`: the proxy runs on the
edge and needs the paths, and importing the nav registry there would drag the
icon library into the middleware bundle for the sake of two strings.

---

## Troubleshooting

**Signing in says "AUTH_PASSWORD_HASH is empty" but the line is right there**.
The `$` signs are unescaped in `.env.local`. See the warning above; `npm run
hash` prints the escaped form.

**Signing in says "Supabase is not configured"**. `.env.local` is missing the
Supabase variables, or `next dev` was started before you filled them in.
Environment variables are read at boot, so restart the dev server.

**`npm run db:check` says a table is missing**. The schema hasn't been applied
to this project. Re-run `supabase/schema.sql`.

**Nothing on Today saves: "column tasks.planned_date does not exist", or
flagging something Hard does nothing.** The database predates the planning
columns — which is the one failure that makes the whole page look broken while
every list still reads fine, because reads ignore columns that are not there and
writes do not. Run `supabase/migrations/001_planning_day.sql`, or re-run the
whole of `supabase/schema.sql`; both are idempotent and add only what is
missing. `npm run db:check` confirms.

**"Too many failed attempts"**. Five wrong passwords in fifteen minutes. It
clears itself, or restart the dev server.

**Signed out unexpectedly after a deploy**. `AUTH_JWT_SECRET` or
`AUTH_PASSWORD_HASH` differs between environments. The cookie is signed with
both, so a mismatch invalidates it. Check that Vercel has the same values (with
the hash **raw**, not escaped).
