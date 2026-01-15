import { produce } from 'solid-js/store';
import type { SetStoreFunction } from 'solid-js/store';
import type { Accessor } from 'solid-js';
import type { ViewId } from '@core/types/view';
import type { ExpandedEntityType } from '@macro-entity';
import { match } from 'ts-pattern';
import type { DocumentTypeFilter, ViewDataMap } from '../../ViewConfig';
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

export function useFilterActions(params: UseFilterActionsParams) {
  const {
    selectedView,
    setViewDataStore,
    entityTypeFilter,
    documentTypeFilter,
    channelCategoryFilter,
    focusFilters,
  } = params;

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

  const clearTopbarTypeFilters = () => {
    setViewDataStore(
      selectedView(),
      'filters',
      produce((filters) => {
        filters.typeFilter = [];
        filters.documentTypeFilter = [];
        filters.channelCategoryFilter = [];
      })
    );
  };

  const toggleFocusFilter = (target: FocusFilterTarget) => {
    const isActive = target === 'signal' ? isInboxActive() : isOtherActive();
    const config = isActive
      ? FOCUS_FILTER_CONFIGS.none
      : FOCUS_FILTER_CONFIGS[target];
    const viewId = selectedView();

    setViewDataStore(viewId, 'filters', 'focusFilters', [
      ...config.focusFilters,
    ]);
    setViewDataStore(
      viewId,
      'filters',
      'notificationFilter',
      config.notificationFilter
    );
    setViewDataStore(
      viewId,
      'display',
      'unrollNotifications',
      config.unrollNotifications
    );
  };

  const setExclusiveEntityTypeFilter = (type: ExpandedEntityType) => {
    if (isEntityTypeActive(type)) {
      clearTopbarTypeFilters();
      return;
    }
    setViewDataStore(
      selectedView(),
      'filters',
      produce((filters) => {
        filters.typeFilter = [type];
        filters.documentTypeFilter = [];
        filters.channelCategoryFilter = [];
      })
    );
  };

  const toggleDocumentPreset = (preset: DocumentTypeFilter[]) => {
    if (entityTypeFilter().length === 1 && isDocPresetActive(preset)) {
      clearTopbarTypeFilters();
      return;
    }
    setViewDataStore(
      selectedView(),
      'filters',
      produce((filters) => {
        filters.typeFilter = ['document'];
        filters.documentTypeFilter = preset;
        filters.channelCategoryFilter = [];
      })
    );
  };

  const toggleChannelCategoryFilter = (category: 'people' | 'groups') => {
    const isActive =
      entityTypeFilter().length === 1 &&
      entityTypeFilter()[0] === 'channel' &&
      isChannelCatActive(category);

    if (isActive) {
      clearTopbarTypeFilters();
      return;
    }
    setViewDataStore(
      selectedView(),
      'filters',
      produce((filters) => {
        filters.typeFilter = ['channel'];
        filters.channelCategoryFilter = [category];
        filters.documentTypeFilter = [];
      })
    );
  };

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
    isInboxActive,
    isOtherActive,
    isEntityTypeActive,
    isDocPresetActive,
    isChannelCatActive,
    isFilterConfigActive,
    clearTopbarTypeFilters,
    toggleFocusFilter,
    setExclusiveEntityTypeFilter,
    toggleDocumentPreset,
    toggleChannelCategoryFilter,
    getFilterHandler,
  };
}
