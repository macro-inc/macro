import {
  type PresetContext,
  getViewPreset,
  VIEW_TAB_PRESETS,
} from '@app/component/app-sidebar/soup-filter-presets';
import type { FilterID } from '@app/component/next-soup/filters/configs';
import type { FilterContext } from '@app/component/next-soup/filters/configs';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';

const NIL = '00000000-0000-0000-0000-000000000000';
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
    queryFilters,
    filters: filterData,
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

    const currentIds = new Set(soup.predicates.activeIds() as FilterID[]);

    const hasClientFilterDiff =
      expectedIds.size !== currentIds.size ||
      [...expectedIds].some((id) => !currentIds.has(id as FilterID));

    // Check if there are any external filters set
    const currentFilterData = filterData();
    const hasExternalFilters =
      Object.keys(currentFilterData.include).length > 0 ||
      Object.keys(currentFilterData.exclude).length > 0;

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
          !soup.predicates.isActive(option.id) ||
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
        !soup.predicates.isActive(optionId) ||
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
            queryFilters.remove({
              include: {
                properties: [{ propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES, type: 'entity', value: id }],
              },
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
    const setChannelIds = (ids: string[]) => {
      const current = filterData().include.channelId ?? [];
      if (ids.length > 0) {
        queryFilters.add({ include: { channelId: ids } });
      } else if (current.length > 0) {
        queryFilters.remove({ include: { channelId: current } });
      }
    };
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
    const setSenderIds = (ids: string[]) => {
      const current = filterData().include.channelSenderId ?? [];
      if (ids.length > 0) {
        queryFilters.add({ include: { channelSenderId: ids } });
      } else if (current.length > 0) {
        queryFilters.remove({ include: { channelSenderId: current } });
      }
    };
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
    if (currentView() === 'search' && soup.predicates.isActive('email')) {
      const importance = filterData().include.emailImportance;
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
            queryFilters.remove({ include: { emailImportance: importance } }),
          onReplace: (newOptionId) =>
            queryFilters.add({ include: { emailImportance: newOptionId === IMPORTANCE_SIGNAL } }),
        });
      }
    }

    return filters;
  });

  const isOptionActive = (optionId: string) => {
    return soup.predicates.isActive(optionId);
  };

  const getFilterContext = (): FilterContext => ({
    userId: currentUserId(),
    assignees: assigneeFilter(),
  });

  const getFilterQuery = (optionId: string) => {
    const filter = soup.predicates.getConfig(optionId);
    if (!filter?.query) return undefined;
    return typeof filter.query === 'function'
      ? filter.query(getFilterContext())
      : filter.query;
  };

  const removeFilter = (optionId: string) => {
    const query = getFilterQuery(optionId);
    batch(() => {
      soup.predicates.toggle({ or: [optionId as FilterID] });
      if (query) {
        queryFilters.remove(query);
      }
    });
  };

  const replaceFilter = (oldOptionId: string, newOptionId: string) => {
    const oldQuery = getFilterQuery(oldOptionId);
    const newQuery = getFilterQuery(newOptionId);
    batch(() => {
      soup.predicates.toggle({ or: [oldOptionId as FilterID] });
      soup.predicates.toggle({ or: [newOptionId as FilterID] });
      if (oldQuery) queryFilters.remove(oldQuery);
      if (newQuery) queryFilters.add(newQuery);
    });
  };

  const resetToTabDefaults = () => {
    const preset = currentPreset();
    if (!preset) return;

    batch(() => {
      soup.predicates.set(preset.clientFilters);
      queryFilters.clear();
      if (preset.filters) {
        queryFilters.add(preset.filters);
      }
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
