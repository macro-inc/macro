import type { EntityReference } from '@service-properties/generated/schemas/entityReference';

/**
 * Plain copies of references read from a property. A query result is a store
 * whose `reconcile` rewrites the objects of a list in place, so references
 * kept past the next update (a staged pick, a value shown until the source
 * catches up) would otherwise turn into their neighbors.
 */
export function copyEntityReferences(
  refs: readonly EntityReference[]
): EntityReference[] {
  return refs.map((reference) => ({ ...reference }));
}
