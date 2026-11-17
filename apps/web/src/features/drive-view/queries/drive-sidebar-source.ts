import { useFavoritesData } from '@queries/favorites/favorites';
import { useDatabasesQuery } from '@queries/storage/databases';
import { useFormsQuery } from '@queries/storage/forms';
import { createGraphqlFoldersQuery } from '@queries/storage/graphql-folders';
import { type Accessor, createMemo } from 'solid-js';
import type { DriveSidebarSource } from '../context/drive-source';
import { selectSidebarDatabases } from './drive-databases';
import { hiddenFormDatabases } from './drive-forms';

type DriveSidebarOptions = {
  databasesEnabled: Accessor<boolean>;
  formsEnabled: Accessor<boolean>;
};

export function createDriveSidebarSource(
  options: DriveSidebarOptions
): DriveSidebarSource {
  const folders = createGraphqlFoldersQuery();

  return {
    folders: () => folders.data ?? [],
    foldersLoading: () => folders.isPending && !folders.data,
    foldersError: () => folders.isError && !folders.data,
    retryFolders: async () => {
      await folders.refetch({ requestPolicy: 'network-only' });
    },
    favorites: createSidebarFavorites(),
    databases: createSidebarDatabases(options),
  };
}

function createSidebarFavorites() {
  const favoritesData = useFavoritesData();
  return createMemo(() =>
    (favoritesData()?.favorites ?? [])
      .filter(
        (favorite) =>
          favorite.entityType === 'project' ||
          favorite.entityType === 'database' ||
          favorite.entityType === 'form' ||
          (favorite.entityType === 'document' &&
            favorite.documentSubType !== 'task')
      )
      .sort((a, b) => a.sortOrder - b.sortOrder)
  );
}

function createSidebarDatabases(options: DriveSidebarOptions) {
  const databases = useDatabasesQuery();
  const forms = useFormsQuery();
  return createMemo(() => {
    if (!options.databasesEnabled() || databases.isPending) return [];
    // The forms list names the databases made for polls; without it, show none.
    const formsEnabled = options.formsEnabled();
    if (formsEnabled && forms.isPending) return [];
    const listedForms = formsEnabled ? forms.data : [];
    if (!listedForms) return [];
    return selectSidebarDatabases(
      databases.data ?? [],
      hiddenFormDatabases(listedForms)
    );
  });
}
