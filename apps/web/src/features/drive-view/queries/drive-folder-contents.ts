import type { NotificationSource } from '@notifications';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { type Accessor, createMemo } from 'solid-js';
import type { DriveListSource, DriveSelection } from '../context/drive-source';
import type { DriveSort } from '../core/types';
import { createDriveDataSource } from './drive-data-source';

/**
 * Dedicated live data source for a single folder (or My Drive root when
 * `folderId` is null). Used by inline expandable folders in List view and
 * individual panes in Miller Columns view.
 */
export function createDriveFolderContentsSource(options: {
  folderId: Accessor<string | null>;
  sort: Accessor<DriveSort>;
  userId: Accessor<string | undefined>;
  tagSets: Accessor<readonly TagSetResponse[]>;
  tagSetsReady: Accessor<boolean>;
  notificationSource: NotificationSource;
}): DriveListSource {
  const selection = createMemo<DriveSelection>(() => {
    const id = options.folderId();
    return {
      location:
        id === null ? { kind: 'tab', tab: 'owned' } : { kind: 'folder', id },
      scope: 'default',
      sort: options.sort(),
      search: '',
      facets: {},
    };
  });

  return createDriveDataSource({
    selection,
    databasesEnabled: () => true,
    formsEnabled: () => true,
    userId: options.userId,
    tagSets: options.tagSets,
    tagSetsReady: options.tagSetsReady,
    notificationSource: options.notificationSource,
  });
}
