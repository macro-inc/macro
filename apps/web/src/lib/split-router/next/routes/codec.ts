import deepEqual from 'fast-deep-equal';
import { createId, isRecord } from '../utils';
import {
  decodeFirstPane,
  decodePane,
  defaultRoute,
  formatPane,
  type SplitRoutesManifest,
} from './manifest';
import { decodeSegment, SPLIT_PATH_SEPARATOR, splitSegments } from './path';
import {
  externalSearchKeys,
  filterRouteSearch,
  keepsAllExternalSearch,
  parseRouteEntryState,
} from './queries';
import {
  isSplitSearchKey,
  parsePaneSearch,
  replacePaneSearchParams,
} from './search';
import type {
  Entry,
  ExternalLocation,
  PaneId,
  SplitHistoryPane,
  SplitHistoryState,
  SplitRouteState,
} from './types';

type DecodedPane = { paneId?: PaneId; entry: Entry };
type DecodedPanes = { panes: readonly DecodedPane[] };
type EncodedPane = { paneId: PaneId; entry: Entry };

const LOCATION_BASE = 'http://split-router.invalid';

export function parseLocation(value: string): Omit<ExternalLocation, 'state'> {
  const url = new URL(value, LOCATION_BASE);

  return { path: url.pathname, search: url.search, hash: url.hash };
}

function ensurePrefix(value: string, prefix: string): string {
  if (!value) return value;
  if (value.startsWith(prefix)) return value;

  return `${prefix}${value}`;
}

export function formatLocation(
  location: Pick<ExternalLocation, 'path' | 'search' | 'hash'>
): string {
  const path = location.path || '/';
  const search = ensurePrefix(location.search, '?');
  const hash = ensurePrefix(location.hash, '#');

  return `${path}${search}${hash}`;
}

/** Raw, still percent-encoded segments for each pane, split on `~`. */
export function splitPanePaths(path: string): string[][] {
  const panes: string[][] = [[]];

  for (const segment of splitSegments(path)) {
    if (segment === SPLIT_PATH_SEPARATOR) {
      panes.push([]);
      continue;
    }

    panes[panes.length - 1]!.push(segment);
  }

  return panes.filter((pane) => pane.length > 0);
}

function encodeSegment(segment: string): string {
  // `~` is unreserved, so a literal value would read back as a pane separator.
  return segment === SPLIT_PATH_SEPARATOR ? '%7E' : encodeURIComponent(segment);
}

function readHistoryPane(value: unknown): SplitHistoryPane | undefined {
  if (!isRecord(value)) return;
  if (typeof value.pane !== 'string') return;
  if (typeof value.entry !== 'string') return;

  const stored: SplitHistoryPane = {
    pane: value.pane as PaneId,
    entry: value.entry,
  };
  if (Object.hasOwn(value, 'state')) stored.state = value.state;

  return stored;
}

/** Validates an untrusted split-router slice of browser history state. */
export function readHistoryState(
  value: unknown
): SplitHistoryState | undefined {
  if (!isRecord(value)) return;
  if (!Array.isArray(value.panes)) return;

  const panes: SplitHistoryPane[] = [];

  for (const raw of value.panes) {
    const pane = readHistoryPane(raw);
    if (!pane) return;

    panes.push(pane);
  }

  return { panes };
}

function storedPanes(
  state: unknown,
  count: number
): readonly SplitHistoryPane[] | undefined {
  const saved = readHistoryState(state);
  if (!saved) return;
  if (saved.panes.length !== count) return;

  return saved.panes;
}

function storedState(
  routes: SplitRoutesManifest,
  route: SplitRouteState,
  pane: SplitHistoryPane | undefined
): unknown {
  if (!pane) return;
  if (!Object.hasOwn(pane, 'state')) return;

  const parsed = parseRouteEntryState(routes, route, pane.state);

  return parsed.success ? parsed.value : undefined;
}

function defaultPanes(
  routes: SplitRoutesManifest,
  createEntryId: () => string
): DecodedPanes {
  const entry: Entry = {
    id: createEntryId(),
    location: { route: defaultRoute(routes) },
  };

  return { panes: [{ entry }] };
}

/**
 * The first pane picks the URL's top-level route, and every later pane must
 * match under the same one. Undefined when nothing handles the URL.
 */
function paneRoutes(
  routes: SplitRoutesManifest,
  parts: readonly (readonly string[])[]
): SplitRouteState[] | undefined {
  const [first, ...rest] = parts.map((raw) => raw.map(decodeSegment));
  if (!first) return [];

  const firstRoute = decodeFirstPane(routes, first);
  if (!firstRoute) return;

  const root = firstRoute.matches[0].id;
  const restRoutes = rest.map((segments) => decodePane(routes, segments));
  const sharesRoot = restRoutes.every((route) => route?.matches[0].id === root);
  if (!sharesRoot) return;

  return [firstRoute, ...(restRoutes as SplitRouteState[])];
}

/** The panes a URL shows. A URL nothing handles shows the default route, which the router writes back. */
export function decodePanes(
  routes: SplitRoutesManifest,
  location: ExternalLocation,
  createEntryId: () => string = () => createId('entry')
): DecodedPanes {
  const parts = splitPanePaths(location.path);
  const decoded = paneRoutes(routes, parts);
  if (!decoded?.length) return defaultPanes(routes, createEntryId);

  const search = parsePaneSearch(location.search);
  const stored = storedPanes(location.state, parts.length);

  const panes = decoded.map((route, position): DecodedPane => {
    const pane = stored?.[position];
    const entry: Entry = {
      id: pane?.entry ?? createEntryId(),
      location: { route },
    };

    const paneSearch = filterRouteSearch(routes, route, search[position]);
    if (paneSearch) entry.location.search = paneSearch;

    const state = storedState(routes, route, pane);
    if (state !== undefined) entry.state = state;

    return pane ? { paneId: pane.pane, entry } : { entry };
  });

  return { panes };
}

export function formatPanePath(
  routes: SplitRoutesManifest,
  route: SplitRouteState
): string {
  const segments = formatPane(routes, route).map(encodeSegment);

  return `/${segments.join('/')}`;
}

function normalizePath(path: string): string {
  if (path.length > 1) return path.replace(/\/+$/g, '');

  return path || '/';
}

function panesPath(
  routes: SplitRoutesManifest,
  entries: readonly Entry[]
): string {
  const panePaths = entries.map((entry) =>
    formatPanePath(routes, entry.location.route)
  );

  return panePaths.join(`/${SPLIT_PATH_SEPARATOR}`);
}

function panesSearch(
  routes: SplitRoutesManifest,
  entries: readonly Entry[],
  previousSearch: string
): string {
  const owned = externalSearchKeys(routes, entries);
  const keepsAll = keepsAllExternalSearch(routes, entries);
  const query = new URLSearchParams();

  for (const [key, value] of new URLSearchParams(previousSearch)) {
    const external = !isSplitSearchKey(key);
    const keep = external && (keepsAll || owned.includes(key));
    if (keep) query.append(key, value);
  }

  const paneSearch = entries.map((entry) =>
    filterRouteSearch(routes, entry.location.route, entry.location.search)
  );
  replacePaneSearchParams(query, paneSearch);
  query.sort();

  const search = query.toString();

  return search ? `?${search}` : '';
}

function historyPane({ paneId, entry }: EncodedPane): SplitHistoryPane {
  const stored: SplitHistoryPane = { pane: paneId, entry: entry.id };
  if (entry.state !== undefined) stored.state = entry.state;

  return stored;
}

/**
 * The URL for `panes`. The hash from `previous` survives when the path is
 * unchanged, or with `keepHash` when rewriting the URL a URL navigation landed on.
 */
export function encodePanes(
  routes: SplitRoutesManifest,
  panes: readonly EncodedPane[],
  previous: Pick<ExternalLocation, 'path' | 'search' | 'hash'>,
  options: { keepHash?: boolean } = {}
): ExternalLocation {
  const entries = panes.map(({ entry }) => entry);
  const path = panesPath(routes, entries);
  const search = panesSearch(routes, entries, previous.search);
  const samePath = normalizePath(path) === normalizePath(previous.path);
  const keepHash = options.keepHash || samePath;

  return {
    path: path || '/',
    search,
    hash: keepHash ? previous.hash : '',
    state: { panes: panes.map(historyPane) },
  };
}

function sortedQuery(search: string): string {
  const query = new URLSearchParams(search);
  query.sort();

  return query.toString();
}

export function sameExternalLocation(
  left: ExternalLocation,
  right: ExternalLocation
): boolean {
  const samePath = normalizePath(left.path) === normalizePath(right.path);
  const sameSearch = sortedQuery(left.search) === sortedQuery(right.search);
  const sameHash = left.hash === right.hash;

  return (
    samePath && sameSearch && sameHash && deepEqual(left.state, right.state)
  );
}
