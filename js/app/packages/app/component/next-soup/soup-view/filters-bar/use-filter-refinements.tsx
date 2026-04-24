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
import { useUserContext, useUserId } from '@core/context/user';
import { deepEqual } from '@core/util/compareUtils';
import { useContacts } from '@queries/contacts/contacts';
import { type Accessor, batch, createMemo, createSignal } from 'solid-js';
import type { ActiveFilter } from './active-filter-chips';
import { INDEX_OPTIONS } from './search-operator-autocomplete';
import {
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
    (filterKey: 'channel_filters' | 'call_filters', field: string) =>
    (ids: string[]) =>
      setQueryFilters((prev) => ({
        ...prev,
        [filterKey]: {
          ...(prev[filterKey] ?? {}),
          [field]: ids.length > 0 ? ids : undefined,
        },
      }));

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
          !soup.filters.isActive(option.id) ||
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
      const key = `Type|${option.id}`;
      seenKeys.add(key);
      filters.push(
        getOrCreateChip(key, () => ({
          categoryLabel: 'Type',
          optionId: () => option.id,
          optionLabel: () => option.label,
          icon: option.icon,
          categoryOptions: INDEX_OPTIONS as ActiveFilter['categoryOptions'],
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
          onRemove: () =>
            setAssigneeFilter(assigneeFilter().filter((a) => a !== id)),
        }))
      );
    }

    pushSearchableChip({
      key: 'ChannelIn',
      categoryLabel: 'In',
      optionIdPrefix: 'channel-in',
      getIds: () =>
        (queryFilters().channel_filters?.channel_ids ?? []).filter(
          (id) => id !== NIL_UUID
        ),
      searchableOptions: channelOptions,
      labelMap: channelLabelMap,
      onChange: setFilterIds('channel_filters', 'channel_ids'),
      searchPlaceholder: 'Search channels...',
    });

    pushSearchableChip({
      key: 'ChannelFrom',
      categoryLabel: 'From',
      optionIdPrefix: 'channel-from',
      getIds: () => queryFilters().channel_filters?.sender_ids ?? [],
      searchableOptions: senderOptions,
      labelMap: senderLabelMap,
      onChange: setFilterIds('channel_filters', 'sender_ids'),
      searchPlaceholder: 'Search senders...',
    });

    if (currentView() === 'search') {
      if (soup.filters.isActive('calls')) {
        pushSearchableChip({
          key: 'CallIn',
          categoryLabel: 'In',
          optionIdPrefix: 'call-in',
          getIds: () =>
            (queryFilters().call_filters?.channel_ids ?? []).filter(
              (id) => id !== NIL_UUID
            ),
          searchableOptions: channelOptions,
          labelMap: channelLabelMap,
          onChange: setFilterIds('call_filters', 'channel_ids'),
          searchPlaceholder: 'Search channels...',
        });

        pushSearchableChip({
          key: 'CallFrom',
          categoryLabel: 'From',
          optionIdPrefix: 'call-from',
          getIds: () => queryFilters().call_filters?.speaker_ids ?? [],
          searchableOptions: senderOptions,
          labelMap: senderLabelMap,
          onChange: setFilterIds('call_filters', 'speaker_ids'),
          searchPlaceholder: 'Search speakers...',
        });

        const callAttended = queryFilters().call_filters?.attended;
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
                queryFilters().call_filters?.attended
                  ? ATTENDED_YES
                  : ATTENDED_NO,
              optionLabel: () =>
                queryFilters().call_filters?.attended
                  ? 'Attended'
                  : 'Unattended',
              categoryOptions: [
                { id: ATTENDED_YES, label: 'Attended' },
                { id: ATTENDED_NO, label: 'Unattended' },
              ] as unknown as ActiveFilter['categoryOptions'],
              multiple: false,
              isOptionActive: (optionId) =>
                optionId ===
                (queryFilters().call_filters?.attended
                  ? ATTENDED_YES
                  : ATTENDED_NO),
              onRemove: () =>
                setQueryFilters((prev) => ({
                  ...prev,
                  call_filters: {
                    ...prev.call_filters,
                    attended: undefined,
                  },
                })),
              onReplace: (newOptionId) =>
                setQueryFilters((prev) => ({
                  ...prev,
                  call_filters: {
                    ...prev.call_filters,
                    attended: newOptionId === ATTENDED_YES,
                  },
                })),
            }))
          );
        }
      }

      // undefined importance means "All" — no chip.
      if (
        soup.filters.isActive('email') &&
        queryFilters().email_filters?.importance !== undefined
      ) {
        const IMPORTANCE_SIGNAL = 'importance:signal';
        const IMPORTANCE_NOISE = 'importance:noise';
        const key = 'Importance';
        seenKeys.add(key);
        filters.push(
          getOrCreateChip(key, () => ({
            categoryLabel: 'Importance',
            optionId: () =>
              queryFilters().email_filters?.importance
                ? IMPORTANCE_SIGNAL
                : IMPORTANCE_NOISE,
            optionLabel: () =>
              queryFilters().email_filters?.importance ? 'Signal' : 'Noise',
            categoryOptions: [
              { id: IMPORTANCE_SIGNAL, label: 'Signal' },
              { id: IMPORTANCE_NOISE, label: 'Noise' },
            ] as unknown as ActiveFilter['categoryOptions'],
            multiple: false,
            isOptionActive: (optionId) =>
              optionId ===
              (queryFilters().email_filters?.importance
                ? IMPORTANCE_SIGNAL
                : IMPORTANCE_NOISE),
            onRemove: () =>
              setQueryFilters((prev) => ({
                ...prev,
                email_filters: {
                  ...prev.email_filters,
                  importance: undefined,
                },
              })),
            onReplace: (newOptionId) =>
              setQueryFilters((prev) => ({
                ...prev,
                email_filters: {
                  ...prev.email_filters,
                  importance: newOptionId === IMPORTANCE_SIGNAL,
                },
              })),
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
