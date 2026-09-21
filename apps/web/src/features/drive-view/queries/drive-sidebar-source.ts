import { useFavoritesData } from '@queries/favorites/favorites';
import { useProjectsQuery } from '@queries/storage/projects';
import { createMemo } from 'solid-js';
import type { DriveSidebarSource } from '../context/drive-source';

export function createDriveSidebarSource(): DriveSidebarSource {
  const projects = useProjectsQuery();

  const favoritesData = useFavoritesData();

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

    favorites: createMemo(() =>
      (favoritesData()?.favorites ?? [])
        .filter(
          (favorite) =>
            favorite.entityType === 'project' ||
            (favorite.entityType === 'document' &&
              favorite.documentSubType !== 'task')
        )
        .sort((a, b) => a.sortOrder - b.sortOrder)
    ),
  };
}
