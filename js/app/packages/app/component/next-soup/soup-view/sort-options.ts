import type { SortConfig } from '@app/component/next-soup/create-soup-state';
import type { SoupEntity } from '@app/component/next-soup/soup-view/soup-view-context';
import {
  isSearchEntity,
  type WithSearch,
  type EntityData,
  type WithNotification,
} from '@macro-entity';

export type SystemSortOption =
  | 'updated_at'
  | 'created_at'
  | 'viewed_at'
  | 'frecency';

export function sortByNotifiedAt<T extends WithNotification<EntityData>>(
  a: T,
  b: T
) {
  const aNotification = a.notifications?.()[0];
  const bNotification = b.notifications?.()[0];

  if (aNotification && bNotification) {
    return bNotification.createdAt - aNotification.createdAt;
  } else if (aNotification) {
    return -1;
  } else if (bNotification) {
    return 1;
  }

  return sortByUpdatedAt(a, b);
}

export function sortByCreatedAt<T extends EntityData>(a: T, b: T): number {
  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
}

export function sortByUpdatedAt<T extends EntityData>(a: T, b: T) {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
}

export function sortByViewedAt<T extends EntityData>(a: T, b: T) {
  return (b.viewedAt ?? 0) - (a.viewedAt ?? 0);
}

export function sortByFrecencyScore<T extends EntityData>(a: T, b: T): number {
  return (b.frecencyScore ?? 0) - (a.frecencyScore ?? 0);
}

export const SORT_CONFIGS = {
  updated_at: {
    id: 'updated_at',
    fn: sortByUpdatedAt,
  },
  created_at: {
    id: 'created_at',
    fn: sortByCreatedAt,
  },
  viewed_at: {
    id: 'viewed_at',
    fn: sortByViewedAt,
  },
  frecency: {
    id: 'frecency',
    fn: sortByFrecencyScore,
  },
  notified_at: {
    id: 'notified_at',
    fn: sortByNotifiedAt,
  },
} satisfies Record<string, SortConfig<SoupEntity>>;

export const sortEntitiesForSearch = <T extends EntityData>(
  a: T,
  b: T
): number => {
  if (!isSearchEntity(a) || !isSearchEntity(b)) {
    if (isSearchEntity(a)) return -1;
    if (isSearchEntity(b)) return 1;
    return 0;
  }

  const channelsWithNameMatchesFirst = (a: WithSearch<T>, b: WithSearch<T>) => {
    if (a.type === 'channel' && b.type !== 'channel' && a.search.nameHighlight)
      return -1;
    if (a.type !== 'channel' && b.type === 'channel' && b.search.nameHighlight)
      return 1;
    return 0;
  };

  // NOTE: backend returns items in descending order of updatedAt so we match that here
  const updatedAtFirst = (a: WithSearch<T>, b: WithSearch<T>) => {
    if (a.updatedAt && b.updatedAt) return b.updatedAt - a.updatedAt;
    if (a.updatedAt) return -1;
    if (b.updatedAt) return 1;
    return 0;
  };

  // TODO: we may want to sort exact name matches first for other items too
  return channelsWithNameMatchesFirst(a, b) || updatedAtFirst(a, b);
};
