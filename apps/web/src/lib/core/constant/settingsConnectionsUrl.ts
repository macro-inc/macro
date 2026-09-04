import { toBaseRelative } from '@app/constants/routerBase';

export const CONNECTIONS_TAB_SLUG = 'connections';
export const CONNECTIONS_DISCOVER_SLUG = 'discover';

export const CONNECTIONS_PROVIDER_SLUGS = [
  'google',
  'github',
  'linear',
  'notion',
  'slack',
  'cursor',
] as const;

export type ConnectionsProviderSlug =
  (typeof CONNECTIONS_PROVIDER_SLUGS)[number];

export type ConnectionsRestToken =
  | typeof CONNECTIONS_DISCOVER_SLUG
  | ConnectionsProviderSlug
  | `discover-${ConnectionsProviderSlug}`;

const PROVIDER_SLUGS: ReadonlySet<string> = new Set(CONNECTIONS_PROVIDER_SLUGS);

const FROM_DISCOVER_PREFIX = 'discover-';

export function isConnectionsProviderSlug(
  value: string
): value is ConnectionsProviderSlug {
  return PROVIDER_SLUGS.has(value);
}

export function connectionsProviderFromRest(
  rest: string | null
): ConnectionsProviderSlug | null {
  if (!rest) return null;
  if (isConnectionsProviderSlug(rest)) return rest;
  if (rest.startsWith(FROM_DISCOVER_PREFIX)) {
    const slug = rest.slice(FROM_DISCOVER_PREFIX.length);
    return isConnectionsProviderSlug(slug) ? slug : null;
  }
  return null;
}

export function connectionsRestForProvider(
  id: ConnectionsProviderSlug,
  fromDiscover: boolean
): string {
  return fromDiscover ? `${FROM_DISCOVER_PREFIX}${id}` : id;
}

export function connectionsRestIsDiscoverReturn(rest: string | null): boolean {
  return Boolean(rest?.startsWith(FROM_DISCOVER_PREFIX));
}

export function isConnectionsRestToken(
  value: string
): value is ConnectionsRestToken {
  return (
    value === CONNECTIONS_DISCOVER_SLUG ||
    connectionsProviderFromRest(value) !== null
  );
}

export function settingsSplitSegmentCount(
  tabSlug: string,
  nextSegment?: string
): 2 | 3 {
  return tabSlug === CONNECTIONS_TAB_SLUG &&
    nextSegment !== undefined &&
    isConnectionsRestToken(nextSegment)
    ? 3
    : 2;
}

export function connectionsRestFromPath(pathname: string): string | null {
  const segments = toBaseRelative(pathname).split('/').filter(Boolean);
  for (let i = 0; i + 1 < segments.length; i += 2) {
    if (
      segments[i] === 'settings' &&
      segments[i + 1] === CONNECTIONS_TAB_SLUG
    ) {
      const rest = segments[i + 2];
      return rest && isConnectionsRestToken(rest) ? rest : null;
    }
  }
  return null;
}
