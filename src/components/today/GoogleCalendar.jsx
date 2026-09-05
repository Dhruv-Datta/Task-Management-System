'use client';

/*
  THE TWO CONTROLS THE GOOGLE CONNECTION NEEDS, and deliberately no more.

  A calendar integration is the kind of feature that grows a settings page, and
  then a settings page with a calendar picker on it, and by then you are
  maintaining a second, worse copy of Google Calendar's own sidebar. So there is
  no settings page. There are two controls, each living exactly where the
  question it answers gets asked:

    GoogleChip     in the timeline's own header, because "is my real day on
                   here?" is a question you ask while looking at the timeline.
                   It connects, says how much it drew, refreshes, disconnects.
    GoogleSync     on the finished day, because "did what I decided reach my
                   phone?" is a question you ask once, at the end. The day
                   sends itself after every edit, planned or finished (see
                   AUTO_SEND_MS in /today), so this mostly REPORTS — and stays
                   pressable, for the send you want right now rather than in a
                   second.

  WHICH CALENDARS ARE READ is not a setting here either: it is the ones ticked
  in Google Calendar's own sidebar. If a birthdays calendar is cluttering the
  day, the place to untick it is the place you already untick it, and it stays
  unticked everywhere rather than in one app's private opinion.
*/

import { useCallback, useRef, useState } from 'react';
import {
  AlertTriangle, Check, Link2, Loader2, RefreshCw, Unlink, UploadCloud, X,
} from 'lucide-react';
import { MenuPortal } from '@/components/tasks/TaskPickers';

/** Google's own blue: the dot on the chip says whose events these are. */
const GOOGLE_BLUE = '#4285f4';

/*
  Kicking off the consent flow is a NAVIGATION, not a fetch: /api/google/connect
  answers with a redirect to accounts.google.com, and you come back to /today a
  minute later. Doing it with fetch would follow the redirect in the background
  and hand us Google's sign-in page as a string.
*/
function startConnect() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = '/api/google/connect';
}

/** Why we are not connected, said in the words the fix is in. */
function connectLabel(reason) {
  if (reason === 'reauth_required') return 'Reconnect Google';
  return 'Connect Google';
}

function connectHint(reason) {
  if (reason === 'reauth_required') {
    return 'Google has revoked this app’s access — connect again to keep drawing your calendar';
  }
  return 'Show your real Google Calendar on this timeline, and send the day back to it when you finish planning';
}

/**
 * The chip in the timeline header.
 *
 * `google` is null while the page is still asking, and undrawn when the
 * deployment has no Google client configured at all — a button that cannot
 * work is worse than no button, and this feature is entirely optional: with it
 * absent, /today is exactly the page it was before.
 */
export function GoogleChip({ google, count, allDayCount = 0, refreshing, onRefresh, onDisconnect }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  if (!google || !google.configured) return null;

  if (!google.connected) {
    return (
      <button
        type="button"
        onClick={startConnect}
        title={connectHint(google.reason)}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg transition-colors ${
          google.reason === 'reauth_required'
            ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
            : 'text-gray-500 hover:bg-gray-100'
        }`}
      >
        {google.reason === 'reauth_required'
          ? <AlertTriangle size={12} strokeWidth={2.5} />
          : <Link2 size={12} strokeWidth={2.5} />}
        {connectLabel(google.reason)}
      </button>
    );
  }

  const total = count + allDayCount;
  /*
    The count is the whole point of the chip. "Connected" is a claim; "4 from
    Google" is evidence, and it is the difference between trusting the empty
    Tuesday you are looking at and wondering whether the sync is broken.
  */
  const label = google.loading
    ? 'Reading…'
    : total === 0
      ? 'Nothing in Google'
      : `${total} from Google`;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        title={[
          google.email && `Connected to ${google.email}`,
          google.failed?.length > 0 && `Could not read: ${google.failed.join(', ')}`,
        ].filter(Boolean).join('\n') || 'Google Calendar'}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
      >
        {google.failed?.length > 0 ? (
          <AlertTriangle size={11} strokeWidth={2.5} className="text-amber-500" />
        ) : (
          <span
            aria-hidden
            className="w-[7px] h-[7px] rounded-full flex-shrink-0"
            style={{ backgroundColor: GOOGLE_BLUE }}
          />
        )}
        {label}
      </button>

      {open && (
        <MenuPortal anchorRef={anchorRef} onClose={close} align="right" width={230}>
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Google Calendar</p>
            <p className="mt-0.5 text-[12px] text-gray-700 truncate" title={google.email || ''}>
              {google.email || 'Connected'}
            </p>
            {/* Said out loud rather than swallowed: a day drawn from three of
                your four calendars looks exactly like a day drawn from four. */}
            {google.failed?.length > 0 && (
              <p className="mt-1 text-[11px] text-amber-600 leading-snug">
                Could not read {google.failed.join(', ')}.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => { close(); onRefresh(); }}
            className="w-full text-left px-3 py-1.5 text-sm text-gray-600 flex items-center gap-2 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh the day
          </button>

          <button
            type="button"
            onClick={() => { close(); onDisconnect(); }}
            title="Stop reading and writing this calendar. Events already in Google are left alone."
            className="w-full text-left px-3 py-1.5 text-sm text-gray-600 flex items-center gap-2 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <Unlink size={13} />
            Disconnect
          </button>
        </MenuPortal>
      )}
    </>
  );
}

/**
 * The other half: what happened to the day you finished.
 *
 * Four states, and the distinction that matters is the last two. A day that has
 * been sent and a day that has been sent AND CHANGED SINCE look identical on a
 * timeline — the blocks are all still there — so the difference has to be said
 * out loud, or you close the laptop believing your phone knows about the
 * eleven-o'clock you moved twenty minutes ago.
 *
 * The changed state is now a MOMENT rather than a decision: the page sends
 * itself a second and a half after you stop editing, from the first block you
 * place to the last one you move. It is still drawn, because a second and a
 * half of silence about a change you just made is exactly the wrong amount of
 * silence, and it is still a button, because sometimes you are closing the
 * laptop now.
 */
export function GoogleSync({ google, sync, onSync }) {
  if (!google?.configured || !google.connected) return null;

  if (sync.status === 'sending') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-500 px-2.5 py-2">
        <Loader2 size={14} className="animate-spin" />
        Sending to Google…
      </span>
    );
  }

  if (sync.status === 'error') {
    return (
      <button
        type="button"
        onClick={onSync}
        title={sync.error || 'The day did not reach Google Calendar'}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-2 rounded-xl transition-colors active:scale-95"
      >
        <AlertTriangle size={14} strokeWidth={2.5} />
        Not sent — try again
      </button>
    );
  }

  if (sync.dirty) {
    return (
      <button
        type="button"
        onClick={onSync}
        title="The day has changed since it was last sent. It goes to Google by itself in a moment — press to send it now."
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-2 rounded-xl transition-colors active:scale-95"
      >
        <UploadCloud size={14} strokeWidth={2.5} />
        Send changes
      </button>
    );
  }

  /*
    Sent, and up to date. Still a button, because a send is also a
    RECONCILIATION — it is what re-creates a block you deleted in Google and
    still want, and what moves the day into a calendar you have just renamed —
    but a quiet one, since there is nothing to do.
  */
  return (
    <button
      type="button"
      onClick={onSync}
      title={[
        sync.at && `Last sent ${new Date(sync.at).toLocaleTimeString()}`,
        'Press to send it again — it re-checks every block against your calendar.',
      ].filter(Boolean).join('\n')}
      className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-400 hover:text-gray-700 hover:bg-gray-100 px-2.5 py-2 rounded-xl transition-colors"
    >
      <Check size={14} strokeWidth={2.5} className="text-emerald-500" />
      {/* Named, when we know the name. "In Personal / Work" is the whole
          answer to "did that go where I meant it to"; "In Google Calendar"
          only answers half of it. */}
      {sync.count === 0
        ? 'Nothing to send'
        : sync.calendar ? `In ${sync.calendar}` : 'In Google Calendar'}
    </button>
  );
}

/*
  WHAT HAPPENED WHEN YOU CAME BACK FROM GOOGLE.

  The consent flow leaves the app entirely and returns as a fresh page load, so
  there is no component still mounted to have been told how it went. The
  callback route says so in the URL instead (`/today?google=…`), /today reads it
  once and scrubs it, and this turns the one word into a sentence.

  It matters most when it FAILED. A redirect back to a page that looks exactly
  as it did before you left is the worst possible answer to "did that work?" —
  and the failures here are not all the same: two of them are things you did (a
  cancelled consent screen, a stale link) and two are things the deployment has
  to fix. Each says which, and where.
*/
const NOTICES = {
  connected: {
    tone: 'emerald',
    title: 'Google Calendar connected',
    body: 'Today’s events are on the timeline below, and finishing the day will send your blocks back to it.',
  },
  denied: {
    tone: 'gray',
    title: 'Google Calendar was not connected',
    body: 'The consent screen was dismissed. Nothing has changed — you can connect whenever you like.',
  },
  state: {
    tone: 'amber',
    title: 'That connection attempt had expired',
    body: 'The link back from Google is only good for a few minutes, and it can only be used in the browser that started it. Press Connect again.',
  },
  unconfigured: {
    tone: 'amber',
    title: 'Google Calendar is not set up on this deployment',
    body: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing from the environment. See the README.',
  },
  no_refresh_token: {
    tone: 'amber',
    title: 'Google did not hand over a lasting grant',
    body: 'This happens when the app is already authorized in a half-finished state. Remove it at myaccount.google.com/permissions, then connect again.',
  },
  error: {
    tone: 'amber',
    title: 'Connecting Google Calendar failed',
    body: 'The exchange with Google did not complete. Check that this app’s redirect URI is registered in the Google Cloud console, then try again.',
  },
  /*
    The one notice whose body is not written here. A failed push has a real
    reason — most often "there is no calendar by that name yet" — and that
    reason is an instruction, so it comes through from the server verbatim
    rather than being flattened into "something went wrong".
  */
  push_failed: {
    tone: 'amber',
    title: 'The day did not reach Google Calendar',
    body: 'The send failed. Nothing on today has changed; press Send changes to try again.',
  },
  /*
    A single event of yours, refused. Its body comes through verbatim too, and
    for the same reason: the commonest refusal is not a fault but a fact — a
    calendar shared with you read-only, or a meeting somebody else organized —
    and the block on the grid has already sprung back to where it was, which on
    its own looks exactly like a gesture that does not work.
  */
  event_failed: {
    tone: 'amber',
    title: 'That event was not changed',
    body: 'Google would not take the change, so the event is as it was.',
  },
};

const NOTICE_TONES = {
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  gray: 'border-gray-200 bg-gray-50 text-gray-700',
};

export function GoogleNotice({ status, message, onDismiss }) {
  const notice = NOTICES[status];
  if (!notice) return null;

  return (
    <div className={`rounded-2xl border p-4 mb-4 flex items-start gap-3 ${NOTICE_TONES[notice.tone]}`}>
      {notice.tone === 'emerald'
        ? <Check size={18} className="mt-0.5 shrink-0 text-emerald-600" />
        : <AlertTriangle size={18} className="mt-0.5 shrink-0 opacity-60" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{notice.title}</p>
        <p className="text-[13px] mt-0.5 leading-relaxed opacity-90">{message || notice.body}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss"
        className="p-1.5 rounded-lg opacity-40 hover:opacity-100 hover:bg-black/5 shrink-0 transition-all"
      >
        <X size={15} />
      </button>
    </div>
  );
}
