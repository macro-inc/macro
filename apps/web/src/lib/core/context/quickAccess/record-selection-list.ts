import {
  type Accessor,
  createComputed,
  createMemo,
  createSignal,
} from 'solid-js';
import { searchQuickAccessEntities } from './entity-search';
import type {
  Bucket,
  EntityBucket,
  EntityItem,
  QuickAccessItem,
} from './types';

const ALL_ENTITY_BUCKETS: EntityBucket[] = [
  'channel',
  'dm',
  'document',
  'note',
  'task',
  'snippet',
  'chat',
  'project',
  'email',
  'crm_company',
];

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

/** Creates a locally filtered and paginated Quick Access record list. */
export function createRecordSelectionQuickAccessItems(options: {
  buckets: Bucket[];
  searchTerm: Accessor<string>;
  enabled: Accessor<boolean>;
  pageSize: number;
  selectedItems: Accessor<EntityItem[]>;
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
  const [visibleLimit, setVisibleLimit] = createSignal(options.pageSize);

  createComputed(() => {
    options.searchTerm();
    options.enabled();
    entityBuckets();
    setVisibleLimit(options.pageSize);
  });

  const allItems = createMemo<QuickAccessItem[]>(() => {
    if (!options.enabled()) return [];
    const requested =
      options.buckets.length > 0 ? new Set(options.buckets) : undefined;
    const itemsById = new Map<string, QuickAccessItem>();
    const addVisibleItem = (item: QuickAccessItem, replaceOnTie = false) => {
      if (requested && !requested.has(item.bucket)) return;
      if (item.bucket === 'note' && item.id === options.instructionsId())
        return;
      if (item.bucket === 'snippet' && !options.snippetsEnabled()) return;
      if (item.bucket === 'crm_company' && !options.crmEnabled()) return;
      addItem(itemsById, item, replaceOnTie);
    };

    for (const item of options.selectedItems()) addVisibleItem(item);
    for (const item of options.localItems()) {
      addVisibleItem(item, item.kind === 'entity');
    }

    const values = [...itemsById.values()];
    const term = options.searchTerm();
    const result = term
      ? [
          ...searchQuickAccessEntities(
            values.filter((item): item is EntityItem => item.kind === 'entity'),
            term
          ),
          ...values
            .filter((item) => item.kind === 'user')
            .sort(
              (left, right) =>
                right.sortTimestamp - left.sortTimestamp ||
                left.id.localeCompare(right.id)
            ),
        ]
      : values.sort(
          (left, right) =>
            right.sortTimestamp - left.sortTimestamp ||
            left.id.localeCompare(right.id)
        );

    options.onItems(result);
    return result;
  });

  const items = createMemo(() => allItems().slice(0, visibleLimit()));
  const hasMore = createMemo(() => visibleLimit() < allItems().length);

  return {
    items,
    totalCount: () => allItems().length,
    hasMore,
    isLoadingMore: () => false,
    loadMore: async () => {
      setVisibleLimit((limit) =>
        Math.min(limit + options.pageSize, allItems().length)
      );
    },
    entityBuckets,
  };
}
