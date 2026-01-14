import { batch, type Accessor } from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import type { ViewId } from '@core/types/view';
import type { ExpandedEntityType } from '@macro-entity';
import { match } from 'ts-pattern';
import type {
  DocumentTypeFilter,
  FilterOptions,
  ViewDataMap,
} from '../../ViewConfig';
import {
  type EntityTypeFilterConfig,
  FOCUS_FILTER_CONFIGS,
  type FocusFilterTarget,
} from '../utils/filterConfigs';
import {
  isChannelCategoryActive,
  isDocumentPresetActive,
  isEntityTypeFilterActive,
  isFocusFilterActive,
} from '../utils/filterHelpers';

export interface UseFilterActionsParams {
  selectedView: Accessor<ViewId>;
  setViewDataStore: SetStoreFunction<ViewDataMap>;
  entityTypeFilter: Accessor<ExpandedEntityType[]>;
  documentTypeFilter: Accessor<DocumentTypeFilter[]>;
  channelCategoryFilter: Accessor<('people' | 'groups')[] | undefined>;
  focusFilters: Accessor<('signal' | 'noise')[] | undefined>;
}

/**
 * Hook that encapsulates all filter mutation logic.
 * Provides clean, type-safe functions for toggling filters with proper batching.
 */
export function useFilterActions(params: UseFilterActionsParams) {
  const {
    selectedView,
    setViewDataStore,
    entityTypeFilter,
    documentTypeFilter,
    channelCategoryFilter,
    focusFilters,
  } = params;

  // --- Batch update helpers ---

  const updateFilters = (updates: Partial<FilterOptions>) => {
    batch(() => {
      for (const [key, value] of Object.entries(updates)) {
        setViewDataStore(
          selectedView(),
          'filters',
          key as keyof FilterOptions,
          value as never
        );
      }
    });
  };

  // --- Active state checkers ---

  const isInboxActive = () => isFocusFilterActive(focusFilters(), 'signal');
  const isOtherActive = () => isFocusFilterActive(focusFilters(), 'noise');

  const isEntityTypeActive = (type: ExpandedEntityType) =>
    isEntityTypeFilterActive(entityTypeFilter(), type);

  const isDocPresetActive = (types: DocumentTypeFilter[]) =>
    isDocumentPresetActive(entityTypeFilter(), documentTypeFilter(), types);

  const isChannelCatActive = (category: 'people' | 'groups') =>
    isChannelCategoryActive(
      entityTypeFilter(),
      channelCategoryFilter() ?? [],
      category
    );

  // --- Filter mutations ---

  /**
   * Clear all topbar type filters (entity type, document type, channel category).
   */
  const clearTopbarTypeFilters = () => {
    updateFilters({
      typeFilter: [],
      documentTypeFilter: [],
      channelCategoryFilter: [],
    });
  };

  /**
   * Toggle focus filter (inbox/other) with coupled state.
   * When active, also sets notificationFilter to 'notDone' and unrollNotifications to true.
   */
  const toggleFocusFilter = (target: FocusFilterTarget) => {
    const isActive = target === 'signal' ? isInboxActive() : isOtherActive();
    const config = isActive
      ? FOCUS_FILTER_CONFIGS.none
      : FOCUS_FILTER_CONFIGS[target];

    batch(() => {
      setViewDataStore(selectedView(), 'filters', 'focusFilters', [
        ...config.focusFilters,
      ]);
      setViewDataStore(
        selectedView(),
        'filters',
        'notificationFilter',
        config.notificationFilter
      );
      setViewDataStore(
        selectedView(),
        'display',
        'unrollNotifications',
        config.unrollNotifications
      );
    });
  };

  /**
   * Set exclusive entity type filter.
   * If already active, clears all filters. Otherwise, sets only this type.
   */
  const setExclusiveEntityTypeFilter = (type: ExpandedEntityType) => {
    const isActive = isEntityTypeActive(type);

    batch(() => {
      if (isActive) {
        clearTopbarTypeFilters();
      } else {
        setViewDataStore(selectedView(), 'filters', 'typeFilter', [type]);
        setViewDataStore(selectedView(), 'filters', 'documentTypeFilter', []);
        setViewDataStore(
          selectedView(),
          'filters',
          'channelCategoryFilter',
          []
        );
      }
    });
  };

  /**
   * Toggle document preset filter (e.g., Docs = ['md', 'canvas'], Files = ['code', 'image', 'pdf', 'unknown']).
   * If already active, clears all filters. Otherwise, sets document type with the preset.
   */
  const toggleDocumentPreset = (preset: DocumentTypeFilter[]) => {
    const isActive =
      entityTypeFilter().length === 1 && isDocPresetActive(preset);

    batch(() => {
      if (isActive) {
        clearTopbarTypeFilters();
      } else {
        setViewDataStore(selectedView(), 'filters', 'typeFilter', ['document']);
        setViewDataStore(
          selectedView(),
          'filters',
          'documentTypeFilter',
          preset
        );
        setViewDataStore(
          selectedView(),
          'filters',
          'channelCategoryFilter',
          []
        );
      }
    });
  };

  /**
   * Toggle channel category filter (people = DMs, groups = non-DM channels).
   * If already active, clears all filters. Otherwise, sets channel type with the category.
   */
  const toggleChannelCategoryFilter = (category: 'people' | 'groups') => {
    const isActive =
      entityTypeFilter().length === 1 &&
      entityTypeFilter()[0] === 'channel' &&
      isChannelCatActive(category);

    batch(() => {
      if (isActive) {
        clearTopbarTypeFilters();
      } else {
        setViewDataStore(selectedView(), 'filters', 'typeFilter', ['channel']);
        setViewDataStore(selectedView(), 'filters', 'channelCategoryFilter', [
          category,
        ]);
        setViewDataStore(selectedView(), 'filters', 'documentTypeFilter', []);
      }
    });
  };

  /**
   * Get the handler function for a given filter config.
   * Used by both hotkeys and button onClick handlers to avoid duplication.
   */
  const getFilterHandler = (filter: EntityTypeFilterConfig): (() => void) => {
    return match(filter)
      .with(
        { kind: 'documentPreset' },
        (f) => () => toggleDocumentPreset(f.documentTypes)
      )
      .with(
        { kind: 'channelCategory' },
        (f) => () => toggleChannelCategoryFilter(f.channelCategory)
      )
      .with(
        { kind: 'entityType' },
        (f) => () => setExclusiveEntityTypeFilter(f.type)
      )
      .exhaustive();
  };

  /**
   * Check if a filter config is currently active.
   * Used by both hotkeys and button active states.
   */
  const isFilterConfigActive = (filter: EntityTypeFilterConfig): boolean => {
    return match(filter)
      .with(
        { kind: 'documentPreset' },
        (f) =>
          entityTypeFilter().length === 1 && isDocPresetActive(f.documentTypes)
      )
      .with(
        { kind: 'channelCategory' },
        (f) =>
          entityTypeFilter().length === 1 &&
          isChannelCatActive(f.channelCategory)
      )
      .with({ kind: 'entityType' }, (f) => isEntityTypeActive(f.type))
      .exhaustive();
  };

  return {
    // Active state checkers
    isInboxActive,
    isOtherActive,
    isEntityTypeActive,
    isDocPresetActive,
    isChannelCatActive,
    isFilterConfigActive,

    // Filter mutations
    clearTopbarTypeFilters,
    toggleFocusFilter,
    setExclusiveEntityTypeFilter,
    toggleDocumentPreset,
    toggleChannelCategoryFilter,
    getFilterHandler,
  };
}
