import { formatPanePath } from '../routes/codec';
import type { SplitRoutesManifest } from '../routes/manifest';
import { filterRouteSearch } from '../routes/queries';
import { locationOf } from '../routes/search';
import { resolveTarget } from '../routes/targets';
import type { Entry } from '../routes/types';
import {
  andThen,
  CANCELLED,
  isAbortError,
  type MaybePromise,
  type Outcome,
  settleMaybe,
} from '../utils';
import type { NavigationCause } from './types';

export type SplitRouterMiddlewareResult =
  | { type: 'redirect'; to: string }
  | { type: 'cancel' };

export type SplitRouterMiddlewareContext = {
  routes: SplitRoutesManifest;
  /** The entry the pane is leaving, if any. */
  from: Readonly<Entry> | undefined;
  /** The proposed entry; it has not been applied yet. */
  to: Readonly<Entry>;
  /** Canonical single-pane path for `to`. */
  path: string;
  cause: NavigationCause;
  /** Raw incoming query on initial and external navigation, unchanged across redirects. */
  externalSearch?: string;
  signal: AbortSignal;
  redirect(to: string): SplitRouterMiddlewareResult;
  cancel(): SplitRouterMiddlewareResult;
};

export type SplitRouterMiddleware = (
  context: SplitRouterMiddlewareContext
) => MaybePromise<SplitRouterMiddlewareResult | undefined | void>;

type MiddlewareRequest = {
  from?: Entry;
  to: Entry;
  cause: NavigationCause;
  externalSearch?: string;
  signal: AbortSignal;
};

type MiddlewareRun = {
  readonly routes: SplitRoutesManifest;
  readonly handlers: readonly SplitRouterMiddleware[];
  readonly request: MiddlewareRequest;
  readonly visited: string[];
};

function recordVisit(visited: string[], path: string, entry: Entry): void {
  const signature = JSON.stringify([path, entry.location.search ?? null]);

  if (visited.includes(signature)) {
    throw new Error(`Split router middleware redirect loop at ${signature}`);
  }

  visited.push(signature);
}

function middlewareContext(
  run: MiddlewareRun,
  entry: Entry,
  path: string
): SplitRouterMiddlewareContext {
  const { request } = run;

  return {
    routes: run.routes,
    from: request.from,
    to: entry,
    path,
    cause: request.cause,
    externalSearch: request.externalSearch,
    signal: request.signal,
    redirect: (to) => ({ type: 'redirect', to }),
    cancel: () => ({ type: 'cancel' }),
  };
}

function redirectEntry(
  routes: SplitRoutesManifest,
  entry: Entry,
  to: string
): Entry {
  const location = resolveTarget(routes, entry.location, to, { depth: 0 });

  if (!location) {
    throw new Error(
      `Split router middleware redirected to an invalid route: ${to}`
    );
  }

  // Unlike a navigation, a redirect keeps search across root routes, filtered to what the new route owns.
  const search =
    location.search ??
    filterRouteSearch(routes, location.route, entry.location.search);

  return { ...entry, location: locationOf(location.route, search) };
}

function runEntry(run: MiddlewareRun, entry: Entry): Outcome<Entry> {
  run.request.signal.throwIfAborted();

  const path = formatPanePath(run.routes, entry.location.route);
  recordVisit(run.visited, path, entry);

  return runHandler(run, entry, path, 0);
}

function runHandler(
  run: MiddlewareRun,
  entry: Entry,
  path: string,
  index: number
): Outcome<Entry> {
  const handler = run.handlers[index];
  if (!handler) return entry;

  const result = handler(middlewareContext(run, entry, path));

  return andThen(result, (settled): Outcome<Entry> => {
    // A handler can settle after the navigation was called off.
    run.request.signal.throwIfAborted();

    if (!settled) return runHandler(run, entry, path, index + 1);
    if (settled.type === 'cancel') return CANCELLED;

    return runEntry(run, redirectEntry(run.routes, entry, settled.to));
  });
}

/**
 * Runs one proposed entry through every handler, following redirects and
 * rejecting loops. Errors fall back to the proposed entry; aborts propagate.
 */
export function runMiddleware(
  routes: SplitRoutesManifest,
  handlers: readonly SplitRouterMiddleware[],
  request: MiddlewareRequest
): Outcome<Entry> {
  const run: MiddlewareRun = { routes, handlers, request, visited: [] };

  return settleMaybe(
    () => runEntry(run, request.to),
    (error) => {
      if (isAbortError(error, request.signal)) throw error;

      console.error(
        'Split router middleware failed; continuing navigation',
        error
      );

      return request.to;
    }
  );
}
