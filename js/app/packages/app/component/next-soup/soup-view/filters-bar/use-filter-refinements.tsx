import {
  type PresetContext,
  getViewPreset,
  VIEW_TAB_PRESETS,
} from '@app/component/app-sidebar/soup-filter-presets';
import type { FilterID } from '@app/component/next-soup/filters/configs';
import {
  addQuery,
  applyFilterData,
  emptyFilterData,
  removeQuery,
  NIL,
} from '@app/component/next-soup/filters/filter-store';
import type { FilterContext } from '@app/component/next-soup/filters/configs';
import { NO_ASSIGNEE } from '@app/component/next-soup/soup-view/task-sub-filter-matcher';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { isListViewID } from '@app/constants/list-views';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserContext, useUserId } from '@core/context/user';
import { useContacts } from '@queries/contacts/contacts';
import { batch, createMemo } from 'solid-js';
import type { ActiveFilter } from './active-filter-chips';
import { INDEX_OPTIONS } from './search-filter-controls';
import {
  useSearchFilterOptions,
  useSearchIndexController,
} from './search-filter-controls';
import {
  buildContactLabel,
  VIEW_FILTER_CATEGORIES,
} from './unified-filter-dropdown';

// Filter IDs that are set by tabs and should not be shown as removable chips
const TAB_ONLY_FILTERS = new Set([
  'signal',
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
    filters: filterData,
    setFilters,
    assigneeFilter,
    setAssigneeFilter,
    activeTab,
  } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const user = useUserContext();
  const contacts = useContacts();
  const currentUserId = useUserId();
  const quickAccess = useQuickAccess();
  const { channelOptions, senderOptions } = useSearchFilterOptions();
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

    const currentIds = new Set(soup.filters.activeIds() as FilterID[]);

    const hasClientFilterDiff =
      expectedIds.size !== currentIds.size ||
      [...expectedIds].some((id) => !currentIds.has(id as FilterID));

    // Check if there are any external filters set
    const currentFilterData = filterData();
    const hasExternalFilters =
      Object.keys(currentFilterData.include).length > 0 ||
      Object.keys(currentFilterData.exclude).length > 0 ||
      currentFilterData.properties.length > 0;

    const hasSubFilters = assigneeFilter().length > 0;

    return hasClientFilterDiff || hasExternalFilters || hasSubFilters;
  });

  /**
   * Human-readable options for the assignee sub-filter, keyed by assignee ID.
   * Mirrors the same logic used in UnifiedFilterDropdown's assigneeOptions.
   */
  const assigneeOptionsMap = createMemo((): Map<string, { label: string }> => {
    const uid = currentUserId();
    const map = new Map<string, { label: string }>();
    map.set(NO_ASSIGNEE, { label: 'Unassigned' });
    for (const contact of contacts()) {
      map.set(contact.id, { label: buildContactLabel(contact, uid) });
    }
    return map;
  });

  /**
   * Get filter categories for the current view
   */
  const viewCategories = createMemo(() => {
    const view = currentView();
    if (!view) return [];
    return VIEW_FILTER_CATEGORIES[view as ListView] ?? [];
  });

  /**
   * Returns a list of active filters that can be displayed as removable chips.
   * Excludes filters that are set by tabs (like signal/noise).
   */
  const activeFiltersList = createMemo((): ActiveFilter[] => {
    const preset = currentPreset();
    const presetFilterIds = new Set([
      ...(preset?.clientFilters.and ?? []),
      ...(preset?.clientFilters.or ?? []),
    ]);

    const filters: ActiveFilter[] = [];
    for (const category of viewCategories()) {
      for (const option of category.options) {
        if (
          !soup.filters.isActive(option.id) ||
          TAB_ONLY_FILTERS.has(option.id) ||
          presetFilterIds.has(option.id as FilterID)
        ) {
          continue;
        }

        filters.push({
          categoryLabel: category.label,
          optionId: option.id,
          optionLabel: option.label,
          icon: option.icon,
          categoryOptions: category.options,
        });
      }
    }

    // Search operator filters: index: (entity type toggles)
    const coveredByView = new Set<string>(
      viewCategories().flatMap((c) => c.options.map((o) => o.id))
    );
    for (const option of INDEX_OPTIONS) {
      const optionId = option.value as FilterID;
      if (
        !soup.filters.isActive(optionId) ||
        coveredByView.has(optionId) ||
        presetFilterIds.has(optionId)
      ) {
        continue;
      }
      filters.push({
        categoryLabel: 'Type',
        optionId: option.value,
        optionLabel: option.label,
        icon: option.icon,
        categoryOptions: INDEX_OPTIONS.map((o) => ({
          id: o.value,
          label: o.label,
          icon: o.icon,
        })) as ActiveFilter['categoryOptions'],
        multiple: false,
        onRemove: () => changeIndex('all'),
        onReplace: (newOptionId) => changeIndex(newOptionId),
      });
    }

    // Sub-filters: assignee
    const optionsMap = assigneeOptionsMap();
    for (const id of assigneeFilter()) {
      const option = optionsMap.get(id);
      filters.push({
        categoryLabel: 'Assignee',
        optionId: id,
        optionLabel: option?.label ?? id,
        onRemove: () => {
          batch(() => {
            setAssigneeFilter(assigneeFilter().filter((a) => a !== id));
            setFilters((d) => {
              removeQuery(d, {
                properties: [{ ASSIGNEES: [{ type: 'entity', value: id }] }],
              });
            });
          });
        },
      });
    }

    const labelForIds = (ids: string[]): string => {
      const [first, ...rest] = ids;
      const firstItem = quickAccess.getById(first);
      const firstLabel =
        firstItem && 'data' in firstItem && firstItem.data?.name
          ? firstItem.data.name
          : first;
      if (rest.length === 0) return firstLabel;
      return `${firstLabel} and ${rest.length} ${rest.length === 1 ? 'other' : 'others'}`;
    };

    // Search operator filters: in: (channel_ids)
    const channelIds = (filterData().include.channelId ?? []).filter(
      (id) => id !== NIL
    );
    const setChannelIds = (ids: string[]) =>
      setFilters((d) => {
        if (ids.length > 0) {
          d.include.channelId = ids;
        } else {
          delete d.include.channelId;
        }
      });
    if (channelIds.length > 0) {
      filters.push({
        categoryLabel: 'In',
        optionId: `in:${channelIds.join(',')}`,
        optionLabel: labelForIds(channelIds),
        searchableOptions: channelOptions,
        activeSearchableIds: () =>
          (filterData().include.channelId ?? []).filter((id) => id !== NIL),
        onSearchableChange: setChannelIds,
        searchPlaceholder: 'Search channels...',
        onRemove: () => setChannelIds([]),
      });
    }

    // Search operator filters: from: (sender_ids)
    const senderIds = filterData().include.channelSenderId ?? [];
    const setSenderIds = (ids: string[]) =>
      setFilters((d) => {
        if (ids.length > 0) {
          d.include.channelSenderId = ids;
        } else {
          delete d.include.channelSenderId;
        }
      });
    if (senderIds.length > 0) {
      filters.push({
        categoryLabel: 'From',
        optionId: `from:${senderIds.join(',')}`,
        optionLabel: labelForIds(senderIds),
        searchableOptions: senderOptions,
        activeSearchableIds: () => filterData().include.channelSenderId ?? [],
        onSearchableChange: setSenderIds,
        searchPlaceholder: 'Search senders...',
        onRemove: () => setSenderIds([]),
      });
    }

    // Email importance (only when the email index is active in the search view
    // and the user has explicitly set a value — undefined means "All", no chip)
    if (currentView() === 'search' && soup.filters.isActive('email')) {
      const importance = filterData().include.emailImportance?.[0];
      if (importance !== undefined) {
        const IMPORTANCE_SIGNAL = 'importance:signal';
        const IMPORTANCE_NOISE = 'importance:noise';
        const currentOptionId = importance
          ? IMPORTANCE_SIGNAL
          : IMPORTANCE_NOISE;
        filters.push({
          categoryLabel: 'Importance',
          optionId: currentOptionId,
          optionLabel: importance ? 'Signal' : 'Noise',
          categoryOptions: [
            { id: IMPORTANCE_SIGNAL, label: 'Signal' },
            { id: IMPORTANCE_NOISE, label: 'Noise' },
          ] as unknown as ActiveFilter['categoryOptions'],
          multiple: false,
          isOptionActive: (optionId) => optionId === currentOptionId,
          onRemove: () =>
            setFilters((d) => {
              delete d.include.emailImportance;
            }),
          onReplace: (newOptionId) =>
            setFilters((d) => {
              d.include.emailImportance = [newOptionId === IMPORTANCE_SIGNAL];
            }),
        });
      }
    }

    return filters;
  });

  const isOptionActive = (optionId: string) => {
    return soup.filters.isActive(optionId);
  };

  const getFilterContext = (): FilterContext => ({
    userId: currentUserId(),
    assignees: assigneeFilter(),
  });

  const getFilterQuery = (optionId: string) => {
    const filter = soup.filters.getFilter(optionId);
    if (!filter?.query) return undefined;
    return typeof filter.query === 'function'
      ? filter.query(getFilterContext())
      : filter.query;
  };

  const removeFilter = (optionId: string) => {
    const query = getFilterQuery(optionId);
    batch(() => {
      soup.filters.toggle({ or: [optionId as FilterID] });
      if (query) {
        setFilters((d) => removeQuery(d, query));
      }
    });
  };

  const replaceFilter = (oldOptionId: string, newOptionId: string) => {
    const oldQuery = getFilterQuery(oldOptionId);
    const newQuery = getFilterQuery(newOptionId);
    batch(() => {
      soup.filters.toggle({ or: [oldOptionId as FilterID] });
      soup.filters.toggle({ or: [newOptionId as FilterID] });
      setFilters((d) => {
        if (oldQuery) removeQuery(d, oldQuery);
        if (newQuery) addQuery(d, newQuery);
      });
    });
  };

  const resetToTabDefaults = () => {
    const preset = currentPreset();
    if (!preset) return;

    batch(() => {
      soup.filters.set(preset.clientFilters);
      setFilters((d) =>
        applyFilterData(d, preset.filters ?? emptyFilterData())
      );
      setAssigneeFilter([]);
    });
  };

  return {
    hasActiveRefinements,
    resetToTabDefaults,
    currentView,
    activeFiltersList,
    removeFilter,
    replaceFilter,
    isOptionActive,
  };
}
