import type { FileListSize } from '@core/component/FileList/constants';
import type {
  ItemFilter,
  OwnershipFilter,
} from '@core/component/FileList/Filter';
import type { ViewType } from '@core/component/FileList/viewTypes';
import { defaultFileSortPair, type SortPair } from '@core/util/sort';
import type { Project } from '@service-storage/generated/schemas/project';
import { makePersisted } from '@solid-primitives/storage';
import { createStore } from 'solid-js/store';

interface PersistedViewFilter {
  viewSize: FileListSize;
  viewSortList: ViewType;
  activeFilters: ItemFilter[];
  ownershipFilters: OwnershipFilter[];
  fileSearchQuery: string;
  fileSort: SortPair;
  showProjectsFirst: boolean;
  showTrash: boolean;
}

// blockId -> viewFilter
type BlockViewFilter = Record<string, PersistedViewFilter>;

export const defaultViewFilter: PersistedViewFilter = {
  viewSize: 'md',
  viewSortList: 'treeList',
  activeFilters: [],
  ownershipFilters: [],
  fileSearchQuery: '',
  fileSort: defaultFileSortPair,
  showProjectsFirst: false,
  showTrash: false,
};

export const [persistedViewFilter_, setPersistedViewFilter] = makePersisted(
  createStore<BlockViewFilter>({}),
  {
    name: 'viewFilter',
    storage: localStorage,
  }
);

export const persitedViewFilter = (project: Project) => {
  if (!persistedViewFilter_[project.id]) {
    setPersistedViewFilter(project.id, defaultViewFilter);
    return defaultViewFilter;
  }
  return persistedViewFilter_[project.id];
};

export const savePersistedViewFilter = (
  project: Project | undefined,
  key: keyof PersistedViewFilter,
  value: PersistedViewFilter[keyof PersistedViewFilter]
) => {
  if (!project || project.id === 'trash') return;

  // Ensure the project entry exists before doing nested update
  if (!persistedViewFilter_[project.id]) {
    setPersistedViewFilter(project.id, { ...defaultViewFilter, [key]: value });
  } else {
    setPersistedViewFilter(project.id, key, value);
  }
};
