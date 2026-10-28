import type { EntityData } from '@entity';
import { keyArray } from '@solid-primitives/keyed';
import { type Accessor, createMemo } from 'solid-js';
import { createKeyedProjection } from '../../create-keyed-projection';
import type { GroupedSoupPaging } from '../../graphql/create-grouped-soup-live-query';
import {
  usePendingGraphqlSoupDeleteIds,
  withoutPendingSoupEntities,
} from '../../graphql/optimistic-deletions';
import type { SoupApiItemFilter, SoupAstItemsGroupedPage } from '../../items';
import {
  isDisplayableSoupItem,
  mapApiSoupItemToEntity,
} from '../../transform-utils';
import type { GroupMeta } from '../types';

export type GroupQueryData = { entities: EntityData[] };

type GraphqlGroupedInitialPage = {
  cachedMail?: boolean;
  items: SoupAstItemsGroupedPage['items'];
  groups: GroupMeta[];
};

type CreateGraphqlGroupedSoupQueriesArgs = {
  initialPage: Accessor<GraphqlGroupedInitialPage | undefined>;
  groupedPaging?: Accessor<GroupedSoupPaging | undefined>;
  enabled: Accessor<boolean>;
  itemFilter: Accessor<SoupApiItemFilter | undefined>;
};

/** Group readers project the parent's combined pages; they never own a second cursor chain. */
export function createGraphqlGroupedSoupQueries(
  args: CreateGraphqlGroupedSoupQueriesArgs
) {
  const pendingDeleteIds = usePendingGraphqlSoupDeleteIds();
  const rows = createKeyedProjection(
    () => Object.entries(args.initialPage()?.items ?? {}),
    ([id]) => id,
    ([id, item]) => {
      const filter = args.itemFilter();
      const entity =
        isDisplayableSoupItem(item) && (!filter || filter(item))
          ? mapApiSoupItemToEntity(item)
          : undefined;
      return { id, entity };
    }
  );
  const byId = createMemo(
    () => new Map(rows().map((row) => [row.id, row.entity]))
  );
  const paging = () =>
    args.initialPage()?.cachedMail ? undefined : args.groupedPaging?.();
  const list = keyArray(
    () => args.initialPage()?.groups ?? [],
    (group) => group.key,
    (group) => ({
      key: group().key,
      data: createMemo(
        (): GroupQueryData => ({
          entities: withoutPendingSoupEntities(
            group().itemIds.flatMap((id) => {
              const entity = byId().get(id);
              return entity ? [entity] : [];
            }),
            pendingDeleteIds()
          ),
        })
      ),
      hasNextPage: () => paging()?.hasNextPage(group().key) ?? false,
      isFetchingNextPage: () =>
        paging()?.isFetchingNextPage(group().key) ?? false,
      error: () => paging()?.error(group().key) ?? null,
      fetchNextPage: async () => {
        if (args.enabled()) await paging()?.fetchNextPage(group().key);
      },
      resetToInitialPage: () => paging()?.resetToInitialPage(),
    })
  );
  return {
    list,
    map: createMemo(() => new Map(list().map((query) => [query.key, query]))),
    resetToInitialPage: () => paging()?.resetToInitialPage(),
  };
}
