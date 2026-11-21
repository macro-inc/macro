import type { CacheHost } from '../host/types';
import { normalizedEntityKey } from './optimistic';

// REST mutations share the normalized cache, but do not pass through the
// GraphQL mutation exchange. Fence their affected record types at that boundary.
// A deletion fences the records it removes the same way: a read sent before it
// still holds them, and writing its answer would put them back.
type Fences = {
  /** Advances with every fenced write or deletion; reads carry the version
   * they were sent at. */
  version: number;
  /** The version of the last write to each record type. */
  types: Map<string, number>;
  /** The version of the last deletion of each normalized record key, oldest
   * first. */
  records: Map<string, number>;
  /** The version of the last deletion fenced in `records`. */
  lastDeletion: number;
};

/** A cache host, or the part of one a direct deleter holds. */
type FencedHost = Pick<CacheHost, 'deleteRecords'>;

// Keyed by the host the exchange and the direct deleters share.
const FENCES = new WeakMap<FencedHost, Fences>();
// Deleted records fenced one by one. Past this many, the oldest fall back to
// a fence on their whole type, which drops more reads but misses none.
const MAX_FENCED_RECORDS = 5_000;

function fencesOf(host: FencedHost): Fences {
  let fences = FENCES.get(host);
  if (!fences) {
    fences = {
      version: 0,
      types: new Map(),
      records: new Map(),
      lastDeletion: 0,
    };
    FENCES.set(host, fences);
  }
  return fences;
}

export function externalWriteVersion(host: FencedHost): number {
  return FENCES.get(host)?.version ?? 0;
}

export function recordExternalWrite(
  host: FencedHost,
  types: readonly string[]
): void {
  const fences = fencesOf(host);
  fences.version += 1;
  for (const type of types) fences.types.set(type, fences.version);
}

/**
 * Fences each normalized record key (`Type:id`) a deletion removes, before
 * the deletion reaches the cache. A response to a read sent before it that
 * still holds one of those records is dropped and read again, instead of
 * writing the record back. The cache applies writes in the order they are
 * sent, so a response that arrived before the fence is written before the
 * deletion removes it.
 */
export function recordExternalDeletion(
  host: FencedHost,
  keys: readonly string[]
): void {
  if (keys.length === 0) return;
  const fences = fencesOf(host);
  fences.version += 1;
  fences.lastDeletion = fences.version;
  for (const key of keys) {
    // Kept in deletion order, so the oldest fold first.
    fences.records.delete(key);
    fences.records.set(key, fences.version);
  }
  for (const [key, version] of fences.records) {
    if (fences.records.size <= MAX_FENCED_RECORDS) break;
    fences.records.delete(key);
    const separator = key.indexOf(':');
    const type = separator < 0 ? key : key.slice(0, separator);
    fences.types.set(type, Math.max(fences.types.get(type) ?? 0, version));
  }
}

/** Fence declared dependencies too: an old empty list can omit a restored
 * record. A response holding a record deleted after it was sent is fenced
 * as well. */
export function predatesExternalWrite(
  host: FencedHost,
  version: unknown,
  data: unknown,
  types: readonly string[] = []
): boolean {
  if (typeof version !== 'number') return false;
  const fences = FENCES.get(host);
  if (!fences || fences.version <= version) return false;
  const after = (fenced: number | undefined) => (fenced ?? 0) > version;
  if (types.some((type) => after(fences.types.get(type)))) return true;
  // Every response is checked, and many hold hundreds of records. One sent
  // after the latest fence returned above without a walk; a walk looks up
  // only the kinds of fence set since its read was sent.
  const typesFenced = [...fences.types.values()].some(after);
  const recordsFenced = after(fences.lastDeletion);
  const visit = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false;
    if ('__typename' in value && typeof value.__typename === 'string') {
      if (typesFenced && after(fences.types.get(value.__typename))) return true;
      if (
        recordsFenced &&
        'id' in value &&
        typeof value.id === 'string' &&
        after(
          fences.records.get(
            normalizedEntityKey({ __typename: value.__typename, id: value.id })
          )
        )
      )
        return true;
    }
    return Object.values(value).some(visit);
  };
  return visit(data);
}
