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
  'other',
] as const;

export type ConnectionsProviderSlug =
  (typeof CONNECTIONS_PROVIDER_SLUGS)[number];

export type ConnectionsRestToken =
  | typeof CONNECTIONS_DISCOVER_SLUG
  | ConnectionsProviderSlug;

const PROVIDER_SLUGS: ReadonlySet<string> = new Set(CONNECTIONS_PROVIDER_SLUGS);

export function isConnectionsProviderSlug(
  value: string
): value is ConnectionsProviderSlug {
  return PROVIDER_SLUGS.has(value);
}

export function isConnectionsRestToken(
  value: string
): value is ConnectionsRestToken {
  return value === CONNECTIONS_DISCOVER_SLUG || isConnectionsProviderSlug(value);
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
