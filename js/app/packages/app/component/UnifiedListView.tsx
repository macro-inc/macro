import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import {
  explicitNoiseFilter,
  noiseFilter,
  signalFilter,
} from '@app/component/soupFilters';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { codeFileExtensions } from '@block-code/util/languageSupport';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { DeprecatedButton } from '@core/component/FormControls/DeprecatedButton';
import DropdownMenu from '@core/component/FormControls/DropdownMenu';
import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { ToggleButton } from '@core/component/FormControls/ToggleButton';
import { ToggleSwitch } from '@core/component/FormControls/ToggleSwitch';
import { ContextMenuContent, MenuSeparator } from '@core/component/Menu';
import { useTaskProperties } from '@core/component/Properties/hooks';
import { getSuggestedProperties } from '@core/component/Properties/utils';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { toast } from '@core/component/Toast/Toast';
import {
  blockAcceptsFileExtension,
  fileTypeToBlockName,
} from '@core/constant/allBlocks';
import {
  ENABLE_FRECENCY,
  ENABLE_PROPERTY_DISPLAY,
  ENABLE_PROPERTY_FILTER,
  ENABLE_SOUP_FROM_FILTER,
  ENABLE_TASKS_TABS,
} from '@core/constant/featureFlags';
import { useEmailLinksStatus } from '@core/email-link';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { arrayEquals } from '@core/util/compareUtils';
import { debouncedDependent } from '@core/util/debounce';
import { fuzzyMatch } from '@core/util/fuzzy';
import CheckIcon from '@icon/bold/check-bold.svg';
import SearchIcon from '@icon/regular/magnifying-glass.svg?component-solid';
import LoadingSpinner from '@icon/regular/spinner.svg?component-solid';
import XIcon from '@icon/regular/x.svg?component-solid';
import { ContextMenu } from '@kobalte/core/context-menu';
import {
  createDssInfiniteQuery,
  createFilterComposer,
  createProjectFilterFn,
  createSort,
  createUnifiedInfiniteList,
  createUnifiedSearchInfiniteQuery,
  Entity,
  type EntityData,
  type EntityFilter,
  type ExpandedEntityType,
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
import type { SearchArgs } from '@service-search/client';
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
  For,
  mergeProps,
  on,
  onCleanup,
  onMount,
  type ParentProps,
  type Setter,
  Show,
  type Signal,
  Suspense,
} from 'solid-js';
import {
  createStore,
  produce,
  type SetStoreFunction,
  unwrap,
} from 'solid-js/store';
import {
  ENTITY_HEIGHT,
  type EntityClickHandler,
  type EntityPointerDownHandler,
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
import { PropertyDisplayControl } from './PropertyDisplayControl';
import { PropertyFilterControl } from './PropertyFilterControl';
import type { PropertyFilter } from './PropertyFilterTypes';
import { useUpsertSavedViewMutation } from './Soup';
import { openEntityInSplitFromUnifiedList } from './soupContextHelpers';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from './split-layout/components/SplitToolbar';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';
import {
  type DisplayOptions,
  type DocumentTypeFilter,
  type FilterOptions,
  isConfigEqual,
  KNOWN_FILE_TYPES,
  type SortOptions,
  type SystemSortOption,
  VIEWCONFIG_BASE,
  VIEWCONFIG_DEFAULTS_IDS_ENUM,
  VIEWCONFIG_FILTER_DOCUMENT_TYPE_FILTER,
  type ViewConfigBase,
  type ViewData,
} from './ViewConfig';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';

const SEARCH_SERVICE_DEBOUNCE_MS = 300;
const LOCAL_FUZZY_SEARCH_DEBOUNCE_MS = 20;

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const FILE_TYPE_DISPLAY_LABELS: Record<DocumentTypeFilter, string> = {
  md: 'NOTE',
  pdf: 'PDF',
  canvas: 'CANVAS',
  code: 'CODE',
  image: 'IMAGE',
  unknown: 'OTHER',
};

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
  hideToolbar?: boolean;
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
    props.defaultDisplayOptions,
    // When the toolbar is hidden (e.g. `Soup`'s topbar is used instead), users
    // have no in-view way to toggle this on. Default it to on so unread dots
    // are visible in the list.
    props.hideToolbar ? { showUnreadIndicator: true } : {}
  );

  const splitContext = useSplitPanelOrThrow();
  const { isPanelActive, soupContext, previewState } = splitContext;
  const [preview] = previewState;
  const {
    viewsDataStore: viewsData,
    setViewDataStore,
    selectedView,
    virtualizerHandleSignal: [virtualizerHandle, setVirtualizerHandle],
    entityListRefSignal: [, setEntityListRef],
    entitiesSignal: [entities_, setEntities],
    emailViewSignal: [emailView],
    activeContextSignal: [activeSoupContext, setActiveSoupContext],
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

  const { isKeypressActive } = useIsKeyPressActive();

  const setSelectedEntity = (entity: EntityData | undefined) => {
    setViewDataStore(
      selectedView(),
      produce((state) => {
        if (!state) return;
        state.selectedEntity = entity;
      })
    );
  };
  const setSelectedEntityFromMouse = (entity: EntityData | undefined) => {
    if (isKeypressActive()) return;

    setViewDataStore(
      selectedView(),
      produce((state) => {
        if (!state) return;
        state.selectedEntity = entity;
      })
    );
  };

  const entityListResetScroll = () => {
    setSelectedEntity(entities_()?.at(0));
    virtualizerHandle()?.scrollToOffset(0);
  };

  const rawSearchText = createMemo<string>(() => view()?.searchText ?? '');
  const searchText = createMemo(() => rawSearchText()?.trim() ?? '');

  // Track entity list ref changes
  createEffect(
    on(
      [localEntityListRef, () => entities_()?.at(0), searchText],
      ([localEntityListRef, firstEntity]) => {
        if (!localEntityListRef) return;
        setEntityListRef(localEntityListRef);

        if (view()?.hasUserInteractedEntity) return;
        if (isTouchDevice()) return;
        if (!firstEntity) return;

        setSelectedEntity(firstEntity);
      }
    )
  );

  // Stable key for filter state - changes trigger selection reset
  const filterKey = createMemo(() =>
    stringify({ viewId: selectedView(), filters: view()?.filters })
  );

  // Reset selection and scroll when filters change
  createEffect(
    on(
      filterKey,
      () => {
        if (isTouchDevice()) return;

        batch(() => {
          setViewDataStore(selectedView(), 'selectedEntity', undefined);
          setViewDataStore(selectedView(), 'hasUserInteractedEntity', false);
        });
        virtualizerHandle()?.scrollToIndex(0);
      },
      { defer: true }
    )
  );

  // Auto-select first entity when no selection exists
  createEffect(() => {
    if (isTouchDevice()) return;
    if (view()?.hasUserInteractedEntity) return;
    if (selectedEntity()) return;

    const first = entities_()?.at(0);
    if (first) setSelectedEntity(first);
  });

  // Always keep an entity selected when the list has items (e.g. after deletes).
  createEffect(
    on([entities_, selectedEntity], () => {
      if (isTouchDevice()) return;

      const list = entities_() ?? [];
      const first = list.at(0);
      if (!first) return;

      const current = selectedEntity();
      if (!current) {
        setSelectedEntity(first);
        return;
      }

      const existsInList = entityById().has(current.id);
      if (!existsInList) {
        setSelectedEntity(first);
      }
    })
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

  const focusFilters = createMemo(
    () => view()?.filters?.focusFilters ?? defaultFilterOptions.focusFilters
  );

  const toggleFocusFilter = (
    filter: NonNullable<FilterOptions['focusFilters']>[number]
  ) => {
    setViewDataStore(selectedView(), 'filters', 'focusFilters', (prev) => {
      if (!prev) return [filter];

      if (prev.includes(filter)) {
        return prev.filter((value) => value !== filter);
      }

      return [...prev, filter];
    });
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

  const unreadOnly = createMemo(
    () => view()?.filters?.unreadOnly ?? defaultFilterOptions.unreadOnly
  );

  const entityTypeFilter = createMemo(
    () => view()?.filters?.typeFilter ?? defaultFilterOptions.typeFilter
  );
  const setEntityTypeFilter: SetStoreFunction<
    ViewData['filters']['typeFilter']
  > = (...args: any[]) => {
    // @ts-ignore narrowing set store function is annoying due to function overloading
    setViewDataStore(selectedView(), 'filters', 'typeFilter', ...args);
    entityListResetScroll();
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

  const channelCategoryFilter = () =>
    view()?.filters?.channelCategoryFilter ??
    defaultFilterOptions.channelCategoryFilter;

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

  // Property filters
  const propertyFilters = createMemo(
    () => view()?.filters.propertyFilters ?? []
  );
  const setPropertyFilters = (filters: PropertyFilter[]) => {
    setViewDataStore(selectedView(), 'filters', 'propertyFilters', filters);
  };
  // Track incomplete property filters for toast warning on save
  const [hasIncompletePropertyFilters, setHasIncompletePropertyFilters] =
    createSignal(false);
  // Store clear handler from PropertyFilterControl
  let clearPropertyFilters: (() => void) | undefined;

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

  // Inbox + notification unrolling are coupled:
  // - inbox=true  => unroll=true
  // - inbox=false => unroll=false
  const showUnrollNotifications = createMemo(() => {
    const focusFilters = view()?.filters?.focusFilters ?? [];
    return focusFilters.includes('signal') && !focusFilters.includes('noise');
  });

  const showUnreadIndicator = createMemo(() => {
    // When the toolbar is hidden, the user has no in-view way to toggle this.
    // Keep unread indicators visible by default in these contexts.
    if (props.hideToolbar) return true;
    return (
      view()?.display?.showUnreadIndicator ??
      defaultDisplayOptions.showUnreadIndicator
    );
  });
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

    // Spread filters with propertyFilters explicitly accessed to ensure reactivity tracking
    const filters = viewsData[viewKey]?.filters;

    return {
      display: viewsData[viewKey]?.display,
      filters: { ...filters, propertyFilters: filters.propertyFilters },
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
    createFilterComposer([signalFilter.predicate]);
  // Initialize with default inbox filter since focusFilters defaults to ['signal']
  const { setFilters: setRequiredFilters, filterFn: requiredFilter } =
    createFilterComposer([signalFilter.predicate]);

  const toggleFileTypeFilter = (fileType: DocumentTypeFilter) => {
    batch(() => {
      if (!entityTypeFilter().includes('document'))
        setEntityTypeFilter((prev) => [...prev, 'document']);

      setFileTypeFilter((prev) =>
        prev.includes(fileType)
          ? prev.filter((t) => t !== fileType)
          : [...prev, fileType]
      );
    });
    entityListResetScroll();
  };

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

    const shouldFilterUnread =
      unreadOnly() === true || notificationFilter() === 'unread';
    if (shouldFilterUnread) filterFns.push(unreadFilterFn);

    if (notificationFilter() === 'notDone') filterFns.push(notDoneFilterFn);

    const focusFilters_ = focusFilters();
    const hasSignalFilter = focusFilters_?.includes('signal') === true;
    const hasNoiseFilter = focusFilters_?.includes('noise') === true;

    if (hasSignalFilter && !hasNoiseFilter) {
      filterFns.push(signalFilter.predicate);
    } else if (hasNoiseFilter && !hasSignalFilter) {
      filterFns.push(noiseFilter.predicate);
    } else if (!hasSignalFilter && !hasNoiseFilter) {
      filterFns.push(
        (entity) => !explicitNoiseFilter.predicate(entity, undefined)
      );
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

    const channelCategoryFilter_ = channelCategoryFilter() ?? [];
    if (channelCategoryFilter_.length > 0) {
      filterFns.push((entity) => {
        if (entity.type !== 'channel') return true;
        const isDm = entity.channelType === 'direct_message';
        const includePeople = channelCategoryFilter_.includes('people');
        const includeGroups = channelCategoryFilter_.includes('groups');
        // Defensive: if both are selected, behave like "no refinement".
        if (includePeople && includeGroups) return true;
        if (includePeople) return isDm;
        if (includeGroups) return !isDm;
        return true;
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

  const validSearchTerms = createMemo(
    () => debouncedSearchForService().length >= 3
  );
  const hasSignalOrNoiseFilter = createMemo(() => {
    const focusFilters_ = focusFilters();
    return (
      focusFilters_?.includes('signal') === true ||
      focusFilters_?.includes('noise') === true
    );
  });
  const isSearchActive = createMemo(
    () => validSearchTerms() && !hasSignalOrNoiseFilter()
  );

  const dssQueryParams = createMemo(
    (): GetItemsSoupParams => ({
      limit: props.defaultDisplayOptions?.limit ?? 100,
      sort_method: sortType(),
    })
  );

  const dssQueryRequestBody = createMemo(
    (): PostSoupRequest => ({
      channel_filters: {
        channel_ids:
          entityTypeFilter().includes('channel') ||
          entityTypeFilter().length === 0
            ? []
            : [NIL_UUID],
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
        : focusFilters()?.includes('signal') ||
            entityTypeFilter().includes('email')
          ? 'all'
          : view().id === VIEWCONFIG_DEFAULTS_IDS_ENUM.email
            ? emailView()
            : undefined,

      sort_method: sortType(),
    })
  );
  const searchUnifiedNameContentQueryParams = createMemo(
    (): SearchArgs => ({
      params: {
        cursor: null,
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

    if (isSearchActive() && onlyHas(typeFilter, 'email')) return true;
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

  const entityClickHandler: EntityClickHandler<EntityData> = async (args) => {
    const { type, event, location } = args;

    const entity = (
      type === 'entity' ? args.entity : args.projectEntity
    ) as EntityData;

    if (event.metaKey || event.ctrlKey) {
      openEntityInNewTab({ entity, location });
      return;
    }

    if (preview() && type === 'entity') {
      setSelectedEntity(entity);

      return;
    }

    await openEntityInSplitFromUnifiedList(entity, {
      openInNewSplit: event.altKey,
      location,
      splitHandle: splitContext.handle,
    });
  };

  const entityDblClickHandler: EntityClickHandler<EntityData> = async ({
    entity,
    location,
    event,
  }) => {
    if (!preview()) {
      return;
    }

    await openEntityInSplitFromUnifiedList(entity, {
      openInNewSplit: event.altKey,
      location,
      splitHandle: splitContext.handle,
    });
  };

  const entityPointerDownHandler: EntityPointerDownHandler<EntityData> = async (
    args
  ) => {
    const { type, location, event } = args;
    const entity = (
      type === 'entity' ? args.entity : args.projectEntity
    ) as EntityData;

    // middle mouse button pressed
    if (event.button === 1 && event.pointerType === 'mouse') {
      // TODO: current page should remain focused after opening new tab
      openEntityInNewTab({ entity, location });
    }
  };

  const StyledTriggerLabel = (props: ParentProps) => {
    return <span class="text-[0.625rem]">{props.children}</span>;
  };

  const focusedSelector = createSelector(() => selectedEntity()?.id);
  const multiSelectSelector = createSelector(
    () => view()?.multiSelectEntities,
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

  const onClickSaveViewConfigChanges = async () => {
    const view_ = view();
    const config = currentViewConfigBase();
    if (!view_ || !config) return;

    // Warn if there are incomplete property filters (they won't be saved)
    if (hasIncompletePropertyFilters()) {
      toast.alert('Incomplete property filters were not saved');
    }

    // Wait for mutation to complete (including query refetch) before updating initialConfig
    await saveViewMutation.mutateAsync({
      id: view_.id,
      name: view_.view,
      config,
    });

    // Reset initialConfig after save + refetch so isViewConfigChanged returns false
    const currentConfig = stringifiedCurrentViewConfigBase();
    if (currentConfig !== null && currentConfig !== undefined) {
      setViewDataStore(selectedView(), 'initialConfig', currentConfig);
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
    // Clear property filter UI state
    clearPropertyFilters?.();
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

  createEffect(
    on(splitContext.isPanelActive, () => {
      if (splitContext.isPanelActive()) {
        if (activeSoupContext() !== soupContext) return;
        const domEl = activeSoupContext()?.domRef();
        setTimeout(() => {
          domEl?.focus();
        });
      }
    })
  );

  return (
    <>
      <Show when={!props.hideToolbar}>
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
                    <DeprecatedButton
                      size="SM"
                      classList={{
                        '!border-ink/25 !text-ink !bg-panel hover:!text-ink font-normal': true,
                      }}
                      onClick={onClickResetViewConfigChanges}
                    >
                      CLEAR
                    </DeprecatedButton>
                    <DeprecatedButton
                      size="SM"
                      classList={{
                        '!border-ink/25 !text-ink !bg-panel hover:!text-ink font-normal': true,
                      }}
                      onClick={onClickSaveViewConfigChanges}
                    >
                      SAVE CHANGES
                    </DeprecatedButton>
                  </div>
                </DropdownMenu>
              </Show>
              <Show when={!preview()}>
                <DeprecatedButton
                  size="SM"
                  classList={{
                    '!border-ink/25 !text-ink !bg-panel hover:!text-ink ml-1.5 font-normal': true,
                  }}
                  onClick={onClickResetViewConfigChanges}
                >
                  CLEAR
                </DeprecatedButton>
                <DeprecatedButton
                  size="SM"
                  classList={{
                    '!border-ink/25 !text-ink !bg-panel hover:!text-ink mx-1.5 font-normal': true,
                  }}
                  onClick={onClickSaveViewConfigChanges}
                >
                  SAVE CHANGES
                </DeprecatedButton>
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
                      onChange={setImportantFilter}
                      checked={importantFilter()}
                      label="Important"
                      size="SM"
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

                    <div class="flex items-center justify-between">
                      <span class="font-medium text-xs">Focus</span>
                      <div class="flex items-center gap-1">
                        <ToggleButton
                          size="SM"
                          pressed={focusFilters()?.includes('signal')}
                          onChange={() => toggleFocusFilter('signal')}
                        >
                          <span class="uppercase">Signal</span>
                        </ToggleButton>
                        <ToggleButton
                          size="SM"
                          pressed={focusFilters()?.includes('noise')}
                          onChange={() => toggleFocusFilter('noise')}
                        >
                          <span class="uppercase">Noise</span>
                        </ToggleButton>
                      </div>
                    </div>
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
                      <For each={[...VIEWCONFIG_FILTER_DOCUMENT_TYPE_FILTER]}>
                        {(fileType) => (
                          <ToggleButton
                            size="SM"
                            pressed={fileTypeFilter().includes(fileType)}
                            onChange={() => toggleFileTypeFilter(fileType)}
                          >
                            {FILE_TYPE_DISPLAY_LABELS[fileType]}
                          </ToggleButton>
                        )}
                      </For>
                    </div>
                  </section>
                  <Show when={ENABLE_SOUP_FROM_FILTER && showFromFilter()}>
                    <section class="gap-1 p-2">
                      <span class="font-medium text-xs">From</span>
                      <RecipientSelector<'user' | 'contact'>
                        options={emailRecipientOptions}
                        selectedOptions={fromFilterUsers()}
                        setSelectedOptions={setFromFilterUsers}
                        placeholder="Filter by user..."
                        includeSelf
                      />
                    </section>
                  </Show>
                  <Show when={ENABLE_PROPERTY_FILTER}>
                    <Suspense>
                      <section class="gap-1 grid p-2">
                        <span class="font-medium text-xs">Property</span>
                        <PropertyFilterControl
                          propertyFilters={propertyFilters}
                          setPropertyFilters={setPropertyFilters}
                          onIncompleteFiltersChange={
                            setHasIncompletePropertyFilters
                          }
                          registerClearHandler={(fn) => {
                            clearPropertyFilters = fn;
                          }}
                        />
                      </section>
                    </Suspense>
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
                      label="Indicate Unread"
                      checked={showUnreadIndicator()}
                      onChange={setShowUnreadIndicator}
                    />
                  </section>
                  <section class="p-2">
                    <SortComponent
                      size="SM"
                      onSelectSystemSort={() => {
                        entityListResetScroll();
                      }}
                    />
                  </section>
                  <Show when={ENABLE_PROPERTY_DISPLAY}>
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
        <ContextMenu.Trigger
          class="@container/uList size-full unified-list-root"
          onPointerDown={() => {
            setActiveSoupContext(soupContext);
          }}
          onKeyUp={() => {
            setActiveSoupContext(soupContext);
          }}
        >
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
              viewType={view()?.viewType}
              name={view()?.view}
              splitId={splitContext.handle.id}
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
                      splitId={splitContext.handle.id}
                      timestamp={timestamp()}
                      onClick={entityClickHandler}
                      onDblClick={entityDblClickHandler}
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
                      onClickNotification={({ entity: notifiedEntity }) => {
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
                        setSelectedEntityFromMouse(innerProps.entity);
                      }}
                      onMouseLeave={() => {}}
                      onFocusIn={() => {
                        if (preview()) return;
                        setSelectedEntity(innerProps.entity);
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
                      highlighted={
                        isPanelActive() && focusedSelector(innerProps.entity.id)
                      }
                      selected={{
                        active:
                          focusedSelector(innerProps.entity.id) ||
                          contextAndModalState.selectedEntity?.id ===
                            innerProps.entity.id,
                        muted:
                          focusedSelector(innerProps.entity.id) &&
                          activeSoupContext() !== soupContext,
                      }}
                      checked={multiSelectSelector(innerProps.entity.id)}
                      onChecked={(next, shiftKey) =>
                        handleMultiSelectChecked({
                          entity: innerProps.entity,
                          entityIndex: innerProps.index,
                          next,
                          shiftKey: shiftKey ?? false,
                        })
                      }
                      searchActive={!!searchText()}
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
                  <Show when={isMobile()}>
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

function _SearchBar(props: {
  isLoading: Accessor<boolean>;
  setIsLoading: Setter<boolean>;
}) {
  const getInputId = (selectedView: string) =>
    `search-input-${splitContext.handle.id}-${selectedView}`;
  const splitContext = useSplitPanelOrThrow();
  const {
    viewsDataStore,
    selectedView,
    setSelectedView,
    setViewDataStore,
    virtualizerHandleSignal: [virtualizerHandle],
    entityListRefSignal: [entityListRef],
    navigateThroughList,
  } = splitContext.soupContext;
  const viewData = createMemo(() => viewsDataStore[selectedView()]);
  const viewName = createMemo(() => viewData().view);

  let inputRef: HTMLInputElement | undefined;

  const searchText = createMemo<string>(() => viewData().searchText ?? '');
  const setSearchText = (text: string) => {
    setViewDataStore(selectedView(), 'searchText', text);
  };

  const selectionClick = () => {
    const id = viewsDataStore[selectedView()].selectedEntity?.id;
    if (!id) return;
    const el = entityListRef()?.querySelector(`[data-entity-id="${id}"]`);
    if (!(el instanceof HTMLElement)) return;
    el.click();
  };

  const focusNextEntity = () => {
    navigateThroughList({
      axis: 'end',
      mode: 'step',
    });
  };

  const [waitForLoadingEnd, setWaitForLoadingEnd] = createSignal(false);

  // When search text changes, mark that we're waiting for loading to end
  createRenderEffect((prevText: string) => {
    const text = searchText().trim();
    if (text !== prevText) {
      setViewDataStore(selectedView(), 'selectedEntity', undefined);
      setViewDataStore(selectedView(), 'hasUserInteractedEntity', false);
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

  // waits for input element to be mounted before focusing it
  const focusSearch = () => {
    const inputId = getInputId(selectedView());
    const existingInput = document.getElementById(inputId) as HTMLInputElement;
    if (existingInput) {
      existingInput.focus();
      return;
    }

    const mutationObserver = new MutationObserver(() => {
      const input = document.getElementById(inputId) as HTMLInputElement;
      if (input) {
        mutationObserver.disconnect();
        input.focus();
      }
    });

    const toolbarLeft = splitContext.layoutRefs.toolbarLeft;
    if (toolbarLeft) {
      mutationObserver.observe(toolbarLeft, {
        childList: true,
        subtree: true,
      });
    }

    setTimeout(() => {
      mutationObserver.disconnect();
    }, 1000);
  };

  onMount(() => {
    const { dispose: disposeSlash } = registerHotkey({
      hotkey: ['/'],
      scopeId: splitContext.splitHotkeyScope,
      description: 'Search all',
      hotkeyToken: TOKENS.soup.openSearch,
      keyDownHandler: () => {
        setSelectedView(VIEWCONFIG_DEFAULTS_IDS_ENUM.all);
        setTimeout(() => {
          focusSearch();
        }, 0);
        return true;
      },
      displayPriority: 5,
    });

    const { dispose: disposeCmd } = registerHotkey({
      hotkey: ['cmd+f'],
      scopeId: splitContext.splitHotkeyScope,
      description: 'Search in current view',
      keyDownHandler: () => {
        focusSearch();
        return true;
      },
      displayPriority: 5,
    });

    onCleanup(() => {
      disposeSlash();
      disposeCmd();
    });
  });

  return (
    <SplitToolbarLeft class="min-w-0">
      <div class="flex ml-2 h-full items-center gap-1">
        <Show
          when={props.isLoading() && searchText()}
          fallback={
            <Show
              when={searchText()}
              fallback={
                <DeprecatedIconButton
                  size="sm"
                  icon={SearchIcon}
                  theme="clear"
                  tooltip={{ label: 'Search' }}
                  tabIndex={-1}
                  onClick={() => {
                    inputRef?.focus();
                  }}
                />
              }
            >
              <DeprecatedIconButton
                size="sm"
                icon={XIcon}
                theme="clear"
                tooltip={{ label: 'Clear search' }}
                tabIndex={-1}
                onClick={() => {
                  setSearchText('');
                  inputRef?.focus();
                }}
              />
            </Show>
          }
        >
          <DeprecatedIconButton
            size="sm"
            icon={LoadingSpinner}
            theme="clear"
            tooltip={{ label: 'Cancel search' }}
            class="[&_svg]:animate-spin"
            tabIndex={-1}
            onClick={() => {
              setSearchText('');
              inputRef?.focus();
            }}
          />
        </Show>
        <input
          ref={inputRef}
          id={getInputId(selectedView())}
          placeholder={`Search in ${viewName()}`}
          value={searchText()}
          onInput={(e) => {
            setSearchText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
              selectionClick();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              e.currentTarget.blur();
              focusNextEntity();
            }
          }}
          class="p-1 pr-0 border-0 outline-none! focus:outline-none ring-0! focus:ring-0 flex-1 text-ink text-sm truncate min-w-0"
        />
      </div>
    </SplitToolbarLeft>
  );
}
