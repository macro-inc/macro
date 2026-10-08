import {
  agentsRouteFromSegments,
  agentsRouteSegments,
} from '@app/features/agents-view/core/route';
import { getPreferredCalendarPeriodView } from '@app/features/calendar/calendar-preferences';
import { isCalendarRange } from '@app/features/calendar-view/calendar-range';
import {
  CALENDAR_ROUTE_ID,
  CALENDAR_SEARCH_NAMESPACE,
  calendarSearchCodec,
  calendarTargetSearch,
} from '@app/features/calendar-view/calendar-url';
import { CALENDAR_VIEW_ID } from '@app/features/calendar-view/types';
import { channelsSearch } from '@app/features/channels-view/channels-route';
import {
  ROUTINE_CREATE_ROUTE_ID,
  ROUTINE_DETAIL_ROUTE_ID,
  ROUTINES_ROUTE_ID,
  routineContent,
  routineIdFromContent,
  routineLocation,
} from '@app/features/routines/routine-navigation';
import {
  canonicalRoute,
  decodePane,
  decodeSegment,
  filterRouteSearch,
  formatPanePath,
  isRecord,
  routeParams,
  type SplitLocation,
  type SplitRoutesManifest,
  type SplitSearchState,
  splitPanePaths,
} from '@app/lib/split-router';
import {
  NOT_FOUND_ROUTE_ID,
  paneRootMatch,
  paneRoute,
} from '@app/routes/app-route';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import type { BlockAlias, BlockName } from '@core/block';
import {
  blocks,
  fileTypeToBlockName,
  isBlockAlias,
  resolveBlockAlias,
} from '@core/constant/allBlocks';
import type { SplitContent } from '../layoutManager';

type LegacySplitPathContext = {
  segments: string[];
  matchedRouteId?: string;
};

export function decodeLegacyPair(
  type: string,
  id: string
): SplitContent | undefined {
  if (!type || !id) return;

  if (type === 'routine' || type === 'automation') return routineContent(id);

  const agentsRoute = agentsRouteFromSegments(type, id);
  if (agentsRoute) return { type: 'component', id: agentsRoute };

  if (type === 'settings') {
    return { type: 'component', id: 'settings' };
  }

  if (type === 'calendar' && id === CALENDAR_BLOCK_ID) {
    return { type: 'component', id: CALENDAR_VIEW_ID };
  }

  if (type === 'component') {
    // Reminder list/detail surfaces are native routes only.
    // Preview Pair placeholders must never reach the view registry.
    return {
      type: 'component',
      id: id === 'preview-empty' || id === 'non-member-channel' ? 'home' : id,
    };
  }

  const resolvedType =
    type === 'write'
      ? resolveBlockAlias(fileTypeToBlockName(type))
      : resolveBlockAlias(type as BlockName | BlockAlias);
  if (!Object.hasOwn(blocks, resolvedType)) return;

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

function legacyLocation(type: string, id: string): SplitLocation | undefined {
  if (type === 'routine' || type === 'automation') return routineLocation(id);
  const agentsRoute = agentsRouteFromSegments(type, id);
  if (agentsRoute) {
    return { route: paneRoute({ id: type, params: { id } }) };
  }

  if (type === 'settings') {
    return { route: paneRoute({ id: 'settings', params: { tab: id } }) };
  }

  if (type === 'component' && id === 'settings') {
    return { route: paneRoute({ id: 'settings', params: { tab: 'account' } }) };
  }

  if (type === 'component' && id === 'documents') {
    return { route: paneRoute({ id: 'drive', params: {} }) };
  }

  if (!decodeLegacyPair(type, id)) return;

  return { route: paneRoute({ id: 'legacy-content', params: { type, id } }) };
}

export function handleLegacySplitPath(
  context: LegacySplitPathContext
): SplitLocation[] | undefined {
  const { segments } = context;

  if (segments.length === 1 && ['documents', 'files'].includes(segments[0]!)) {
    return [{ route: paneRoute({ id: 'drive', params: {} }) }];
  }

  // The retired Getting Started checklist's own path.
  if (segments.length === 1 && segments[0] === 'getting-started') {
    return [{ route: paneRoute({ id: 'view-home', params: {} }) }];
  }

  if (
    context.matchedRouteId &&
    context.matchedRouteId !== 'settings' &&
    context.matchedRouteId !== ROUTINE_DETAIL_ROUTE_ID &&
    context.matchedRouteId !== ROUTINE_CREATE_ROUTE_ID &&
    !context.matchedRouteId.startsWith('view-') &&
    context.matchedRouteId !== 'legacy-content'
  ) {
    return;
  }
  if (segments.length < 2 || segments.length % 2 !== 0) return;

  const locations = [];

  for (let index = 0; index < segments.length; index += 2) {
    if (
      segments[index] === 'component' &&
      (segments[index + 1] === 'preview-empty' ||
        segments[index + 1] === 'non-member-channel')
    )
      continue;
    const location = legacyLocation(segments[index]!, segments[index + 1]!);

    if (!location) return;

    locations.push(location);
  }

  return locations;
}

/** One pane of an incoming path, as pane paths; old pair paths can expand into several panes. */
function upgradeLegacyPane(
  routes: SplitRoutesManifest,
  raw: readonly string[]
): string[] {
  const unchanged = [raw.join('/')];
  const segments = raw.map(decodeSegment);
  const route = decodePane(routes, segments);
  const matched =
    route !== undefined && route.matches.at(-1)?.id !== NOT_FOUND_ROUTE_ID;
  if (matched) return unchanged;

  const upgraded = handleLegacySplitPath({ segments });
  if (!upgraded?.length) return unchanged;

  return upgraded.map((location) =>
    formatPanePath(routes, location.route).slice(1)
  );
}

/** Rewrites panes of an incoming path that no route matches, as the old URL format wrote them. */
export function upgradeLegacyPath(
  routes: SplitRoutesManifest,
  path: string
): string {
  const panes = splitPanePaths(path);
  const upgraded = panes.map((raw) => upgradeLegacyPane(routes, raw));
  const changed = upgraded.some(
    (paths, index) => paths.length !== 1 || paths[0] !== panes[index]!.join('/')
  );
  if (!changed) return path;

  return `/${upgraded.flat().join('/~/')}`;
}

export function encodeLegacyContent(content: SplitContent): string[] {
  return [
    content.type === 'component'
      ? content.type
      : content.aliasContext?.alias || content.type,
    content.id,
  ];
}

export function splitLocationFromContent(
  routes: SplitRoutesManifest,
  content: SplitContent
): SplitLocation {
  // Persisted panes can still contain the old block discriminator.
  if (['routine', 'automation'].includes(content.type))
    return routineLocation(content.id);
  if (content.type === 'component' && content.id === 'routines') {
    return routineLocation(routineIdFromContent(content));
  }
  if (
    content.type === 'component' &&
    content.id === 'agents' &&
    content.params?.agentPage === 'routines'
  ) {
    return routineLocation(
      typeof content.params.routineId === 'string'
        ? content.params.routineId
        : undefined
    );
  }
  if (
    (content.type === 'component' && content.id === CALENDAR_VIEW_ID) ||
    (content.type === 'calendar' && content.id === CALENDAR_BLOCK_ID)
  ) {
    const params: Record<string, unknown> = isRecord(content.params)
      ? content.params
      : {};
    const search = calendarSearchCodec.serialize(
      calendarTargetSearch({
        eventId:
          typeof params.eventId === 'string' && params.eventId.length > 0
            ? params.eventId
            : undefined,
        occurrenceKey:
          typeof params.occurrenceKey === 'string'
            ? params.occurrenceKey
            : undefined,
        range: isCalendarRange(params.range) ? params.range : undefined,
      })
    );
    return {
      route: paneRoute({
        id: CALENDAR_ROUTE_ID,
        params: { period: getPreferredCalendarPeriodView() },
      }),
      ...(search ? { search: { [CALENDAR_SEARCH_NAMESPACE]: search } } : {}),
    };
  }

  if (content.type === 'pr') {
    return {
      route: paneRoute({
        id: 'pr-detail',
        params: { foreignEntityId: content.id },
      }),
    };
  }

  if (content.type === 'call') {
    return {
      route: paneRoute({ id: 'call-detail', params: { callId: content.id } }),
    };
  }

  if (content.type === 'component' && content.id === 'documents') {
    return { route: paneRoute({ id: 'drive', params: {} }) };
  }

  if (content.type === 'component' && content.id === 'settings') {
    return { route: paneRoute({ id: 'settings', params: { tab: 'account' } }) };
  }

  if (content.type === 'component') {
    const viewId = `view-${content.id}`;
    if (routes.byId.has(viewId)) {
      return { route: paneRoute({ id: viewId, params: {} }) };
    }
    const segments = agentsRouteSegments(content.id);
    const [section, id] = segments ?? [];
    if (section && id) {
      return { route: paneRoute({ id: section, params: { id } }) };
    }
  }

  const [type, id] = encodeLegacyContent(content);
  return { route: paneRoute({ id: 'legacy-content', params: { type, id } }) };
}

/** Resolve legacy/persisted metadata before it reaches router state. */
export function resolveContentLocation(
  routes: SplitRoutesManifest,
  content: SplitContent
): SplitLocation {
  let metadata: Record<string, unknown> | undefined;
  if (isRecord(content.entryMetadata)) metadata = content.entryMetadata;

  let metadataLocation = metadata;
  if (isRecord(metadata?.location)) metadataLocation = metadata.location;
  // Go through the URL representation, not schema validation of schema outputs.
  const resolve = (route: SplitLocation['route']) => {
    const canonical = canonicalRoute(routes, route);
    if (!canonical)
      throw new Error('Split content did not resolve to its route');

    return canonical;
  };
  let route: SplitLocation['route'] | undefined;
  if (isRecord(metadataLocation?.route)) {
    try {
      route = resolve(metadataLocation.route as SplitLocation['route']);
    } catch {
      // Old or malformed metadata falls back to the content's compatibility route.
    }
  }
  route ??= resolve(splitLocationFromContent(routes, content).route);
  const savedSearch = isRecord(metadataLocation?.search)
    ? (metadataLocation.search as SplitSearchState)
    : undefined;
  // In-app message opens carry block params, not external URL query keys.
  // Preserve the target before middleware upgrades the block to Chat, where
  // the legacy block (and its imperative navigation handle) is replaced.
  const channelParams: Record<string, unknown> | undefined =
    content.type === 'channel' && isRecord(content.params)
      ? content.params
      : undefined;
  const messageId = channelParams?.[CHANNEL_URL_PARAMS.message];
  const threadId = channelParams?.[CHANNEL_URL_PARAMS.thread];
  let contentSearch = savedSearch;
  if (typeof messageId === 'string') {
    const channelSearch = { ...savedSearch?.[channelsSearch.namespace] };
    // Message and thread identify one target; never combine two saved opens.
    if (!Object.hasOwn(channelSearch, 'messageId')) {
      channelSearch.messageId = [messageId];
      if (typeof threadId === 'string') channelSearch.threadId = [threadId];
      else delete channelSearch.threadId;
    }
    contentSearch = {
      ...savedSearch,
      [channelsSearch.namespace]: channelSearch,
    };
  }
  const search = filterRouteSearch(routes, route, contentSearch);
  const location: SplitLocation = { route };
  if (search) location.search = search;
  return location;
}

export function splitContentFromLocation(
  location: SplitLocation
): SplitContent {
  const root = paneRootMatch(location.route);

  if (!root || root.id === NOT_FOUND_ROUTE_ID) {
    return { type: 'component', id: NOT_FOUND_ROUTE_ID };
  }

  if (root.id === ROUTINES_ROUTE_ID) return routineContent();
  if (root.id === ROUTINE_CREATE_ROUTE_ID) return routineContent('new');
  if (root.id === ROUTINE_DETAIL_ROUTE_ID) {
    const { routineId } = routeParams(location.route);
    if (typeof routineId === 'string' && routineId.length > 0)
      return routineContent(routineId);
    throw new Error('Invalid routine detail split route');
  }

  if (root.id.startsWith('view-'))
    return { type: 'component', id: root.id.slice('view-'.length) };
  if (root.id === 'drive') return { type: 'component', id: 'documents' };
  if (root.id === 'settings') return { type: 'component', id: 'settings' };
  if (root.id === 'pr-detail') {
    const { foreignEntityId } = routeParams(location.route);
    if (typeof foreignEntityId === 'string' && foreignEntityId.length > 0) {
      return { type: 'pr', id: foreignEntityId };
    }
    throw new Error('Invalid PR detail split route');
  }
  if (root.id === 'call-detail') {
    const { callId } = routeParams(location.route);
    if (typeof callId === 'string' && callId.length > 0) {
      return { type: 'call', id: callId };
    }
    throw new Error('Invalid call detail split route');
  }

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
