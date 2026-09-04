'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useTaskView } from '@/lib/taskView';
import { NAV_AREAS, TASK_VIEWS, areaForPath } from '@/lib/navigation';

/*
  The app bar. It does two things, and keeps them visibly apart.

  On the LEFT, after the mark, are the two places you can be: Today and Tasks.
  They are links and they are drawn as tabs: a word, and a rule under the one
  you are on, because that is what navigation looks like everywhere.

  To their right, and only on /tasks, is the VIEW SWITCHER: board, list,
  calendar. Those are buttons in a recessed group, because switching view doesn't
  move you anywhere; the group is the control's own surface, which is what stops
  it reading as three more destinations. Two segmented pill groups side by side
  would have said "these are the same kind of choice", and they are not.

  Everything sits in the SAME max-w-[1400px] container the page below uses, so
  the mark lines up with the page's left edge and the sign-out button with its
  right. Only sign-out goes to the far right, because it is the one thing you
  should never hit by accident while reaching for a view.
*/

// A place. The rule under the active one is the whole indicator; a filled chip
// here would make the tabs compete with the view group beside them.
function AreaTab({ area, active }) {
  const Icon = area.icon;
  return (
    <Link
      href={area.href}
      title={area.hint}
      aria-current={active ? 'page' : undefined}
      className={`relative flex items-center gap-2 px-1 py-2 text-[14.5px] font-semibold no-underline whitespace-nowrap transition-colors duration-150 ${
        active ? 'text-gray-900' : 'text-gray-400 hover:text-gray-700'
      }`}
    >
      <Icon size={16} strokeWidth={2.25} className={active ? 'text-emerald-600' : ''} />
      {area.label}
      <span
        className={`absolute -bottom-[3px] left-0 right-0 h-[2px] rounded-full bg-gray-900 transition-opacity duration-150 ${
          active ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </Link>
  );
}

// A way of looking. Only the ACTIVE one is drawn as a solid chip; the rest stay
// quiet until hovered, so the group reads as one control rather than a row of
// competing outlines.
function ViewPill({ view, active, onSelect }) {
  const Icon = view.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(view.key)}
      title={view.hint}
      aria-pressed={active}
      className={`flex items-center gap-2 px-3 sm:px-3.5 py-1.5 rounded-lg text-[13.5px] font-semibold transition-colors duration-150 outline-none whitespace-nowrap ${
        active
          ? 'bg-white text-gray-900 shadow-sm'
          : 'text-gray-500 hover:text-gray-900'
      }`}
    >
      <Icon size={15} strokeWidth={2.25} className={active ? 'text-emerald-600' : ''} />
      {/* The label is the first thing to go on a narrow screen; the icon and the
          active chip still say which view you are in. */}
      <span className="hidden sm:inline">{view.label}</span>
    </button>
  );
}

export default function Navbar() {
  const { logout } = useAuth();
  const { view, setView } = useTaskView();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    // Hard navigation rather than router.push: signing out should leave nothing
    // of the session behind, including cached RSC payloads and in-memory state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/login';
  }, [logout]);

  const area = areaForPath(pathname);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-[9999] bg-white/80 backdrop-blur-xl backdrop-saturate-150 transition-shadow duration-300 ${
        // A hairline while you're at the top, a soft lift once the content is
        // sliding underneath. One cue, not a whole change of material.
        scrolled ? 'border-b border-gray-200/80 shadow-sm' : 'border-b border-gray-100'
      }`}
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12 h-20 flex items-center gap-4 sm:gap-6">
        <Link
          href="/today"
          aria-label="Tasks"
          className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-sm shadow-emerald-500/25 no-underline shrink-0 transition-transform duration-150 hover:scale-105"
        >
          <CheckCircle2 size={21} strokeWidth={2.5} />
        </Link>

        <div role="navigation" aria-label="Areas" className="flex items-center gap-4 sm:gap-5">
          {NAV_AREAS.map(a => (
            <AreaTab key={a.key} area={a} active={area?.key === a.key} />
          ))}
        </div>

        {/* The switcher belongs to /tasks, so it is only there. */}
        {area?.key === 'tasks' && (
          <>
            <span className="hidden sm:block w-px h-5 bg-gray-200 shrink-0" aria-hidden />
            <div
              role="group"
              aria-label="Task view"
              className="flex items-center gap-0.5 p-1 rounded-xl bg-gray-100/80"
            >
              {TASK_VIEWS.map(v => (
                <ViewPill key={v.key} view={v} active={view === v.key} onSelect={setView} />
              ))}
            </div>
          </>
        )}

        <button
          onClick={handleLogout}
          title="Sign out"
          aria-label="Sign out"
          className="ml-auto flex items-center justify-center w-10 h-10 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors duration-150"
        >
          <LogOut size={19} />
        </button>
      </div>
    </nav>
  );
}
