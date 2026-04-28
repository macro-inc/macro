import {
  type PresetContext,
  getViewPreset,
  VIEW_TAB_PRESETS,
} from '@app/component/app-sidebar/soup-filter-presets';
import {
  type FilterID,
  type FilterContext,
  NO_ASSIGNEE,
} from '@app/component/next-soup/filters';
import { NIL_UUID } from '@app/component/next-soup/filters/filter-store';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { isListViewID } from '@app/constants/list-views';
import { useUserContext, useUserId } from '@core/context/user';
import { useContacts } from '@queries/contacts/contacts';
import { type Accessor, batch, createMemo, createSignal } from 'solid-js';
import type { ActiveFilter } from './active-filter-chips';
import { INDEX_OPTIONS } from './search-filter-controls';
import {
  type SearchableOption,
  useSearchFilterOptions,
  useSearchIndexController,
} from './search-filter-controls';
import {
  buildContactLabel,
  VIEW_FILTER_CATEGORIES,
} from './unified-filter-dropdown';
import { deepEqual } from '@core/util/compareUtils';

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
  const { soup, queryFilters, assigneeFilter, setAssigneeFilter, activeTab } =
    useSoupView();
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

    // Keep a chip alive while its popup is still open, even if the user
    // toggled every option off — closing the menu mid-swap is jarring.
    const pushSearchableChip = (args: {
      key: string;
      categoryLabel: 'In' | 'From';
      optionIdPrefix: string;
      getIds: () => string[];
      searchableOptions: Accessor<SearchableOption[]>;
      labelMap: Accessor<Map<string, string>>;
      onChange: (ids: string[]) => void;
      searchPlaceholder: string;
    }) => {
      const popupOpen = chipCache.get(args.key)?.isPopupOpen?.() ?? false;
      if (args.getIds().length === 0 && !popupOpen) return;
      seenKeys.add(args.key);
      filters.push(
        getOrCreateChip(args.key, () => {
          const [isPopupOpen, setPopupOpen] = createSignal(false);
          return {
            categoryLabel: args.categoryLabel,
            optionId: () => `${args.optionIdPrefix}:${args.getIds().join(',')}`,
            optionLabel: () => labelForIds(args.getIds(), args.labelMap()),
            searchableOptions: args.searchableOptions,
            activeSearchableIds: args.getIds,
            onSearchableChange: args.onChange,
            searchPlaceholder: args.searchPlaceholder,
            onRemove: () => args.onChange([]),
            isPopupOpen,
            setPopupOpen,
          };
        })
      );
    };

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

    pushSearchableChip({
      key: 'ChannelIn',
      categoryLabel: 'In',
      optionIdPrefix: 'channel-in',
      getIds: () =>
        (queryFilters.state.include.channelId ?? []).filter(
          (id) => id !== NIL_UUID
        ),
      searchableOptions: channelOptions,
      labelMap: channelLabelMap,
      onChange: setFilterIds('channelId'),
      searchPlaceholder: 'Search channels...',
    });

    pushSearchableChip({
      key: 'ChannelFrom',
      categoryLabel: 'From',
      optionIdPrefix: 'channel-from',
      getIds: () => queryFilters.state.include.channelSenderId ?? [],
      searchableOptions: senderOptions,
      labelMap: senderLabelMap,
      onChange: setFilterIds('channelSenderId'),
      searchPlaceholder: 'Search senders...',
    });

    if (currentView() === 'search') {
      if (soup.predicates.isActive('calls')) {
        pushSearchableChip({
          key: 'CallIn',
          categoryLabel: 'In',
          optionIdPrefix: 'call-in',
          getIds: () =>
            (queryFilters.state.include.callChannelId ?? []).filter(
              (id) => id !== NIL_UUID
            ),
          searchableOptions: channelOptions,
          labelMap: channelLabelMap,
          onChange: setFilterIds('callChannelId'),
          searchPlaceholder: 'Search channels...',
        });

        pushSearchableChip({
          key: 'CallFrom',
          categoryLabel: 'From',
          optionIdPrefix: 'call-from',
          getIds: () => queryFilters.state.include.callSpeakerId ?? [],
          searchableOptions: senderOptions,
          labelMap: senderLabelMap,
          onChange: setFilterIds('callSpeakerId'),
          searchPlaceholder: 'Search speakers...',
        });

        const callAttended = queryFilters.state.include.callAttended;
        if (callAttended !== undefined && callAttended !== null) {
          const ATTENDED_YES = 'attended:yes';
          const ATTENDED_NO = 'attended:no';
          const key = 'CallAttended';
          seenKeys.add(key);
          filters.push(
            getOrCreateChip(key, () => ({
              categoryLabel: 'Attended',
              hideCategoryLabel: true,
              optionId: () =>
                queryFilters.state.include.callAttended
                  ? ATTENDED_YES
                  : ATTENDED_NO,
              optionLabel: () =>
                queryFilters.state.include.callAttended
                  ? 'Attended'
                  : 'Unattended',
              categoryOptions: [
                { id: ATTENDED_YES, label: 'Attended' },
                { id: ATTENDED_NO, label: 'Unattended' },
              ] as unknown as ActiveFilter['categoryOptions'],
              multiple: false,
              isOptionActive: (optionId) =>
                optionId ===
                (queryFilters.state.include.callAttended
                  ? ATTENDED_YES
                  : ATTENDED_NO),
              onRemove: () =>
                queryFilters.remove({
                  include: {
                    callAttended: queryFilters.state.include.callAttended,
                  },
                }),
              onReplace: (newOptionId) =>
                queryFilters.add({
                  include: {
                    callAttended: newOptionId === ATTENDED_YES,
                  },
                }),
            }))
          );
        }
      }

      // undefined importance means "All" — no chip.
      if (
        soup.predicates.isActive('email') &&
        queryFilters.state.include.emailImportance !== undefined
      ) {
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
              queryFilters.remove({
                include: {
                  emailImportance: queryFilters.state.include.emailImportance,
                },
              }),
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
      if (soup.predicates.isActive(oldOptionId)) {
        soup.predicates.toggle({ or: [oldOptionId as FilterID] });
      }

      if (!soup.predicates.isActive(newOptionId)) {
        soup.predicates.toggle({ or: [newOptionId as FilterID] });
      }

      if (oldQuery) queryFilters.remove(oldQuery);
      if (newQuery) queryFilters.add(newQuery);
    });
  };

  const resetToTabDefaults = () => {
    const preset = currentPreset();
    if (!preset) return;

    batch(() => {
      soup.predicates.set(preset.clientFilters);
      queryFilters.replace(preset.filters ?? null);
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
