import { getPreferredCalendarPeriodView } from '@app/features/calendar/calendar-preferences';
import {
  CALENDAR_ROUTE_ID,
  CALENDAR_SEARCH_NAMESPACE,
  calendarPath,
} from '@app/features/calendar-view/calendar-url';
import { CALENDAR_VIEW_ID } from '@app/features/calendar-view/types';
import { CHANNEL_DETAIL_SEARCH_NAMESPACE } from '@app/features/channels-view/channels-route';
import {
  driveDocumentFromContent,
  drivePath,
} from '@app/features/drive-view/primitives/drive-route';
import { driveDocumentBlockType } from '@app/features/drive-view/primitives/drive-route-schema';
import { URL_PARAMS as EMAIL_URL_PARAMS } from '@app/features/email-thread/core/location';
import { EMAIL_DETAIL_SEARCH_NAMESPACE } from '@app/features/email-view/email-route';
import {
  routeParams,
  type SerializedSearchParams,
  type SplitRouterMiddleware,
  type SplitRouterMiddlewareContext,
  type SplitRouterMiddlewareResult,
} from '@app/lib/split-router';
import { replaceSplitSearchParams } from '@app/lib/split-router/search';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import { match } from 'ts-pattern';
import { appSplitRoutes } from './app-routes';
import { decodeLegacyPair } from './legacy-route';

type NewAppViewsState = {
  enabled: boolean;
  loading: boolean;
};

type AppMiddlewareState = {
  newAppViews: () => NewAppViewsState;
  isTouchDevice: () => boolean;
};

/** Upgrade legacy component and block URLs when supported; on touch, keep
 * document details in their full-block routes instead of inline Drive views. */
function redirectLegacyRoutes(
  { to, redirect }: SplitRouterMiddlewareContext,
  options: AppMiddlewareState
): SplitRouterMiddlewareResult {
  const route = to.location.route;

  const isTouch = options.isTouchDevice();

  if (route.matches[0].id === 'drive' && isTouch) {
    const { documentType, documentId } = routeParams(route);
    if (typeof documentType === 'string' && typeof documentId === 'string') {
      return redirect(
        `/${driveDocumentBlockType(documentType)}/${encodeURIComponent(documentId)}`
      );
    }
  }

  if (route.matches[0].id !== 'legacy-content') return;

  const { type, id } = routeParams(route);

  if (typeof type !== 'string' || typeof id !== 'string') return;

  const content = decodeLegacyPair(type, id);
  if (!content) return;

  const path = match(content)
    .with({ type: 'component', id: 'documents' }, () => '/drive')
    .with({ type: 'component', id: 'settings' }, () => '/settings')
    .with({ type: 'component', id: CALENDAR_VIEW_ID }, () =>
      calendarPath(getPreferredCalendarPeriodView())
    )
    .with({ type: 'component' }, ({ id }) =>
      appSplitRoutes.definitions.some((route) => route.id === `view-${id}`)
        ? `/${id}`
        : undefined
    )
    .when(
      () => {
        if (isTouch) return true;
        const flag = options.newAppViews();
        return flag.loading || !flag.enabled;
      },
      () => undefined
    )
    .with({ type: 'email' }, ({ id }) => `/mail/${encodeURIComponent(id)}`)
    .with(
      { type: 'channel' },
      ({ id }) => `/channels/${encodeURIComponent(id)}`
    )
    .with({ type: 'task' }, ({ id }) => `/tasks/${encodeURIComponent(id)}`)
    .otherwise((content) => {
      const document = driveDocumentFromContent(content);
      return document
        ? drivePath({ kind: 'tab', tab: 'owned' }, document)
        : undefined;
    });

  if (!path) return;

  return redirect(path);
}

/** On external entry, copy legacy detail query keys into the destination pane.
 * Keep repeated values and let explicit pane-local values take precedence. */
function migrateLegacySearch({
  to,
  path,
  cause,
  externalSearch,
  redirect,
}: SplitRouterMiddlewareContext): SplitRouterMiddlewareResult {
  if (cause !== 'initial' && cause !== 'external') return;

  if (!externalSearch) return;

  const leafId = to.location.route.matches.at(-1)?.id;

  const mapping = match(leafId)
    .with('mail-thread', () => ({
      namespace: EMAIL_DETAIL_SEARCH_NAMESPACE,
      fields: [[EMAIL_URL_PARAMS.messageId, 'messageId']] as const,
    }))
    .with('channels-channel', () => ({
      namespace: CHANNEL_DETAIL_SEARCH_NAMESPACE,
      fields: [
        [CHANNEL_URL_PARAMS.message, 'messageId'],
        [CHANNEL_URL_PARAMS.thread, 'threadId'],
      ] as const,
    }))
    .with(CALENDAR_ROUTE_ID, () => ({
      namespace: CALENDAR_SEARCH_NAMESPACE,
      fields: [['eventId', 'eventId']] as const,
    }))
    .otherwise(() => undefined);

  if (!mapping) return;

  const { namespace, fields } = mapping;

  const raw = new URLSearchParams(externalSearch);
  const current = to.location.search?.[namespace] ?? {};
  const additions: SerializedSearchParams = {};

  for (const [legacyKey, field] of fields) {
    // Explicit canonical values, including empty ones, take precedence.
    if (Object.hasOwn(current, field)) continue;

    const values = raw.getAll(legacyKey);

    if (values.length) additions[field] = values;
  }

  if (!Object.keys(additions).length) return;

  const search = {
    ...to.location.search,
    [namespace]: { ...current, ...additions },
  };

  const query = new URLSearchParams();

  // Middleware redirects describe one entry; the router assigns its pane index.
  replaceSplitSearchParams(query, [{ location: { search } }]);

  return redirect(`${path}?${query}`);
}

export function createAppSplitRouterMiddleware(
  state: AppMiddlewareState
): readonly SplitRouterMiddleware[] {
  return [
    (context) => redirectLegacyRoutes(context, state),
    migrateLegacySearch,
  ];
}
