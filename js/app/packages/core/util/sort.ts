import { useUserId } from '@service-gql/client';
import type { Item } from '@service-storage/generated/schemas/item';

export type SortType =
  | 'name'
  | 'updatedAt'
  | 'createdAt'
  | 'owner'
  | 'deletedAt';
export type SortDirection = 'asc' | 'desc';
export type SortPair = [SortType, SortDirection];

export const sortEquals = (a: SortPair, b: SortPair) => {
  return a[0] === b[0] && a[1] === b[1];
};

export const defaultFileSortPair: SortPair = ['updatedAt', 'desc'];

// NOTE: we have to use the array references for sortpair as it checks for reference equality
export const fileSortLabels: Map<SortPair, string> = new Map([
  [['name', 'asc'], 'Name'],
  [['updatedAt', 'desc'], 'Modified'],
  [['createdAt', 'desc'], 'Created'],
]);

function getSortProperty(item: Item, sort: SortType) {
  switch (sort) {
    case 'name': {
      return item.name.toLowerCase();
    }
    case 'updatedAt': {
      return item.updatedAt;
    }
    case 'createdAt': {
      return item.createdAt;
    }
    case 'deletedAt': {
      return item.deletedAt;
    }
    case 'owner': {
      return item.type === 'document' ? item.owner : item.userId;
    }
    default:
      console.error('Invalid sort type', sort);
      return 0;
  }
}

export function sortItems(
  a: Item,
  b: Item,
  sort: SortType,
  direction: SortDirection,
  options?: {
    showProjectsFirst?: boolean;
  }
) {
  if (options?.showProjectsFirst) {
    if (a.type === 'project' && b.type !== 'project') return -1;
    if (a.type !== 'project' && b.type === 'project') return 1;
  }

  const aProp = getSortProperty(a, sort);
  const bProp = getSortProperty(b, sort);

  if (sort === 'owner') {
    const userId = useUserId();
    if (aProp === userId() && bProp !== userId())
      return direction === 'asc' ? -1 : 1;
    if (aProp !== userId() && bProp === userId())
      return direction === 'asc' ? 1 : -1;
  }

  let cmp;

  if (typeof aProp === 'string' && typeof bProp === 'string') {
    cmp = aProp.localeCompare(bProp);
  } else {
    cmp = (aProp ?? 0) > (bProp ?? 0) ? 1 : -1;
  }

  if (direction === 'desc') cmp *= -1;
  return cmp;
}
