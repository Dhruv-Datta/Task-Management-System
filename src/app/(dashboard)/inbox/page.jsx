'use client';

/*
  /inbox: the thought, and then the decision. In that order, and never at the
  same time.

  The other two areas of this app are for work you sat down to do: /today
  arranges a day you chose, /tasks holds the whole body of it. Both of them ask
  you questions, and rightly — a task with no list and no date is a task you
  will never see again. But the moment a thought ARRIVES is the one moment those
  questions cost more than they are worth: you are in the shower, in a lecture,
  halfway out of the door, and a dialog with six fields is the reason the
  thought is lost.

  So this tab is first in the bar and it is split in two:

    CAPTURE   one box. Type, Enter, gone. Nothing is asked, so nothing can stop
              you. The pile grows under the box where you can see it.
    ORGANIZE  the pile, oldest first, one card at a time: list, priority, due
              date, and whether it is today's problem. File it, and it becomes
              an ordinary task in an ordinary list.

  It always OPENS ON CAPTURE, whatever you did last, because the reason you
  reached for this tab is almost always that you have something to write down.
  Organize is a thing you go to on purpose, which is why the count is a button
  and not just a number.

  An unfiled thought lives in a reserved list and is hidden from every other
  read in the app — lib/inbox.js has the whole of why, and /api/tasks does the
  hiding. The upshot is that nothing here can clutter the board, the calendar or
  the planned day until you have said what it is.
*/

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox as InboxIcon, ListChecks } from 'lucide-react';
import { useTaskStore } from '@/lib/taskStore';
import { useLastFiledList } from '@/lib/taskPrefs';
import { setInboxCount } from '@/lib/inboxCount';
import { capturePayload, isCaptured, sortCaptured, splitCaptures } from '@/lib/inbox';
import { resolveListsPayload } from '@/lib/tasks';
import { listIndex } from '@/lib/agenda';
import { createTask, fetchInbox, fetchLists } from '@/lib/tasksApi';
import LoadError from '@/components/tasks/LoadError';
import WriteError from '@/components/tasks/WriteError';
import CaptureStage from '@/components/inbox/CaptureStage';
import OrganizeStage from '@/components/inbox/OrganizeStage';

const STAGES = [
  { key: 'capture', label: 'Capture', icon: InboxIcon },
  { key: 'organize', label: 'Organize', icon: ListChecks },
];

/*
  The two stages, as one control.

  Drawn the way the app bar draws its view switcher — a recessed group, one
  filled chip — because it is the same kind of choice: it changes what you are
  doing on this page, not where you are. The count rides on Organize rather than
  sitting somewhere in the header, so the thing that tells you there is work and
  the thing that takes you to it are the same button.
*/
function StageSwitch({ stage, count, onSelect }) {
  return (
    <div
      role="group"
      aria-label="Inbox stage"
      /* Full width on a phone, where "Inbox" plus both stages plus a count does
         not fit across 360px on one line and the two halves make better thumb
         targets sharing the screen than huddled against the right edge. */
      className="flex items-center gap-0.5 p-1 rounded-xl bg-gray-100/80 w-full sm:w-auto"
    >
      {STAGES.map(s => {
        const Icon = s.icon;
        const active = stage === s.key;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onSelect(s.key)}
            aria-pressed={active}
            className={`flex flex-1 sm:flex-none items-center justify-center gap-2 h-10 sm:h-9 px-3 sm:px-4 rounded-lg text-[13.5px] font-semibold transition-colors ${
              active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Icon size={15} strokeWidth={2.25} className={active ? 'text-emerald-600' : ''} />
            {s.label}
            {s.key === 'organize' && count > 0 && (
              <span className={`min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
                active ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-600'
              }`}>
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function InboxPage() {
  /*
    The captured pile is held by the SAME store every other page writes through
    (lib/taskStore): filing is an ordinary version-guarded, optimistic task
    edit, and getting that subtly different here is how one page starts quietly
    losing edits the rest keep.

    Which means the visible pile is DERIVED rather than kept: a thought filed
    into a real list stops matching `isCaptured` and leaves the screen the
    instant you press the button, and a save that fails rolls the row back —
    list and all — so it reappears exactly where it was. Neither of those needed
    a line of code here.
  */
  const { tasks, setTasks, patchTask, removeTask, writeError, setWriteError } = useTaskStore();

  // Captures still in the air. Deliberately NOT in the store: they have no id
  // and no version yet, so nothing that guards a write could guard one of them.
  const [pending, setPending] = useState([]);

  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [stage, setStage] = useState('capture');
  const [lastFiledList, setLastFiledList] = useLastFiledList();

  /*
    WHERE EACH OPEN THOUGHT IS HEADED, before it goes there.

    Every other answer a triage card takes is written straight to the row as you
    give it, so it survives a collapse and a reload without anything being kept
    here. The list cannot be: `list_id` is the field that takes a thought OUT of
    the inbox, so writing it on the press would file the thought mid-decision.

    It is held HERE rather than in the card so that collapsing one, opening
    another and switching stages all leave it standing; it is deliberately not
    persisted further, because an intended-but-uncommitted destination stored
    across reloads would be a second answer to a question the Save button is
    about to settle. A reload puts each card back on the last list you filed to,
    which is the same answer it opens on the first time.
  */
  const [listChoices, setListChoices] = useState({});

  // ─── Loading ───────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The lists are only needed by Organize, and a failure to read them is not
      // a reason to refuse to CAPTURE — the default list is a fine assumption,
      // exactly as it is on /tasks.
      const [listsPayload, inbox] = await Promise.all([
        fetchLists().catch(() => ({})),
        fetchInbox(),
      ]);
      setLists(resolveListsPayload(listsPayload).lists);
      setTasks(inbox);
      setLoadError(null);
    } catch (err) {
      console.error('Failed to load the inbox', err);
      setTasks([]);
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [setTasks]);

  useEffect(() => {
    (async () => { await load(); })();
  }, [load]);

  // ─── The pile ──────────────────────────────────────────────────────────────

  const captured = useMemo(() => tasks.filter(isCaptured), [tasks]);
  // Newest first while you are writing (the thing you just typed belongs at the
  // top), oldest first while you are filing (the stale one is the urgent one).
  // Both orders are defined once, in lib/inbox.js.
  const feed = useMemo(() => sortCaptured(captured, { newestFirst: true }), [captured]);
  const queue = useMemo(() => sortCaptured(captured), [captured]);

  /*
    The app bar's badge. Counted here rather than re-fetched there, so it tracks
    a capture or a filing the moment it happens. In-flight captures count: you
    wrote them down, and a number that waited for the network would tick up a
    beat after the row it belongs to.

    Not while the page is still loading or has failed to: `0` would read as
    "inbox empty" over an inbox nobody has managed to look in yet.
  */
  const waiting = captured.length + pending.filter(p => !p.error).length;
  useEffect(() => {
    if (!loading && !loadError) setInboxCount(waiting);
  }, [waiting, loading, loadError]);

  /*
    The lists, with the colour each one wears everywhere else in the app
    (lib/agenda's positional palette). Organize's list chips are the same colour
    as that list's dot on /today and its section on /tasks, which is the only
    thing making "the blue one" mean anything.
  */
  const listOptions = useMemo(() => [...listIndex(lists).values()], [lists]);

  // ─── Capturing ─────────────────────────────────────────────────────────────

  const saveCapture = useCallback(async (item) => {
    setPending(prev => prev.map(p => (p.tempId === item.tempId ? { ...p, error: null } : p)));
    try {
      const { ok, data } = await createTask(capturePayload(item.title));
      if (!ok || !data?.id) throw new Error(data?.error || 'The server refused it.');
      setTasks(prev => [...prev, data]);
      setPending(prev => prev.filter(p => p.tempId !== item.tempId));
    } catch (err) {
      // It stays on screen, marked, with a retry. A thought you believe you
      // have written down and have not is the one failure this page cannot
      // afford to be quiet about.
      setPending(prev => prev.map(p => (
        p.tempId === item.tempId ? { ...p, error: err?.message || 'It did not reach the server.' } : p
      )));
    }
  }, [setTasks]);

  const capture = useCallback(async (text) => {
    const titles = splitCaptures(text);
    if (titles.length === 0) return;
    const stamped = titles.map((title, i) => ({ tempId: `tmp_${Date.now()}_${i}`, title, error: null }));
    // Newest at the top, to match the feed under the box.
    setPending(prev => [...stamped.slice().reverse(), ...prev]);
    // One at a time: a pasted list went in in an order, and the server hands
    // out the next row number per request. Sending twenty at once would number
    // them in whatever order they happened to land.
    for (const item of stamped) await saveCapture(item);
  }, [saveCapture]);

  const dropPending = useCallback((item) => {
    setPending(prev => prev.filter(p => p.tempId !== item.tempId));
  }, []);

  // ─── Filing ────────────────────────────────────────────────────────────────

  /*
    Filing is one write: the task moves to a real list. `patchTask` is the same
    optimistic, version-guarded save the rest of the app uses, so the card
    leaves the pile at once and comes back if the write doesn't land — with the
    banner above saying why.
  */
  const file = useCallback(async (task, payload) => {
    setLastFiledList(payload.list_id);
    await patchTask(task.id, payload);
  }, [patchTask, setLastFiledList]);

  // Which list a card opens on: whatever you have already picked for it, else
  // the one you filed the last thing into, falling back to the first list you
  // own when that one has since been deleted.
  const defaultListId = listOptions.some(l => l.id === lastFiledList)
    ? lastFiledList
    : listOptions[0]?.id;

  const listFor = useCallback((taskId) => {
    const picked = listChoices[taskId];
    return listOptions.some(l => l.id === picked) ? picked : defaultListId;
  }, [listChoices, listOptions, defaultListId]);

  const pickList = useCallback((taskId, listId) => {
    setListChoices(prev => ({ ...prev, [taskId]: listId }));
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-[720px] mx-auto px-4 sm:px-6 pb-24">
      {/* Stacked on a phone, side by side from `sm`. Squeezing the heading and
          both stages onto one 360px line only produces two controls too small
          to hit. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 animate-fade-in-up">
        <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
        <StageSwitch stage={stage} count={waiting} onSelect={setStage} />
      </div>

      {loadError && <LoadError error={loadError} onRetry={load} noun="your inbox" />}
      {writeError && <WriteError error={writeError} onDismiss={() => setWriteError(null)} />}

      {loading ? (
        <div className="space-y-3">
          <div className="h-[104px] rounded-2xl border-2 border-gray-100 bg-white animate-pulse" />
          <div className="h-14 rounded-2xl border border-gray-100 bg-white animate-pulse" />
        </div>
      ) : stage === 'capture' ? (
        <CaptureStage
          items={feed}
          pending={pending}
          onCapture={capture}
          onRetry={saveCapture}
          onDropPending={dropPending}
          onDelete={removeTask}
        />
      ) : (
        <OrganizeStage
          items={queue}
          lists={listOptions}
          listFor={listFor}
          onPickList={pickList}
          onPatch={patchTask}
          onFile={file}
          onDelete={removeTask}
        />
      )}
    </div>
  );
}
