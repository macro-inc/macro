import {
  type PresetContext,
  getViewPreset,
  VIEW_TAB_PRESETS,
} from '@app/component/app-sidebar/soup-filter-presets';
import type { FilterID, FilterContext } from '@app/component/next-soup/filters';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';

const NIL = '00000000-0000-0000-0000-000000000000';
import { NO_ASSIGNEE } from '@app/component/next-soup/soup-view/task-sub-filter-matcher';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { isListViewID } from '@app/constants/list-views';
import { useUserContext, useUserId } from '@core/context/user';
import { useContacts } from '@queries/contacts/contacts';
import { batch, createMemo, createSignal } from 'solid-js';
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

  // Reactive id → label maps derived from the chip's option sources.
  // Using quickAccess.getById here would read a plain Map that isn't a signal,
  // so on page reload the chip label shows the raw uuid until the first
  // rerender that happens to read live data.
  const channelLabelMap = createMemo(() => {
    const map = new Map<string, string>();
    for (const opt of channelOptions()) map.set(opt.id, opt.label);
    return map;
  });
  const senderLabelMap = createMemo(() => {
    const map = new Map<string, string>();
    for (const opt of senderOptions()) map.set(opt.id, opt.label);
    return map;
  });

  const labelForIds = (
    ids: string[],
    labelMap: Map<string, string>
  ): string => {
    if (ids.length === 0) return '';
    const [first, ...rest] = ids;
    const firstLabel = labelMap.get(first) ?? first;
    if (rest.length === 0) return firstLabel;
    return `${firstLabel} and ${rest.length} ${rest.length === 1 ? 'other' : 'others'}`;
  };

  const setChannelIds = (ids: string[]) => {
    const current = filterData().include.channelId ?? [];
    if (ids.length > 0) {
      queryFilters.add({ include: { channelId: ids } });
    } else {
      queryFilters.remove({ include: { channelId: current } });
    }
  };

  const setSenderIds = (ids: string[]) => {
    const current = filterData().include.channelSenderId ?? [];
    if (ids.length > 0) {
      queryFilters.add({ include: { channelSenderId: ids } });
    } else {
      queryFilters.remove({ include: { channelSenderId: current } });
    }
  };

  /**
   * Cache of chip objects keyed by a stable id derived from the chip's category
   * and static identity (e.g. "In", "Type|channels", "Assignee|<uuid>"). Reusing
   * the same `ActiveFilter` object across memo runs keeps `<For>` from
   * remounting the chip — its internal combobox state (open, search) survives
   * selection toggles. Mutable state lives inside the accessor fields.
   */
  const chipCache = new Map<string, ActiveFilter>();
  const getOrCreateChip = (
    key: string,
    build: () => ActiveFilter
  ): ActiveFilter => {
    let chip = chipCache.get(key);
    if (!chip) {
      chip = build();
      chipCache.set(key, chip);
    }
    return chip;
  };

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
    const seenKeys = new Set<string>();

    for (const category of viewCategories()) {
      for (const option of category.options) {
        if (
          !soup.predicates.isActive(option.id) ||
          TAB_ONLY_FILTERS.has(option.id) ||
          presetFilterIds.has(option.id as FilterID)
        ) {
          continue;
        }
        const key = `${category.label}|${option.id}`;
        seenKeys.add(key);
        filters.push(
          getOrCreateChip(key, () => ({
            categoryLabel: category.label,
            optionId: () => option.id,
            optionLabel: () => option.label,
            icon: option.icon,
            categoryOptions: category.options,
          }))
        );
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
      const key = `Type|${option.value}`;
      seenKeys.add(key);
      filters.push(
        getOrCreateChip(key, () => ({
          categoryLabel: 'Type',
          optionId: () => option.value,
          optionLabel: () => option.label,
          icon: option.icon,
          categoryOptions: INDEX_OPTIONS.map((o) => ({
            id: o.value,
            label: o.label,
            icon: o.icon,
          })) as ActiveFilter['categoryOptions'],
          multiple: false,
          onRemove: () => changeIndex('all'),
          onReplace: (newOptionId) => changeIndex(newOptionId),
        }))
      );
    }

    // Sub-filters: assignee
    const _optionsMap = assigneeOptionsMap();
    for (const id of assigneeFilter()) {
      const key = `Assignee|${id}`;
      seenKeys.add(key);
      filters.push(
        getOrCreateChip(key, () => ({
          categoryLabel: 'Assignee',
          optionId: () => id,
          optionLabel: () => assigneeOptionsMap().get(id)?.label ?? id,
          onRemove: () => {
            batch(() => {
              setAssigneeFilter(assigneeFilter().filter((a) => a !== id));
              queryFilters.remove({
                include: {
                  properties: [
                    {
                      propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
                      type: 'entity',
                      value: id,
                    },
                  ],
                },
              });
            });
          },
        }))
      );
    }

    // Search operator filters: in: (channel_ids)
    const channelIds = (filterData().include.channelId ?? []).filter(
      (id) => id !== NIL
    );
    // Keep the chip alive while its popup is still open, even if the user
    // toggled every option off — they may be mid-way through swapping A→B
    // and closing the menu on them would be jarring.
    const inChipOpen = chipCache.get('In')?.isPopupOpen?.() ?? false;
    if (channelIds.length > 0 || inChipOpen) {
      const key = 'In';
      seenKeys.add(key);
      filters.push(
        getOrCreateChip(key, () => {
          const [isPopupOpen, setPopupOpen] = createSignal(false);
          return {
            categoryLabel: 'In',
            optionId: () => {
              const ids = (filterData().include.channelId ?? []).filter(
                (id) => id !== NIL
              );
              return `in:${ids.join(',')}`;
            },
            optionLabel: () => {
              const ids = (filterData().include.channelId ?? []).filter(
                (id) => id !== NIL
              );
              return labelForIds(ids, channelLabelMap());
            },
            searchableOptions: channelOptions,
            activeSearchableIds: () =>
              (filterData().include.channelId ?? []).filter((id) => id !== NIL),
            onSearchableChange: setChannelIds,
            searchPlaceholder: 'Search channels...',
            onRemove: () => setChannelIds([]),
            isPopupOpen,
            setPopupOpen,
          };
        })
      );
    }

    // Search operator filters: from: (sender_ids)
    const senderIds = filterData().include.channelSenderId ?? [];
    const fromChipOpen = chipCache.get('From')?.isPopupOpen?.() ?? false;
    if (senderIds.length > 0 || fromChipOpen) {
      const key = 'From';
      seenKeys.add(key);
      filters.push(
        getOrCreateChip(key, () => {
          const [isPopupOpen, setPopupOpen] = createSignal(false);
          return {
            categoryLabel: 'From',
            optionId: () => {
              const ids = filterData().include.channelSenderId ?? [];
              return `from:${ids.join(',')}`;
            },
            optionLabel: () => {
              const ids = filterData().include.channelSenderId ?? [];
              return labelForIds(ids, senderLabelMap());
            },
            searchableOptions: senderOptions,
            activeSearchableIds: () =>
              filterData().include.channelSenderId ?? [],
            onSearchableChange: setSenderIds,
            searchPlaceholder: 'Search senders...',
            onRemove: () => setSenderIds([]),
            isPopupOpen,
            setPopupOpen,
          };
        })
      );
    }

    // Email importance (only when the email index is active in the search view
    // and the user has explicitly set a value — undefined means "All", no chip)
    if (currentView() === 'search' && soup.predicates.isActive('email')) {
      const importance = filterData().include.emailImportance;
      if (importance !== undefined) {
        const IMPORTANCE_SIGNAL = 'importance:signal';
        const IMPORTANCE_NOISE = 'importance:noise';
        const key = 'Importance';
        seenKeys.add(key);
        filters.push(
          getOrCreateChip(key, () => ({
            categoryLabel: 'Importance',
            optionId: () =>
              filterData().include.emailImportance
                ? IMPORTANCE_SIGNAL
                : IMPORTANCE_NOISE,
            optionLabel: () =>
              filterData().include.emailImportance ? 'Signal' : 'Noise',
            categoryOptions: [
              { id: IMPORTANCE_SIGNAL, label: 'Signal' },
              { id: IMPORTANCE_NOISE, label: 'Noise' },
            ] as unknown as ActiveFilter['categoryOptions'],
            multiple: false,
            isOptionActive: (optionId) =>
              optionId ===
              (filterData().include.emailImportance
                ? IMPORTANCE_SIGNAL
                : IMPORTANCE_NOISE),
            onRemove: () =>
              queryFilters.remove({ include: { emailImportance: importance } }),
            onReplace: (newOptionId) =>
              queryFilters.add({
                include: { emailImportance: newOptionId === IMPORTANCE_SIGNAL },
              }),
          }))
        );
      }
    }

    // Evict chips whose keys are no longer present so a fresh chip (with
    // reset internal state) gets built next time that filter reappears.
    for (const key of chipCache.keys()) {
      if (!seenKeys.has(key)) chipCache.delete(key);
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
      queryFilters.set(preset.filters ?? null);
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
