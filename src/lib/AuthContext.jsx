'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';

/*
  Who is signed in, for the whole client tree.

  Same shape as AlphaOS's AuthContext with the workspace machinery removed:
  there is one account, so there are no roles, no tenants, no ids and no
  per-user feature list to keep live. What remains is the part that matters: the
  session is checked once on mount, re-checked on tab focus, and any gated API
  call that comes back 401 flips `sessionExpired` so the user is told rather
  than shown a silently empty page.
*/

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(true);
  // Flipped on when a gated API call comes back 401, i.e. the session died
  // after we last checked (cookie expired, signed out elsewhere, or the JWT
  // secret was rotated under us). The mount check below only runs once, so
  // without this a mid-session expiry just makes every page silently empty;
  // the overlay in AuthGate turns it into a clear "please log in again".
  const [sessionExpired, setSessionExpired] = useState(false);

  // Watch every fetch for a 401 from a gated API route (src/proxy.js answers
  // `{ error: 'Unauthorized' }` 401 once the session can't be verified). Auth
  // endpoints handle their own 401s, so they're excluded. We only read the
  // status and pass the untouched response straight through, so existing
  // callers still get to read the body.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await originalFetch(...args);
      try {
        if (res.status === 401) {
          const input = args[0];
          const rawUrl = typeof input === 'string' ? input : (input?.url || '');
          const path = rawUrl.startsWith('http')
            ? new URL(rawUrl, window.location.origin).pathname
            : rawUrl;
          if (path.startsWith('/api/') && !path.startsWith('/api/auth/')) {
            setSessionExpired(true);
          }
        }
      } catch {
        // URL parsing/edge cases shouldn't ever break the underlying fetch.
      }
      return res;
    };
    return () => { window.fetch = originalFetch; };
  }, []);

  /*
    Pull the current session from the server.

    Only an explicit answer moves the needle: a 200 saying "authenticated", or a
    401 saying the session is gone (which also clears the cookie server-side, so
    the next page load lands on /login instead of bouncing between it and the
    app). A 500 or a dropped connection leaves the current state alone;
    signing someone out over a network blip would be worse than showing them a
    page that briefly can't load its data.
  */
  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.authenticated) {
          setAuthenticated(true);
          setUsername(data.user?.username || '');
        } else {
          setAuthenticated(false);
        }
      } else if (res.status === 401) {
        setAuthenticated(false);
      }
    } catch {
      // Network error: say nothing rather than sign the user out.
    }
  }, []);

  // On mount, check for an existing session cookie.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshSession();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refreshSession]);

  // Re-check on tab focus, so signing out on another device reaches an
  // already-open tab without a full reload.
  useEffect(() => {
    const onFocus = () => { if (authenticated) refreshSession(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [authenticated, refreshSession]);

  const login = useCallback(async (name, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Invalid credentials');
    }

    const data = await res.json().catch(() => ({}));
    setAuthenticated(true);
    // The server answers with the configured spelling, so signing in as "Dhruv"
    // still greets you as "dhruv".
    setUsername(data.username || name || '');
    setSessionExpired(false);
    return true;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear local state even if the server call fails.
    }
    setAuthenticated(false);
    setUsername('');
  }, []);

  return (
    <AuthContext.Provider
      value={{
        authenticated,
        username,
        loading,
        sessionExpired,
        refreshSession,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
