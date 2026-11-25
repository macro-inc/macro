import { t } from '@app/lib/i18n';
import type { EntityData, ProjectEntity } from '@entity';
import { createMemo } from 'solid-js';
import type { ActiveFilterChip } from '../../components/redesign/active-filter-chips';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import type { DriveFolderMetadata } from '../../context/drive-source';
import {
  countDirectSubfolders,
  filterRootBrowseItems,
  orderDriveDisplayItems,
  splitOwnedAndSharedFolders,
  topLevelFolders,
} from '../../core/drive-items';
import { useDriveFilters } from '../../filters/use-drive-filters';

export type DriveDisplayRow = {
  id: string;
  entity: EntityData;
  isFolder: boolean;
  subfolderCount: number;
};

export function folderToProjectEntity(
  folder: DriveFolderMetadata
): ProjectEntity {
  return {
    type: 'project',
    id: folder.id,
    name: folder.name,
    ownerId: folder.userId,
    projectId: folder.parentId ?? undefined,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  };
}

/**
 * Unifies Drive's file list and folder graph into one coherent display model:
 * - On My Drive root (Browse): shows top-level owned folders + unfiled owned files.
 * - On My Drive root (All files): shows all owned files flat with folder paths.
 * - On Shared with me: includes shared folders alongside shared files.
 * - On Drive root folder view (`folder/null`): shows top-level folders cleanly.
 * - Inside any folder: shows direct subfolders + files, ordered with Folders first.
 */
export function useDriveDisplayItems() {
  const { state, source, sidebar, actions } = useDriveView();
  const { preferences } = useDriveRedesign();
  const filters = useDriveFilters();

  const foldersById = createMemo(() => {
    const map = new Map<string, DriveFolderMetadata>();
    for (const folder of sidebar.folders()) {
      map.set(folder.id, folder);
    }
    return map;
  });

  const subfolderCounts = createMemo(() =>
    countDirectSubfolders(sidebar.folders())
  );

  const partitionedFolders = createMemo(() =>
    splitOwnedAndSharedFolders(sidebar.folders(), actions.userId())
  );

  const isSearching = () => state.value().search.trim().length > 0;
  const hasFilters = () => filters.activeCount() > 0;

  const isMyDriveRoot = () => {
    const loc = state.value().location;
    return (
      (loc.kind === 'tab' && loc.tab === 'owned') ||
      (loc.kind === 'folder' && loc.id === null)
    );
  };

  const isRecentTab = () => {
    const loc = state.value().location;
    return loc.kind === 'tab' && loc.tab === 'recent';
  };

  const isSharedTab = () => {
    const loc = state.value().location;
    return loc.kind === 'tab' && loc.tab === 'shared';
  };

  const items = createMemo<DriveDisplayRow[]>(() => {
    const loc = state.value().location;
    const searching = isSearching();
    const filtered = hasFilters();
    const searchTerm = state.value().search.trim().toLocaleLowerCase();
    const counts = subfolderCounts();

    const rawEntities: EntityData[] = source.items().map((row) => row.entity);
    const seen = new Set(rawEntities.map((entity) => entity.id));

    // Synthesize top-level folders where Soup's legacy tab query omits them.
    const extraFolders: ProjectEntity[] = [];
    const addFolders = (folders: readonly DriveFolderMetadata[]) => {
      for (const folder of folders) {
        if (seen.has(folder.id)) continue;
        if (
          searchTerm &&
          !folder.name.toLocaleLowerCase().includes(searchTerm)
        ) {
          continue;
        }
        seen.add(folder.id);
        extraFolders.push(folderToProjectEntity(folder));
      }
    };

    if (loc.kind === 'tab' && loc.tab === 'owned') {
      const showFolders =
        !filtered && (preferences.rootMode() === 'browse' || searching);
      if (showFolders) {
        const candidates = searching
          ? partitionedFolders().owned
          : topLevelFolders(partitionedFolders().owned);
        addFolders(candidates);
      }
    } else if (loc.kind === 'tab' && loc.tab === 'shared') {
      if (!filtered) {
        const candidates = searching
          ? partitionedFolders().shared
          : topLevelFolders(partitionedFolders().shared);
        addFolders(candidates);
      }
    } else if (loc.kind === 'folder' && loc.id === null) {
      // Replace the flattened all-depth legacy dump with top-level folders only.
      const topIds = new Set(
        topLevelFolders(sidebar.folders()).map((folder) => folder.id)
      );
      const topOnly = rawEntities.filter(
        (entity) => entity.type !== 'project' || topIds.has(entity.id)
      );
      const orderedTop = orderDriveDisplayItems(topOnly, {
        foldersFirst: preferences.foldersFirst(),
        sort: state.value().sort,
        direction: preferences.sortDirection(),
      });
      return orderedTop.map((entity) => ({
        id: entity.id,
        entity,
        isFolder: entity.type === 'project',
        subfolderCount:
          entity.type === 'project' ? (counts.get(entity.id) ?? 0) : 0,
      }));
    }

    let combined: EntityData[] = [...extraFolders, ...rawEntities];

    if (loc.kind === 'tab' && loc.tab === 'owned') {
      combined = filterRootBrowseItems(
        combined,
        preferences.rootMode(),
        searching || filtered
      );
    }

    // Recent keeps strict server recency order (touched_by_me).
    const ordered = isRecentTab()
      ? combined
      : orderDriveDisplayItems(combined, {
          foldersFirst: preferences.foldersFirst(),
          sort: state.value().sort,
          direction: preferences.sortDirection(),
        });

    return ordered.map((entity) => ({
      id: entity.id,
      entity,
      isFolder: entity.type === 'project',
      subfolderCount:
        entity.type === 'project' ? (counts.get(entity.id) ?? 0) : 0,
    }));
  });

  const activeFilterChips = createMemo<ActiveFilterChip[]>(() => {
    const chips: ActiveFilterChip[] = [];
    const { scope, facets } = state.value();
    const groups = filters.groups();

    if (scope === 'all') {
      chips.push({
        key: 'scope:all',
        groupLabel: t('drive.columnKind'),
        valueLabel: t('drive.filterScopeAll'),
        onRemove: () => state.setScope('default'),
      });
    } else if (scope === 'attachments') {
      chips.push({
        key: 'scope:attachments',
        groupLabel: t('drive.columnKind'),
        valueLabel: t('drive.filterScopeAttachments'),
        onRemove: () => state.setScope('default'),
      });
    }

    const labelFor = (groupId: string, optionId: string) => {
      const group = groups.find((entry) => entry.id === groupId);
      const option = group?.options.find((entry) => entry.id === optionId);
      return option?.label ?? optionId;
    };

    for (const id of facets.type ?? []) {
      chips.push({
        key: `type:${id}`,
        groupLabel: t('drive.filterTypeLabel'),
        valueLabel: labelFor('type', id),
        onRemove: () => state.setFacetSelected('type', id, false),
      });
    }

    for (const id of facets.tags ?? []) {
      chips.push({
        key: `tags:${id}`,
        groupLabel: t('drive.filterTagLabel'),
        valueLabel: labelFor('tags', id),
        onRemove: () =>
          state.setTags((facets.tags ?? []).filter((value) => value !== id)),
      });
    }

    for (const id of facets['created-by'] ?? []) {
      chips.push({
        key: `created-by:${id}`,
        groupLabel: t('drive.filterCreatorLabel'),
        valueLabel: labelFor('created-by', id),
        onRemove: () => state.setFacetSelected('created-by', id, false),
      });
    }

    return chips;
  });

  return {
    items,
    foldersById,
    subfolderCounts,
    partitionedFolders,
    activeFilterChips,
    isSearching,
    hasFilters,
    isMyDriveRoot,
    isRecentTab,
    isSharedTab,
    filters,
  };
}
