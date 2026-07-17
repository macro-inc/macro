import type { CacheHost, IndexedEntityBucket } from '@graphql-cache/index';
import { type Accessor, createMemo } from 'solid-js';
import { searchQuickAccessEntities } from './entity-search';
import {
  createIndexedQuickAccessQuery,
  QUICK_ACCESS_INDEX_QUERY_KEY,
} from './indexed-items';
import type {
  Bucket,
  EntityBucket,
  EntityItem,
  QuickAccessItem,
} from './types';

const DOCUMENT_BUCKETS: EntityBucket[] = [
  'document',
  'note',
  'task',
  'snippet',
];
const CHANNEL_BUCKETS: EntityBucket[] = ['channel', 'dm'];
const ALL_ENTITY_BUCKETS: EntityBucket[] = [
  ...CHANNEL_BUCKETS,
  ...DOCUMENT_BUCKETS,
  'chat',
  'project',
  'email',
  'crm_company',
];

function indexedBucketsForQuickAccess(
  buckets: EntityBucket[]
): IndexedEntityBucket[] {
  const indexed = new Set<IndexedEntityBucket>();
  for (const bucket of buckets) {
    switch (bucket) {
      case 'document':
      case 'note':
      case 'task':
      case 'snippet':
        indexed.add('document');
        break;
      case 'channel':
      case 'dm':
        indexed.add('channel');
        break;
      default:
        indexed.add(bucket);
    }
  }
  return [...indexed];
}

export function indexedBucketsForExactCount(
  buckets: EntityBucket[]
): IndexedEntityBucket[] | undefined {
  if (buckets.length === 0) return undefined;
  const requested = new Set(buckets);
  const includesDocument = DOCUMENT_BUCKETS.some((bucket) =>
    requested.has(bucket)
  );
  if (
    includesDocument &&
    !DOCUMENT_BUCKETS.every((bucket) => requested.has(bucket))
  ) {
    return undefined;
  }

  const includesChannel = CHANNEL_BUCKETS.some((bucket) =>
    requested.has(bucket)
  );
  if (
    includesChannel &&
    !CHANNEL_BUCKETS.every((bucket) => requested.has(bucket))
  ) {
    return undefined;
  }

  return indexedBucketsForQuickAccess(buckets);
}

function addItem(
  items: Map<string, QuickAccessItem>,
  item: QuickAccessItem,
  replaceOnTie = false
) {
  const current = items.get(item.id);
  if (
    !current ||
    item.sortTimestamp > current.sortTimestamp ||
    (replaceOnTie && item.sortTimestamp === current.sortTimestamp)
  ) {
    items.set(item.id, item);
  }
}

/** Creates one independently paginated indexed Quick Access item source. */
export function createIndexedQuickAccessItems(options: {
  cacheHost: CacheHost | undefined;
  buckets: Bucket[];
  searchTerm: Accessor<string>;
  pageSize: number;
  localItems: Accessor<QuickAccessItem[]>;
  instructionsId: Accessor<string | undefined>;
  snippetsEnabled: Accessor<boolean>;
  crmEnabled: Accessor<boolean>;
  onItems: (items: QuickAccessItem[]) => void;
}) {
  const entityBuckets = createMemo(() =>
    (options.buckets.length > 0 ? options.buckets : ALL_ENTITY_BUCKETS).filter(
      (bucket): bucket is EntityBucket =>
        bucket !== 'person' &&
        (bucket !== 'snippet' || options.snippetsEnabled()) &&
        (bucket !== 'crm_company' || options.crmEnabled())
    )
  );
  const indexedBuckets = createMemo(() =>
    indexedBucketsForQuickAccess(entityBuckets())
  );
  const query = createIndexedQuickAccessQuery({
    cacheHost: () => options.cacheHost,
    buckets: indexedBuckets,
    searchTerm: options.searchTerm,
    pageSize: () => options.pageSize,
  });

  const items = createMemo<QuickAccessItem[]>(() => {
    const term = options.searchTerm();
    const indexedItems = (query.data?.pages ?? []).flatMap(
      (page) => page.items
    );
    const indexedIds = new Set(indexedItems.map((item) => item.id));
    const itemsById = new Map<string, QuickAccessItem>();

    for (const item of indexedItems) {
      if (item.bucket === 'note' && item.id === options.instructionsId()) {
        continue;
      }
      if (item.bucket === 'snippet' && !options.snippetsEnabled()) continue;
      if (item.bucket === 'crm_company' && !options.crmEnabled()) continue;
      addItem(itemsById, item);
    }

    for (const item of options.localItems()) {
      if (
        term &&
        options.cacheHost &&
        item.kind === 'entity' &&
        !indexedIds.has(item.id)
      ) {
        continue;
      }
      addItem(itemsById, item, item.kind === 'entity');
    }

    const values = [...itemsById.values()];
    let result: QuickAccessItem[];
    if (!term) {
      result = values.sort(
        (a, b) => b.sortTimestamp - a.sortTimestamp || a.id.localeCompare(b.id)
      );
    } else if (!options.cacheHost) {
      const users = values.filter((item) => item.kind === 'user');
      const entities = searchQuickAccessEntities(
        values.filter((item): item is EntityItem => item.kind === 'entity'),
        term
      );
      result = [...entities, ...users];
    } else {
      const users = values
        .filter((item) => item.kind === 'user')
        .sort(
          (a, b) =>
            b.sortTimestamp - a.sortTimestamp || a.id.localeCompare(b.id)
        );
      const seen = new Set<string>();
      const entities = indexedItems.flatMap((item) => {
        if (seen.has(item.id)) return [];
        const candidate = itemsById.get(item.id);
        if (!candidate || candidate.kind !== 'entity') return [];
        seen.add(item.id);
        return [candidate];
      });
      result = [...entities, ...users];
    }

    options.onItems(result);
    return result;
  });

  return { items, query, entityBuckets };
}

export { QUICK_ACCESS_INDEX_QUERY_KEY };
