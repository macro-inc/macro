import { resolveNavigation } from './navigation';
import {
  assertRouteEntry,
  encodeRoute,
  type SplitRoutesManifest,
} from './routes';
import type {
  SplitLocation,
  SplitRouterEntry,
  SplitRouterMiddlewareConfig,
  SplitRouterMiddlewareRequest,
  SplitRouterMiddlewareResult,
  SplitRouterMiddlewareRun,
} from './types';
import { formatRoutePathname } from './url';
import { isAbortError, isPromise, throwIfAborted } from './utils';

type BatchRequest = {
  from?: readonly SplitRouterEntry[];
  to: SplitRouterEntry[];
  cause: SplitRouterMiddlewareRequest['cause'];
  externalSearch?: string;
  signal: AbortSignal;
};

type PreparedEntries = SplitRouterEntry[] | Promise<SplitRouterEntry[]>;

function withSearch(
  entry: SplitRouterEntry,
  search: SplitLocation['search']
): SplitRouterEntry {
  if (!search || entry.location.search) return entry;

  return {
    location: {
      ...entry.location,
      search,
    },
  };
}

function entryPath(
  routes: SplitRoutesManifest,
  entry: SplitRouterEntry
): string {
  return formatRoutePathname(routes, encodeRoute(routes, entry));
}

/**
 * Runs one proposed entry through middleware, following redirects safely.
 * Remains synchronous until a middleware actually returns a Promise.
 */
export function runSplitRouterMiddleware(
  config: SplitRouterMiddlewareConfig,
  request: SplitRouterMiddlewareRequest
): SplitRouterMiddlewareRun {
  const visited = new Set<string>();

  const runEntry = (current: SplitRouterEntry): SplitRouterMiddlewareRun => {
    throwIfAborted(request.signal);
    assertRouteEntry(config.routes, current);

    const path = entryPath(config.routes, current);
    const signature = JSON.stringify([path, current.location.search]);
    if (visited.has(signature)) {
      throw new Error(`Split router middleware redirect loop at ${signature}`);
    }
    visited.add(signature);

    const handleResult = (
      result: SplitRouterMiddlewareResult,
      nextIndex: number
    ): SplitRouterMiddlewareRun => {
      throwIfAborted(request.signal);

      if (!result) return runAt(nextIndex);

      const next = resolveNavigation(
        config.routes,
        current,
        current,
        result.to
      );
      if (!next) {
        throw new Error(
          `Split router middleware redirected to an invalid route: ${result.to}`
        );
      }

      return runEntry(withSearch(next, current.location.search));
    };

    const runAt = (index: number): SplitRouterMiddlewareRun => {
      throwIfAborted(request.signal);

      const handler = config.handlers[index];
      if (!handler) {
        assertRouteEntry(config.routes, current);
        return current;
      }

      const result = handler({
        from: request.from,
        to: current,
        path,
        externalSearch: request.externalSearch,
        cause: request.cause,
        signal: request.signal,
        redirect: (to) => ({ type: 'redirect', to }),
      });

      return isPromise(result)
        ? result.then((settled) => handleResult(settled, index + 1))
        : handleResult(result, index + 1);
    };

    return runAt(0);
  };

  return runEntry(request.to);
}

function recoverFailure(
  error: unknown,
  config: SplitRouterMiddlewareConfig,
  request: SplitRouterMiddlewareRequest
): SplitRouterEntry {
  if (isAbortError(error, request.signal)) throw error;
  // Failure recovery must never publish a malformed original proposal.
  assertRouteEntry(config.routes, request.to);

  console.error('Split router middleware failed; continuing navigation', error);
  return request.to;
}

export function prepareEntry(
  config: SplitRouterMiddlewareConfig,
  request: SplitRouterMiddlewareRequest
): SplitRouterMiddlewareRun {
  assertRouteEntry(config.routes, request.to);
  try {
    const prepared = runSplitRouterMiddleware(config, request);

    return isPromise(prepared)
      ? prepared.catch((error) => recoverFailure(error, config, request))
      : prepared;
  } catch (error) {
    return recoverFailure(error, config, request);
  }
}

export function prepareEntries(
  config: SplitRouterMiddlewareConfig,
  request: BatchRequest
): PreparedEntries {
  const prepared = request.to.map((entry, index) =>
    prepareEntry(config, {
      from: request.from?.[index],
      to: entry,
      cause: request.cause,
      externalSearch: request.externalSearch,
      signal: request.signal,
    })
  );

  return prepared.some(isPromise)
    ? Promise.all(prepared)
    : (prepared as SplitRouterEntry[]);
}
