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
import { usePending } from '@app/observability/flow';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  type EntityData,
  getTaskReferencedEntityIds,
  isTaskEntity,
  type TaskEntityWithProperties,
  taskCustomPropertyReferences,
} from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { PROPERTY_OPTION_IDS } from '@property/identifiers';
import { toPropertyDefinitionDomain } from '@property/utils/transforms';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { createTaskDependencyStatesSource } from '@queries/properties/graphql/task-dependency-source';
import { createGroupedSoupQueries } from '@queries/soup/grouped/create-grouped-soup-queries';
import {
  type SoupApiItemFilter,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { mapApiSoupItemToEntity } from '@queries/soup/transform-utils';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { mapGraphqlProperties } from '@service-storage/graphql-soup';
import { type Accessor, createMemo } from 'solid-js';
import { sortTasks } from '../constants';
import {
  type DateBucketBoundaries,
  TASK_DUE_DATE_BUCKETS,
  TASK_START_DATE_BUCKETS,
  taskDueDatePredicate,
  taskStartDatePredicate,
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
  | 'startDate'
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

function dateGroupLabel(
  groupBy: TasksViewState['groupBy'],
  key: string
): string | undefined {
  const buckets =
    groupBy === 'due_date'
      ? TASK_DUE_DATE_BUCKETS
      : groupBy === 'start_date'
        ? TASK_START_DATE_BUCKETS
        : undefined;
  return buckets?.find((bucket) => bucket.id === key)?.label;
}

/** Query, service search, and row assembly owned by the production Tasks view. */
export function useTasksDataSource(
  state: TasksDataSourceInput,
  options: UseTasksDataSourceOptions
): TasksDataSource {
  const notificationSource = useGlobalNotificationSource();
  const calendar = options.calendar ?? createDateBucketBoundariesSignal();
  const dueDate = () => taskDueDatePredicate(state.dueDate, calendar());
  const startDate = () => taskStartDatePredicate(state.startDate, calendar());
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
      startDate: startDate(),
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
    startDate: startDate(),
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
      facetOptionsReady() && ['status', 'priority'].includes(state.sort[0]?.id)
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
            startDate: startDate(),
          }),
      });

  const searchDependencies = createTaskDependencyStatesSource(() =>
    search.isSearching() && !options.crm
      ? search
          .data()
          .filter(isTaskEntity)
          .filter((task) => task.isBlocked === undefined)
          .map((task) => task.id)
      : []
  );
  usePending('tasks.dependencies.search', searchDependencies.pending);

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

    const facts = searchDependencies.states();
    const results = transformEntities(search.data()).map((task) => {
      const dependency = searchDependencies.error()
        ? undefined
        : facts.get(task.id);
      if (!dependency) return task;
      const updated = mapGraphqlProperties(dependency.properties);
      const replaced = new Set<string>([
        SYSTEM_PROPERTY_IDS.STATUS,
        SYSTEM_PROPERTY_IDS.DEPENDS_ON,
        SYSTEM_PROPERTY_IDS.BLOCKING,
      ]);
      const properties = [
        ...(task.properties ?? []).filter(
          (property) => !replaced.has(property.definition.id)
        ),
        ...updated,
      ];
      const status = dependency.properties.find(
        (property) =>
          property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STATUS
      )?.value;
      const completed =
        status?.__typename === 'GraphqlSelectOptionPropertyValue' &&
        status.optionIds.includes(PROPERTY_OPTION_IDS.STATUS.COMPLETED);
      return {
        ...task,
        properties,
        subType: { ...task.subType, is_completed: completed },
        isBlocked: dependency.isBlocked,
        openBlockerIds: dependency.openBlockerIds,
      };
    });
    if (
      results.length === 0 &&
      previous.length > 0 &&
      search.isLocalSearchSettling()
    ) {
      return previous;
    }
    return results;
  }, []);

  const builtRows = createMemo<SoupRow<TaskEntityWithProperties>[]>(
    (previous) => {
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
          label: dateGroupLabel(state.groupBy, group.key) ?? group.label,
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
    },
    []
  );
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
  } satisfies TasksDataSource;
}
