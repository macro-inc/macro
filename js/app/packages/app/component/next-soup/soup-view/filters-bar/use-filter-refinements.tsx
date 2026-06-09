import {
  getViewPreset,
  type PresetContext,
  VIEW_TAB_PRESETS,
} from '@app/component/app-sidebar/soup-filter-presets';
import {
  type FilterContext,
  type FilterID,
  NO_ASSIGNEE,
} from '@app/component/next-soup/filters';
import {
  defineQueryFilters,
  NIL_UUID,
  type Query,
  queryStateFrom,
} from '@app/component/next-soup/filters/filter-store';
import { mergeQuery } from '@app/component/next-soup/filters/filter-store/query-store';
import {
  type CallStatus,
  callStatusFromAttended,
} from '@app/component/next-soup/filters/filter-store/types';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { isListViewID } from '@app/constants/list-views';
import { UserIcon } from '@core/component/UserIcon';
import { useUserContext, useUserId } from '@core/context/user';
import { deepEqual } from '@core/util/compareUtils';
import CircleDashedIcon from '@phosphor/circle-dashed.svg';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useContacts } from '@queries/contacts/contacts';
import {
  type Accessor,
  batch,
  createMemo,
  createSignal,
  type JSX,
} from 'solid-js';
import type {
  ConsolidatedFilter,
  FilterValue,
} from './consolidated-filter-chip';
import {
  CALL_STATUS_FILTER_OPTIONS,
  cacheCallSubFilters,
  cacheChannelSubFilters,
  cacheEmailSubFilters,
  getCallStatusLabel,
  INDEX_OPTIONS,
  type SearchableOption,
  useSearchFilterOptions,
  useSearchIndexController,
} from './search-filter-controls';
import {
  buildContactLabel,
  VIEW_FILTER_CATEGORIES,
} from './unified-filter-dropdown';

// Filter IDs that are set by tabs and should not be shown as removable chips
const TAB_ONLY_FILTERS = new Set([
  'inbox',
  'noise',
  'explicit-noise',
  'channels',
  'file-folder',
  'shared-entity',
  'shared-agent',
  'assigned-to',
  'no-drafts',
  'email-drafts',
  'not-task',
]);

/**
 * Hook that provides detection of active filter refinements beyond tab defaults,
 * and a function to reset filters to the current tab's default state.
 */
export function useFilterRefinements() {
  const {
    soup,
    items,
    queryFilters,
    assigneeFilter,
    setAssigneeFilter,
    activeTab,
  } = useSoupView();
  const filterData = () => queryFilters.state;
  const panel = useSplitPanelOrThrow();
  const user = useUserContext();
  const contacts = useContacts();
  const currentUserId = useUserId();
  const { channelOptions, channelLabelMap, senderOptions, senderLabelMap } =
    useSearchFilterOptions();
  const { changeIndex } = useSearchIndexController();

  const getPresetContext = (): PresetContext => ({
    userId: user.userId(),
    email: user.email(),
  });

  const currentView = createMemo(() => {
    const content = panel.handle.content();

    if (content.type !== 'component' || !isListViewID(content.id)) return;

    return content.id;
  });

  const currentPreset = createMemo(() => {
    const view = currentView();
    if (!view) return undefined;
    const tab = activeTab() ?? VIEW_TAB_PRESETS[view]?.default;
    if (!tab) return undefined;
    return getViewPreset(view, tab, getPresetContext());
  });

  const hasActiveRefinements = createMemo(() => {
    const preset = currentPreset();
    if (!preset) return false;

    const expectedIds = new Set([
      ...(preset.clientFilters.and ?? []),
      ...(preset.clientFilters.or ?? []),
    ]);

    const currentIds = new Set(soup.predicates.activeIds() as FilterID[]);

    const hasClientFilterDiff =
      expectedIds.size !== currentIds.size ||
      [...expectedIds].some((id) => !currentIds.has(id as FilterID));

    // Check if there are any external filters set (normalize undefined vs {} for comparison)
    const currentFilterData = filterData();
    const presetFilters = preset.filters;
    const hasQueryFilterDiff =
      !deepEqual(currentFilterData.include, presetFilters.include ?? {}) ||
      !deepEqual(currentFilterData.exclude, presetFilters.exclude ?? {}) ||
      currentFilterData.emailView !== presetFilters.emailView;

    const hasSubFilters = assigneeFilter().length > 0;

    return hasClientFilterDiff || hasQueryFilterDiff || hasSubFilters;
  });

  /**
   * Human-readable options for the assignee sub-filter, keyed by assignee ID.
   * Mirrors the same logic used in UnifiedFilterDropdown's assigneeOptions.
   */
  const assigneeOptionsMap = createMemo(
    (): Map<string, { label: string; icon?: () => JSX.Element }> => {
      const uid = currentUserId();
      const map = new Map<
        string,
        { label: string; icon?: () => JSX.Element }
      >();
      map.set(NO_ASSIGNEE, {
        label: 'Unassigned',
        icon: () => <CircleDashedIcon class="size-3 text-ink-muted" />,
      });
      for (const contact of contacts()) {
        map.set(contact.id, {
          label: buildContactLabel(contact, uid),
          icon: () => (
            <UserIcon
              id={contact.id}
              size="sm"
              suppressClick
              showTooltip={false}
            />
          ),
        });
      }
      return map;
    }
  );

  /**
   * Searchable options for the assignee filter (for use in searchable multi-select).
   */
  const assigneeSearchableOptions = createMemo((): SearchableOption[] => {
    const uid = currentUserId();
    const noAssigneeOption: SearchableOption = {
      id: NO_ASSIGNEE,
      label: 'Unassigned',
      icon: () => <CircleDashedIcon class="size-3.5 text-ink-muted" />,
    };
    let meOption: SearchableOption | undefined;
    const otherContactOptions: SearchableOption[] = [];
    for (const contact of contacts()) {
      const opt: SearchableOption = {
        id: contact.id,
        label: buildContactLabel(contact, uid),
        icon: () => (
          <UserIcon
            id={contact.id}
            size="sm"
            suppressClick
            showTooltip={false}
          />
        ),
      };
      if (contact.id === uid) {
        meOption = opt;
      } else {
        otherContactOptions.push(opt);
      }
    }
    return [
      ...(meOption ? [meOption] : []),
      noAssigneeOption,
      ...otherContactOptions,
    ];
  });

  /**
   * Handler for assignee filter changes.
   */
  const handleAssigneeChange = (ids: string[]) => {
    const current = assigneeFilter();
    const toAdd = ids.filter((id) => !current.includes(id));
    const toRemove = current.filter((id) => !ids.includes(id));

    // Exclude NO_ASSIGNEE from backend queries - it's handled client-side only
    const toProps = (list: string[]) =>
      list
        .filter((id) => id !== NO_ASSIGNEE)
        .map((id) => ({
          propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
          type: 'entity' as const,
          value: id,
        }));

    batch(() => {
      setAssigneeFilter(ids);

      // Activate/deactivate the assignee predicate based on selection
      const shouldBeActive = ids.length > 0;
      if (shouldBeActive !== soup.predicates.isActive('assignee')) {
        soup.predicates.toggle({ and: ['assignee'] });
      }

      const removeProps = toProps(toRemove);
      const addProps = toProps(toAdd);
      if (removeProps.length)
        queryFilters.remove({ include: { properties: removeProps } });
      if (addProps.length)
        queryFilters.add({ include: { properties: addProps } });
    });
  };

  /**
   * Get filter categories for the current view
   */
  const viewCategories = createMemo(() => {
    const view = currentView();
    if (!view) return [];
    return VIEW_FILTER_CATEGORIES[view as ListView] ?? [];
  });

  const setFilterIds =
    (
      field: 'callChannelId' | 'callSpeakerId' | 'channelId' | 'channelSenderId'
    ) =>
    (ids: string[]) =>
      queryFilters.set({
        include: {
          [field]: ids,
        },
      });

  /**
   * Cache for consolidated filter chips, similar to chipCache but for the new format.
   * We track the view and tab to invalidate when they change, since cached chips
   * may close over stale values (e.g. group.allOptions, coveredByView, presetFilterIds).
   */
  const consolidatedChipCache = new Map<string, ConsolidatedFilter>();
  let lastCacheViewId: ListView | undefined;
  let lastCacheTab: string | undefined;

  const getOrCreateConsolidatedChip = (
    key: string,
    build: () => ConsolidatedFilter
  ): ConsolidatedFilter => {
    let chip = consolidatedChipCache.get(key);
    if (!chip) {
      chip = build();
      consolidatedChipCache.set(key, chip);
    }
    return chip;
  };

  /**
   * Returns consolidated filters grouped by category.
   * Multiple values in the same category are shown in a single chip.
   */
  const consolidatedFiltersList = createMemo((): ConsolidatedFilter[] => {
    const view = currentView();
    const preset = currentPreset();
    const tab = activeTab();

    // Invalidate cache when view or tab changes, since cached chips
    // close over render-local values like group.allOptions, coveredByView, presetFilterIds
    if (view !== lastCacheViewId || tab !== lastCacheTab) {
      consolidatedChipCache.clear();
      lastCacheViewId = view;
      lastCacheTab = tab;
    }

    const presetFilterIds = new Set([
      ...(preset?.clientFilters.and ?? []),
      ...(preset?.clientFilters.or ?? []),
    ]);

    const filters: ConsolidatedFilter[] = [];
    const seenKeys = new Set<string>();

    // Group view category filters by category
    const categoryGroups = new Map<
      string,
      {
        label: string;
        labelPlural?: string;
        allOptions: FilterValue[];
        multiple: boolean;
      }
    >();

    for (const category of viewCategories()) {
      const activeValues: FilterValue[] = [];
      const allOptions: FilterValue[] = [];

      for (const option of category.options) {
        allOptions.push({
          id: option.id,
          label: option.label,
          icon: option.icon,
        });

        if (
          soup.predicates.isActive(option.id) &&
          !TAB_ONLY_FILTERS.has(option.id) &&
          !presetFilterIds.has(option.id as FilterID)
        ) {
          activeValues.push({
            id: option.id,
            label: option.label,
            icon: option.icon,
          });
        }
      }

      if (activeValues.length > 0) {
        categoryGroups.set(category.id, {
          label: category.label,
          labelPlural: category.labelPlural,
          allOptions,
          multiple: category.multiple ?? true,
        });
      }
    }

    // Build consolidated chips for each category group
    for (const [categoryId, group] of categoryGroups) {
      const key = `category:${categoryId}`;
      seenKeys.add(key);

      // Helper to get current active values for this category (computed fresh)
      const getActiveValues = (): FilterValue[] => {
        const result: FilterValue[] = [];
        for (const opt of group.allOptions) {
          if (
            soup.predicates.isActive(opt.id) &&
            !TAB_ONLY_FILTERS.has(opt.id) &&
            !presetFilterIds.has(opt.id as FilterID)
          ) {
            result.push(opt);
          }
        }
        return result;
      };

      filters.push(
        getOrCreateConsolidatedChip(key, () => ({
          key,
          categoryLabel: group.label,
          categoryLabelPlural: group.labelPlural,
          values: getActiveValues, // Accessor - computed fresh each render
          availableOptions: group.allOptions,
          multiple: group.multiple,
          isValueActive: (id) => soup.predicates.isActive(id),
          onToggleValue: (id) => {
            const isInboxTypeFilter =
              currentView() === 'inbox' && categoryId === 'type';
            batch(() => {
              soup.predicates.toggle({ or: [id as FilterID] });

              if (isInboxTypeFilter) {
                const activeTypeIds = group.allOptions
                  .filter((option) => soup.predicates.isActive(option.id))
                  .map((option) => option.id);
                queryFilters.replace(getInboxTypeQuery(activeTypeIds) ?? null);
                return;
              }

              const query = getFilterQuery(id);
              if (!query) return;

              if (soup.predicates.isActive(id)) {
                queryFilters.add(query);
              } else {
                queryFilters.remove(query);
              }
            });
          },
          onRemoveAll: () => {
            // Compute current active values at removal time
            const currentValues = getActiveValues();
            const isInboxTypeFilter =
              currentView() === 'inbox' && categoryId === 'type';
            batch(() => {
              for (const value of currentValues) {
                soup.predicates.toggle({ or: [value.id as FilterID] });
              }

              if (isInboxTypeFilter) {
                queryFilters.replace(getInboxTypeQuery([]) ?? null);
                return;
              }

              for (const value of currentValues) {
                const query = getFilterQuery(value.id);
                if (query) queryFilters.remove(query);
              }
            });
          },
        }))
      );
    }

    // Search index type filters (single-select, replaces)
    const coveredByView = new Set<string>(
      viewCategories().flatMap((c) => c.options.map((o) => o.id))
    );
    const activeIndexOptions: FilterValue[] = [];
    for (const option of INDEX_OPTIONS) {
      const optionId = option.value as FilterID;
      if (
        soup.predicates.isActive(optionId) &&
        !coveredByView.has(optionId) &&
        !presetFilterIds.has(optionId)
      ) {
        activeIndexOptions.push({
          id: option.value,
          label: option.label,
          icon: option.icon,
        });
      }
    }

    if (activeIndexOptions.length > 0) {
      const key = 'type:index';
      seenKeys.add(key);

      const getActiveIndexValues = (): FilterValue[] => {
        const result: FilterValue[] = [];
        for (const option of INDEX_OPTIONS) {
          const optionId = option.value as FilterID;
          if (
            soup.predicates.isActive(optionId) &&
            !coveredByView.has(optionId) &&
            !presetFilterIds.has(optionId)
          ) {
            result.push({
              id: option.value,
              label: option.label,
              icon: option.icon,
            });
          }
        }
        return result;
      };

      filters.push(
        getOrCreateConsolidatedChip(key, () => ({
          key,
          categoryLabel: 'Type',
          categoryLabelPlural: 'Types',
          values: getActiveIndexValues,
          availableOptions: INDEX_OPTIONS.map((o) => ({
            id: o.value,
            label: o.label,
            icon: o.icon,
          })),
          multiple: false,
          isValueActive: (id) => soup.predicates.isActive(id),
          onToggleValue: (id) => changeIndex(id),
          onRemoveAll: () => changeIndex('all'),
        }))
      );
    }

    // Assignee filter (consolidated) - using searchable approach
    const pushAssigneeConsolidatedChip = () => {
      const key = 'assignee';
      const popupOpen =
        consolidatedChipCache.get(key)?.isPopupOpen?.() ?? false;
      const ids = assigneeFilter();
      if (ids.length === 0 && !popupOpen) return;

      seenKeys.add(key);

      // Compute values as accessor for reactivity, including icons
      const getValues = (): FilterValue[] =>
        assigneeFilter().map((id) => {
          const opt = assigneeOptionsMap().get(id);
          return {
            id,
            label: opt?.label ?? id,
            icon: opt?.icon,
          };
        });

      filters.push(
        getOrCreateConsolidatedChip(key, () => {
          const [isPopupOpen, _setPopupOpen] = createSignal(false);
          const setPopupOpen = (v: boolean) => {
            if (!v) {
              queueMicrotask(() =>
                panel.panelRef()?.focus({ preventScroll: true })
              );
            }
            _setPopupOpen(v);
          };
          return {
            key,
            categoryLabel: 'Assignee',
            values: getValues,
            searchableOptions: assigneeSearchableOptions,
            activeSearchableIds: assigneeFilter,
            onSearchableChange: handleAssigneeChange,
            searchPlaceholder: 'Search assignees...',
            isPopupOpen,
            setPopupOpen,
            onRemoveAll: () => handleAssigneeChange([]),
          };
        })
      );
    };

    pushAssigneeConsolidatedChip();

    // Searchable filters helper for consolidated chips
    const pushSearchableConsolidatedChip = (args: {
      key: string;
      categoryLabel: string;
      getIds: () => string[];
      searchableOptions: Accessor<SearchableOption[]>;
      labelMap: Accessor<Map<string, string>>;
      onChange: (ids: string[]) => void;
      searchPlaceholder: string;
    }) => {
      const popupOpen =
        consolidatedChipCache.get(args.key)?.isPopupOpen?.() ?? false;
      const ids = args.getIds();
      if (ids.length === 0 && !popupOpen) return;

      seenKeys.add(args.key);

      // Compute values as accessor for reactivity
      const getValues = (): FilterValue[] => {
        const options = args.searchableOptions();
        return args.getIds().map((id) => {
          const opt = options.find((o) => o.id === id);
          return {
            id,
            label: args.labelMap().get(id) ?? id,
            icon: opt?.icon,
          };
        });
      };

      filters.push(
        getOrCreateConsolidatedChip(args.key, () => {
          const [isPopupOpen, _setPopupOpen] = createSignal(false);
          const setPopupOpen = (v: boolean) => {
            if (!v) {
              queueMicrotask(() =>
                panel.panelRef()?.focus({ preventScroll: true })
              );
            }
            _setPopupOpen(v);
          };
          return {
            key: args.key,
            categoryLabel: args.categoryLabel,
            values: getValues,
            searchableOptions: args.searchableOptions,
            activeSearchableIds: args.getIds,
            onSearchableChange: args.onChange,
            searchPlaceholder: args.searchPlaceholder,
            isPopupOpen,
            setPopupOpen,
            onRemoveAll: () => args.onChange([]),
          };
        })
      );
    };

    // Channel In/From filters
    pushSearchableConsolidatedChip({
      key: 'channel-in',
      categoryLabel: 'In',
      getIds: () =>
        (queryFilters.state.include.channelId ?? []).filter(
          (id) => id !== NIL_UUID
        ),
      searchableOptions: channelOptions,
      labelMap: channelLabelMap,
      onChange: setFilterIds('channelId'),
      searchPlaceholder: 'Search channels...',
    });

    pushSearchableConsolidatedChip({
      key: 'channel-from',
      categoryLabel: 'From',
      getIds: () => queryFilters.state.include.channelSenderId ?? [],
      searchableOptions: senderOptions,
      labelMap: senderLabelMap,
      onChange: setFilterIds('channelSenderId'),
      searchPlaceholder: 'Search senders...',
    });

    // Search view specific filters
    if (currentView() === 'search') {
      if (soup.predicates.isActive('calls')) {
        pushSearchableConsolidatedChip({
          key: 'call-in',
          categoryLabel: 'In',
          getIds: () =>
            (queryFilters.state.include.callChannelId ?? []).filter(
              (id) => id !== NIL_UUID
            ),
          searchableOptions: channelOptions,
          labelMap: channelLabelMap,
          onChange: setFilterIds('callChannelId'),
          searchPlaceholder: 'Search channels...',
        });

        pushSearchableConsolidatedChip({
          key: 'call-from',
          categoryLabel: 'From',
          getIds: () => queryFilters.state.include.callSpeakerId ?? [],
          searchableOptions: senderOptions,
          labelMap: senderLabelMap,
          onChange: setFilterIds('callSpeakerId'),
          searchPlaceholder: 'Search speakers...',
        });

        // Call status filter
        const getCurrentCallStatus = (): CallStatus | undefined =>
          queryFilters.state.include.callStatus ??
          callStatusFromAttended(queryFilters.state.include.callAttended);

        if (getCurrentCallStatus() !== undefined) {
          const key = 'call-status';
          seenKeys.add(key);

          const getCallStatusValues = (): FilterValue[] => {
            const status = getCurrentCallStatus();
            if (status === undefined) return [];
            return [{ id: status, label: getCallStatusLabel(status) }];
          };

          filters.push(
            getOrCreateConsolidatedChip(key, () => ({
              key,
              categoryLabel: 'Status',
              values: getCallStatusValues,
              availableOptions: CALL_STATUS_FILTER_OPTIONS,
              multiple: false,
              isValueActive: (id) => id === getCurrentCallStatus(),
              onToggleValue: (id) =>
                queryFilters.set({
                  include: {
                    callStatus: id as CallStatus,
                    callAttended: undefined,
                  },
                }),
              onRemoveAll: () =>
                queryFilters.set({
                  include: {
                    callStatus: undefined,
                    callAttended: undefined,
                  },
                }),
            }))
          );
        }
      }

      // Email importance filter
      if (
        soup.predicates.isActive('email') &&
        queryFilters.state.include.emailImportance !== undefined
      ) {
        const key = 'email-importance';
        seenKeys.add(key);

        const getImportanceValues = (): FilterValue[] => {
          const importance = filterData().include.emailImportance;
          if (importance === undefined) return [];
          return [
            {
              id: importance ? 'signal' : 'noise',
              label: importance ? 'Signal' : 'Noise',
            },
          ];
        };

        filters.push(
          getOrCreateConsolidatedChip(key, () => ({
            key,
            categoryLabel: 'Importance',
            values: getImportanceValues,
            availableOptions: [
              { id: 'signal', label: 'Signal' },
              { id: 'noise', label: 'Noise' },
            ],
            multiple: false,
            isValueActive: (id) =>
              id ===
              (filterData().include.emailImportance ? 'signal' : 'noise'),
            onToggleValue: (id) =>
              queryFilters.add({
                include: { emailImportance: id === 'signal' },
              }),
            onRemoveAll: () =>
              queryFilters.remove({
                include: {
                  emailImportance: queryFilters.state.include.emailImportance,
                },
              }),
          }))
        );
      }
    }

    // Evict stale chips
    for (const key of consolidatedChipCache.keys()) {
      if (!seenKeys.has(key)) consolidatedChipCache.delete(key);
    }

    return filters;
  });

  const getFilterContext = (): FilterContext => ({
    userId: currentUserId(),
    assignees: assigneeFilter(),
  });

  /**
   * Does at least one item pass the BASE preset's client predicates? Used to
   * decide whether the empty-state banner should claim items are hidden.
   * Short-circuits at the first match.
   *
   * Note: items() is already server-filtered by current query filters, so if
   * the user has tightened the server query this may return false even when
   * items exist. `hasHiddenItems` below compensates by being sticky.
   */
  const baseHasItems = createMemo(() => {
    const preset = currentPreset();
    if (!preset) return false;
    const baseAnd = preset.clientFilters.and ?? [];
    const baseOr = preset.clientFilters.or ?? [];
    if (baseAnd.length === 0 && baseOr.length === 0) return items().length > 0;

    const ctx = getFilterContext();
    for (const entity of items()) {
      let andOk = true;
      for (const id of baseAnd) {
        const cfg = soup.predicates.getConfig(id);
        if (cfg && !cfg.predicate(entity, ctx)) {
          andOk = false;
          break;
        }
      }
      if (!andOk) continue;
      if (baseOr.length > 0) {
        let orOk = false;
        for (const id of baseOr) {
          const cfg = soup.predicates.getConfig(id);
          if (cfg?.predicate(entity, ctx)) {
            orOk = true;
            break;
          }
        }
        if (!orOk) continue;
      }
      return true;
    }
    return false;
  });

  /**
   * Sticky-true while refinements are active so the banner doesn't flicker
   * off when a server refetch transiently zeroes out items(). Resets on
   * view/tab change, and snaps to the live state whenever refinements clear.
   *
   * Imperfect by design: if the user mounts with refinements already active
   * and the server returns zero items, this stays false. Getting a true
   * answer would need a separate base-preset query.
   */
  const hasHiddenItems = createMemo<{ key: string; value: boolean }>((prev) => {
    const key = `${currentView() ?? ''}|${activeTab() ?? ''}`;
    const refinementsActive = hasActiveRefinements();
    const itemsExist = baseHasItems();

    if (prev?.key !== key || !refinementsActive) {
      return { key, value: itemsExist };
    }
    return { key, value: prev.value || itemsExist };
  });

  const hasHiddenItemsValue = () => hasHiddenItems().value;

  const getFilterQuery = (optionId: string) => {
    const filter = soup.predicates.getConfig(optionId);
    if (!filter?.query) return undefined;
    return typeof filter.query === 'function'
      ? filter.query(getFilterContext())
      : filter.query;
  };

  const getInboxTypeQuery = (activeTypeIds: string[]): Query | undefined => {
    const preset = currentPreset();
    if (currentView() !== 'inbox' || !preset) return undefined;

    let targetQuery: Query = {};
    for (const id of activeTypeIds) {
      const query = getFilterQuery(id);
      if (!query) continue;
      targetQuery = mergeQuery(queryStateFrom(targetQuery), query);
    }

    if (!activeTypeIds.length) return preset.filters;

    return mergeQuery(
      queryStateFrom(preset.filters),
      defineQueryFilters({}, { skipTargetsFrom: targetQuery })
    );
  };

  const resetToTabDefaults = () => {
    const preset = currentPreset();
    if (!preset) return;

    const contentId = panel.handle.content().id;

    batch(() => {
      soup.predicates.set(preset.clientFilters);
      queryFilters.replace(preset.filters ?? null);
      setAssigneeFilter([]);
      cacheChannelSubFilters(contentId, {});
      cacheCallSubFilters(contentId, {});
      cacheEmailSubFilters(contentId, {});
    });
  };

  return {
    hasActiveRefinements,
    hasHiddenItems: hasHiddenItemsValue,
    resetToTabDefaults,
    currentView,
    consolidatedFiltersList,
  };
}
