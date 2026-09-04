import { NextResponse } from 'next/server';
import { VersionConflictError } from './concurrency.js';

export function apiJson(data, init) {
  return NextResponse.json(data, init);
}

// The one canonical optimistic-concurrency conflict response. Every OCC-guarded
// route replies with this exact shape on a lost-update race, so a single client
// helper (src/lib/occClient.js) can recognize + reconcile it everywhere:
//   409 { conflict: true, current: <fresh server row/doc | null>, version }
export function conflictResponse(current) {
  return apiJson(
    { conflict: true, current: current ?? null, version: current?.version ?? 0 },
    { status: 409 }
  );
}

export function apiCreated(data) {
  return apiJson(data, { status: 201 });
}

export function apiBadRequest(message) {
  return apiJson({ error: message }, { status: 400 });
}

/*
  `status` wins when given. Otherwise the error may carry its own: a thrown
  ConfigurationError is a 503, not a 500, and "not authenticated" is a 401, so a
  misconfigured deployment reports itself accurately instead of looking like a
  crash. Anything without an opinion is a 500, as before.
*/
export function apiError(error, status) {
  const message = typeof error === 'string' ? error : error?.message || 'Internal server error';
  return apiJson({ error: message }, { status: status ?? error?.status ?? 500 });
}

export function apiOk(data = { ok: true }) {
  return apiJson(data);
}

export async function withApiError(handler) {
  try {
    return await handler();
  } catch (error) {
    // A lost-update race from versionedWrite becomes the canonical 409, so any
    // route wrapped in withApiError gets uniform conflict handling for free, with
    // no per-route try/catch.
    if (error instanceof VersionConflictError) {
      return conflictResponse(error.current);
    }
    return apiError(error);
  }
}
