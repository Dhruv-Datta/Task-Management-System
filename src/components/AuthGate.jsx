'use client';

import { useEffect } from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

// Shown when a gated API call 401s mid-session (cookie expired, signed out
// elsewhere, secret rotated). The page underneath is intentionally left mounted
// but blocked, so you keep your place; re-logging in lands you right back here
// with a fresh cookie.
function SessionExpiredOverlay() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl border border-gray-100 p-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center mx-auto mb-4">
          <LogIn size={22} />
        </div>
        <h2 className="text-lg font-bold text-gray-900">Session expired</h2>
        <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
          Your session is no longer valid. Please log in again to continue. Your work is saved.
        </p>
        <button
          /* A hard navigation, not router.push: the session is gone, so every
             piece of client state built under it should go with it. */
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          onClick={() => { window.location.href = '/login'; }}
          className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-sm hover:from-emerald-700 hover:to-emerald-600 transition-all"
        >
          <LogIn size={15} /> Log in
        </button>
      </div>
    </div>
  );
}

/*
  The client half of "protected routes". The hard gate is the edge proxy
  (src/proxy.js), which bounces an unauthenticated page request to /login and
  401s every non-auth API route before a handler ever runs. This is what makes
  that pleasant: no flash of an empty dashboard, and a real prompt when a
  session dies while the tab is open.
*/
export default function AuthGate({ children }) {
  const { authenticated, loading, sessionExpired } = useAuth();

  useEffect(() => {
    if (!loading && !authenticated) {
      // Hard navigation on purpose: this fires when a session dies under an
      // already-loaded app, and a full load is the only way to be sure nothing
      // from the signed-in session survives.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/login';
    }
  }, [authenticated, loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400 text-sm">Loading…</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400 text-sm">Redirecting to login…</p>
      </div>
    );
  }

  return (
    <>
      {children}
      {sessionExpired && <SessionExpiredOverlay />}
    </>
  );
}
