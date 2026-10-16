import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useFavoritesData } from '@queries/favorites/favorites';
import { createGraphqlFoldersQuery } from '@queries/storage/graphql-folders';
import { useProjectsQuery } from '@queries/storage/projects';
import { createMemo } from 'solid-js';
import type { DriveSidebarSource } from '../context/drive-source';

export function createDriveSidebarSource(): DriveSidebarSource {
  if (isFeatureEnabled(enableGraphqlSoup)) {
    return createGraphqlDriveSidebarSource();
  }

  return createRestDriveSidebarSource();
}

function createSidebarFavorites() {
  const favoritesData = useFavoritesData();
  return createMemo(() =>
    (favoritesData()?.favorites ?? [])
      .filter(
        (favorite) =>
          favorite.entityType === 'project' ||
          (favorite.entityType === 'document' &&
            favorite.documentSubType !== 'task')
      )
      .sort((a, b) => a.sortOrder - b.sortOrder)
  );
}

function createGraphqlDriveSidebarSource(): DriveSidebarSource {
  const folders = createGraphqlFoldersQuery();

  return {
    folders: () => folders.data ?? [],
    foldersLoading: () => folders.isPending && !folders.data,
    foldersError: () => folders.isError && !folders.data,
    retryFolders: async () => {
      await folders.refetch({ requestPolicy: 'network-only' });
    },
    favorites: createSidebarFavorites(),
  };
}

function createRestDriveSidebarSource(): DriveSidebarSource {
  const projects = useProjectsQuery();

  return {
    folders: () =>
      projects.isSuccess
        ? projects.data.filter((folder) => !folder.deletedAt)
        : [],

    foldersLoading: () => projects.isPending,

    foldersError: () => projects.isError,

    retryFolders: async () => {
      await projects.refetch();
    },

    favorites: createSidebarFavorites(),
  };
}
