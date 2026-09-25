import { normalizeFacetSelection } from '@app/features/soup/filters/facets/selection';
import { type Accessor, batch, type Setter } from 'solid-js';
import type { DriveFolderMetadata } from '../context/drive-source';
import { folderAncestors } from '../core/folder-tree';
import type {
  DriveLocation,
  DriveScope,
  DriveSort,
  DriveState,
  DriveTab,
} from '../core/types';
import type { DriveListState } from './drive-list';

/** Shared navigation and controls. Display derivations stay with their consumers. */
export function createDriveState(options: {
  state: Accessor<DriveState>;
  setState: Setter<DriveState>;
  folders: Accessor<DriveFolderMetadata[]>;
  list: Pick<DriveListState, 'reset'>;
  showList: () => void;
}) {
  const { state, setState, list } = options;

  const projectId = () => {
    const location = state().location;

    if (location.kind !== 'folder') return undefined;

    return location.id ?? undefined;
  };

  const navigate = (location: DriveLocation) => {
    const current = state();

    const expandedFolderIds = new Set(current.expandedFolderIds);

    if (location.kind === 'folder' && location.id) {
      for (const folder of folderAncestors(options.folders(), location.id)) {
        expandedFolderIds.add(folder.id);
      }
    }

    batch(() => {
      setState({
        ...current,
        location,
        scope: 'default',
        facets: {},
        search: '',
        rootOpen: true,
        expandedFolderIds: [...expandedFolderIds],
      });

      list.reset();
      options.showList();
    });
  };

  const updateFilter = (update: () => void) =>
    batch(() => {
      list.reset();
      update();
    });

  const setFacetSelected = (facetId: string, id: string, selected: boolean) =>
    updateFilter(() => {
      const facets = state().facets;

      const values = (facets[facetId] ?? []).filter((value) => value !== id);

      if (selected) values.push(id);

      setState((current) => ({
        ...current,
        facets: normalizeFacetSelection({ ...facets, [facetId]: values }),
      }));
    });

  return {
    value: state,
    projectId,
    navigate,

    selectTab: (tab: DriveTab) => navigate({ kind: 'tab', tab }),

    selectFolder: (id: string | null) => navigate({ kind: 'folder', id }),

    setScope: (scope: DriveScope) =>
      updateFilter(() => {
        setState((current) => ({ ...current, scope, facets: {} }));
      }),

    setSort: (sort: DriveSort) => setState((current) => ({ ...current, sort })),

    setSearch: (search: string) =>
      updateFilter(() => setState((current) => ({ ...current, search }))),

    setFacetSelected,

    setTags: (ids: string[]) =>
      updateFilter(() => {
        setState((current) => ({
          ...current,
          facets: normalizeFacetSelection({ ...current.facets, tags: ids }),
        }));

        options.showList();
      }),

    clearFilters: () =>
      updateFilter(() => {
        setState((current) => ({ ...current, scope: 'default', facets: {} }));
      }),

    toggleFolder: (id: string) =>
      setState((current) => ({
        ...current,
        expandedFolderIds: current.expandedFolderIds.includes(id)
          ? current.expandedFolderIds.filter((value) => value !== id)
          : [...current.expandedFolderIds, id],
      })),

    setFavoritesOpen: (favoritesOpen: boolean) =>
      setState((current) => ({ ...current, favoritesOpen })),

    setRootOpen: (rootOpen: boolean) =>
      setState((current) => ({ ...current, rootOpen })),

    setTagsOpen: (tagsOpen: boolean) =>
      setState((current) => ({ ...current, tagsOpen })),
  };
}
