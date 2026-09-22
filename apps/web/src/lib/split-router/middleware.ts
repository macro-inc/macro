import { resolveNavigation } from './navigation';
import { assertRouteEntry, encodeRoute } from './routes';
import type {
  SplitLocation,
  SplitRouterEntry,
  SplitRouterEvent,
  SplitRouterMiddlewareConfig,
  SplitRouterMiddlewareResult,
  SplitRouterMiddlewareRun,
} from './types';
import { formatRoutePathname } from './url';
import { isAbortError, isPromise, throwIfAborted } from './utils';

type PreparedEntries = SplitRouterEntry[] | Promise<SplitRouterEntry[]>;

function withSearch(entry: SplitRouterEntry, search: SplitLocation['search']) {
  if (!search || entry.location.search) return entry;
  return { location: { ...entry.location, search } };
}

export function runSplitRouterMiddleware(
  config: SplitRouterMiddlewareConfig,
  event: SplitRouterEvent
): SplitRouterMiddlewareRun {
  const visited = new Set<string>();

  const runEntry = (current: SplitRouterEntry): SplitRouterMiddlewareRun => {
    throwIfAborted(event.request.signal);
    assertRouteEntry(config.routes, current);

    const currentEvent = {
      ...event,
      to: current,
      path: formatRoutePathname(
        config.routes,
        encodeRoute(config.routes, current)
      ),
    };
    const signature = JSON.stringify([
      currentEvent.path,
      current.location.search,
    ]);
    if (visited.has(signature)) {
      throw new Error(`Split router middleware redirect loop at ${signature}`);
    }
    visited.add(signature);

    const runAt = (index: number): SplitRouterMiddlewareRun => {
      throwIfAborted(event.request.signal);
      const handler = config.handlers[index];
      if (!handler) {
        assertRouteEntry(config.routes, current);
        return current;
      }

      const result = handler({
        ...currentEvent,
        redirect: (to) => ({ type: 'redirect', to }),
      });
      const handleResult = (
        settled: SplitRouterMiddlewareResult
      ): SplitRouterMiddlewareRun => {
        throwIfAborted(event.request.signal);
        if (!settled) return runAt(index + 1);

        const next = resolveNavigation(
          config.routes,
          current,
          current,
          settled.to
        );
        if (!next) {
          throw new Error(
            `Split router middleware redirected to an invalid route: ${settled.to}`
          );
        }
        return runEntry(withSearch(next, current.location.search));
      };

      return isPromise(result)
        ? result.then(handleResult)
        : handleResult(result);
    };

    return runAt(0);
  };

  return runEntry(event.to);
}

function recoverFailure(
  error: unknown,
  config: SplitRouterMiddlewareConfig,
  event: SplitRouterEvent
): SplitRouterEntry {
  if (isAbortError(error, event.request.signal)) throw error;
  assertRouteEntry(config.routes, event.to);
  console.error('Split router middleware failed; continuing navigation', error);
  return event.to;
}

export function prepareEntry(
  config: SplitRouterMiddlewareConfig,
  event: SplitRouterEvent
): SplitRouterMiddlewareRun {
  assertRouteEntry(config.routes, event.to);
  try {
    const prepared = runSplitRouterMiddleware(config, event);
    return isPromise(prepared)
      ? prepared.catch((error) => recoverFailure(error, config, event))
      : prepared;
  } catch (error) {
    return recoverFailure(error, config, event);
  }
}

export function prepareEntries(
  config: SplitRouterMiddlewareConfig,
  events: readonly SplitRouterEvent[]
): PreparedEntries {
  const prepared = events.map((event) => prepareEntry(config, event));
  return prepared.some(isPromise)
    ? Promise.all(prepared)
    : (prepared as SplitRouterEntry[]);
}
