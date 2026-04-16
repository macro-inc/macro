import {
  type PresetContext,
  getViewPreset,
} from '@app/component/app-sidebar/soup-filter-presets';
import {
  type FilterID,
  type FilterContext,
  NIL_UUID,
} from '@app/component/next-soup/filters';
import {
  addQuery,
  applyFilterData,
  emptyFilterData,
  removeQuery,
} from '@app/component/next-soup/filters/filter-store';
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
import { INDEX_OPTIONS } from './search-operator-autocomplete';
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
    activePreset,
  } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const user = useUserContext();
  const contacts = useContacts();
  const currentUserId = useUserId();
  const quickAccess = useQuickAccess();

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
    const preset = activePreset();
    if (!preset) return undefined;
    return getViewPreset(preset.view, preset.tab, getPresetContext());
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
      const optionId = option.id as FilterID;
      if (
        !soup.filters.isActive(optionId) ||
        coveredByView.has(optionId) ||
        presetFilterIds.has(optionId)
      ) {
        continue;
      }
      filters.push({
        categoryLabel: 'Index',
        optionId: option.id,
        optionLabel: option.label,
        icon: option.icon,
        categoryOptions: INDEX_OPTIONS as ActiveFilter['categoryOptions'],
        onRemove: () => {
          soup.filters.toggle({ or: [optionId] });
          setFilters((d) => applyFilterData(d, emptyFilterData()));
        },
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

    // Channel filter chips (In:)
    const channelIds = (filterData().include.channelId ?? []).filter(
      (id) => id !== NIL_UUID
    );
    for (const channelId of channelIds) {
      const item = quickAccess.getById(channelId);
      const label =
        item && 'data' in item && item.data?.name ? item.data.name : channelId;

      filters.push({
        categoryLabel: 'In',
        optionId: `in:${channelId}`,
        optionLabel: label,
        onRemove: () =>
          setFilters((d) => {
            const ids = (d.include.channelId ?? []).filter(
              (id) => id !== channelId
            );
            if (ids.length > 0) {
              d.include.channelId = ids;
            } else {
              delete d.include.channelId;
            }
          }),
      });
    }

    // Sender filter chips (From:)
    const senderIds = filterData().include.channelSenderId ?? [];
    for (const senderId of senderIds) {
      const item = quickAccess.getById(senderId);
      const label =
        item && 'data' in item && item.data?.name ? item.data.name : senderId;
      filters.push({
        categoryLabel: 'From',
        optionId: `from:${senderId}`,
        optionLabel: label,
        onRemove: () =>
          setFilters((d) => {
            const ids = (d.include.channelSenderId ?? []).filter(
              (id) => id !== senderId
            );
            if (ids.length > 0) {
              d.include.channelSenderId = ids;
            } else {
              delete d.include.channelSenderId;
            }
          }),
      });
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
