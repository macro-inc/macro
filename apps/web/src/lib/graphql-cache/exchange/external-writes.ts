import type { CacheHost } from '../host/types';

// REST mutations share the normalized cache, but do not pass through the
// GraphQL mutation exchange. Fence their affected record types at that boundary.
const WRITES = new WeakMap<CacheHost, Map<string, number>>();

export function externalWriteVersion(host: CacheHost): number {
  return Math.max(0, ...(WRITES.get(host)?.values() ?? []));
}

export function recordExternalWrite(
  host: CacheHost,
  types: readonly string[]
): void {
  const versions = WRITES.get(host) ?? new Map<string, number>();
  const version = externalWriteVersion(host) + 1;
  for (const type of types) versions.set(type, version);
  WRITES.set(host, versions);
}

/** Fence declared dependencies too: an old empty list can omit a restored record. */
export function predatesExternalWrite(
  host: CacheHost,
  version: unknown,
  data: unknown,
  types: readonly string[] = []
): boolean {
  if (typeof version !== 'number') return false;
  const versions = WRITES.get(host);
  if (!versions || externalWriteVersion(host) <= version) return false;
  if (types.some((type) => (versions.get(type) ?? 0) > version)) return true;
  const visit = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false;
    if (
      '__typename' in value &&
      typeof value.__typename === 'string' &&
      (versions.get(value.__typename) ?? 0) > version
    )
      return true;
    return Object.values(value).some(visit);
  };
  return visit(data);
}
