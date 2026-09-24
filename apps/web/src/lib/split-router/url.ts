import { mergeBrowserEntries, parseBrowserEntries } from './entry-state';
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
    const location: SplitRouterExternalLocationValue = {
      pathname: value.pathname || '/',
      search: addPrefix(value.search, '?'),
      hash: addPrefix(value.hash, '#'),
    };
    if (Object.hasOwn(value, 'state')) location.state = value.state;
    return location;
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
  let segments = raw;
  const startsWithBase = base.every((part, index) => raw[index] === part);
  if (base.length > 0 && startsWithBase) segments = raw.slice(base.length);

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
  let parts = [segments];
  if (segments.includes(SPLIT_PATH_SEPARATOR)) {
    parts = framedParts(segments);
  }
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

    if (index === 0) return segments;
    return [SPLIT_PATH_SEPARATOR, ...segments];
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
  const browserEntries = parseBrowserEntries(externalLocation.state);
  const decodedEntries = decodeRouteLayout(options.routes, segments ?? []);
  let entryState: typeof browserEntries;
  if (browserEntries?.length === decodedEntries.length) {
    entryState = browserEntries;
  }
  const entries = decodedEntries.map((entry, index) => {
    const route = entry.location.route;
    const splitSearch = filterRouteSearch(
      options.routes,
      route,
      search.get(index)
    );
    const browserEntry = entryState?.[index];
    const decoded: SplitRouterEntry = {
      location: { ...entry.location },
    };
    if (splitSearch) decoded.location.search = splitSearch;
    if (browserEntry?.key) decoded.key = browserEntry.key;
    if (browserEntry && Object.hasOwn(browserEntry, 'state')) {
      decoded.state = browserEntry.state;
    }
    return decoded;
  });

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
  let ownedSearch: ReadonlySet<string>;
  if (options.preserveExternalSearch === false) {
    ownedSearch = new Set(options.routes.globalSearch ?? []);
  } else {
    ownedSearch = getExternalSearchKeys(options.routes, options.entries);
  }
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

  const encoded: SplitRouterExternalLocationValue = {
    pathname,
    search: '',
    hash: '',
    state: mergeBrowserEntries(options.previous.state, options.entries),
  };
  if (search) encoded.search = `?${search}`;
  if (!pathChanged || options.preserveHash) {
    encoded.hash = options.previous.hash;
  }
  return encoded;
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
