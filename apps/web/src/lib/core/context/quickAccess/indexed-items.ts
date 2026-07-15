import type {
  CacheHost,
  EntityIndexCursor,
  IndexedEntityBucket,
} from '@graphql-cache/index';
import { indexedEntityToQuickAccessItem } from './graphql-items';
import type { EntityItem } from './types';

const INDEXED_PAGE_LIMIT = 500;
const INDEXED_QUICK_ACCESS_BUCKETS: IndexedEntityBucket[] = [
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

/**
 * Reads and maps the complete durable entity index for Quick Access.
 *
 * The cursor remains opaque: this helper only returns frontend entity items.
 * `isCurrent` lets owners abandon a superseded scan between pages.
 */
export async function loadIndexedQuickAccessItems(
  cacheHost: Pick<CacheHost, 'queryIndexedItems'>,
  isCurrent: () => boolean = () => true
): Promise<EntityItem[] | undefined> {
  const items: EntityItem[] = [];
  let cursor: EntityIndexCursor | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await cacheHost.queryIndexedItems({
      buckets: INDEXED_QUICK_ACCESS_BUCKETS,
      cursor,
      limit: INDEXED_PAGE_LIMIT,
    });
    if (!isCurrent()) return undefined;

    for (const item of page.items) {
      const mapped = indexedEntityToQuickAccessItem(item);
      if (mapped) items.push(mapped);
    }

    hasMore = page.hasMore;
    if (hasMore) {
      if (!page.nextCursor || page.nextCursor === cursor) {
        throw new Error('indexed entity page is missing a forward cursor');
      }
      cursor = page.nextCursor;
    }
  }

  return items;
}
