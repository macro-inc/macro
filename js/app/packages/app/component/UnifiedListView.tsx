import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { URL_PARAMS as EMAIL_PARAMS } from '@block-email/constants';
import { URL_PARAMS as MD_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_PARAMS } from '@block-pdf/signal/location';
import { Button } from '@core/component/FormControls/Button';
import DropdownMenu from '@core/component/FormControls/DropdownMenu';
import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { ToggleButton } from '@core/component/FormControls/ToggleButton';
import { ToggleSwitch } from '@core/component/FormControls/ToggleSwitch';
import { IconButton } from '@core/component/IconButton';
import { ContextMenuContent, MenuSeparator } from '@core/component/Menu';
import { getSuggestedProperties } from '@core/component/Properties/utils';
import { RecipientSelector } from '@core/component/RecipientSelector';
import {
  blockAcceptsFileExtension,
  fileTypeToBlockName,
} from '@core/constant/allBlocks';
import {
  ENABLE_PROPERTY_DISPLAY_CONTROL,
  ENABLE_SOUP_FROM_FILTER,
  ENABLE_TASKS_TABS,
} from '@core/constant/featureFlags';
import { useEmailLinksStatus } from '@core/email-link';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { debouncedDependent } from '@core/util/debounce';
import { fuzzyMatch } from '@core/util/fuzzy';
import SearchIcon from '@icon/regular/magnifying-glass.svg?component-solid';
import LoadingSpinner from '@icon/regular/spinner.svg?component-solid';
import XIcon from '@icon/regular/x.svg?component-solid';
import { ContextMenu } from '@kobalte/core/context-menu';
import { supportedExtensions } from '@lexical-core/utils';
import {
  createChannelsQuery,
  createDssInfiniteQuery,
  createFilterComposer,
  createProjectFilterFn,
  createSort,
  createUnifiedInfiniteList,
  createUnifiedSearchInfiniteQuery,
  type DocumentEntity,
  Entity,
  type EntityClickHandler,
  type EntityData,
  type EntityFilter,
  type ExpandedEntityType,
  importantFilterFn,
  isTaskEntity,
  notDoneFilterFn,
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
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSelector,
  createSignal,
  mergeProps,
  on,
  onCleanup,
  onMount,
  type ParentProps,
  type Setter,
  Show,
  type Signal,
} from 'solid-js';
import { createStore, type SetStoreFunction, unwrap } from 'solid-js/store';
import { EntityWithEverything } from '../../macro-entity/src/components/EntityWithEverything';
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
import { PropertyDisplayControl } from './PropertyDisplayControl';
import { useUpsertSavedViewMutation } from './Soup';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from './split-layout/components/SplitToolbar';
import { useSplitLayout } from './split-layout/layout';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';
import { EmptyState } from './UnifiedListEmptyState';
import {
  applyClientFilters,
  type DisplayOptions,
  type DocumentTypeFilter,
  type FilterOptions,
  isConfigEqual,
  KNOWN_FILE_TYPES,
  type SortOptions,
  type SystemSortOption,
  VIEWCONFIG_BASE,
  VIEWCONFIG_DEFAULTS_IDS,
  VIEWCONFIG_DEFAULTS_IDS_ENUM,
  type ViewConfigBase,
  type ViewData,
} from './ViewConfig';

const SEARCH_SERVICE_DEBOUNCE_MS = 200;
const LOCAL_FUZZY_SEARCH_DEBOUNCE_MS = 20;

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
  {
    value: 'frecency',
    label: 'Frecency',
    sortFn: sortByFrecencyScore,
  },
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
  const { isPanelActive, unifiedListContext, panelRef, previewState } =
    splitContext;
  const [preview] = previewState;
  const {
    viewsDataStore: viewsData,
    setViewDataStore,
    selectedView,
    virtualizerHandleSignal: [, setVirtualizerHandle],
    entityListRefSignal: [, setEntityListRef],
    entitiesSignal: [_entities, setEntities],
    emailViewSignal: [_emailView],
  } = unifiedListContext;
  const view = createMemo(() => viewsData[selectedView()]);
  const selectedEntity = createMemo(() => view()?.selectedEntity);

  createEffect(
    on(
      () =>
        [
          localEntityListRef(),
          // access index to properly track
          _entities()?.[0],
        ] as const,
      ([localEntityListRef]) => {
        if (!localEntityListRef) return;
        setEntityListRef(localEntityListRef);

        if (view()?.hasUserInteractedEntity) {
          if (selectedEntity()) {
            if (localEntityListRef && localEntityListRef.isConnected) {
              // focusing non-first entity causes issue where 100ms later, that focused entity loses focus and document.body is focused
              // forcing refocus on that entity works for now
              // read TODO inside function for more info
              tryFocusEntity(selectedEntity()!.id, {
                forceRefocusOnce: true,
              });
            }
          }
          return;
        }

        // select first item from entityList until interaction
        if (!_entities() || !_entities()?.length) return;
        const firstEntity = _entities()![0];

        setViewDataStore(selectedView(), 'highlightedId', firstEntity.id);
        setViewDataStore(selectedView(), 'selectedEntity', firstEntity);

        tryFocusEntity(firstEntity.id);

        function tryFocusEntity(
          entityId: string,
          { forceRefocusOnce }: { forceRefocusOnce: boolean } = {
            forceRefocusOnce: false,
          }
        ) {
          setTimeout(() => {
            const dontFocus = () => {
              if (!localEntityListRef) return true;
              // don't steal focus outside of entityList
              if (
                !(
                  document.activeElement === document.body ||
                  document.activeElement === panelRef() ||
                  localEntityListRef.contains(document.activeElement)
                )
              ) {
                return true;
              }
              return false;
            };

            if (dontFocus()) return;

            const focusElement = localEntityListRef!.querySelector(
              `[data-entity-id="${entityId}"]`
            ) as HTMLElement;

            if (focusElement instanceof HTMLElement) {
              focusElement.focus({ preventScroll: true });

              // TODO: figure out what's causing document.body to be focused
              // 100ms later or so, document.body is focused, despite focueElement still connected, and not shuffled
              // without this, createMenu on close doesn't refocus on entity
              if (forceRefocusOnce) {
                focusElement.addEventListener(
                  'blur',
                  () => {
                    if (dontFocus()) return;

                    focusElement.focus({ preventScroll: true });
                  },
                  { once: true }
                );
              }
            }
          });
        }
      }
    )
  );

  const notificationFilter = createMemo(
    () =>
      view()?.filters?.notificationFilter ??
      defaultFilterOptions.notificationFilter
  );
  const setNotificationFilter = (
    notificationFilter: FilterOptions['notificationFilter']
  ) => {
    setViewDataStore(
      selectedView(),
      'filters',
      'notificationFilter',
      notificationFilter
    );
  };

  const importantFilter = createMemo(
    () =>
      view()?.filters?.importantFilter ?? defaultFilterOptions.importantFilter
  );
  const setImportantFilter = (importantFilter: boolean) => {
    setViewDataStore(
      selectedView(),
      'filters',
      'importantFilter',
      importantFilter
    );
  };

  const entityTypeFilter = createMemo(
    () => view()?.filters?.typeFilter ?? defaultFilterOptions.typeFilter
  );
  const setEntityTypeFilter: SetStoreFunction<
    ViewData['filters']['typeFilter']
  > = (...args: any[]) => {
    // @ts-ignore narrowing set store function is annoying due to function overloading
    setViewDataStore(selectedView(), 'filters', 'typeFilter', ...args);
  };

  const fileTypeFilter = createMemo(
    () =>
      view()?.filters?.documentTypeFilter ??
      defaultFilterOptions.documentTypeFilter
  );
  const setFileTypeFilter: SetStoreFunction<
    ViewData['filters']['documentTypeFilter']
  > = (...args: any[]) => {
    setViewDataStore(
      selectedView(),
      'filters',
      'documentTypeFilter',
      // @ts-ignore narrowing set store function is annoying due to function overloading
      ...args
    );
  };

  const projectFilter = createMemo(
    () => view()?.filters?.projectFilter ?? defaultFilterOptions.projectFilter
  );

  const { all: emailRecipientOptions } = useCombinedRecipients(['user']);
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
  const showFromFilter = createMemo(
    () => shouldFilterEmails() || shouldFilterOwnedEntities()
  );
  const fromFilterUsers = createMemo(() => fromFilter() ?? []);
  const setFromFilterUsers: SetStoreFunction<
    ViewData['filters']['fromFilter']
  > = (...args: any[]) => {
    // @ts-ignore narrowing set store function is annoying due to function overloading
    setViewDataStore(selectedView(), 'filters', 'fromFilter', ...args);
  };

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
  const setShowUnrollNotifications = (
    showUnrollNotifications: DisplayOptions['unrollNotifications']
  ) => {
    setViewDataStore(
      selectedView(),
      'display',
      'unrollNotifications',
      showUnrollNotifications
    );
  };

  const showUnreadIndicator = createMemo(
    () =>
      view()?.display?.showUnreadIndicator ??
      defaultDisplayOptions.showUnreadIndicator
  );
  const setShowUnreadIndicator = (
    showUnreadIndicator: DisplayOptions['showUnreadIndicator']
  ) => {
    setViewDataStore(
      selectedView(),
      'display',
      'showUnreadIndicator',
      showUnreadIndicator
    );
  };

  const displayProperties = createMemo(
    () =>
      view()?.display?.displayProperties ??
      defaultDisplayOptions.displayProperties
  );
  const setDisplayProperties = (
    properties: DisplayOptions['displayProperties']
  ) => {
    setViewDataStore(
      selectedView(),
      'display',
      'displayProperties',
      properties
    );
  };

  // Suggested properties reactive to filter type
  const suggestedProperties = createMemo(() => {
    const types = entityTypeFilter();
    return getSuggestedProperties(types);
  });

  const rawSearchText = createMemo<string>(() => view()?.searchText ?? '');
  const searchText = createMemo(() => rawSearchText()?.trim() ?? '');

  const debouncedSearchForLocal = debouncedDependent(
    searchText,
    LOCAL_FUZZY_SEARCH_DEBOUNCE_MS
  );
  const debouncedSearchForService = debouncedDependent(
    searchText,
    SEARCH_SERVICE_DEBOUNCE_MS
  );

  const [isSearchLoading, setIsSearchLoading] = createSignal(false);

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

  const setHighlightedId = (id: string) => {
    setViewDataStore(selectedView(), 'highlightedId', id);
  };

  const { setFilters: setOptionalFilters, filterFn: optionalFilter } =
    createFilterComposer();
  const { setFilters: setRequiredFilters, filterFn: requiredFilter } =
    createFilterComposer();

  const toggleFileTypeFilter = (fileType: DocumentTypeFilter) =>
    batch(() => {
      if (!entityTypeFilter().includes('document'))
        setEntityTypeFilter((prev) => [...prev, 'document']);

      setFileTypeFilter((prev) =>
        prev.includes(fileType)
          ? prev.filter((t) => t !== fileType)
          : [...prev, fileType]
      );
    });

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

    if (notificationFilter() === 'unread') filterFns.push(unreadFilterFn);

    if (notificationFilter() === 'notDone') filterFns.push(notDoneFilterFn);

    const clientFilterFn = (entity: WithNotification<EntityData>) => {
      const filtered = applyClientFilters([entity], selectedView(), {
        soupContext: unifiedListContext,
      });
      return filtered.length > 0;
    };
    filterFns.push(clientFilterFn);

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

  const unifiedSearchIncludeArray = createMemo<UnifiedSearchIndex[]>(() => {
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
    return includeArray;
  });

  const unifiedSearchFilters = createMemo<UnifiedSearchRequestFilters>(() => {
    let documentFilters: DocumentFilters | null = null;
    if (fileTypeFilter().length > 0) {
      const fileTypes = fileTypeFilter().flatMap((fileType) => {
        // not ideal but it works for most cases
        if (fileType === 'code') return supportedExtensions;
        return [fileType];
      });
      documentFilters = {
        file_types: fileTypes,
      };
    }

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
  const GARBAGE_UUID = '00000000-0000-0000-0000-000000000000';
  const dssQueryRequestBody = createMemo(
    (): PostSoupRequest => ({
      channel_filters: {
        channel_ids: [GARBAGE_UUID],
      },
      document_filters: {
        document_ids:
          entityTypeFilter().includes('document') ||
          entityTypeFilter().includes('task') ||
          entityTypeFilter().length === 0
            ? []
            : [GARBAGE_UUID],
        project_ids: view().viewType === 'project' ? [view().id] : [],
      },
      chat_filters: {
        chat_ids:
          entityTypeFilter().includes('chat') || entityTypeFilter().length === 0
            ? []
            : [GARBAGE_UUID],
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
            : [GARBAGE_UUID],
      },
      project_filters: {
        project_ids:
          view().viewType === 'project'
            ? [view().id]
            : entityTypeFilter().includes('project') ||
                entityTypeFilter().length === 0
              ? []
              : [GARBAGE_UUID],
      },
      limit: props.defaultDisplayOptions?.limit ?? 100,
      emailView: importantFilter()
        ? 'important'
        : view().id === VIEWCONFIG_DEFAULTS_IDS_ENUM.all
          ? 'all'
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
    const actions = unifiedListContext.actionRegistry;
    if (actions.isActionEnabled('mark_as_done', entity)) {
      actions.execute('mark_as_done', entity);
      return true;
    }
    return false;
  };

  const { replaceOrInsertSplit, insertSplit } = useSplitLayout();

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
      notification.eventItemId,
      'channel'
    );
    if (!blockHandle) return;

    if (!isChannelMessageSend(notification))
      thread_id = notification.notificationMetadata.threadId;

    notificationSource.markAsRead(notification);

    return blockHandle?.goToLocationFromParams({ message_id, thread_id });
  };

  const { SortComponent, sortFn: entitySort } = createSort({
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

  const documentEntityClickHandler: EntityClickHandler<
    DocumentEntity | WithSearch<DocumentEntity>
  > = async (entity, event, location) => {
    const { id, fileType, subType } = entity;
    const blockName = fileTypeToBlockName(subType ?? fileType);
    const handle = event.altKey
      ? insertSplit({ type: blockName, id })
      : replaceOrInsertSplit({ type: blockName, id });

    handle?.activate();

    if (!location) return;

    const blockHandle = await blockOrchestrator.getBlockHandle(id);
    switch (location.type) {
      case 'md':
        await blockHandle?.goToLocationFromParams({
          [MD_PARAMS.nodeId]: location.nodeId,
        });
        break;
      case 'pdf':
        await blockHandle?.goToLocationFromParams({
          [PDF_PARAMS.searchPage]: location.searchPage.toString(),
          [PDF_PARAMS.searchRawQuery]: location.searchRawQuery,
          [PDF_PARAMS.searchHighlightTerms]: JSON.stringify(
            location.highlightTerms
          ),
          [PDF_PARAMS.searchSnippet]: location.searchSnippet,
        });
        break;
    }
  };

  const entityClickHandler: EntityClickHandler<EntityData> = async (
    entity,
    event,
    location,
    options
  ) => {
    if (preview() && !options?.ignorePreview) {
      setViewDataStore(selectedView(), 'selectedEntity', entity);
      return;
    }

    if (entity.type === 'document')
      return documentEntityClickHandler(entity, event, location);

    const handle = event.altKey
      ? insertSplit({ type: entity.type, id: entity.id })
      : replaceOrInsertSplit({ type: entity.type, id: entity.id });

    handle?.activate();

    if (!location) return;

    switch (location.type) {
      case 'channel': {
        const blockHandle = await blockOrchestrator.getBlockHandle(entity.id);
        await blockHandle?.goToLocationFromParams({
          [CHANNEL_PARAMS.message]: location.messageId,
        });
        break;
      }
      case 'email': {
        const blockHandle = await blockOrchestrator.getBlockHandle(entity.id);
        await blockHandle?.goToLocationFromParams({
          [EMAIL_PARAMS.messageId]: location.messageId,
        });
        break;
      }
    }
  };

  const StyledTriggerLabel = (props: ParentProps) => {
    return <span class="text-[0.625rem]">{props.children}</span>;
  };

  const highlightedSelector = createSelector(() => view()?.highlightedId);

  const focusedSelector = createSelector(() => selectedEntity()?.id);
  const selectedSelector = createSelector(
    () => view()?.selectedEntities,
    (a: string, b: EntityData[]) => b.find((e) => e.id === a) !== undefined
  );

  const saveViewMutation = useUpsertSavedViewMutation();

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

  const onClickSaveViewConfigChanges = () => {
    const view_ = view();
    const config = currentViewConfigBase();
    if (!view_ || !config) return;

    saveViewMutation.mutate({
      id: view_.id,
      name: view_.view,
      config,
    });
    // only for default views
    if (VIEWCONFIG_DEFAULTS_IDS.includes(view_.id as any)) {
      // Reset initialConfigSignal to current config after save
      const currentConfig = stringifiedCurrentViewConfigBase();
      if (currentConfig !== null && currentConfig !== undefined) {
        setViewDataStore(selectedView(), 'initialConfig', currentConfig);
      }
    }
  };

  const onClickResetViewConfigChanges = () => {
    const view_ = view();
    if (!view_) return;

    const initialConfigStr = view_.initialConfig;
    if (initialConfigStr == null || initialConfigStr === '') return;

    const initialConfigObj = JSON.parse(initialConfigStr) as ViewConfigBase;

    batch(() => {
      setViewDataStore(selectedView(), 'filters', initialConfigObj.filters);
      setViewDataStore(selectedView(), 'sort', initialConfigObj.sort);
      setViewDataStore(selectedView(), 'display', initialConfigObj.display);
    });
  };

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

  // reset last clicked on view change.
  createEffect(
    on(view, () => {
      lastClickedEntityId = -1;
    })
  );

  // reset last clicked on reset multi-selection.
  createEffect(() => {
    if (
      unifiedListContext.viewsDataStore[selectedView()].selectedEntities
        .length === 0
    ) {
      lastClickedEntityId = -1;
    }
  });

  return (
    <>
      <Show when={!props.hideToolbar}>
        <SearchBar
          isLoading={isSearchLoading}
          setIsLoading={setIsSearchLoading}
        />
        <SplitToolbarRight order={5}>
          <div class="flex flex-row items-center gap-1 p-1 h-full select-none">
            <Show when={isViewConfigChanged()}>
              <Show when={preview()}>
                <DropdownMenu
                  size="SM"
                  theme="secondary"
                  triggerLabel={<span class="font-extrabold">⋮</span>}
                >
                  <div class="flex flex-col gap-2 p-2">
                    <Button
                      size="SM"
                      classList={{
                        '!border-ink/25 !text-ink !bg-panel hover:!text-ink font-normal': true,
                      }}
                      onClick={onClickResetViewConfigChanges}
                    >
                      CLEAR
                    </Button>
                    <Button
                      size="SM"
                      classList={{
                        '!border-ink/25 !text-ink !bg-panel hover:!text-ink font-normal': true,
                      }}
                      onClick={onClickSaveViewConfigChanges}
                    >
                      SAVE CHANGES
                    </Button>
                  </div>
                </DropdownMenu>
              </Show>
              <Show when={!preview()}>
                <Button
                  size="SM"
                  classList={{
                    '!border-ink/25 !text-ink !bg-panel hover:!text-ink ml-1.5 font-normal': true,
                  }}
                  onClick={onClickResetViewConfigChanges}
                >
                  CLEAR
                </Button>
                <Button
                  size="SM"
                  classList={{
                    '!border-ink/25 !text-ink !bg-panel hover:!text-ink mx-1.5 font-normal': true,
                  }}
                  onClick={onClickSaveViewConfigChanges}
                >
                  SAVE CHANGES
                </Button>
              </Show>
            </Show>
            <DropdownMenu
              size="SM"
              theme="primary"
              triggerLabel={<StyledTriggerLabel>Filter</StyledTriggerLabel>}
            >
              <div class="min-w-[10vw] max-w-md">
                <div class="grid divide-y divide-edge">
                  <section class="gap-1 grid p-2">
                    <ToggleSwitch
                      size="SM"
                      label="Important"
                      checked={importantFilter()}
                      onChange={setImportantFilter}
                    />
                    <SegmentedControl
                      size="SM"
                      label="Show"
                      list={[
                        { value: 'all', label: 'All' },
                        { value: 'unread', label: 'Unread' },
                        { value: 'notDone', label: 'Not Done' },
                      ]}
                      value={notificationFilter()}
                      onChange={setNotificationFilter}
                    />
                  </section>
                  <section class="gap-1 p-2">
                    <span class="font-medium text-xs">Type</span>
                    <div class="flex flex-row flex-wrap items-center gap-1">
                      <EntityTypeToggle
                        filter={entityTypeFilter}
                        setFilter={setEntityTypeFilter}
                        setFileTypeFilter={setFileTypeFilter}
                        type="document"
                      />
                      <EntityTypeToggle
                        filter={entityTypeFilter}
                        setFilter={setEntityTypeFilter}
                        type="chat"
                      />
                      <EntityTypeToggle
                        filter={entityTypeFilter}
                        setFilter={setEntityTypeFilter}
                        type="channel"
                      />
                      <Show when={ENABLE_TASKS_TABS}>
                        <EntityTypeToggle
                          filter={entityTypeFilter}
                          setFilter={setEntityTypeFilter}
                          type="task"
                        />
                      </Show>
                      <EntityTypeToggle
                        filter={entityTypeFilter}
                        setFilter={setEntityTypeFilter}
                        type="email"
                      />
                      <EntityTypeToggle
                        filter={entityTypeFilter}
                        setFilter={setEntityTypeFilter}
                        type="project"
                      />
                    </div>
                  </section>
                  <section class="gap-1 p-2">
                    <span class="font-medium text-xs">Filetype</span>
                    <div class="flex flex-row flex-wrap items-center gap-1">
                      <ToggleButton
                        size="SM"
                        pressed={fileTypeFilter().includes('md')}
                        onChange={() => toggleFileTypeFilter('md')}
                      >
                        NOTE
                      </ToggleButton>
                      <ToggleButton
                        size="SM"
                        pressed={fileTypeFilter().includes('pdf')}
                        onChange={() => toggleFileTypeFilter('pdf')}
                      >
                        PDF
                      </ToggleButton>
                      <ToggleButton
                        size="SM"
                        pressed={fileTypeFilter().includes('canvas')}
                        onChange={() => toggleFileTypeFilter('canvas')}
                      >
                        CANVAS
                      </ToggleButton>
                      <ToggleButton
                        size="SM"
                        pressed={fileTypeFilter().includes('code')}
                        onChange={() => toggleFileTypeFilter('code')}
                      >
                        CODE
                      </ToggleButton>
                      <ToggleButton
                        size="SM"
                        pressed={fileTypeFilter().includes('image')}
                        onChange={() => toggleFileTypeFilter('image')}
                      >
                        IMAGE
                      </ToggleButton>
                      <ToggleButton
                        size="SM"
                        pressed={fileTypeFilter().includes('unknown')}
                        onChange={() => toggleFileTypeFilter('unknown')}
                      >
                        Other
                      </ToggleButton>
                    </div>
                  </section>
                  <Show when={ENABLE_SOUP_FROM_FILTER && showFromFilter()}>
                    <section class="gap-1 p-2">
                      <span class="font-medium text-xs">From</span>
                      <RecipientSelector<'user' | 'contact'>
                        options={emailRecipientOptions}
                        selectedOptions={fromFilterUsers}
                        setSelectedOptions={setFromFilterUsers}
                        placeholder="Filter by user..."
                        includeSelf
                      />
                    </section>
                  </Show>
                </div>
              </div>
            </DropdownMenu>
            <DropdownMenu
              size="SM"
              triggerLabel={<StyledTriggerLabel>Display</StyledTriggerLabel>}
            >
              <div class="min-w-[10vw] max-w-md">
                <div class="grid divide-y divide-edge">
                  <section class="p-2">
                    <SegmentedControl
                      size="SM"
                      label="Layout"
                      // value={selectItemFromList()}
                      list={['Compact', 'Relaxed', 'Visual']}
                      // onChange={(newValue) => setSelectItemFromList(newValue)}
                      disabled
                    />
                  </section>
                  <section class="gap-1 grid p-2">
                    <ToggleSwitch
                      size="SM"
                      label="Unroll Notifications"
                      checked={showUnrollNotifications()}
                      onChange={setShowUnrollNotifications}
                    />
                    <ToggleSwitch
                      size="SM"
                      label="Indicate Unread"
                      checked={showUnreadIndicator()}
                      onChange={setShowUnreadIndicator}
                    />
                  </section>
                  <section class="p-2">
                    <SortComponent size="SM" />
                  </section>
                  <Show when={ENABLE_PROPERTY_DISPLAY_CONTROL}>
                    <section class="p-2">
                      <PropertyDisplayControl
                        selectedPropertyIds={displayProperties}
                        setSelectedPropertyIds={setDisplayProperties}
                        suggestedProperties={suggestedProperties()}
                      />
                    </section>
                  </Show>
                </div>
              </div>
            </DropdownMenu>
          </div>
        </SplitToolbarRight>
      </Show>
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
          <UnifiedListComponent
            entityListRef={setLocalEntityListRef}
            virtualizerHandle={setVirtualizerHandle}
            emptyState={<EmptyState viewId={view()?.id} />}
            hasRefinementsFromBase={isViewConfigChanged}
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
              return (
                <EntityWithEverything
                  onContextMenu={() => {
                    setHighlightedId(innerProps.entity.id);

                    if (isPanelActive() && !preview()) {
                      setViewDataStore(
                        selectedView(),
                        'selectedEntity',
                        innerProps.entity
                      );
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
                  timestamp={timestamp()}
                  onClick={entityClickHandler}
                  onClickRowAction={
                    unifiedListContext.actionRegistry.isActionEnabled(
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
                    setViewDataStore(
                      selectedView(),
                      'hasUserInteractedEntity',
                      true
                    );

                    setHighlightedId(innerProps.entity.id);

                    if (isPanelActive() && !preview()) {
                      setViewDataStore(
                        selectedView(),
                        'selectedEntity',
                        innerProps.entity
                      );
                    }
                  }}
                  onMouseLeave={() => {}}
                  onFocusIn={() => {
                    setHighlightedId(innerProps.entity.id);

                    if (isPanelActive() && !preview()) {
                      setViewDataStore(
                        selectedView(),
                        'selectedEntity',
                        innerProps.entity
                      );
                    }
                  }}
                  showLeftColumnIndicator={
                    showUnreadIndicator() || importantFilter()
                  }
                  fadeIfRead={showUnreadIndicator()}
                  showUnrollNotifications={showUnrollNotifications()}
                  importantIndicatorActive={importantFilterFn(
                    innerProps.entity
                  )}
                  unreadIndicatorActive={unreadFilterFn(innerProps.entity)}
                  showDoneButton={displayDoneButton()}
                  highlighted={highlightedSelector?.(innerProps.entity.id)}
                  selected={
                    isPanelActive() && focusedSelector(innerProps.entity.id)
                  }
                  checked={selectedSelector(innerProps.entity.id)}
                  onChecked={(next, shiftKey) => {
                    const toggleSingle = () =>
                      unifiedListContext.setViewDataStore(
                        selectedView(),
                        'selectedEntities',
                        (p) => {
                          if (!next) {
                            return p.filter(
                              (e) => e.id !== innerProps.entity.id
                            );
                          }
                          return p.concat(innerProps.entity);
                        }
                      );

                    if (shiftKey) {
                      const entityList = unifiedListContext.entitiesSignal[0]();
                      if (!entityList) return;

                      const selectedEntitySet = new Set(
                        unifiedListContext.viewsDataStore[
                          unifiedListContext.selectedView()
                        ].selectedEntities
                      );
                      const newEnititiesForSeleciton: EntityData[] = [];

                      // Try to grab the last clicked item and fall back on
                      // the highest currently selected index.
                      let anchorIndex = lastClickedEntityId;
                      if (anchorIndex === -1) {
                        for (let i = 0; i < entityList.length; i++) {
                          if (selectedEntitySet.has(entityList[i])) {
                            anchorIndex = i;
                          }
                        }
                      }

                      if (anchorIndex === -1) {
                        toggleSingle();
                        lastClickedEntityId = innerProps.index;
                        return;
                      }

                      const targetIndex = innerProps.index;
                      const sign = Math.sign(targetIndex - anchorIndex);
                      if (anchorIndex === targetIndex) {
                        // no_op
                      } else {
                        for (
                          let i = anchorIndex;
                          sign > 0 ? i <= targetIndex : i >= targetIndex;
                          i += sign
                        ) {
                          const entity = entityList[i];
                          if (!selectedEntitySet.has(entity)) {
                            newEnititiesForSeleciton.push(entity);
                          }
                        }
                      }
                      unifiedListContext.setViewDataStore(
                        selectedView(),
                        'selectedEntities',
                        (p) => {
                          return p.concat(newEnititiesForSeleciton);
                        }
                      );
                      lastClickedEntityId = innerProps.index;
                    } else {
                      toggleSingle();
                      lastClickedEntityId = innerProps.index;
                    }
                  }}
                />
              );
            }}
          </UnifiedListComponent>
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
                  <Show when={isTouchDevice && isMobileWidth()}>
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
        <Show when={view()?.selectedEntities.length}>
          <EntitySelectionToolbarModal
            selectedEntities={view()?.selectedEntities ?? []}
            onClose={() =>
              unifiedListContext.setViewDataStore(
                selectedView(),
                'selectedEntities',
                []
              )
            }
            onAction={() => {
              const selectedEntities =
                viewsData[selectedView()].selectedEntities;
              const hasSelection = selectedEntities.length > 0;
              if (hasSelection) {
                setKonsoleMode('SELECTION_MODIFICATION');
                const selectionIndex =
                  searchCategories.getCategoryIndex('Selection');

                if (selectionIndex === undefined) return false;

                setCommandCategoryIndex(selectionIndex);

                searchCategories.showCategory('Selection');

                setKonsoleContextInformation({
                  selectedEntities: selectedEntities.slice(),
                  clearSelection: () => {
                    unifiedListContext.setViewDataStore(
                      selectedView(),
                      'selectedEntities',
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
    </>
  );
}

const EntityTypeToggle = (props: {
  type: ExpandedEntityType;
  filter: Accessor<typeof VIEWCONFIG_BASE.filters.typeFilter>;
  setFilter: Setter<typeof VIEWCONFIG_BASE.filters.typeFilter>;
  setFileTypeFilter?: Setter<typeof VIEWCONFIG_BASE.filters.documentTypeFilter>;
}) => {
  const toggleEntityTypeFilter = (type: ExpandedEntityType) => {
    props.setFilter((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };
  return (
    <ToggleButton
      size="SM"
      pressed={props.filter().includes(props.type)}
      onChange={(pressed) =>
        batch(() => {
          if (props.setFileTypeFilter && !pressed) props.setFileTypeFilter([]);

          toggleEntityTypeFilter(props.type);
        })
      }
    >
      <span class="uppercase">
        {props.type === 'project' ? 'folder' : props.type}
      </span>
    </ToggleButton>
  );
};

function SearchBar(props: {
  isLoading: Accessor<boolean>;
  setIsLoading: Setter<boolean>;
}) {
  const splitContext = useSplitPanelOrThrow();
  const {
    viewsDataStore,
    selectedView,
    setViewDataStore,
    entitiesSignal: [entities],
    virtualizerHandleSignal: [virtualizerHandle],
    entityListRefSignal: [entityListRef],
  } = splitContext.unifiedListContext;
  const viewData = createMemo(() => viewsDataStore[selectedView()]);
  const viewName = createMemo(() => viewData().view);

  let inputRef: HTMLInputElement | undefined;

  const searchText = createMemo<string>(() => viewData().searchText ?? '');
  const setSearchText = (text: string) => {
    setViewDataStore(selectedView(), 'searchText', text);
  };

  const isElementInViewport = (element: Element): Promise<boolean> => {
    return new Promise((resolve) => {
      const observer = new IntersectionObserver(
        (entries) => {
          resolve(entries[0].isIntersecting);
          observer.disconnect();
        },
        { threshold: 0.1 }
      );
      observer.observe(element);
    });
  };

  const focusFirstEntity = async () => {
    const highlightedId = viewData()?.highlightedId;
    const id = highlightedId;

    if (id) {
      const highlightedEntityEl = entityListRef()?.querySelector(
        `[data-entity-id="${id}"]`
      );

      if (
        highlightedEntityEl instanceof HTMLElement &&
        (await isElementInViewport(highlightedEntityEl))
      ) {
        highlightedEntityEl.focus();
        const entity = entities()?.find(({ id: entityId }) => entityId === id);
        if (entity) {
          setViewDataStore(selectedView(), 'selectedEntity', entity);
          return;
        }
      }
    }

    // Fallback to first entity
    const firstEntity = entityListRef()?.querySelector('[data-entity]');
    if (firstEntity instanceof HTMLElement) firstEntity.focus();
  };

  const [waitForLoadingEnd, setWaitForLoadingEnd] = createSignal(false);

  // When search text changes, mark that we're waiting for loading to end
  createRenderEffect((prevText: string) => {
    const text = searchText().trim();
    if (text !== prevText) {
      batch(() => {
        setViewDataStore(selectedView(), 'selectedEntity', undefined);
        setViewDataStore(selectedView(), 'highlightedId', undefined);
      });
      virtualizerHandle()?.scrollToIndex(0);
      setWaitForLoadingEnd(true);
    }
    return text;
  }, searchText());

  // When we're no longer loading but still waiting, reset the list
  createRenderEffect((prevLoading: boolean) => {
    const loading = props.isLoading();

    if (prevLoading && !loading && waitForLoadingEnd()) {
      // Loading just ended and we were waiting for it
      setWaitForLoadingEnd(false);
      virtualizerHandle()?.scrollToIndex(0);
    }

    return loading;
  }, props.isLoading());

  onMount(() => {
    const { dispose } = registerHotkey({
      hotkey: ['/'],
      scopeId: splitContext.splitHotkeyScope,
      description: 'Search in current view',
      hotkeyToken: TOKENS.soup.openSearch,
      keyDownHandler: () => {
        setTimeout(() => {
          const searchInput = document.getElementById(
            `search-input-${splitContext.handle.id}-${selectedView()}`
          ) as HTMLInputElement;
          searchInput?.focus();
        }, 0);
        return true;
      },
      displayPriority: 5,
    });
    onCleanup(() => {
      dispose();
    });
  });

  return (
    <SplitToolbarLeft>
      <div class="flex ml-2 h-full items-center gap-1">
        <Show
          when={props.isLoading() && searchText()}
          fallback={
            <Show
              when={searchText()}
              fallback={
                <IconButton
                  size="sm"
                  icon={SearchIcon}
                  theme="clear"
                  tooltip={{ label: 'Search' }}
                  onClick={() => {
                    inputRef?.focus();
                  }}
                />
              }
            >
              <IconButton
                size="sm"
                icon={XIcon}
                theme="clear"
                tooltip={{ label: 'Clear search' }}
                onClick={() => {
                  setSearchText('');
                  inputRef?.focus();
                }}
              />
            </Show>
          }
        >
          <IconButton
            size="sm"
            icon={LoadingSpinner}
            theme="clear"
            tooltip={{ label: 'Cancel search' }}
            class="animate-spin"
            onClick={() => {
              setSearchText('');
              inputRef?.focus();
            }}
          />
        </Show>
        <input
          ref={inputRef}
          id={`search-input-${splitContext.handle.id}-${selectedView()}`}
          placeholder={`Search in ${viewName()}`}
          value={searchText()}
          onInput={(e) => {
            setSearchText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (
              e.key === 'Escape' ||
              e.key === 'ArrowDown' ||
              e.key === 'Enter'
            ) {
              e.preventDefault();
              e.currentTarget.blur();
              focusFirstEntity();
            }
          }}
          class="p-1 pr-0 border-0 outline-none! focus:outline-none ring-0! focus:ring-0 flex-1 text-ink text-sm truncate"
        />
      </div>
    </SplitToolbarLeft>
  );
}
