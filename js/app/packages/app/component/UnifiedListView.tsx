import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { noiseFilter, signalFilter } from '@app/component/soupFilters';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { codeFileExtensions } from '@block-code/util/languageSupport';
import { ContextMenuContent, MenuSeparator } from '@core/component/Menu';
import { useTaskProperties } from '@core/component/Properties/hooks';
import {
  blockAcceptsFileExtension,
  fileTypeToBlockName,
} from '@core/constant/allBlocks';
import { ENABLE_FRECENCY } from '@core/constant/featureFlags';
import { useEmailLinksStatus } from '@core/email-link';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { arrayEquals } from '@core/util/compareUtils';
import { debouncedDependent } from '@core/util/debounce';
import { fuzzyMatch } from '@core/util/fuzzy';
import CheckIcon from '@icon/bold/check-bold.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import {
  createChannelsQuery,
  createDssInfiniteQuery,
  createFilterComposer,
  createProjectFilterFn,
  createSort,
  createUnifiedInfiniteList,
  createUnifiedSearchInfiniteQuery,
  Entity,
  type EntityClickHandler,
  type EntityData,
  type EntityFilter,
  importantFilterFn,
  isTaskEntity,
  notDoneFilterFn,
  type SearchLocation,
  type SortOption,
  sortByCreatedAt,
  sortByFrecencyScore,
  sortByUpdatedAt,
  sortByViewedAt,
  unreadFilterFn,
  type WithNotification,
  type WithSearch,
} from '@macro-entity';
import {
  isChannelMention,
  isChannelMessageReply,
  isChannelMessageSend,
  tryToTypedNotification,
  type UnifiedNotification,
  useNotificationsForEntity,
} from '@notifications';
import type { PaginatedSearchArgs } from '@service-search/client';
import type {
  ChannelFilters,
  ChatFilters,
  DocumentFilters,
  EmailFilters,
  ProjectFilters,
  UnifiedSearchIndex,
  UnifiedSearchRequestFilters,
} from '@service-search/generated/models';
import type {
  GetItemsSoupParams,
  PostSoupRequest,
} from '@service-storage/generated/schemas';
import stringify from 'json-stable-stringify';
import {
  batch,
  createEffect,
  createMemo,
  createRoot,
  createSelector,
  createSignal,
  mergeProps,
  on,
  onCleanup,
  Show,
  type Signal,
} from 'solid-js';
import { createStore, produce, unwrap } from 'solid-js/store';
import type { EntityPointerDownHandler } from '../../macro-entity/src/components/Entity';
import {
  ENTITY_HEIGHT,
  EntityWithEverything,
} from '../../macro-entity/src/components/EntityWithEverything';
import {
  resetCommandCategoryIndex,
  searchCategories,
  setCommandCategoryIndex,
  setKonsoleContextInformation,
} from './command/KonsoleItem';
import {
  resetKonsoleMode,
  setKonsoleMode,
  toggleKonsoleVisibility,
} from './command/state';
import { EntityActionsMenuItems } from './EntityActionsMenuItems';
import { EntityModal } from './EntityModal/EntityModal';
import { EntitySelectionToolbarModal } from './EntitySelectionToolbarModal';
import { EntityRow, EntityRowProvider } from './mobile/EntityRow';
import { openEntityInSplitFromUnifiedList } from './soupContextHelpers';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';
import {
  type DisplayOptions,
  type FilterOptions,
  isConfigEqual,
  KNOWN_FILE_TYPES,
  type SortOptions,
  type SystemSortOption,
  VIEWCONFIG_BASE,
  VIEWCONFIG_DEFAULTS_IDS_ENUM,
  VIEWCONFIG_FILTER_DOCUMENT_TYPE_FILTER,
} from './ViewConfig';

const SEARCH_SERVICE_DEBOUNCE_MS = 200;
const LOCAL_FUZZY_SEARCH_DEBOUNCE_MS = 20;

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const sortOptions = [
  {
    value: 'viewed_at',
    label: 'Viewed',
    sortFn: sortByViewedAt,
  },
  {
    value: 'updated_at',
    label: 'Updated',
    sortFn: sortByUpdatedAt,
  },
  {
    value: 'created_at',
    label: 'Created',
    sortFn: sortByCreatedAt,
  },
  ...(ENABLE_FRECENCY
    ? [
        {
          value: 'frecency' as const,
          label: 'Frecency',
          sortFn: sortByFrecencyScore,
        },
      ]
    : []),
] satisfies SortOption<EntityData, SystemSortOption>[];

export type UnifiedListViewProps = {
  defaultFilterOptions?: Partial<FilterOptions>;
  defaultSortOptions?: Partial<SortOptions>;
  defaultDisplayOptions?: Partial<DisplayOptions>;
  hideToolbar?: true;
};
export function UnifiedListView(props: UnifiedListViewProps) {
  const [contextAndModalState, setContextAndModalState] = createStore<{
    modalOpen: boolean;
    modalView: 'rename' | 'moveToProject';
    contextMenuOpen: boolean;
    selectedEntity: WithNotification<EntityData> | undefined;
    prevSelectedEntity: WithNotification<EntityData> | undefined;
  }>({
    modalOpen: false,
    modalView: 'rename',
    contextMenuOpen: false,
    selectedEntity: undefined,
    prevSelectedEntity: undefined,
  });

  const [localEntityListRef, setLocalEntityListRef] = createSignal<
    HTMLDivElement | undefined
  >();

  const defaultFilterOptions = mergeProps(
    VIEWCONFIG_BASE.filters,
    props.defaultFilterOptions
  );
  const defaultSortOptions = mergeProps(
    VIEWCONFIG_BASE.sort,
    props.defaultSortOptions
  );
  const defaultDisplayOptions = mergeProps(
    VIEWCONFIG_BASE.display,
    props.defaultDisplayOptions
  );

  const splitContext = useSplitPanelOrThrow();
  const { isPanelActive, soupContext, previewState } = splitContext;
  const [preview] = previewState;
  const {
    viewsDataStore: viewsData,
    setViewDataStore,
    selectedView,
    virtualizerHandleSignal: [, setVirtualizerHandle],
    entityListRefSignal: [, setEntityListRef],
    entitiesSignal: [entities_, setEntities],
    emailViewSignal: [emailView],
  } = soupContext;

  // Properties for task entities
  const taskPropertiesStore = useTaskProperties(entities_);

  const view = createMemo(() => viewsData[selectedView()]);
  const selectedEntity = createMemo(() => view()?.selectedEntity);

  const entityById = createMemo(() => {
    const list = entities_() ?? [];
    const map = new Map<string, EntityData>();
    for (const entity of list as any[]) {
      if (entity?.id) map.set(entity.id, entity);
    }
    return map;
  });

  const setSelectedEntity = (entity: EntityData | undefined) => {
    setViewDataStore(
      selectedView(),
      produce((state) => {
        if (!state) return;
        state.selectedEntity = entity;
      })
    );
  };

  const rawSearchText = createMemo<string>(() => view()?.searchText ?? '');
  const searchText = createMemo(() => rawSearchText()?.trim() ?? '');

  createEffect(
    on(
      [localEntityListRef, () => entities_()?.at(0), searchText],
      ([localEntityListRef, firstEntity]) => {
        if (!localEntityListRef) return;
        setEntityListRef(localEntityListRef);

        if (view()?.hasUserInteractedEntity) {
          return;
        }

        if (isTouchDevice()) return;
        if (!firstEntity) return;

        setSelectedEntity(firstEntity);
      }
    )
  );

  const notificationFilter = createMemo(
    () =>
      view()?.filters?.notificationFilter ??
      defaultFilterOptions.notificationFilter
  );

  const focusFilters = createMemo(
    () => view()?.filters?.focusFilters ?? defaultFilterOptions.focusFilters
  );

  const importantFilter = createMemo(
    () =>
      view()?.filters?.importantFilter ?? defaultFilterOptions.importantFilter
  );

  const unreadOnly = createMemo(
    () => view()?.filters?.unreadOnly ?? false
  );

  const entityTypeFilter = createMemo(
    () => view()?.filters?.typeFilter ?? defaultFilterOptions.typeFilter
  );

  const fileTypeFilter = createMemo(
    () =>
      view()?.filters?.documentTypeFilter ??
      defaultFilterOptions.documentTypeFilter
  );

  const projectFilter = createMemo(
    () => view()?.filters?.projectFilter ?? defaultFilterOptions.projectFilter
  );

  useCombinedRecipients(['user']);
  const fromFilter = createMemo(() => view()?.filters.fromFilter);
  const hasFromFilter = createMemo(() => fromFilter() !== undefined);
  const shouldFilterEmails = createMemo(() => {
    if (!hasFromFilter()) return false;
    const types = entityTypeFilter();
    return types.length === 0 || types.includes('email');
  });
  const shouldFilterOwnedEntities = createMemo(() => {
    if (!hasFromFilter()) return false;
    const types = entityTypeFilter();
    return types.length === 0 || types.some((t) => t !== 'email');
  });
  const fromFilterUsers = createMemo(() => fromFilter() ?? []);

  const getSystemSortOption = (
    sort: SortOptions | undefined
  ): SystemSortOption => {
    if (sort?.type === 'systemSortOption') {
      return sort.sortBy;
    }
    // Default fallback - use defaultSortOptions if it's a system sort
    if (
      defaultSortOptions.type === 'systemSortOption' &&
      defaultSortOptions.sortBy
    ) {
      return defaultSortOptions.sortBy;
    }
    return 'updated_at';
  };

  const sortType = createMemo(() => getSystemSortOption(view()?.sort));
  const setSortType = (sortBy: SystemSortOption) => {
    (setViewDataStore as any)(selectedView(), 'sort', 'sortBy', sortBy);
  };

  const propertyId = createMemo(() => {
    const sort = view()?.sort;
    return sort?.type === 'property' ? sort.propertyId : null;
  });
  const setPropertyId = (id: string | null) => {
    if (id === null) {
      // Clear property sort, revert to system
      batch(() => {
        (setViewDataStore as any)(
          selectedView(),
          'sort',
          'type',
          'systemSortOption'
        );
        (setViewDataStore as any)(selectedView(), 'sort', 'propertyId', null);
      });
    } else {
      // Set property sort
      batch(() => {
        (setViewDataStore as any)(selectedView(), 'sort', 'type', 'property');
        (setViewDataStore as any)(selectedView(), 'sort', 'propertyId', id);
        // Clear sortBy if switching to property
        (setViewDataStore as any)(selectedView(), 'sort', 'sortBy', null);
      });
    }
  };

  const sortOrder = createMemo(
    () => view()?.sort?.sortOrder ?? defaultSortOptions.sortOrder
  );
  const setSortOrder = (order: 'ascending' | 'descending') => {
    setViewDataStore(selectedView(), 'sort', 'sortOrder', order);
  };

  const showUnrollNotifications = createMemo(
    () =>
      view()?.display?.unrollNotifications ??
      defaultDisplayOptions.unrollNotifications
  );

  const debouncedSearchForLocal = debouncedDependent(
    searchText,
    LOCAL_FUZZY_SEARCH_DEBOUNCE_MS
  );
  const debouncedSearchForService = debouncedDependent(
    searchText,
    SEARCH_SERVICE_DEBOUNCE_MS
  );

  const [, setIsSearchLoading] = createSignal(false);

  const currentViewConfigBase = createMemo(() => {
    const viewKey = selectedView();
    const viewData = viewsData[viewKey];
    if (!viewData) return null;

    // Access store properties directly (not through view() memo) for reactivity
    const sort = viewsData[viewKey]?.sort as any;
    const sortType = sort?.type ?? null;
    const sortBy = sort?.sortBy ?? null;
    const propertyId = sort?.propertyId ?? null;
    const sortOrder = sort?.sortOrder ?? null;

    return {
      display: viewsData[viewKey]?.display,
      filters: viewsData[viewKey]?.filters,
      sort: {
        type: sortType,
        sortBy,
        propertyId,
        sortOrder,
      },
    };
  });
  const stringifiedCurrentViewConfigBase = createMemo(() => {
    if (!view()) return null;
    return stringify(currentViewConfigBase());
  });

  const { setFilters: setOptionalFilters, filterFn: optionalFilter } =
    createFilterComposer();
  const { setFilters: setRequiredFilters, filterFn: requiredFilter } =
    createFilterComposer();

  const nameFuzzySearchFilter = createMemo(() =>
    rawSearchText()
      ? (items: WithNotification<EntityData>[]) => {
          const query = debouncedSearchForLocal();
          if (!query || query.length === 0) return items;

          const matchResults = fuzzyMatch(query, items, (item) => item.name);

          return matchResults.map((result) => {
            return {
              ...result.item,
              search: {
                nameHighlight: result.nameHighlight,
                contentHitData: null,
                source: 'local',
              },
            } as WithNotification<WithSearch<EntityData>>;
          });
        }
      : undefined
  );

  const fileTypeCompatibilityFilter = createMemo(() => {
    const filterByFileType = fileTypeFilter();

    let filterFn: EntityFilter<EntityData> | undefined;
    if (filterByFileType.length === 1 && filterByFileType[0] === 'unknown') {
      filterFn = (entity) => {
        if (entity.type !== 'document') return true;

        const entityFileType = entity.fileType;
        if (!entityFileType) return true;

        return KNOWN_FILE_TYPES.every(
          (fileType) => !blockAcceptsFileExtension(fileType, entityFileType)
        );
      };
    } else if (filterByFileType.length > 0) {
      filterFn = (entity) => {
        if (entity.type !== 'document') return true;

        const entityFileType = entity.fileType;
        if (
          filterByFileType.includes('unknown') &&
          (!entityFileType ||
            KNOWN_FILE_TYPES.every(
              (fileType) => !blockAcceptsFileExtension(fileType, entityFileType)
            ))
        )
          return true;

        return (
          !!entityFileType &&
          filterByFileType.some((fileType) =>
            blockAcceptsFileExtension(fileType, entityFileType)
          )
        );
      };
    }
    return filterFn;
  });

  const ownerFilter = createMemo<EntityFilter<EntityData> | undefined>(() => {
    if (!shouldFilterOwnedEntities()) return undefined;
    const selectedFromUsers = fromFilterUsers();
    if (selectedFromUsers.length === 0) return undefined;

    return (entity) => {
      if (entity.type === 'email') return true;

      const ownerId = entity.ownerId;
      if (!ownerId) return false;

      const match = selectedFromUsers.some((user) => {
        return user.id === ownerId;
      });
      return match;
    };
  });

  // NOTE: these filters are required because the backend doesn't support these filters yet
  createEffect(() => {
    const filterFns: EntityFilter<EntityData>[] = [];

    if (importantFilter()) filterFns.push(importantFilterFn);

    // Apply unread filter independently (can be combined with other filters)
    if (unreadOnly()) filterFns.push(unreadFilterFn);

    if (notificationFilter() === 'notDone') filterFns.push(notDoneFilterFn);

    const focusFilters_ = focusFilters();
    const hasSignalFilter = focusFilters_?.includes('signal') === true;
    const hasNoiseFilter = focusFilters_?.includes('noise') === true;

    // We only want to apply these filters when their opposite is not in the list
    // because the filters negate each other
    if (hasSignalFilter && !hasNoiseFilter) {
      filterFns.push(signalFilter.predicate);
    }

    if (hasNoiseFilter && !hasSignalFilter) {
      filterFns.push(noiseFilter.predicate);
    }

    setRequiredFilters(filterFns);
  });

  createEffect(() => {
    const filterFns: EntityFilter<EntityData>[] = [];

    const projectFilter_ = projectFilter();
    if (projectFilter_) {
      filterFns.push(createProjectFilterFn(projectFilter_));
    }

    if (entityTypeFilter().length > 0) {
      filterFns.push((entity) => {
        // special case the tasks, entity type will still be document
        if (isTaskEntity(entity)) {
          return entityTypeFilter().includes('task');
        }
        return entityTypeFilter().includes(entity.type);
      });
    }

    const fileTypeCompatibilityFilter_ = fileTypeCompatibilityFilter();
    if (fileTypeCompatibilityFilter_)
      filterFns.push(fileTypeCompatibilityFilter_);

    // NOTE: email from filters handled directly in search service
    const ownerFilter_ = ownerFilter();
    if (ownerFilter_) filterFns.push(ownerFilter_);

    setOptionalFilters(filterFns);
  });

  const unifiedSearchIncludeArray = createMemo<UnifiedSearchIndex[]>(
    () => {
      let types = entityTypeFilter();
      // NOTE: empty array means search all
      if (types.length === 0) types = [];
      const includeArray: UnifiedSearchIndex[] = [];
      for (const type of types) {
        switch (type) {
          case 'document':
          case 'task':
            includeArray.push('documents');
            break;
          case 'chat':
            includeArray.push('chats');
            break;
          case 'channel':
            includeArray.push('channels');
            break;
          case 'email':
            includeArray.push('emails');
            break;
          case 'project':
            includeArray.push('projects');
            break;
        }
      }
      return Array.from(new Set(includeArray));
    },
    [],
    { equals: arrayEquals }
  );

  const createFileTypeFilterMemo = (type: 'soup' | 'search') =>
    createMemo<string[]>(
      () => {
        let fileTypes = [];
        if (entityTypeFilter().includes('task')) {
          fileTypes.push('md');
        }

        if (entityTypeFilter().includes('document')) {
          if (
            fileTypeFilter().length > 0 &&
            fileTypeFilter().length <
              VIEWCONFIG_FILTER_DOCUMENT_TYPE_FILTER.length
          ) {
            const documentFileTypes = fileTypeFilter().flatMap((fileType) => {
              if (fileType === 'code')
                return type === 'soup' ? ['assoc:code'] : codeFileExtensions;
              if (fileType === 'image')
                return type === 'soup' ? ['assoc:image'] : [NIL_UUID];
              if (fileType === 'unknown')
                return type === 'soup' ? ['assoc:other'] : [NIL_UUID];
              return [fileType];
            });
            fileTypes.push(...documentFileTypes);
          } else {
            // if we have task + document and no file type filter, we want to include all file types
            fileTypes = [];
          }
        }

        return Array.from(new Set(fileTypes));
      },
      [],
      {
        equals: arrayEquals,
      }
    );

  const joinedSoupFileTypeFilter = createFileTypeFilterMemo('soup');
  const joinedSearchFileTypeFilter = createFileTypeFilterMemo('search');

  const unifiedSearchFilters = createMemo<UnifiedSearchRequestFilters>(() => {
    let documentFilters: DocumentFilters | null = null;
    documentFilters = {
      file_types: joinedSearchFileTypeFilter(),
    };

    let emailFilters: EmailFilters | null = null;
    if (shouldFilterEmails()) {
      const users = fromFilterUsers();
      if (users.length > 0) {
        const senderEmails = users.map((user) => user.data.email);
        emailFilters = {
          senders: senderEmails,
        };
      }
    }

    let channelFilters: ChannelFilters | null = null;
    let chatFilters: ChatFilters | null = null;
    let projectFilters: ProjectFilters | null = null;
    if (shouldFilterOwnedEntities()) {
      const users = fromFilterUsers();
      if (users.length > 0) {
        const ownerIds = users.map((user) => user.id);
        channelFilters = {
          sender_ids: ownerIds,
        };
        chatFilters = {
          owners: ownerIds,
        };
        projectFilters = {
          owners: ownerIds,
        };
      }
    }

    const projectId = projectFilter();
    if (projectId) {
      documentFilters = {
        ...(documentFilters ?? {}),
        project_ids: [projectId],
      };
      chatFilters = {
        ...(chatFilters ?? {}),
        project_ids: [projectId],
      };
      projectFilters = {
        ...(projectFilters ?? {}),
        project_ids: [projectId],
      };
    }

    const filters = {
      document: documentFilters,
      chat: chatFilters,
      channel: channelFilters,
      email: emailFilters,
      project: projectFilters,
    };

    return filters;
  });

  const emailActive = useEmailLinksStatus();

  const validSearchTerms = createMemo(() => {
    return debouncedSearchForService().length >= 3;
  });
  const isSearchActive = createMemo(() => {
    return validSearchTerms();
  });

  const dssQueryParams = createMemo(
    (): GetItemsSoupParams => ({
      limit: props.defaultDisplayOptions?.limit ?? 100,
      sort_method: sortType(),
    })
  );

  const dssQueryRequestBody = createMemo(
    (): PostSoupRequest => ({
      channel_filters: {
        channel_ids: [NIL_UUID],
      },
      document_filters: {
        document_ids:
          entityTypeFilter().includes('document') ||
          entityTypeFilter().includes('task') ||
          entityTypeFilter().length === 0
            ? []
            : [NIL_UUID],
        project_ids: view().viewType === 'project' ? [view().id] : [],
        file_types: joinedSoupFileTypeFilter(),
      },
      chat_filters: {
        chat_ids:
          entityTypeFilter().includes('chat') || entityTypeFilter().length === 0
            ? []
            : [NIL_UUID],
        project_ids: view().viewType === 'project' ? [view().id] : [],
      },
      email_filters: {
        recipients:
          emailActive() &&
          !isSearchActive() &&
          view().viewType !== 'project' &&
          (entityTypeFilter().includes('email') ||
            entityTypeFilter().length === 0)
            ? []
            : [NIL_UUID],
      },
      project_filters: {
        project_ids:
          view().viewType === 'project'
            ? [view().id]
            : entityTypeFilter().includes('project') ||
                entityTypeFilter().length === 0
              ? []
              : [NIL_UUID],
      },
      limit: props.defaultDisplayOptions?.limit ?? 100,
      emailView: importantFilter()
        ? 'important'
        : view().id === VIEWCONFIG_DEFAULTS_IDS_ENUM.all
          ? 'all'
          : view().id === VIEWCONFIG_DEFAULTS_IDS_ENUM.email
            ? emailView()
            : undefined,

      sort_method: sortType(),
    })
  );
  const searchUnifiedNameContentQueryParams = createMemo(
    (): PaginatedSearchArgs => ({
      params: {
        page: 0,
        page_size: 100,
      },
      request: {
        search_on: 'name_content',
        match_type: 'partial',
        terms:
          debouncedSearchForService().length > 0
            ? [debouncedSearchForService()]
            : undefined,
        filters: unifiedSearchFilters(),
        include: unifiedSearchIncludeArray(),
      },
    })
  );

  const disableSearchService = createMemo(() => {
    return !isSearchActive();
  });

  const disableDssInfiniteQuery = createMemo(() => {
    const typeFilter = entityTypeFilter();
    if (typeFilter.length === 0) return false;

    function onlyHas<T>(arr: readonly T[], value: T): boolean {
      return arr.length === 1 && arr[0] === value;
    }

    if (onlyHas(typeFilter, 'channel')) return true;
    if (isSearchActive() && onlyHas(typeFilter, 'email')) return true;
    return false;
  });

  const disableChannelsQuery = createMemo(() => {
    const typeFilter = entityTypeFilter();
    if (typeFilter.length > 0 && !typeFilter.includes('channel')) return true;
    return false;
  });

  // TODO: fix email source
  // const emailSource = useGlobalEmailSource();
  // createEffect(() => emailSource.setQueryParams(emailQueryParams()));

  const notificationSource = useGlobalNotificationSource();
  const markEntityAsDone = (entity: EntityData) => {
    const actions = soupContext.actionRegistry;
    if (actions.isActionEnabled('mark_as_done', entity)) {
      actions.execute('mark_as_done', entity);
      return true;
    }
    return false;
  };

  const blockOrchestrator = useGlobalBlockOrchestrator();
  const gotoChannelNotification = async (notification: UnifiedNotification) => {
    if (
      !isChannelMention(notification) &&
      !isChannelMessageReply(notification) &&
      !isChannelMessageSend(notification)
    )
      return;

    const message_id = notification.notificationMetadata.messageId;
    let thread_id: string | null | undefined;

    const blockHandle = await blockOrchestrator.getBlockHandle(
      notification.entity_id,
      'channel'
    );
    if (!blockHandle) return;

    if (!isChannelMessageSend(notification))
      thread_id = notification.notificationMetadata.threadId;

    notificationSource.markAsRead(notification);

    return blockHandle?.goToLocationFromParams({
      [CHANNEL_PARAMS.message]: message_id,
      [CHANNEL_PARAMS.thread]: thread_id,
    });
  };

  const { sortFn: entitySort } = createSort({
    sortOptions,
    defaultSortOption: getSystemSortOption(defaultSortOptions as SortOptions),
    sortTypeSignal: [sortType, setSortType] as Signal<SystemSortOption>,
    propertyIdSignal: [propertyId, setPropertyId] as Signal<string | null>,
    sortOrderSignal: [sortOrder, setSortOrder] as Signal<
      'ascending' | 'descending'
    >,
    disabled: isSearchActive,
  });

  const {
    dispose: disposeUnifiedListQueries,
    UnifiedListComponent,
    isLoading,
  } = createRoot((dispose) => {
    const channelsQuery = createChannelsQuery({
      disabled: disableChannelsQuery,
    });
    const dssInfiniteQuery = createDssInfiniteQuery(
      dssQueryParams,
      dssQueryRequestBody,
      {
        disabled: disableDssInfiniteQuery,
      }
    );
    const searchNameContentInfiniteQuery = createUnifiedSearchInfiniteQuery(
      searchUnifiedNameContentQueryParams,
      { disabled: disableSearchService }
    );
    const notificationSource = useGlobalNotificationSource();

    const entityMapper = (entity: EntityData) => {
      return {
        ...unwrap(entity),
        notifications: useNotificationsForEntity(notificationSource, entity),
      };
    };

    // We want to be to be able to search over locally cached emails without actually
    // fetching more data when we have a invalid search term (i.e. one or two chars).
    // If we're using search service for a valid term, we can safely fetch more data
    // from dss for fuzzy name search since we won't be searching over emails (too big).
    const disableFetchMore = createMemo(() => {
      const searchAllEmails =
        (dssQueryRequestBody().email_filters?.recipients ?? []).length === 0;
      return searchText().length > 0 && searchAllEmails;
    });

    const { UnifiedListComponent, entities, isLoading } =
      createUnifiedInfiniteList<
        WithNotification<WithSearch<EntityData> | EntityData>
      >({
        id: `${selectedView()}-${splitContext.handle.id}`,
        entityInfiniteQueries: [
          {
            query: dssInfiniteQuery,
            operations: { filter: true, search: true },
          },
          {
            query: searchNameContentInfiniteQuery,
            operations: { filter: true, search: false },
          },
        ],
        entityMapper,
        entityQueries: [
          { query: channelsQuery, operations: { filter: true, search: true } },
        ],
        requiredFilter,
        optionalFilter,
        entitySort,
        searchFilter: nameFuzzySearchFilter,
        isSearchActive,
        disableFetchMore,
      });

    createEffect(() => {
      setEntities(entities());
    });

    return { dispose, isLoading, UnifiedListComponent };
  });

  createEffect(() => {
    const loading = isLoading();
    setIsSearchLoading(loading);
  });

  onCleanup(() => {
    createRoot((dispose) => {
      createEffect(() => {
        // don't dispose on blocks, such as email block when marking as done, in order to update entity navigation indicator
        if (
          splitContext.panelRef()?.isConnected &&
          splitContext.handle.content().id !== 'unified-list'
        ) {
          return;
        }

        disposeUnifiedListQueries();
        dispose();
      });
    });
  });

  const openEntityInNewTab = ({
    entity,
    location,
  }: {
    entity: EntityData;
    location?: SearchLocation;
  }) => {
    // Build URL for the entity
    let entityPath: string;
    if (entity.type === 'document') {
      const { fileType, subType } = entity;
      const blockName = fileTypeToBlockName(subType?.type ?? fileType);
      entityPath = `/app/${blockName}/${entity.id}`;
    } else {
      entityPath = `/app/${entity.type}/${entity.id}`;
    }

    // Add location params if present
    const entityUrl = new URL(entityPath, window.location.origin);
    if (location) {
      switch (location.type) {
        case 'channel':
          if (location.messageId) {
            entityUrl.searchParams.set(
              'channel_message_id',
              location.messageId
            );
          }
          if (location.threadId) {
            entityUrl.searchParams.set('thread', location.threadId);
          }
          break;
        case 'email':
          if (location.messageId) {
            entityUrl.searchParams.set('email_message_id', location.messageId);
          }

          break;
        case 'md':
          if (location.nodeId) {
            entityUrl.searchParams.set('node_id', location.nodeId);
          }
          break;
        case 'pdf':
          if (location.searchPage !== undefined) {
            entityUrl.searchParams.set(
              'search_page',
              location.searchPage.toString()
            );
          }
          if (location.searchRawQuery) {
            entityUrl.searchParams.set(
              'search_raw_query',
              location.searchRawQuery
            );
          }
          if (location.highlightTerms) {
            entityUrl.searchParams.set(
              'search_highlight_terms',
              JSON.stringify(location.highlightTerms)
            );
          }
          if (location.searchSnippet) {
            entityUrl.searchParams.set(
              'search_snippet',
              location.searchSnippet
            );
          }
          break;
      }
    }

    window.open(entityUrl.toString(), '_blank', 'noopener');
  };

  const entityClickHandler: EntityClickHandler<EntityData> = async (
    entity,
    event,
    location,
    options
  ) => {
    if (preview() && !options?.ignorePreview) {
      setSelectedEntity(entity);

      return;
    }

    if (event.metaKey || event.ctrlKey) {
      openEntityInNewTab({ entity, location });
      return;
    }

    await openEntityInSplitFromUnifiedList(entity, {
      openInNewSplit: event.altKey,
      location,
      splitHandle: splitContext.handle,
    });
  };

  const entityPointerDownHandler: EntityPointerDownHandler<EntityData> = async (
    entity,
    event,
    location,
    options
  ) => {
    if (preview() && !options?.ignorePreview) {
      return;
    }

    // middle mouse button pressed
    if (event.button === 1 && event.pointerType === 'mouse') {
      // TODO: current page should remain focused after opening new tab
      openEntityInNewTab({ entity, location });
    }
  };

  const focusedSelector = createSelector(() => selectedEntity()?.id);
  const multiSelectSelector = createSelector(
    () => view()?.multiSelectEntities,
    (a: string, b: EntityData[]) => b.find((e) => e.id === a) !== undefined
  );

  const isViewConfigChanged = createMemo(() => {
    const view_ = view();
    if (!view_) return false;

    const initialConfigStr = view_.initialConfig;
    if (initialConfigStr == null || initialConfigStr === '') return false;

    try {
      const initialConfigObj = JSON.parse(initialConfigStr);
      const currentConfigObj = currentViewConfigBase();

      if (!currentConfigObj) return false;

      const isEqual = isConfigEqual(initialConfigObj, currentConfigObj);

      return !isEqual;
    } catch (e) {
      console.warn(e);
      return false;
    }
  });

  // Set initialConfig when it's not present (on load or after save/refetch)
  createEffect(() => {
    const view_ = view();
    if (!view_) return;

    const initialConfig = view_.initialConfig;
    if (initialConfig) return;

    const stringifiedConfig = stringifiedCurrentViewConfigBase();
    if (stringifiedConfig) {
      setViewDataStore(selectedView(), 'initialConfig', stringifiedConfig);
    }
  });

  let lastClickedEntityId = -1;

  const toggleSingleMultiSelection = (params: {
    entity: EntityData;
    next: boolean;
  }) => {
    soupContext.setViewDataStore(
      selectedView(),
      'multiSelectEntities',
      (prev) => {
        if (!params.next) {
          return prev.filter((e) => e.id !== params.entity.id);
        }
        return prev.concat(params.entity);
      }
    );
  };

  const getSelectionAnchorIndex = (params: {
    entityList: EntityData[];
    selectedEntitySet: Set<EntityData>;
    lastClickedIndex: number;
  }) => {
    // Try to grab the last clicked item and fall back on the highest currently
    // selected index.
    let anchorIndex = params.lastClickedIndex;
    if (anchorIndex === -1) {
      for (let i = 0; i < params.entityList.length; i++) {
        if (params.selectedEntitySet.has(params.entityList[i])) {
          anchorIndex = i;
        }
      }
    }
    return anchorIndex;
  };

  const getNewEntitiesForShiftSelection = (params: {
    entityList: EntityData[];
    selectedEntitySet: Set<EntityData>;
    anchorIndex: number;
    targetIndex: number;
  }) => {
    const newEntitiesForSelection: EntityData[] = [];
    const sign = Math.sign(params.targetIndex - params.anchorIndex);
    if (params.anchorIndex === params.targetIndex)
      return newEntitiesForSelection;

    for (
      let i = params.anchorIndex;
      sign > 0 ? i <= params.targetIndex : i >= params.targetIndex;
      i += sign
    ) {
      const entity = params.entityList[i];
      if (!params.selectedEntitySet.has(entity)) {
        newEntitiesForSelection.push(entity);
      }
    }

    return newEntitiesForSelection;
  };

  const handleMultiSelectChecked = (params: {
    entity: EntityData;
    entityIndex: number;
    next: boolean;
    shiftKey: boolean;
  }) => {
    if (!params.shiftKey) {
      toggleSingleMultiSelection({ entity: params.entity, next: params.next });
      lastClickedEntityId = params.entityIndex;
      return;
    }

    const entityList = soupContext.entitiesSignal[0]();
    if (!entityList) return;

    const selectedEntitySet = new Set(
      soupContext.viewsDataStore[soupContext.selectedView()].multiSelectEntities
    );

    const anchorIndex = getSelectionAnchorIndex({
      entityList,
      selectedEntitySet,
      lastClickedIndex: lastClickedEntityId,
    });

    if (anchorIndex === -1) {
      toggleSingleMultiSelection({ entity: params.entity, next: params.next });
      lastClickedEntityId = params.entityIndex;
      return;
    }

    const newEntitiesForSelection = getNewEntitiesForShiftSelection({
      entityList,
      selectedEntitySet,
      anchorIndex,
      targetIndex: params.entityIndex,
    });

    soupContext.setViewDataStore(
      selectedView(),
      'multiSelectEntities',
      (prev) => prev.concat(newEntitiesForSelection)
    );

    lastClickedEntityId = params.entityIndex;
  };

  // reset last clicked on view change.
  createEffect(
    on(view, () => {
      lastClickedEntityId = -1;
    })
  );

  // reset last clicked on reset multi-selection.
  createEffect(() => {
    if (
      soupContext.viewsDataStore[selectedView()].multiSelectEntities.length ===
      0
    ) {
      lastClickedEntityId = -1;
    }
  });

  return (
      <ContextMenu
        forceMount={contextAndModalState.contextMenuOpen}
        onOpenChange={(open) => {
          setContextAndModalState((prev) => {
            if (open) {
              return {
                ...prev,
                contextMenuOpen: open,
                prevSelectedEntity: prev.selectedEntity,
              };
            }
            return {
              ...prev,
              contextMenuOpen: open,
              selectedEntity: undefined,
            };
          });
        }}
      >
        <ContextMenu.Trigger class="size-full unified-list-root">
          <EntityRowProvider
            container={localEntityListRef}
            canSwipeLeft={(entityId) => {
              const entity = entityById().get(entityId);
              if (!entity) return false;
              return soupContext.actionRegistry.isActionEnabled(
                'mark_as_done',
                entity
              );
            }}
            onSwipeLeft={(entityId) => {
              const entity = entityById().get(entityId);
              if (!entity) return false;

              soupContext.actionRegistry.execute('mark_as_done', entity);
            }}
            setCollapseEntity={soupContext.collapseEntitySignal[1]}
          >
            <UnifiedListComponent
              entityListRef={setLocalEntityListRef}
              virtualizerHandle={setVirtualizerHandle}
              viewId={view()?.id}
              searchText={searchText()}
              hasRefinementsFromBase={isViewConfigChanged()}
              entityMinHeight={ENTITY_HEIGHT}
            >
              {(innerProps) => {
                const displayDoneButton = () => {
                  if (innerProps.entity.type === 'email') {
                    return !innerProps.entity.done;
                  }

                  return (innerProps.entity.notifications?.().length ?? 0) > 0;
                };
                const timestamp = () => {
                  switch (sortType()) {
                    case 'viewed_at':
                      return innerProps.entity.viewedAt;
                    case 'created_at':
                      return innerProps.entity.createdAt;
                    case 'updated_at':
                      return innerProps.entity.updatedAt;
                  }
                };

                const properties = () => {
                  if (isTaskEntity(innerProps.entity)) {
                    return taskPropertiesStore()[innerProps.entity.id] ?? [];
                  }
                  return undefined;
                };

                return (
                  <EntityRow
                    entityId={innerProps.entity.id}
                    swipeLeftColor="bg-success"
                    swipeLeftRevealedComponent={
                      <CheckIcon class="size-8 text-panel" />
                    }
                  >
                    <EntityWithEverything
                      onContextMenu={() => {
                        if (isPanelActive() && !preview()) {
                          setSelectedEntity(innerProps.entity);
                        }
                        setContextAndModalState((prev) => {
                          return {
                            ...prev,
                            contextMenuOpen: true,
                            selectedEntity: innerProps.entity,
                          };
                        });
                      }}
                      entity={innerProps.entity}
                      properties={properties()}
                      timestamp={timestamp()}
                      onClick={entityClickHandler}
                      onPointerDown={entityPointerDownHandler}
                      onClickRowAction={
                        soupContext.actionRegistry.isActionEnabled(
                          'mark_as_done',
                          innerProps.entity
                        )
                          ? (entity, type) => {
                              if (type === 'done') {
                                markEntityAsDone?.(entity);
                              }
                            }
                          : undefined
                      }
                      onClickNotification={(notifiedEntity) => {
                        const notification = tryToTypedNotification(
                          notifiedEntity.notification
                        );
                        if (!notification) return;
                        if (notifiedEntity.type === 'channel')
                          gotoChannelNotification(notification);
                      }}
                      onMouseOver={() => {
                        if (preview()) return;
                        setViewDataStore(
                          selectedView(),
                          'hasUserInteractedEntity',
                          true
                        );
                        setSelectedEntity(innerProps.entity);
                      }}
                      onMouseLeave={() => {}}
                      onFocusIn={() => {
                        if (preview()) return;
                        setSelectedEntity(innerProps.entity);
                      }}
                      showLeftColumnIndicator={true}
                      showUnrollNotifications={showUnrollNotifications()}
                      importantIndicatorActive={importantFilterFn(
                        innerProps.entity
                      )}
                      unreadIndicatorActive={unreadFilterFn(innerProps.entity)}
                      showDoneButton={displayDoneButton()}
                      highlighted={
                        isPanelActive() && focusedSelector(innerProps.entity.id)
                      }
                      selected={
                        focusedSelector(innerProps.entity.id) ||
                        contextAndModalState.selectedEntity?.id ===
                          innerProps.entity.id
                      }
                      checked={multiSelectSelector(innerProps.entity.id)}
                      onChecked={(next, shiftKey) =>
                        handleMultiSelectChecked({
                          entity: innerProps.entity,
                          entityIndex: innerProps.index,
                          next,
                          shiftKey: shiftKey ?? false,
                        })
                      }
                    />
                  </EntityRow>
                );
              }}
            </UnifiedListComponent>
          </EntityRowProvider>

          <EntityModal
            isOpen={() =>
              !!(
                contextAndModalState.modalOpen &&
                contextAndModalState.selectedEntity?.id
              )
            }
            setIsOpen={() =>
              setContextAndModalState((prev) => ({
                ...prev,
                modalOpen: !prev.modalOpen,
              }))
            }
            view={() => contextAndModalState.modalView}
            entity={contextAndModalState.selectedEntity}
          />
          <ContextMenu.Portal>
            <Show when={contextAndModalState.selectedEntity}>
              {(selectedEntity) => (
                <ContextMenuContent mobileFullScreen>
                  <Show when={isTouchDevice() && isMobileWidth()}>
                    <Entity
                      entity={selectedEntity()}
                      timestamp={
                        sortType() === 'viewed_at'
                          ? selectedEntity().viewedAt
                          : sortType() === 'created_at'
                            ? selectedEntity().createdAt
                            : undefined
                      }
                    />
                    <MenuSeparator />
                  </Show>
                  <EntityActionsMenuItems
                    entity={selectedEntity()}
                    onSelectAction={() => {}}
                  />
                </ContextMenuContent>
              )}
            </Show>
          </ContextMenu.Portal>
        </ContextMenu.Trigger>
        <Show when={view()?.multiSelectEntities.length}>
          <EntitySelectionToolbarModal
            multiSelectEntities={view()?.multiSelectEntities ?? []}
            onClose={() =>
              soupContext.setViewDataStore(
                selectedView(),
                'multiSelectEntities',
                []
              )
            }
            onAction={() => {
              const multiSelectEntities =
                viewsData[selectedView()].multiSelectEntities;
              const hasSelection = multiSelectEntities.length > 0;
              if (hasSelection) {
                setKonsoleMode('SELECTION_MODIFICATION');
                const selectionIndex =
                  searchCategories.getCategoryIndex('Selection');

                if (selectionIndex === undefined) return false;

                setCommandCategoryIndex(selectionIndex);

                searchCategories.showCategory('Selection');

                setKonsoleContextInformation({
                  selectedEntities: multiSelectEntities.slice(),
                  clearSelection: () => {
                    soupContext.setViewDataStore(
                      selectedView(),
                      'multiSelectEntities',
                      []
                    );
                  },
                });

                toggleKonsoleVisibility();
                return true;
              }
              searchCategories.hideCategory('Selection');
              resetCommandCategoryIndex();
              resetKonsoleMode();
              return false;
            }}
          />
        </Show>{' '}
      </ContextMenu>
  );
}
