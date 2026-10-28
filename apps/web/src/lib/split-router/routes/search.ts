import { isSafeName } from '../utils';
import type {
  SerializedSearchParams,
  SplitLocation,
  SplitRouteState,
  SplitSearchState,
  SplitSearchUpdate,
} from './types';

const SPLIT_SEARCH_PREFIX = /^s\d+\./;
const SPLIT_SEARCH_KEY =
  /^s(\d+)\.([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)$/;
const MAX_SEARCH_VALUE_LENGTH = 16_384;

type PaneSearchKey = { position: number; namespace: string; field: string };

export function isSplitSearchKey(key: string): boolean {
  return SPLIT_SEARCH_PREFIX.test(key);
}

export function assertSafeSearchName(
  value: string,
  kind: 'namespace' | 'field'
): void {
  if (!isSafeName(value)) {
    throw new Error(`Invalid split search ${kind} "${value}"`);
  }
}

function hasKeys(record: object): boolean {
  return Object.keys(record).length > 0;
}

function ownValue<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function parsePaneSearchKey(key: string): PaneSearchKey | undefined {
  const match = SPLIT_SEARCH_KEY.exec(key);
  if (!match) return;

  const position = Number(match[1]);
  const namespace = match[2]!;
  const field = match[3]!;
  const safe =
    Number.isSafeInteger(position) &&
    isSafeName(namespace) &&
    isSafeName(field);
  if (!safe) return;

  return { position, namespace, field };
}

function appendPaneValue(
  panes: (SplitSearchState | undefined)[],
  { position, namespace, field }: PaneSearchKey,
  value: string
): void {
  const namespaces = panes[position] ?? {};
  const fields = ownValue(namespaces, namespace) ?? {};
  const values = ownValue(fields, field) ?? [];

  fields[field] = [...values, value];
  namespaces[namespace] = fields;
  panes[position] = namespaces;
}

/** Pane search indexed by pane position, from `s{i}.{namespace}.{field}` keys. */
export function parsePaneSearch(
  value: string
): (SplitSearchState | undefined)[] {
  const panes: (SplitSearchState | undefined)[] = [];

  for (const [key, fieldValue] of new URLSearchParams(value)) {
    const parsed = parsePaneSearchKey(key);
    if (!parsed) continue;
    if (fieldValue.length > MAX_SEARCH_VALUE_LENGTH) continue;

    appendPaneValue(panes, parsed, fieldValue);
  }

  return panes;
}

/** A search value too long for the URL; callers refuse the navigation rather than fail. */
export class SearchValueTooLongError extends Error {
  constructor(field: string) {
    super(`Split search value for "${field}" is too long`);
    this.name = 'SearchValueTooLongError';
  }
}

function assertSearchValueLength(field: string, value: string): void {
  if (value.length > MAX_SEARCH_VALUE_LENGTH) {
    throw new SearchValueTooLongError(field);
  }
}

function appendNamespaceParams(
  query: URLSearchParams,
  prefix: string,
  params: SerializedSearchParams
): void {
  for (const field of Object.keys(params).sort()) {
    assertSafeSearchName(field, 'field');

    for (const value of params[field] ?? []) {
      query.append(`${prefix}.${field}`, value);
    }
  }
}

function appendPaneSearch(
  query: URLSearchParams,
  search: SplitSearchState,
  position: number
): void {
  for (const namespace of Object.keys(search).sort()) {
    assertSafeSearchName(namespace, 'namespace');

    const params = search[namespace];
    if (!params) continue;

    appendNamespaceParams(query, `s${position}.${namespace}`, params);
  }
}

/** Replaces pane-owned keys in the query and keeps every other key. */
export function replacePaneSearchParams(
  query: URLSearchParams,
  panes: readonly (SplitSearchState | undefined)[]
): void {
  for (const key of [...query.keys()]) {
    if (isSplitSearchKey(key)) query.delete(key);
  }

  panes.forEach((search, position) => {
    if (search) appendPaneSearch(query, search, position);
  });
}

function normalizeSearchParams(
  params: SerializedSearchParams | undefined
): SerializedSearchParams | undefined {
  if (!params) return;

  const result: SerializedSearchParams = {};

  for (const field of Object.keys(params).sort()) {
    assertSafeSearchName(field, 'field');

    const values = params[field] ?? [];
    for (const value of values) {
      assertSearchValueLength(field, value);
    }

    if (values.length > 0) result[field] = [...values];
  }

  return hasKeys(result) ? result : undefined;
}

function withSearchNamespace(
  current: SplitLocation,
  namespace: string,
  params: SerializedSearchParams | undefined
): SplitLocation {
  const search = { ...(current.search ?? {}) };
  const hasParams = params !== undefined && hasKeys(params);

  if (hasParams) {
    search[namespace] = params;
  } else {
    delete search[namespace];
  }

  return locationOf(current.route, hasKeys(search) ? search : undefined);
}

/** A location that carries `search` only when there is some. */
export function locationOf(
  route: SplitRouteState,
  search: SplitSearchState | undefined
): SplitLocation {
  if (!search) return { route };

  return { route, search };
}

export function updateSearchState(
  location: SplitLocation,
  updates: Readonly<Record<string, SplitSearchUpdate>> | undefined
): SplitLocation {
  let next = location;

  for (const [namespace, update] of Object.entries(updates ?? {})) {
    assertSafeSearchName(namespace, 'namespace');

    const current = ownValue(next.search ?? {}, namespace);
    const requested = typeof update === 'function' ? update(current) : update;
    const params = normalizeSearchParams(requested);

    next = withSearchNamespace(next, namespace, params);
  }

  return next;
}
