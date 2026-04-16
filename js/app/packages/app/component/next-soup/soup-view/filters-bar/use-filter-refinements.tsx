import {
  VIEW_TAB_PRESETS,
  type PresetContext,
} from '@app/component/app-sidebar/soup-filter-presets';
import type { FilterID } from '@app/component/next-soup/filters/configs';
import { NIL_UUID } from '@app/component/next-soup/filters/query-filters';
import { NO_ASSIGNEE } from '@app/component/next-soup/soup-view/task-sub-filter-matcher';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { isListViewID } from '@app/constants/list-views';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserContext, useUserId } from '@core/context/user';
import { deepEqual } from '@core/util/compareUtils';
import { useContacts } from '@queries/contacts/contacts';
import { batch, createMemo } from 'solid-js';
import type { ActiveFilter } from './active-filter-chips';
import { INDEX_OPTIONS } from './search-operator-autocomplete';
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
    setQueryFilters,
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

    const viewConfig = VIEW_TAB_PRESETS[view];
    if (!viewConfig) return undefined;

    const tab = activeTab() ?? viewConfig.default;
    const resolver = viewConfig.tabs[tab];
    if (!resolver) return undefined;

    return resolver(getPresetContext());
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

    const hasQueryFilterDiff = !deepEqual(queryFilters(), preset.queryFilters);

    const hasSubFilters = assigneeFilter().length > 0;

    return hasClientFilterDiff || hasQueryFilterDiff || hasSubFilters;
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
    const coveredByView = new Set(
      viewCategories().flatMap((c) => c.options.map((o) => o.id))
    );
    for (const option of INDEX_OPTIONS) {
      const optionId = option.id as FilterID;
      if (
        !soup.filters.isActive(optionId) ||
        coveredByView.has(optionId) ||
        presetFilterIds.has(optionId)
      ) {
        continue;
      }
      filters.push({
        categoryLabel: 'Type',
        optionId: option.id,
        optionLabel: option.label,
        icon: option.icon,
        categoryOptions: INDEX_OPTIONS as ActiveFilter['categoryOptions'],
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
        onRemove: () =>
          setAssigneeFilter(assigneeFilter().filter((a) => a !== id)),
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
    const channelIds = (
      queryFilters().channel_filters?.channel_ids ?? []
    ).filter((id) => id !== NIL_UUID);
    const setChannelIds = (ids: string[]) =>
      setQueryFilters((prev) => ({
        ...prev,
        channel_filters: {
          ...prev.channel_filters,
          channel_ids: ids.length > 0 ? ids : undefined,
        },
      }));
    if (channelIds.length > 0) {
      filters.push({
        categoryLabel: 'In',
        optionId: `in:${channelIds.join(',')}`,
        optionLabel: labelForIds(channelIds),
        searchableOptions: channelOptions,
        activeSearchableIds: () =>
          (queryFilters().channel_filters?.channel_ids ?? []).filter(
            (id) => id !== NIL_UUID
          ),
        onSearchableChange: setChannelIds,
        searchPlaceholder: 'Search channels...',
        onRemove: () => setChannelIds([]),
      });
    }

    // Search operator filters: from: (sender_ids)
    const senderIds = queryFilters().channel_filters?.sender_ids ?? [];
    const setSenderIds = (ids: string[]) =>
      setQueryFilters((prev) => ({
        ...prev,
        channel_filters: {
          ...prev.channel_filters,
          sender_ids: ids.length > 0 ? ids : undefined,
        },
      }));
    if (senderIds.length > 0) {
      filters.push({
        categoryLabel: 'From',
        optionId: `from:${senderIds.join(',')}`,
        optionLabel: labelForIds(senderIds),
        searchableOptions: senderOptions,
        activeSearchableIds: () =>
          queryFilters().channel_filters?.sender_ids ?? [],
        onSearchableChange: setSenderIds,
        searchPlaceholder: 'Search senders...',
        onRemove: () => setSenderIds([]),
      });
    }

    // Email importance (only when the email index is active in the search view
    // and the user has explicitly set a value — undefined means "All", no chip)
    if (currentView() === 'search' && soup.filters.isActive('email')) {
      const importance = queryFilters().email_filters?.importance;
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
            setQueryFilters((prev) => ({
              ...prev,
              email_filters: { ...prev.email_filters, importance: undefined },
            })),
          onReplace: (newOptionId) =>
            setQueryFilters((prev) => ({
              ...prev,
              email_filters: {
                ...prev.email_filters,
                importance: newOptionId === IMPORTANCE_SIGNAL,
              },
            })),
        });
      }
    }

    return filters;
  });

  const isOptionActive = (optionId: string) => {
    return soup.filters.isActive(optionId);
  };

  const removeFilter = (optionId: string) => {
    soup.filters.toggle({ or: [optionId as FilterID] });
  };

  const replaceFilter = (oldOptionId: string, newOptionId: string) => {
    // Toggle off the old filter and toggle on the new one
    batch(() => {
      soup.filters.toggle({ or: [oldOptionId as FilterID] });
      soup.filters.toggle({ or: [newOptionId as FilterID] });
    });
  };

  const resetToTabDefaults = () => {
    const preset = currentPreset();
    if (!preset) return;

    batch(() => {
      soup.filters.set(preset.clientFilters);
      setQueryFilters(preset.queryFilters);
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
