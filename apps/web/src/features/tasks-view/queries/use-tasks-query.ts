import type { ListDataSource } from '@app/components/list';
import {
  buildFlatSoupRows,
  buildGroupedSoupRows,
  createSearchState,
  deduplicateSoupEntities,
  isSoupRowVisible,
  type SoupGroup,
  type SoupRow,
  sortItems,
  useSearchContext,
} from '@app/features/soup';
import {
  type EntityData,
  isTaskEntity,
  type TaskEntityWithProperties,
} from '@entity';
import { createGroupedSoupQueries } from '@queries/soup/grouped/create-grouped-soup-queries';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { type Accessor, createMemo } from 'solid-js';
import { TASK_SORT_DEFINITIONS } from '../constants';
import type { TaskFacetContext } from '../filters/task-facets';
import {
  type TaskViewContext,
  taskMatchesView,
} from '../filters/task-predicates';
import type { TasksViewState } from '../types';
import { buildTaskQuery } from './task-query';
import { buildTaskSearchRequest } from './task-search';

export type TasksDataSourceInput = Pick<
  TasksViewState,
  'tab' | 'search' | 'groupBy' | 'sort' | 'facets'
>;

export type UseTasksDataSourceOptions = {
  userId: Accessor<string | undefined>;
  tagSets: Accessor<readonly TagSetResponse[]>;
  isGroupExpanded: (groupId: string) => boolean;
};

export type TasksDataSourceItem = SoupRow<TaskEntityWithProperties>;

export type TasksDataSource = ListDataSource<TasksDataSourceItem> & {
  loadMoreGroup: (groupId: string) => Promise<void>;
};

type TaskGroupContinuationReader = {
  entities: (groupId: string) => TaskEntityWithProperties[];
  hasMore: (groupId: string) => boolean;
  isLoading: (groupId: string) => boolean;
  loadMore: (groupId: string) => Promise<void>;
};

/** Query, service search, and row assembly owned by the production Tasks view. */
export function useTasksDataSource(
  state: TasksDataSourceInput,
  options: UseTasksDataSourceOptions
): TasksDataSource {
  const facetContext = createMemo((): TaskFacetContext => {
    const tagPropertyDefinitionByOptionId = new Map<string, string>();
    for (const set of options.tagSets()) {
      for (const option of set.options) {
        tagPropertyDefinitionByOptionId.set(
          option.id,
          option.propertyDefinitionId
        );
      }
    }
    return { tagPropertyDefinitionByOptionId };
  });

  const facetOptionsReady = () =>
    (state.facets.tags ?? []).every((id) =>
      facetContext().tagPropertyDefinitionByOptionId.has(id)
    );

  const queryArgs = () =>
    buildTaskQuery({
      tab: state.tab,
      userId: options.userId(),
      facets: state.facets,
      facetContext: facetContext(),
      groupBy: state.groupBy,
      sort: state.sort,
    });

  const query = useSoupAstItemsQuery(queryArgs, () => ({
    enabled: facetOptionsReady(),
  }));

  const viewContext = (): TaskViewContext => ({
    tab: state.tab,
    userId: options.userId(),
    facets: state.facets,
    facetContext: facetContext(),
  });

  const transformEntities = (entities: EntityData[]) => {
    const selected: TaskEntityWithProperties[] = [];
    const context = viewContext();
    for (const entity of entities) {
      if (!isTaskEntity(entity)) continue;
      if (!taskMatchesView(entity, context)) continue;

      selected.push(entity);
    }
    return selected;
  };

  const baseTasks = createMemo<TaskEntityWithProperties[]>((previous) => {
    if (query.isLoading) return previous;
    if (query.isPlaceholderData && previous.length > 0) return previous;

    return sortItems(
      transformEntities(query.data?.entities ?? []),
      state.sort,
      TASK_SORT_DEFINITIONS
    );
  }, []);

  const { entityPool } = useSearchContext();
  const localPool = createMemo(() => {
    if (!state.search.trim()) return [];
    const pool = entityPool();
    const matchingIds = new Set(
      transformEntities(pool.map((item) => item.data)).map(
        (entity) => entity.id
      )
    );
    return pool.filter((item) => matchingIds.has(item.data.id));
  });

  const search = createSearchState({
    text: () => state.search,
    localPool,
    enabled: facetOptionsReady,
    buildRequest: ({ query, matchType }) =>
      buildTaskSearchRequest({
        query,
        matchType,
        tab: state.tab,
        userId: options.userId(),
        facets: state.facets,
        facetContext: facetContext(),
      }),
  });

  const groupedQueries = createGroupedSoupQueries({
    initialPage: createMemo(() => {
      if (search.isSearching() || query.isLoading || query.isPlaceholderData) {
        return;
      }

      const groups = query.data?.groups;
      const items = query.data?.itemsById;
      if (!groups || !items) return;
      return { groups, items };
    }),
    groupByField: () => queryArgs().groupBy,
    soupParams: () => queryArgs().params,
    soupBody: () => queryArgs().body,
    transport: () => query.transport,
    queryOptions: () => ({
      enabled: !search.isSearching() && facetOptionsReady(),
    }),
  });

  const groupQueryFor = (groupKey: string) =>
    groupedQueries.map().get(groupKey);

  const continuations: TaskGroupContinuationReader = {
    entities: (groupKey) =>
      (groupQueryFor(groupKey)?.data()?.entities ?? []).flatMap((entity) =>
        isTaskEntity(entity) ? [entity] : []
      ),
    hasMore: (groupKey) => groupQueryFor(groupKey)?.hasNextPage() ?? false,
    isLoading: (groupKey) =>
      groupQueryFor(groupKey)?.isFetchingNextPage() ?? false,
    loadMore: async (groupKey) => {
      await groupQueryFor(groupKey)?.fetchNextPage();
    },
  };

  const tasks = createMemo<TaskEntityWithProperties[]>((previous) => {
    if (!search.isSearching()) return baseTasks();

    const results = transformEntities(search.data());
    if (
      results.length === 0 &&
      previous.length > 0 &&
      search.isLocalSearchSettling()
    ) {
      return previous;
    }
    return results;
  }, []);

  const rows = createMemo<SoupRow<TaskEntityWithProperties>[]>((previous) => {
    if (
      !search.isSearching() &&
      (query.isLoading || (query.isPlaceholderData && previous.length > 0))
    ) {
      return previous;
    }

    const groups = search.isSearching() ? undefined : query.data?.groups;
    const currentTasks = tasks();
    if (!groups || state.groupBy === 'none') {
      return buildFlatSoupRows(currentTasks);
    }

    const tasksById = new Map(currentTasks.map((task) => [task.id, task]));
    const taskGroups: SoupGroup<TaskEntityWithProperties>[] = [];

    for (const group of groups) {
      const initialTasks = group.itemIds.flatMap((id) => {
        const task = tasksById.get(id);
        return task ? [task] : [];
      });
      const continuationTasks = continuations
        .entities(group.key)
        .filter((task) => taskMatchesView(task, viewContext()));
      const entities = sortItems(
        deduplicateSoupEntities([...initialTasks, ...continuationTasks]),
        state.sort,
        TASK_SORT_DEFINITIONS
      );
      const taskGroup: SoupGroup<TaskEntityWithProperties> = {
        id: group.key,
        label: group.label,
        entities,
        count: group.totalCount,
      };

      if (continuations.hasMore(group.key)) {
        taskGroup.loadMore = {
          scopeId: `tasks:${group.key}`,
          isLoading: continuations.isLoading(group.key),
        };
      }

      taskGroups.push(taskGroup);
    }

    return buildGroupedSoupRows(taskGroups);
  }, []);

  const items = createMemo(() =>
    rows().filter((row) => isSoupRowVisible(row, options.isGroupExpanded))
  );

  const usesServiceSearch = search.usesServiceSearch;

  const isLoading = () => {
    if (!search.isSearching()) {
      return query.isLoading && rows().length === 0;
    }
    if (tasks().length > 0) return false;
    if (usesServiceSearch()) return search.isLoading();
    return query.isLoading;
  };

  const isFetching = () => {
    if (search.isSettling()) return true;
    if (usesServiceSearch()) return search.isFetching();
    return query.isFetching;
  };

  const error = () => {
    if (!usesServiceSearch()) return query.error ?? undefined;
    return search.error();
  };

  const hasMore = () => {
    if (usesServiceSearch()) return search.hasNextPage();
    return query.hasNextPage;
  };

  const isLoadingMore = () => {
    if (usesServiceSearch()) return search.isFetchingNextPage();
    return query.isFetchingNextPage;
  };

  const loadMore = async () => {
    if (usesServiceSearch()) {
      await search.fetchNextPage();
      return;
    }
    await query.fetchNextPage();
  };

  const refresh = async () => {
    if (usesServiceSearch()) {
      await search.refetch();
      return;
    }
    groupedQueries.resetToInitialPage();
    await query.refresh();
  };

  return {
    items,
    isLoading,
    isFetching,
    error,
    hasMore,
    isLoadingMore,
    loadMoreGroup: continuations.loadMore,
    loadMore,
    refresh,
  } satisfies TasksDataSource;
}
