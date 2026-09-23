import {
  agentsRouteFromSegments,
  agentsRouteSegments,
} from '@app/features/agents-view/core/route';
import { getPreferredCalendarPeriodView } from '@app/features/calendar/calendar-preferences';
import {
  CALENDAR_ROUTE_ID,
  CALENDAR_SEARCH_NAMESPACE,
  calendarSearchCodec,
} from '@app/features/calendar-view/calendar-url';
import { CALENDAR_VIEW_ID } from '@app/features/calendar-view/types';
import type { DriveLocation } from '@app/features/drive-view/core/types';
import type { DriveDocumentRoute } from '@app/features/drive-view/primitives/drive-route';
import { URL_PARAMS as EMAIL_URL_PARAMS } from '@app/features/email-thread/core/location';
import {
  defineRoute,
  routeParams,
  type SplitLocation,
  type SplitRouteMatch,
  type SplitRouterEntry,
  type UnmatchedSplitPathHandler,
} from '@app/lib/split-router';
import {
  assertRouteState,
  decodeRoute,
  encodeRoute,
  filterRouteSearch,
  type SplitRoutesManifest,
} from '@app/lib/split-router/routes';
import { parseSearchState } from '@app/lib/split-router/search';
import { isRecord } from '@app/lib/split-router/utils';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import type { BlockAlias, BlockName } from '@core/block';
import { isBlockAlias, resolveBlockAlias } from '@core/constant/allBlocks';
import { z } from 'zod';
import type { SplitContent } from '../layoutManager';

export function decodeLegacyPair(
  type: string,
  id: string
): SplitContent | undefined {
  if (!type || !id) return;

  const agentsRoute = agentsRouteFromSegments(type, id);
  if (agentsRoute) return { type: 'component', id: agentsRoute };

  if (type === 'settings') {
    return { type: 'component', id: 'settings' };
  }

  if (type === 'calendar' && id === CALENDAR_BLOCK_ID) {
    return { type: 'component', id: CALENDAR_VIEW_ID };
  }

  if (type === 'component') {
    // Retired Preview Pair placeholders must never reach the view registry.
    return {
      type: 'component',
      id: id === 'preview-empty' || id === 'non-member-channel' ? 'inbox' : id,
    };
  }

  const resolvedType = resolveBlockAlias(type as BlockName | BlockAlias);

  if (isBlockAlias(type)) {
    return {
      type,
      id,
      aliasContext: {
        alias: type,
        baseType: resolvedType,
      },
    };
  }

  return { type: resolvedType, id };
}

function legacyEntry(type: string, id: string): SplitRouterEntry | undefined {
  const agentsRoute = agentsRouteFromSegments(type, id);
  if (agentsRoute) {
    return {
      location: {
        route: { matches: [{ id: type, params: { id } }] },
      },
    };
  }

  if (type === 'settings') {
    return {
      location: {
        route: { matches: [{ id: 'settings', params: { tab: id } }] },
      },
    };
  }

  if (type === 'component' && id === 'settings') {
    return {
      location: {
        route: { matches: [{ id: 'settings', params: { tab: 'account' } }] },
      },
    };
  }

  if (type === 'component' && id === 'documents') {
    return {
      location: { route: { matches: [{ id: 'drive', params: {} }] } },
    };
  }

  if (!decodeLegacyPair(type, id)) return;

  return {
    location: {
      route: {
        matches: [{ id: 'legacy-content', params: { type, id } }],
      },
    },
  };
}

export const handleLegacySplitPath: UnmatchedSplitPathHandler = (context) => {
  const { segments } = context;

  if (segments.length === 1 && ['documents', 'files'].includes(segments[0]!)) {
    return [
      {
        location: {
          route: { matches: [{ id: 'drive', params: {} }] },
        },
      },
    ];
  }

  if (
    context.matchedRouteId &&
    context.matchedRouteId !== 'settings' &&
    !context.matchedRouteId.startsWith('view-') &&
    context.matchedRouteId !== 'legacy-content'
  ) {
    return;
  }
  if (segments.length < 2 || segments.length % 2 !== 0) return;

  const entries = [];

  for (let index = 0; index < segments.length; index += 2) {
    if (
      segments[index] === 'component' &&
      (segments[index + 1] === 'preview-empty' ||
        segments[index + 1] === 'non-member-channel')
    )
      continue;
    const entry = legacyEntry(segments[index]!, segments[index + 1]!);

    if (!entry) return;

    entries.push(entry);
  }

  return entries;
};

export function encodeLegacyContent(content: SplitContent): string[] {
  return [
    content.type === 'component'
      ? content.type
      : content.aliasContext?.alias || content.type,
    content.id,
  ];
}

export function driveSplitContent(
  location: DriveLocation,
  document?: DriveDocumentRoute
): SplitContent {
  const matches: [SplitRouteMatch, ...SplitRouteMatch[]] = [
    { id: 'drive', params: {} },
  ];
  if (location.kind === 'folder') {
    matches.push({
      id: 'drive-folder',
      params: { view: 'folder', folderId: location.id ?? undefined },
    });
  } else if (location.tab !== 'owned') {
    matches.push({ id: 'drive-tab', params: { tab: location.tab } });
  }
  if (document) {
    matches.push({
      id:
        location.kind === 'folder'
          ? 'drive-folder-document'
          : location.tab === 'owned'
            ? 'drive-document'
            : 'drive-tab-document',
      params: { documentId: document.id, documentType: document.type },
    });
  }
  return {
    type: 'component',
    id: 'documents',
    entryMetadata: { route: { matches } },
  };
}

export function splitLocationFromContent(
  routes: SplitRoutesManifest,
  content: SplitContent
): SplitLocation {
  if (
    (content.type === 'component' && content.id === CALENDAR_VIEW_ID) ||
    (content.type === 'calendar' && content.id === CALENDAR_BLOCK_ID)
  ) {
    const rawEventId = isRecord(content.params)
      ? (content.params as Record<string, unknown>).eventId
      : undefined;
    const eventId =
      typeof rawEventId === 'string' && rawEventId.length > 0 ? rawEventId : '';
    const search = calendarSearchCodec.serialize({ eventId });
    return {
      route: {
        matches: [
          {
            id: CALENDAR_ROUTE_ID,
            params: { period: getPreferredCalendarPeriodView() },
          },
        ],
      },
      ...(search ? { search: { [CALENDAR_SEARCH_NAMESPACE]: search } } : {}),
    };
  }

  if (content.type === 'component' && content.id === 'documents') {
    return { route: { matches: [{ id: 'drive', params: {} }] } };
  }

  if (content.type === 'component' && content.id === 'settings') {
    return {
      route: {
        matches: [{ id: 'settings', params: { tab: 'account' } }],
      },
    };
  }

  if (content.type === 'component') {
    const viewId = `view-${content.id}`;
    if (routes.byId.has(viewId)) {
      return { route: { matches: [{ id: viewId, params: {} }] } };
    }
    const segments = agentsRouteSegments(content.id);
    const [section, id] = segments ?? [];
    if (section && id) {
      return { route: { matches: [{ id: section, params: { id } }] } };
    }
  }

  const [type, id] = encodeLegacyContent(content);
  return {
    route: {
      matches: [{ id: 'legacy-content', params: { type, id } }],
    },
  };
}

/** Resolve legacy/persisted metadata before it reaches router state. */
export function resolveContentLocation(
  routes: SplitRoutesManifest,
  content: SplitContent
): SplitLocation {
  const metadata = isRecord(content.entryMetadata)
    ? content.entryMetadata
    : undefined;
  const resolve = (route: unknown) => {
    assertRouteState(routes, route);
    // Go through the URL representation, not schema validation of schema outputs.
    const decoded = decodeRoute(
      routes,
      encodeRoute(routes, { location: { route } })
    );
    if (
      !decoded ||
      decoded.location.route.matches.length !== route.matches.length ||
      decoded.location.route.matches.some(
        (match, index) => match.id !== route.matches[index]!.id
      )
    ) {
      throw new Error('Split content did not resolve to its route');
    }
    return decoded.location.route;
  };
  let route: SplitLocation['route'] | undefined;
  if (metadata?.route !== undefined) {
    try {
      route = resolve(metadata.route);
    } catch {
      // Old or malformed metadata falls back to the content's compatibility route.
    }
  }
  route ??= resolve(splitLocationFromContent(routes, content).route);
  const search = filterRouteSearch(
    routes,
    route,
    parseSearchState(metadata?.search)
  );
  return search ? { route, search } : { route };
}

export function splitContentFromLocation(
  location: SplitLocation
): SplitContent {
  const root = location.route.matches[0];

  if (root.id.startsWith('view-'))
    return { type: 'component', id: root.id.slice('view-'.length) };
  if (root.id === 'drive') return { type: 'component', id: 'documents' };
  if (root.id === 'settings') return { type: 'component', id: 'settings' };

  const params = routeParams(location.route);
  if (
    root.id === 'agents' ||
    root.id === 'coders' ||
    root.id === 'agent-chats'
  ) {
    const id = typeof params.id === 'string' ? params.id : undefined;
    const componentId = id ? agentsRouteFromSegments(root.id, id) : undefined;
    if (componentId) return { type: 'component', id: componentId };
    throw new Error(`Invalid ${root.id} split route`);
  }

  if (root.id === 'legacy-content') {
    const type = typeof params.type === 'string' ? params.type : undefined;
    const id = typeof params.id === 'string' ? params.id : undefined;
    const content = type && id ? decodeLegacyPair(type, id) : undefined;
    if (content) return content;
  }

  throw new Error(`No split content matched route "${root.id}"`);
}

export const legacySplitRoute = defineRoute({
  id: 'legacy-content',
  path: ':type/:id',
  search: '*',
  params: z.object({ type: z.string().min(1), id: z.string().min(1) }),
  externalSearch: (entry) => {
    const { type } = routeParams(entry.location.route);
    if (type === 'email') return Object.values(EMAIL_URL_PARAMS);
    if (type === 'channel') return Object.values(CHANNEL_URL_PARAMS);
    return [];
  },
  claim: ({ type, id }) => {
    const content = decodeLegacyPair(type, id);
    if (!content) return;

    if (content.type === 'component') {
      const [section, conversationId] = agentsRouteSegments(content.id) ?? [];
      if (section && conversationId) {
        return {
          namespace: section === 'agent-chats' ? 'chat' : 'agent',
          id: conversationId,
        };
      }
      return { namespace: 'component', id: content.id };
    }

    return {
      namespace: 'block',
      id: `${content.aliasContext?.baseType ?? content.type}:${id}`,
    };
  },
});
