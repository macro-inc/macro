import type { SplitRoutesManifest } from './routes';
import { encodeRoute } from './routes';
import type {
  SplitRouterEvent,
  SplitRouterExternalLocationValue,
} from './types';
import { externalLocationToString, formatRoutePathname } from './url';

function defaultOrigin(): string {
  const origin = globalThis.location?.origin;
  if (!origin) {
    throw new Error(
      'Split router requires an external location origin to build Request URLs'
    );
  }
  return origin;
}

function buildPlatformRequest(
  location: string | SplitRouterExternalLocationValue,
  signal: AbortSignal,
  origin = defaultOrigin()
): Request {
  const value =
    typeof location === 'string'
      ? location
      : externalLocationToString(location);
  return new Request(new URL(value, origin), { signal });
}

export function withSplitRouterEventTarget<TSplitId>(
  routes: SplitRoutesManifest,
  event: SplitRouterEvent<TSplitId>,
  to: SplitRouterEvent<TSplitId>['to']
): SplitRouterEvent<TSplitId> {
  return {
    ...event,
    to,
    path: formatRoutePathname(routes, encodeRoute(routes, to)),
  };
}

export function buildSplitRouterEvent<TSplitId>(options: {
  routes: SplitRoutesManifest;
  location: string | SplitRouterExternalLocationValue;
  origin?: string;
  signal: AbortSignal;
  splitId: TSplitId | undefined;
  from: SplitRouterEvent<TSplitId>['from'];
  to: SplitRouterEvent<TSplitId>['to'];
  cause: SplitRouterEvent<TSplitId>['cause'];
  direction: SplitRouterEvent<TSplitId>['direction'];
}): SplitRouterEvent<TSplitId> {
  return {
    request: buildPlatformRequest(
      options.location,
      options.signal,
      options.origin
    ),
    splitId: options.splitId,
    from: options.from,
    to: options.to,
    path: formatRoutePathname(
      options.routes,
      encodeRoute(options.routes, options.to)
    ),
    cause: options.cause,
    direction: options.direction,
  };
}
