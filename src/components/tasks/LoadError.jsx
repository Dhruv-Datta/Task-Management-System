'use client';

/*
  What went wrong, said out loud.

  Without this, a database that isn't reachable renders as an empty page,
  indistinguishable from having no tasks, and the only clue is a 500 in the
  terminal. A 503 means the deployment isn't finished (no Supabase in the
  environment), which is a setup instruction, not a fault; anything else is a
  real error worth retrying.

  Shared by every page that loads tasks, so a dead database says the same thing
  wherever you happen to be standing.
*/

import { RefreshCw, ServerCrash } from 'lucide-react';

export default function LoadError({ error, onRetry, noun = 'your tasks' }) {
  const setup = error.status === 503;
  return (
    <div className={`rounded-2xl border p-4 mb-4 flex items-start gap-3 ${
      setup ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'
    }`}>
      <ServerCrash size={18} className={`mt-0.5 shrink-0 ${setup ? 'text-amber-500' : 'text-red-500'}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-bold ${setup ? 'text-amber-900' : 'text-red-900'}`}>
          {setup ? 'No database connected yet' : `Couldn't load ${noun}`}
        </p>
        <p className={`text-[13px] mt-0.5 leading-relaxed ${setup ? 'text-amber-800' : 'text-red-800'}`}>
          {error.message}
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg shrink-0 transition-colors ${
          setup ? 'text-amber-800 hover:bg-amber-100' : 'text-red-800 hover:bg-red-100'
        }`}
      >
        <RefreshCw size={13} /> Retry
      </button>
    </div>
  );
}
