import {
  assertRouteEntry,
  decodeRoute,
  encodeRoute,
  filterRouteSearch,
  findMatchingRouteId,
  getExternalSearchKeys,
  type SplitRoutesManifest,
} from './routes';
import {
  isSplitSearchKey,
  parseSplitSearch,
  replaceSplitSearchParams,
} from './search';
import type {
  SplitRouterEntry,
  SplitRouterExternalLocationValue,
} from './types';

export const SPLIT_PATH_SEPARATOR = '~';

function addPrefix(value: string, prefix: '?' | '#'): string {
  if (!value || value.startsWith(prefix)) return value;

  return `${prefix}${value}`;
}

export function externalLocationToString(
  location: SplitRouterExternalLocationValue
): string {
  const search = addPrefix(location.search, '?');
  const hash = addPrefix(location.hash, '#');

  return `${location.pathname || '/'}${search}${hash}`;
}

export function parseExternalLocation(
  value: string | SplitRouterExternalLocationValue
): SplitRouterExternalLocationValue {
  if (typeof value !== 'string') {
    return {
      pathname: value.pathname || '/',
      search: addPrefix(value.search, '?'),
      hash: addPrefix(value.hash, '#'),
    };
  }

  const parsed = new URL(value, 'https://split-router.invalid');

  return {
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
  };
}

export function parseRoutePathname(
  routes: SplitRoutesManifest,
  pathname: string
): string[] | undefined {
  const raw = pathname
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
  const base = routes.basePath;
  const segments =
    base.length > 0 && base.every((part, index) => raw[index] === part)
      ? raw.slice(base.length)
      : raw;

  try {
    return segments.map(decodeURIComponent);
  } catch {
    return;
  }
}

export function formatRoutePathname(
  routes: SplitRoutesManifest,
  segments: string[]
): string {
  return `/${[...routes.basePath, ...segments]
    .map(encodeURIComponent)
    .join('/')}`;
}

function framedParts(segments: string[]): string[][] {
  const parts: string[][] = [[]];

  for (const segment of segments) {
    if (segment === SPLIT_PATH_SEPARATOR) {
      parts.push([]);
    } else {
      parts.at(-1)!.push(segment);
    }
  }

  return parts.filter((part) => part.length > 0);
}

export function decodeRouteLayout(
  routes: SplitRoutesManifest,
  segments: string[]
): SplitRouterEntry[] {
  const parts = segments.includes(SPLIT_PATH_SEPARATOR)
    ? framedParts(segments)
    : [segments];
  const decoded = parts.map((part) => decodeRoute(routes, part));

  if (decoded.length > 0 && decoded.every(Boolean)) {
    return decoded as SplitRouterEntry[];
  }

  for (const handle of routes.unmatchedPathHandlers ?? []) {
    const recovered = handle({
      segments,
      matchedRouteId: findMatchingRouteId(routes, segments),
    });

    if (recovered) {
      for (const entry of recovered) assertRouteEntry(routes, entry);
      return recovered;
    }
  }

  if (!routes.defaultEntry) return [];
  const entry = routes.defaultEntry();
  assertRouteEntry(routes, entry);
  return [entry];
}

export function encodeRouteLayout(
  routes: SplitRoutesManifest,
  entries: SplitRouterEntry[]
): string[] {
  return entries.flatMap((entry, index) => {
    const segments = encodeRoute(routes, entry);

    return index === 0 ? segments : [SPLIT_PATH_SEPARATOR, ...segments];
  });
}

export type DecodedSplitRouterLocation = {
  entries: SplitRouterEntry[];
  externalLocation: SplitRouterExternalLocationValue;
};

export function decodeSplitRouterLocation(options: {
  routes: SplitRoutesManifest;
  location: string | SplitRouterExternalLocationValue;
}): DecodedSplitRouterLocation {
  const externalLocation = parseExternalLocation(options.location);
  const segments = parseRoutePathname(
    options.routes,
    externalLocation.pathname
  );
  const search = parseSplitSearch(externalLocation.search);
  const entries = decodeRouteLayout(options.routes, segments ?? []).map(
    (entry, index) => {
      const route = entry.location.route;
      const splitSearch = filterRouteSearch(
        options.routes,
        route,
        search.get(index)
      );

      return {
        location: {
          ...entry.location,
          ...(splitSearch ? { search: splitSearch } : {}),
        },
      };
    }
  );

  return { entries, externalLocation };
}

export function encodeSplitRouterLocation(options: {
  routes: SplitRoutesManifest;
  entries: SplitRouterEntry[];
  previous: SplitRouterExternalLocationValue;
  preserveHash?: boolean;
  preserveExternalSearch?: boolean;
}): SplitRouterExternalLocationValue {
  const pathname = formatRoutePathname(
    options.routes,
    encodeRouteLayout(options.routes, options.entries)
  );
  const ownedSearch =
    options.preserveExternalSearch === false
      ? new Set(options.routes.globalSearch ?? [])
      : getExternalSearchKeys(options.routes, options.entries);
  const query = new URLSearchParams();

  for (const [key, value] of new URLSearchParams(options.previous.search)) {
    if (!isSplitSearchKey(key) && ownedSearch.has(key)) {
      query.append(key, value);
    }
  }

  replaceSplitSearchParams(
    query,
    options.entries.map((entry) => ({
      location: {
        search: filterRouteSearch(
          options.routes,
          entry.location.route,
          entry.location.search
        ),
      },
    }))
  );
  query.sort();

  const search = query.toString();
  const pathChanged =
    pathname.replace(/\/+$/g, '') !==
    options.previous.pathname.replace(/\/+$/g, '');

  return {
    pathname,
    search: search ? `?${search}` : '',
    hash: !pathChanged || options.preserveHash ? options.previous.hash : '',
  };
}

export function serializeSplitRouterLocation(options: {
  routes: SplitRoutesManifest;
  entries: SplitRouterEntry[];
  previous: string | SplitRouterExternalLocationValue;
  preserveHash?: boolean;
  preserveExternalSearch?: boolean;
}): string {
  return externalLocationToString(
    encodeSplitRouterLocation({
      ...options,
      previous: parseExternalLocation(options.previous),
    })
  );
}
