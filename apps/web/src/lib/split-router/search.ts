import type {
  SerializedSearchParams,
  SplitLocation,
  SplitSearchState,
  SplitSearchUpdate,
} from './types';
import { isRecord, isSafeName } from './utils';

const SPLIT_SEARCH_PREFIX = /^s\d+\./;
const SPLIT_SEARCH_KEY =
  /^s(\d+)\.([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)$/;
const MAX_SEARCH_VALUE_LENGTH = 16_384;

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

export function parseSplitSearch(value: string): Map<number, SplitSearchState> {
  const splits = new Map<number, SplitSearchState>();

  for (const [key, fieldValue] of new URLSearchParams(value)) {
    const match = SPLIT_SEARCH_KEY.exec(key);

    if (!match || fieldValue.length > MAX_SEARCH_VALUE_LENGTH) continue;

    const splitIndex = Number(match[1]);
    const namespace = match[2]!;
    const field = match[3]!;

    if (
      !Number.isSafeInteger(splitIndex) ||
      !isSafeName(namespace) ||
      !isSafeName(field)
    ) {
      continue;
    }

    const namespaces = splits.get(splitIndex) ?? {};
    const fields = Object.hasOwn(namespaces, namespace)
      ? namespaces[namespace]!
      : {};

    const values = Object.hasOwn(fields, field) ? fields[field]! : [];
    fields[field] = [...values, fieldValue];
    namespaces[namespace] = fields;
    splits.set(splitIndex, namespaces);
  }

  return splits;
}

/** Recover compatible fields from untrusted persisted search metadata. */
export function parseSearchState(value: unknown): SplitSearchState | undefined {
  if (!isRecord(value)) return;
  const search: SplitSearchState = {};
  for (const [namespace, rawFields] of Object.entries(value)) {
    if (!isSafeName(namespace) || !isRecord(rawFields)) continue;
    const fields: SerializedSearchParams = {};
    for (const [field, rawValues] of Object.entries(rawFields)) {
      if (!isSafeName(field) || !Array.isArray(rawValues)) continue;
      const values = rawValues.filter(
        (item): item is string =>
          typeof item === 'string' && item.length <= MAX_SEARCH_VALUE_LENGTH
      );
      if (values.length > 0) fields[field] = values;
    }
    if (Object.keys(fields).length > 0) search[namespace] = fields;
  }
  return Object.keys(search).length > 0 ? search : undefined;
}

/** Replaces split-owned keys in the query, preserving other search params. */
export function replaceSplitSearchParams(
  query: URLSearchParams,
  entries: Array<{ location?: { search?: SplitSearchState } }>
): void {
  for (const key of [...query.keys()]) {
    if (isSplitSearchKey(key)) query.delete(key);
  }

  entries.forEach((entry, splitIndex) => {
    const search = entry.location?.search;

    if (!search) return;

    for (const namespace of Object.keys(search).sort()) {
      assertSafeSearchName(namespace, 'namespace');

      const params = search[namespace];

      if (!params) continue;

      for (const field of Object.keys(params).sort()) {
        assertSafeSearchName(field, 'field');

        for (const value of params[field] ?? []) {
          if (value.length > MAX_SEARCH_VALUE_LENGTH) {
            throw new Error(`Split search value for "${field}" is too long`);
          }

          query.append(`s${splitIndex}.${namespace}.${field}`, value);
        }
      }
    }
  });
}

export function normalizeSearchParams(
  params: SerializedSearchParams | undefined
): SerializedSearchParams | undefined {
  if (!params) return;

  const result: Record<string, string[]> = {};

  for (const field of Object.keys(params).sort()) {
    assertSafeSearchName(field, 'field');

    const values = params[field];

    if (values?.length) result[field] = [...values];
  }

  return Object.keys(result).length ? result : undefined;
}

export function withSearchNamespace(
  current: SplitLocation,
  namespace: string,
  params: SerializedSearchParams | undefined
): SplitLocation {
  const search = { ...(current.search ?? {}) };

  if (params && Object.keys(params).length > 0) search[namespace] = params;
  else delete search[namespace];

  return Object.keys(search).length > 0
    ? { route: current.route, search }
    : { route: current.route };
}

export function updateSearchState(
  location: SplitLocation,
  updates: Record<string, SplitSearchUpdate> | undefined
): SplitLocation {
  let next = location;

  for (const [namespace, update] of Object.entries(updates ?? {})) {
    assertSafeSearchName(namespace, 'namespace');

    const current =
      next.search && Object.hasOwn(next.search, namespace)
        ? next.search[namespace]
        : undefined;
    const requested = typeof update === 'function' ? update(current) : update;

    next = withSearchNamespace(
      next,
      namespace,
      normalizeSearchParams(requested)
    );
  }

  return next;
}
