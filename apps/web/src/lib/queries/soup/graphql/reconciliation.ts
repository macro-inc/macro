import { MAX_RECONCILIATION_BASELINE } from '@app/lib/graphql-cache/protocol';
import type { GraphqlSoupItem } from '@service-storage/graphql-soup';

/** Normalized identity, shared by every Soup entity variant. */
export const soupItemKey = (item: GraphqlSoupItem): string =>
  `${item.__typename}:${item.id}`;

/** Same-query server membership and sort evidence; filtering stays in Rust. */
export function soupReconciliationBaseline(
  records: readonly GraphqlSoupItem[],
  sortMethod: 'CREATED_AT' | 'UPDATED_AT'
): Array<{ key: string; sortTimestamp: string }> | undefined {
  const entries = new Map<string, { key: string; sortTimestamp: string }>();
  for (const record of records) {
    const sortTimestamp =
      sortMethod === 'CREATED_AT'
        ? 'createdAt' in record && record.createdAt
        : 'updatedAt' in record && record.updatedAt;
    // Do not silently drop baseline rows whose sort evidence is unavailable.
    if (typeof sortTimestamp !== 'string') return undefined;
    const key = soupItemKey(record);
    entries.set(key, { key, sortTimestamp });
  }
  return entries.size <= MAX_RECONCILIATION_BASELINE
    ? [...entries.values()]
    : undefined;
}

/** Rows discovered by server pagination after an overlay was computed. Do not
 * re-add covered baseline rows (including confirmed non-matches), or duplicate
 * local candidates that pagination now also returns. */
export function unreconciledServerRecords(
  records: readonly GraphqlSoupItem[],
  baselineKeys: ReadonlySet<string>,
  displayedKeys: ReadonlySet<string>
): GraphqlSoupItem[] {
  const seen = new Set([...baselineKeys, ...displayedKeys]);
  return records.filter((record) => {
    const key = soupItemKey(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Materialize only reconciled survivors, preserving baseline display data if
 * a selected record is incomplete. Unrenderable new candidates are omitted. */
export function materializeReconciledSoup(
  keys: readonly string[],
  selected: readonly { recordKey: string; record: GraphqlSoupItem }[],
  baseline: readonly GraphqlSoupItem[]
): GraphqlSoupItem[] {
  const records = new Map(
    baseline.map((record) => [soupItemKey(record), record])
  );
  for (const { recordKey, record } of selected) records.set(recordKey, record);
  return [...new Set(keys)].flatMap((key) => {
    const record = records.get(key);
    return record ? [record] : [];
  });
}
