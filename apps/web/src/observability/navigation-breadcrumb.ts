import {
  claimOf,
  isSafeName,
  type SplitRouterMiddlewareContext,
} from '@app/lib/split-router';
import { fireAndForget } from '@core/util/fireAndForget';
import { isTauri } from '@core/util/platform';
import { Telemetry } from '@macro-inc/observability';
import type { FrontendEvent } from './generated/native-diagnostics';
import { recordNativeDiagnostic } from './native-diagnostics';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Navigated = Extract<FrontendEvent, { kind: 'navigated' }>;

/** The native schema rejects the whole event on one bad field, which also
 * disables diagnostics for the document, so drop anything it would refuse. */
function codeName(value: string | undefined): string | null {
  return value !== undefined && isSafeName(value) ? value : null;
}

/** The type of entity a route claims; views such as Search claim no entity. */
function claimedEntityType(claim: string | undefined): string | null {
  const [namespace, ...rest] = claim?.split(':') ?? [];
  const [type, id] =
    namespace === 'block'
      ? [rest[0], rest.slice(1).join(':')]
      : [namespace, rest.join(':')];
  return UUID.test(id ?? '') ? codeName(type) : null;
}

export function navigationBreadcrumb({
  routes,
  from,
  to,
  cause,
}: Pick<SplitRouterMiddlewareContext, 'routes' | 'from' | 'to' | 'cause'>):
  | Navigated
  | undefined {
  const route = codeName(to.location.route.matches.at(-1)?.id);
  if (!route) return;
  return {
    kind: 'navigated',
    cause,
    route,
    from_route: codeName(from?.location.route.matches.at(-1)?.id),
    entity_type: claimedEntityType(claimOf(routes, to.location.route)),
  };
}

/**
 * Records where a pane is going in the native host before the destination
 * loads, and flushes telemetry still queued in this document, so both survive
 * a WebContent termination while it loads. Never changes the navigation.
 */
export function recordNavigationBreadcrumb(
  context: SplitRouterMiddlewareContext
): undefined {
  if (!isTauri()) return;
  try {
    const breadcrumb = navigationBreadcrumb(context);
    if (breadcrumb) recordNativeDiagnostic(breadcrumb);
  } catch (error) {
    Telemetry.error(error, { surface: 'navigation-breadcrumb' });
  }
  fireAndForget(Telemetry.flush(), 'navigation-telemetry-flush');
}
