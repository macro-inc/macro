import type { RecordSelection } from '../../../graphql-cache/exchange/record-selection';
import { readRecordsByKeys } from '../../../graphql-cache/exchange/record-selection';
import type { CacheHost } from '../../../graphql-cache/host/types';
import type { EntityFilterCacheResult } from '../../../graphql-cache/protocol';
import type { MailItemFieldsFragment } from '../../../service-clients/service-storage/graphql/generated/graphql';
import type { GraphqlSoupItem } from '../../../service-clients/service-storage/graphql-soup';
import { type CachedMailView, materializeMailView } from './mail-view';
import { materializeReconciledSoup, soupItemKey } from './reconciliation';

/** Compatibility materialization for Mail pages and hosts without live views.
 * Both initial reads and pagination publish only a single coherent revision.
 */
export async function readSoupPage(
  host: Pick<CacheHost, 'readRecordsByKeys' | 'currentRevision'>,
  options: {
    page: Extract<
      EntityFilterCacheResult,
      { kind: 'reconciled' | 'mail-page' }
    >;
    select: RecordSelection<GraphqlSoupItem>;
    baseline: readonly GraphqlSoupItem[];
    mailView?: CachedMailView;
    keys?: readonly string[];
  }
) {
  const { page, select, baseline, mailView, keys = page.keys } = options;
  const chunks = [];
  for (let offset = 0; offset < Math.max(1, page.keys.length); offset += 500) {
    chunks.push(
      await readRecordsByKeys(
        host,
        select,
        page.keys.slice(offset, offset + 500)
      )
    );
  }
  const revision = await host.currentRevision();
  if (
    page.revision !== revision ||
    chunks.some((chunk) => chunk.revision !== revision)
  )
    return { kind: 'stale' as const, revision };

  const timestamps =
    page.kind === 'mail-page'
      ? new Map(page.keys.map((key, i) => [key, page.sortTimestamps[i]]))
      : undefined;
  const selected = chunks.flatMap((chunk) => chunk.records);
  const selectedKeys = new Set(selected.map((row) => row.recordKey));
  const snapshots = new Map(
    baseline.map((record) => [soupItemKey(record), record])
  );
  const retainedKeys = new Set(
    page.kind === 'mail-page' ? page.retainedKeys : []
  );
  const records = materializeReconciledSoup(keys, selected, baseline).flatMap(
    (record) => {
      // A retained row is server membership evidence, not a complete canonical
      // preview. Preserve its fetched display fields until hydration catches up.
      if (
        page.kind === 'mail-page' &&
        (retainedKeys.has(soupItemKey(record)) ||
          !selectedKeys.has(soupItemKey(record)))
      )
        return [snapshots.get(soupItemKey(record)) ?? record];
      const timestamp = timestamps?.get(soupItemKey(record));
      if (!timestamp || !mailView) return [record];
      // Older hosts can confirm membership before the canonical preview is
      // readable. Prefer canonical fields as soon as they become available.
      const selected =
        materializeMailView(
          record as MailItemFieldsFragment,
          mailView,
          timestamp
        ) ?? snapshots.get(soupItemKey(record));
      return selected ? [selected] : [];
    }
  );
  return { kind: 'ready' as const, revision, records };
}
