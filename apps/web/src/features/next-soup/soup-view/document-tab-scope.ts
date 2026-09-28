import type { SoupApiItem } from '@service-storage/generated/schemas/soupApiItem';
import { NIL_UUID } from '../filters/filter-store';
import type {
  DocumentFilterExpression,
  QueryState,
} from '../filters/filter-store/types';

type ItemFilter = (item: SoupApiItem) => boolean;

/** Bind cache membership to the query's tab/viewer, not later active-tab state. */
export function withDocumentTabItemScope(
  tab: string | undefined,
  userId: string | undefined,
  filter: ItemFilter
): ItemFilter {
  if (tab !== 'shared') return filter;
  return (item) => {
    if (item.tag === 'document' && (!userId || item.data.ownerId === userId))
      return false;
    return filter(item);
  };
}

/** Apply tab invariants at request time, including to older persisted filters. */
export function applyDocumentTabScope(
  state: QueryState,
  tab: string | undefined,
  userId: string | undefined
): QueryState {
  if (tab !== 'shared') return state;

  // Flat include values override matching flat excludes in the query store.
  // Reuse an intact preset, but never let an explicit creator remove its scope.
  if (
    userId &&
    state.exclude.documentOwnerId?.includes(userId) &&
    !state.include.documentOwnerId?.includes(userId)
  )
    return state;

  const scope: DocumentFilterExpression = userId
    ? { exclude: { documentOwnerId: [userId] } }
    : { include: { documentId: [NIL_UUID] } };
  return {
    ...state,
    // Separate clauses are ANDed; creator selection and non-ownership cannot
    // cancel each other here. Do not persist this derived constraint into other tabs.
    documentWhere: [...(state.documentWhere ?? []), scope],
  };
}
