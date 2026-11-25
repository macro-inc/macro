import { t } from '@app/lib/i18n';
import type { EntityData, ProjectEntity } from '@entity';
import { startOfDay } from 'date-fns';
import { createMemo } from 'solid-js';
import type { ActiveFilterChip } from '../../components/redesign/active-filter-chips';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import type { DriveFolderMetadata } from '../../context/drive-source';
import {
  isDriveModifiedPreset,
  matchesDateRange,
  modifiedPresetRange,
  resolveCreatorOptionIds,
} from '../../core/drive-filters';
import {
  countDirectSubfolders,
  filterRootBrowseItems,
  orderDriveDisplayItems,
  splitOwnedAndSharedFolders,
  topLevelFolders,
} from '../../core/drive-items';
import {
  DRIVE_SHARE_SOURCE_FACET_ID,
  driveShareScopeFromFacet,
  matchesDriveShareScope,
  partitionSharedByProvenance,
} from '../../core/drive-share-provenance';
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
  const { preferences, agents, shareProvenance } = useDriveRedesign();
  const filters = useDriveFilters();
  const todayAnchor = startOfDay(new Date());

  const shareScope = () =>
    driveShareScopeFromFacet(state.value().facets[DRIVE_SHARE_SOURCE_FACET_ID]);

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

    const facets = state.value().facets;
    const excludesFoldersByFilter =
      (facets.type?.length ?? 0) > 0 ||
      (facets.tags?.length ?? 0) > 0 ||
      state.value().scope === 'attachments';

    const creatorFilters = facets['created-by'] ?? [];
    const allowedCreatorIds =
      creatorFilters.length > 0
        ? new Set(
            creatorFilters.flatMap((id) =>
              resolveCreatorOptionIds(id, {
                userId: actions.userId(),
                myAgentIds: agents?.myAgentIds(),
                teamAgentIds: agents?.teamAgentIds(),
              })
            )
          )
        : undefined;
    const modifiedFilters = (facets.modified ?? []).filter(
      isDriveModifiedPreset
    );
    const modifiedRanges = modifiedFilters.map((preset) =>
      modifiedPresetRange(preset, todayAnchor)
    );

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
        if (allowedCreatorIds && !allowedCreatorIds.has(folder.userId)) {
          continue;
        }
        if (
          modifiedRanges.length > 0 &&
          !modifiedRanges.some((range) =>
            matchesDateRange(folder.updatedAt ?? folder.createdAt, range)
          )
        ) {
          continue;
        }
        seen.add(folder.id);
        extraFolders.push(folderToProjectEntity(folder));
      }
    };

    if (loc.kind === 'tab' && loc.tab === 'owned') {
      const showFolders =
        !excludesFoldersByFilter &&
        (preferences.rootMode() === 'browse' || searching || filtered);
      if (showFolders) {
        const pool =
          creatorFilters.length > 0
            ? sidebar.folders()
            : partitionedFolders().owned;
        const candidates = searching || filtered ? pool : topLevelFolders(pool);
        addFolders(candidates);
      }
    } else if (loc.kind === 'tab' && loc.tab === 'shared') {
      if (!excludesFoldersByFilter) {
        const currentShareScope = shareScope();
        const candidates =
          searching || filtered
            ? partitionedFolders().shared
            : topLevelFolders(partitionedFolders().shared);
        addFolders(
          currentShareScope === 'all'
            ? candidates
            : candidates.filter((folder) =>
                matchesDriveShareScope(
                  currentShareScope,
                  shareProvenance?.get({ type: 'project', id: folder.id }),
                  false
                )
              )
        );
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

    if (loc.kind === 'tab' && loc.tab === 'shared') {
      const currentShareScope = shareScope();
      if (currentShareScope !== 'all') {
        combined = combined.filter((entity) => {
          const provenance = shareProvenance?.get(entity);
          // Documents are already server-filtered by Soup's ShareSource literal;
          // client-synthesized databases, forms, and folders wait for resolved provenance.
          const fallback = entity.type === 'document';
          return matchesDriveShareScope(
            currentShareScope,
            provenance,
            fallback
          );
        });
      }
    }

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
        valueLabel: filters.creatorLabel(id),
        onRemove: () => state.setFacetSelected('created-by', id, false),
      });
    }

    for (const id of facets.modified ?? []) {
      chips.push({
        key: `modified:${id}`,
        groupLabel: t('drive.filterModifiedLabel'),
        valueLabel: labelFor('modified', id),
        onRemove: () => state.setFacetSelected('modified', id, false),
      });
    }

    return chips;
  });

  const sharedGroups = createMemo(() => {
    if (!isSharedTab() || shareScope() !== 'all') {
      return { groups: [], hasResolvedProvenance: false };
    }
    return partitionSharedByProvenance(items(), (row) =>
      shareProvenance?.get(row.entity)
    );
  });

  return {
    items,
    sharedGroups,
    shareScope,
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
