import {
  type ListView,
  soupItemMatchesListView,
  soupItemMatchesTagFilter,
} from '@app/constants/list-views';
import type { SoupEntity } from '@app/features/next-soup/create-soup-state';
import type { FilterContext } from '@app/features/next-soup/filters/configs/';
import { emailItemMatchesImportance } from '@app/features/next-soup/filters/email-signal';
import type { TagFilterMode } from '@app/features/next-soup/filters/filter-store/types';
import { type EntityData, unreadFilterFn } from '@entity';
import type { SoupApiItemFilter } from '@queries/soup/items';
import {
  isDisplayableSoupItem,
  mapApiSoupItemToEntity,
} from '@queries/soup/transform-utils';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import { withDocumentTabItemScope } from './document-tab-scope';

// The functions built here land in cached query `meta`, which TanStack keeps
// for gcTime after the soup view unmounts. They are created at module scope
// over plain snapshots so the cache never retains the view provider's scope
// (see "Query callback lifetimes" in apps/web/AGENTS.md).

export type ReadFilter = 'all' | 'unread' | 'read';

/**
 * A row the status filter admitted stays admitted for the rest of the visit
 * (`admittedIds`). The inbox opens rows in a preview pane, and previewing
 * marks the row read, so without this the row the user just clicked would
 * drop out from under the preview they are still reading.
 */
export function entityMatchesReadFilter(
  entity: EntityData,
  filter: ReadFilter,
  isHomeView: boolean,
  admittedIds: ReadonlySet<string>
): boolean {
  if (filter === 'all' || !isHomeView) return true;
  const isUnread = unreadFilterFn(entity);
  return (
    (filter === 'unread' ? isUnread : !isUnread) || admittedIds.has(entity.id)
  );
}

export type SoupViewItemFilterSnapshot = {
  view: ListView | undefined;
  /** Documents tab when the view is Documents; scopes cache membership. */
  tab: string | undefined;
  userId: string | undefined;
  tagOptionIds: readonly string[];
  tagFilterMode: TagFilterMode;
  /** Caller-supplied membership gate (a project block scopes to its project). */
  membershipFilter: SoupApiItemFilter | undefined;
  /** The soup state's predicate store test; reads the live predicate ids. */
  testPredicates: (entity: SoupEntity, ctx: FilterContext) => boolean;
  filterContext: FilterContext;
  readFilter: ReadFilter;
  /** Live view of the ids the status filter has admitted this visit. */
  admittedIds: { readonly current: ReadonlySet<string> };
};

/** Cache membership for one soup view query: does an item belong in it? */
export function createSoupViewItemFilter(
  snapshot: SoupViewItemFilterSnapshot
): SoupApiItemFilter {
  const matches = (item: SoupApiItem): boolean => {
    if (!soupItemMatchesListView(item, snapshot.view)) return false;

    if (
      !soupItemMatchesTagFilter(
        item,
        snapshot.tagOptionIds,
        snapshot.tagFilterMode
      )
    ) {
      return false;
    }

    if (snapshot.membershipFilter && !snapshot.membershipFilter(item))
      return false;

    if (!isDisplayableSoupItem(item)) return false;
    const entity = mapApiSoupItemToEntity(item) as SoupEntity;
    return (
      snapshot.testPredicates(entity, snapshot.filterContext) &&
      entityMatchesReadFilter(
        entity,
        snapshot.readFilter,
        snapshot.view === 'home',
        snapshot.admittedIds.current
      )
    );
  };
  return withDocumentTabItemScope(snapshot.tab, snapshot.userId, matches);
}

/** Websocket-insert gate for importance tabs; see `emailItemMatchesImportance`. */
export function emailImportanceInsertFilter(
  emailImportance: boolean | undefined
): SoupApiItemFilter {
  return (item) => emailItemMatchesImportance(item, emailImportance);
}
