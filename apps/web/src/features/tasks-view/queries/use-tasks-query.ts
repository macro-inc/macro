import type { ListDataSource } from '@app/components/list';
import {
  buildFlatSoupRows,
  buildGroupedSoupRows,
  createSearchState,
  createSoupRowStore,
  createTagFacetContext,
  deduplicateSoupEntities,
  isSoupRowVisible,
  type SoupGroup,
  type SoupRow,
  tagFacetReady,
  useSearchContext,
} from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  type EntityData,
  getTaskReferencedEntityIds,
  isTaskEntity,
  type TaskEntityWithProperties,
  taskCustomPropertyReferences,
} from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { toPropertyDefinitionDomain } from '@property/utils/transforms';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { soupEntityKey } from '@queries/soup/graphql/entity-input';
import {
  usePendingGraphqlSoupDeleteKeys,
  withoutPendingSoupEntities,
} from '@queries/soup/graphql/optimistic-deletions';
import {
  computeGroupKeysForProperties,
  DATE_GROUP_BUCKETS,
  makeGroupComparator,
} from '@queries/soup/grouped/api';
import { createGroupedSoupQueries } from '@queries/soup/grouped/create-grouped-soup-queries';
import type { GroupMeta } from '@queries/soup/grouped/types';
import {
  type SoupApiItemFilter,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { mapApiSoupItemToEntity } from '@queries/soup/transform-utils';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { type Accessor, createEffect, createMemo, on } from 'solid-js';
import { sortTasks } from '../constants';
import type { OptimisticTask } from '../core/optimistic-task';
import {
  type DateBucketBoundaries,
  TASK_DUE_DATE_BUCKETS,
  taskDueDatePredicate,
} from '../core/task-due-date';
import { isProjectTab } from '../core/task-navigation';
import type { TaskFacetContext } from '../filters/task-facets';
import {
  type TaskViewContext,
  taskMatchesView,
} from '../filters/task-predicates';
import { createDateBucketBoundariesSignal } from '../primitives/create-date-bucket-boundaries';
import type {
  TaskCrmScope,
  TaskReferenceScope,
  TasksViewState,
} from '../types';
import { createScopedTaskSearch } from './scoped-task-search';
import { buildTaskQuery } from './task-query';
import { buildTaskSearchRequest } from './task-search';

export type TasksDataSourceInput = Pick<
  TasksViewState,
  | 'tab'
  | 'search'
  | 'groupBy'
  | 'sort'
  | 'facets'
  | 'dueDate'
  | 'savedViewActive'
>;

export type UseTasksDataSourceOptions = {
  userId: Accessor<string | undefined>;
  tagSets: Accessor<readonly TagSetResponse[]>;
  tagSetsReady: Accessor<boolean>;
  /** Saved definitions supply stable tag bindings and viewer-relative people. */
  facetContext?: Accessor<TaskFacetContext>;
  isGroupExpanded: (groupId: string) => boolean;
  /** Only tasks whose property references this entity. */
  reference?: Accessor<TaskReferenceScope>;
  /**
   * Only tasks associated with this CRM record. The server resolves the
   * membership, so fetched rows are not re-filtered by their properties.
   */
  crm?: Accessor<TaskCrmScope>;
  enabled?: Accessor<boolean>;
  networkPaused?: Accessor<boolean>;
  board?: Accessor<boolean>;
  calendar?: Accessor<DateBucketBoundaries>;
  /** Tasks created here that the query may not list yet, shown in place. */
  optimisticTasks?: Accessor<readonly OptimisticTask[]>;
  /**
   * False where a task still being created can't be shown (board and Gantt
   * cards open and drag); it shows there once created.
   */
  showsPendingTasks?: Accessor<boolean>;
  /**
   * Whether the host knows a confirmed task too (a project's own task list);
   * its stand-in stays until then, even once the query lists it.
   */
  isOptimisticTaskKnown?: (taskId: string) => boolean;
  /** Confirmed optimistic tasks the query now lists itself, or deleted. */
  onOptimisticTasksListed?: (taskIds: string[]) => void;
};

export type TasksDataSourceItem = SoupRow<TaskEntityWithProperties>;

export type TasksDataSource = ListDataSource<TasksDataSourceItem> & {
  loadMoreGroup: (groupId: string) => Promise<void>;
  /** Whether text search reruns the list's sorted query; service search keeps its own order. */
  sortsSearchResults: boolean;
  /** Uncollapsed rows for alternative layouts; the query owner is shared. */
  boardRows?: Accessor<TasksDataSourceItem[]>;
  boardSearching?: Accessor<boolean>;
  boardLoading?: Accessor<boolean>;
  groupError?: (groupId: string) => unknown;
  /** A row standing in for a task the server has not created yet. */
  isPendingTask?: (taskId: string) => boolean;
};

type TaskGroupContinuationReader = {
  entities: (groupId: string) => TaskEntityWithProperties[];
  hasMore: (groupId: string) => boolean;
  isLoading: (groupId: string) => boolean;
  loadMore: (groupId: string) => Promise<void>;
};

function referencesEntity(
  task: TaskEntityWithProperties,
  reference: TaskReferenceScope
) {
  return getTaskReferencedEntityIds(
    task,
    reference.propertyDefinitionId
  ).includes(reference.entityId);
}

/**
 * Whether a task known only locally (an optimistic insert) is associated with
 * the record through its own property: the built-in Companies or Contacts
 * property, or a custom entity property that references the record, as the
 * server matches them. Mention and contact-company matches are known only to
 * the server and arrive with the next fetch.
 */
function namesCrmRecord(task: TaskEntityWithProperties, crm: TaskCrmScope) {
  if (crm.type === 'activity') return false;

  const company = crm.type === 'company';
  const builtIn = company
    ? SYSTEM_PROPERTY_IDS.COMPANIES
    : SYSTEM_PROPERTY_IDS.CONTACTS;
  if (getTaskReferencedEntityIds(task, builtIn).includes(crm.id)) return true;

  return taskCustomPropertyReferences(
    task,
    company ? 'COMPANY' : 'CONTACT',
    crm.id
  );
}

/** A plain copy of the view's facet store, safe to keep in cached options. */
function copyFacets(
  facets: TaskViewContext['facets']
): TaskViewContext['facets'] {
  return Object.fromEntries(
    Object.entries(facets).map(([facet, values]) => [facet, [...values]])
  );
}

/** Admits an optimistic row only where this scoped view shows it. */
function taskInsertFilter(
  context: TaskViewContext,
  reference: TaskReferenceScope | undefined,
  crm: TaskCrmScope | undefined
): SoupApiItemFilter {
  return (item) => {
    const entity = mapApiSoupItemToEntity(item);
    return (
      isTaskEntity(entity) &&
      taskMatchesView(entity, context) &&
      (!reference || referencesEntity(entity, reference)) &&
      (!crm || namesCrmRecord(entity, crm))
    );
  };
}

type ServerTasks =
  | { kind: 'flat'; tasks: TaskEntityWithProperties[] }
  | {
      kind: 'grouped';
      groups: SoupGroup<TaskEntityWithProperties>[];
      /** The grouping these groups were read for; unknown for a page loaded
       * for another one. */
      groupBy: TasksDataSourceInput['groupBy'] | undefined;
    };

function hasServerTasks(server: ServerTasks): boolean {
  return server.kind === 'flat'
    ? server.tasks.length > 0
    : server.groups.length > 0;
}

type OptimisticPlacement = {
  groupKeys: (task: TaskEntityWithProperties) => readonly string[];
  groupLabel: (key: string) => string;
  /** The server's group order, for a group no loaded page has. */
  compareGroups: (a: string, b: string) => number;
  sort: (entities: TaskEntityWithProperties[]) => TaskEntityWithProperties[];
};

/**
 * The groups with each optimistic task they don't list added to the groups its
 * keys name, opening a group no loaded page has where the server would put it,
 * and to the first group when its keys are unknown. Counts include it, since
 * the server's do not yet; a task that sorts past a group's loaded rows is
 * left to the later page it belongs on. Leaves `groups` as it was.
 */
export function placeOptimisticTasks(
  serverGroups: readonly SoupGroup<TaskEntityWithProperties>[],
  optimistic: readonly TaskEntityWithProperties[],
  placement: OptimisticPlacement
): SoupGroup<TaskEntityWithProperties>[] {
  const groups = [...serverGroups];
  const listed = new Set(
    groups.flatMap((group) => group.entities.map((task) => task.id))
  );
  for (const task of optimistic) {
    if (listed.has(task.id)) continue;
    listed.add(task.id);
    const keys = placement.groupKeys(task);
    const targets = keys.length > 0 ? keys : groups[0] ? [groups[0].id] : [];
    for (const key of targets) {
      let index = groups.findIndex((candidate) => candidate.id === key);
      if (index === -1) {
        index = groups.findIndex(
          (group) => placement.compareGroups(key, group.id) < 0
        );
        if (index === -1) index = groups.length;
        groups.splice(index, 0, {
          id: key,
          label: placement.groupLabel(key),
          entities: [],
          count: 0,
        });
      }
      const group = groups[index];
      const entities = placement.sort([task, ...group.entities]);
      // A task that sorts after every loaded row of a group with more rows
      // belongs on a later page, which the server's count may already hold.
      const unloaded =
        !!group.loadMore ||
        (group.count !== undefined && group.count > group.entities.length);
      if (unloaded && group.entities.length > 0 && entities.at(-1) === task)
        continue;
      groups[index] = {
        ...group,
        entities,
        count: group.count === undefined ? undefined : group.count + 1,
      };
    }
  }
  return groups;
}

/** Query, service search, and row assembly owned by the production Tasks view. */
export function useTasksDataSource(
  state: TasksDataSourceInput,
  options: UseTasksDataSourceOptions
): TasksDataSource {
  const notificationSource = useGlobalNotificationSource();
  const calendar = options.calendar ?? createDateBucketBoundariesSignal();
  const dueDate = () => taskDueDatePredicate(state.dueDate, calendar());
  const attachNotifications = (entity: TaskEntityWithProperties) =>
    withEntityNotifications(entity, notificationSource);

  const facetContext = createMemo(
    (): TaskFacetContext =>
      options.facetContext?.() ?? {
        ...createTagFacetContext(options.tagSets()),
        viewerId: options.userId(),
      }
  );
  const facetOptionsReady = () =>
    (options.enabled?.() ?? true) &&
    !isProjectTab(state.tab) &&
    (state.savedViewActive
      ? Boolean(options.userId())
      : tagFacetReady(state.facets, options.tagSetsReady()));

  const queryArgsFor = (nameContains?: string) =>
    buildTaskQuery({
      tab: state.tab,
      userId: options.userId(),
      facets: state.facets,
      facetContext: facetContext(),
      groupBy: state.groupBy,
      sort: state.sort,
      reference: options.reference?.(),
      crm: options.crm?.(),
      nameContains,
      board: options.board?.(),
      dueDate: dueDate(),
      calendar: calendar(),
      searching: !!state.search.trim(),
    });
  const queryArgs = () => queryArgsFor();

  const scoped = Boolean(options.reference || options.crm);
  const viewContext = (): TaskViewContext => ({
    tab: state.tab,
    userId: options.userId(),
    facets: state.facets,
    facetContext: facetContext(),
    dueDate: dueDate(),
  });

  const query = useSoupAstItemsQuery(queryArgs, () => ({
    enabled: facetOptionsReady(),
    networkPaused: options.networkPaused?.(),
    keepPreviousData: scoped,
    onBeforeGraphqlRefresh: () => groupedQueries.resetToInitialPage(),
    meta: scoped
      ? {
          insertFilter: taskInsertFilter(
            { ...viewContext(), facets: copyFacets(state.facets) },
            options.reference?.(),
            options.crm?.()
          ),
        }
      : undefined,
  }));

  const transformEntities = (entities: EntityData[]) => {
    const selected: TaskEntityWithProperties[] = [];
    const context = viewContext();
    const reference = options.reference?.();
    for (const entity of entities) {
      if (!isTaskEntity(entity)) continue;
      if (reference && !referencesEntity(entity, reference)) continue;
      if (!taskMatchesView(entity, context)) continue;

      selected.push(attachNotifications(entity));
    }
    return selected;
  };
  const definitions = useListPropertiesQuery(
    () => ({ scope: 'system', includeOptions: true }),
    () =>
      facetOptionsReady() &&
      // Sorting by an option, or placing a created task in a group no page
      // has yet, orders by the options' display order.
      (['status', 'priority'].includes(state.sort[0]?.id) ||
        ['status', 'priority'].includes(state.groupBy))
  );
  const propertyDefinitions = createMemo(
    () =>
      new Map(
        (definitions.isSuccess ? definitions.data : []).map((item) => {
          const definition = 'definition' in item ? item.definition : item;
          const options =
            'property_options' in item ? item.property_options : [];
          return [
            definition.id,
            toPropertyDefinitionDomain(definition, options),
          ];
        })
      )
  );

  const baseTasks = createMemo<TaskEntityWithProperties[]>((previous) => {
    if (query.isLoading) return previous;
    if (query.isPlaceholderData && previous.length > 0) return previous;
    return sortTasks(
      transformEntities(query.data?.entities ?? []),
      state.sort,
      propertyDefinitions()
    );
  }, []);

  const entityPool = useSearchContext().entityPool(
    () => !options.crm && Boolean(state.search.trim())
  );
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

  // CRM membership includes references and a company's contacts, which the
  // search service cannot express: search the scoped Soup query by name.
  const search = options.crm
    ? createScopedTaskSearch({
        text: () => state.search,
        args: queryArgsFor,
        enabled: facetOptionsReady,
      })
    : createSearchState({
        surface: () => 'tasks',
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
            reference: options.reference?.(),
            dueDate: dueDate(),
          }),
      });

  const groupedQueries = createGroupedSoupQueries({
    groupedPaging: () => query.groupedPaging,
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
        isTaskEntity(entity) ? [attachNotifications(entity)] : []
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

  // Created tasks the query has not listed yet. Search results come from
  // another source, so they show only the tasks it finds. A task deleted
  // before the query lists it stays gone.
  const pendingDeleteKeys = usePendingGraphqlSoupDeleteKeys();
  const isDeletedTask = (taskId: string) =>
    pendingDeleteKeys().has(
      soupEntityKey({ type: 'document', id: taskId }) ?? taskId
    );
  const optimisticTasks = createMemo<TaskEntityWithProperties[]>(() => {
    const optimistic = options.optimisticTasks?.() ?? [];
    if (optimistic.length === 0 || search.isSearching()) return [];
    const showsPending = options.showsPendingTasks?.() ?? true;
    const reference = options.reference?.();
    const context = viewContext();
    return withoutPendingSoupEntities(
      optimistic.flatMap(({ entity, pending }) =>
        (showsPending || !pending) &&
        (!reference || referencesEntity(entity, reference)) &&
        taskMatchesView(entity, context)
          ? [entity]
          : []
      ),
      pendingDeleteKeys(),
      (entity) => soupEntityKey({ type: 'document', id: entity.id })
    );
  });
  const optimisticGroupKeys = (task: TaskEntityWithProperties) => {
    const groupBy = queryArgs().groupBy;
    // Date grouping buckets by update time, and a created task is new.
    if (groupBy?.type === 'date') return ['today'];
    return computeGroupKeysForProperties(task.properties, groupBy) ?? [];
  };
  // A group no page has: headers name status, priority, people and projects
  // from the key itself.
  const optimisticGroupLabel = (key: string) => {
    if (state.groupBy === 'due_date')
      return (
        TASK_DUE_DATE_BUCKETS.find((bucket) => bucket.id === key)?.label ?? key
      );
    if (state.groupBy === 'date')
      return DATE_GROUP_BUCKETS.find(([id]) => id === key)?.[1] ?? key;
    return key;
  };
  // Orders a group no page has as the server would: by the option's display
  // order for a select property, by its bucket for dates.
  const optimisticGroupMeta = (key: string): GroupMeta => {
    const groupBy = queryArgs().groupBy;
    const loaded = !query.isPending
      ? query.data?.groups?.find((group) => group.key === key)
      : undefined;
    if (loaded) return loaded;
    const propertyId =
      groupBy?.type === 'property' ? groupBy.propertyDefinitionId : undefined;
    const option = propertyId
      ? propertyDefinitions()
          .get(propertyId)
          ?.options?.find((candidate) => candidate.id === key)
      : undefined;
    const dateOrder =
      groupBy?.type === 'date'
        ? DATE_GROUP_BUCKETS.findIndex(([id]) => id === key)
        : -1;
    return {
      key,
      label: optimisticGroupLabel(key),
      displayOrder:
        option?.display_order ?? (dateOrder === -1 ? null : dateOrder),
      totalCount: 0,
      itemIds: [],
      nextCursor: null,
    };
  };
  const compareOptimisticGroups = (a: string, b: string) =>
    makeGroupComparator(queryArgs().groupBy)(
      optimisticGroupMeta(a),
      optimisticGroupMeta(b)
    );
  const isPendingTask = (taskId: string) =>
    (options.optimisticTasks?.() ?? []).some(
      ({ entity, pending }) => pending && entity.id === taskId
    );

  // A confirmed stand-in goes once the query lists the task itself (and the
  // host knows it), or once the task is deleted.
  const listedOptimisticTaskIds = createMemo<string[]>(
    () => {
      const confirmed = (options.optimisticTasks?.() ?? []).filter(
        ({ pending }) => !pending
      );
      if (confirmed.length === 0) return [];
      const deleted = confirmed.flatMap(({ entity }) =>
        isDeletedTask(entity.id) ? [entity.id] : []
      );
      // A previous page shown while the next one loads proves nothing.
      if (search.isSearching() || query.isPending || query.isPlaceholderData)
        return deleted;
      const listed = new Set(baseTasks().map((task) => task.id));
      for (const group of query.data?.groups ?? []) {
        for (const task of continuations.entities(group.key)) {
          listed.add(task.id);
        }
      }
      const known = options.isOptimisticTaskKnown ?? (() => true);
      return confirmed.flatMap(({ entity }) =>
        isDeletedTask(entity.id) || (listed.has(entity.id) && known(entity.id))
          ? [entity.id]
          : []
      );
    },
    [],
    {
      equals: (a, b) =>
        a.length === b.length && a.every((id, i) => id === b[i]),
    }
  );
  createEffect(
    on(listedOptimisticTaskIds, (taskIds) => {
      if (taskIds.length > 0) options.onOptimisticTasksListed?.(taskIds);
    })
  );

  // What the server lists, kept while a new page loads; created tasks are
  // added on top of it, so they follow the store even while it loads.
  const serverTasks = createMemo<ServerTasks>(
    (previous) => {
      if (
        !search.isSearching() &&
        (query.isLoading ||
          (query.isPlaceholderData && hasServerTasks(previous)))
      ) {
        return previous;
      }

      const groups = search.isSearching() ? undefined : query.data?.groups;
      const currentTasks = tasks();
      if (!groups || state.groupBy === 'none') {
        return { kind: 'flat', tasks: currentTasks };
      }

      const tasksById = new Map(currentTasks.map((task) => [task.id, task]));
      const taskGroups: SoupGroup<TaskEntityWithProperties>[] = [];

      for (const group of groups) {
        const initialTasks = group.itemIds.flatMap((id) => {
          const task = tasksById.get(id);
          return task ? [task] : [];
        });
        const reference = options.reference?.();
        const continuationTasks = continuations
          .entities(group.key)
          .filter(
            (task) =>
              (!reference || referencesEntity(task, reference)) &&
              taskMatchesView(task, viewContext())
          );
        const entities = sortTasks(
          deduplicateSoupEntities([...initialTasks, ...continuationTasks]),
          state.sort,
          propertyDefinitions()
        );
        const taskGroup: SoupGroup<TaskEntityWithProperties> = {
          id: group.key,
          label:
            state.groupBy === 'due_date'
              ? (TASK_DUE_DATE_BUCKETS.find((bucket) => bucket.id === group.key)
                  ?.label ?? group.label)
              : group.label,
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

      // A previous page shown while the next loads keeps the grouping it
      // was read for.
      const keptGroupBy =
        previous.kind === 'grouped' ? previous.groupBy : undefined;
      return {
        kind: 'grouped',
        groups: taskGroups,
        groupBy: query.isPlaceholderData ? keptGroupBy : state.groupBy,
      };
    },
    { kind: 'flat', tasks: [] }
  );

  const builtRows = createMemo<SoupRow<TaskEntityWithProperties>[]>(() => {
    const server = serverTasks();
    const optimistic = optimisticTasks();
    const sort = (entities: TaskEntityWithProperties[]) =>
      sortTasks(entities, state.sort, propertyDefinitions());
    // Before the first page, a grouped view shows a created task in its group.
    const groups =
      server.kind === 'grouped'
        ? server.groups
        : server.tasks.length === 0 &&
            optimistic.length > 0 &&
            state.groupBy !== 'none' &&
            !search.isSearching()
          ? []
          : undefined;
    if (!groups) {
      const listed = server.kind === 'flat' ? server.tasks : [];
      if (optimistic.length === 0) return buildFlatSoupRows(listed);
      return buildFlatSoupRows(
        sort(deduplicateSoupEntities([...listed, ...optimistic]))
      );
    }
    // Groups read for another grouping (a page kept while the new grouping
    // loads) have no place for a created task until that page arrives.
    const stale = server.kind === 'grouped' && server.groupBy !== state.groupBy;
    if (optimistic.length === 0 || stale) return buildGroupedSoupRows(groups);
    return buildGroupedSoupRows(
      placeOptimisticTasks(groups, optimistic, {
        groupKeys: optimisticGroupKeys,
        groupLabel: optimisticGroupLabel,
        compareGroups: compareOptimisticGroups,
        sort,
      })
    );
  });
  const rows = createSoupRowStore(builtRows);

  const items = createMemo(() => {
    if (options.enabled?.() === false) return [];
    return rows().filter((row) =>
      isSoupRowVisible(row, options.isGroupExpanded)
    );
  });

  const usesServiceSearch = search.usesServiceSearch;

  const isLoading = () => {
    if (options.enabled?.() === false) return false;
    if (!search.isSearching()) {
      // A query held back for the tag sets is loading, not empty.
      return (query.isLoading || !facetOptionsReady()) && rows().length === 0;
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
    if (query.transport !== 'graphql') groupedQueries.resetToInitialPage();
    await query.refresh();
  };

  const boardRows = () => {
    if (options.enabled?.() === false) {
      return [];
    }

    if (search.isSearching()) {
      return rows();
    }

    if (query.isPending || query.isPlaceholderData) {
      return [];
    }

    return rows();
  };

  const boardLoading = () => {
    if (search.isSearching()) {
      return isLoading();
    }

    if (options.enabled?.() === false) {
      return false;
    }

    return query.isPending || !facetOptionsReady();
  };

  return {
    items,
    boardRows,
    boardLoading,
    groupError: (id) => groupQueryFor(id)?.error(),
    boardSearching: search.isSearching,
    isLoading,
    isFetching,
    error,
    hasMore,
    isLoadingMore,
    loadMoreGroup: continuations.loadMore,
    loadMore,
    refresh,
    sortsSearchResults: Boolean(options.crm),
    isPendingTask,
  } satisfies TasksDataSource;
}
