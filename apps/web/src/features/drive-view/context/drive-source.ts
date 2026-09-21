import type { ListDataSource } from '@app/components/list';
import type { SoupEntityRow } from '@app/features/soup/collection/types';
import type { EntityData } from '@entity';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { Accessor } from 'solid-js';
import type { DriveFolder, DriveState } from '../core/types';

export type DriveListItem = SoupEntityRow<EntityData>;

/** Query results consumed by Drive's list controller and renderer. */
export type DriveListSource = ListDataSource<DriveListItem> & {
  hasData: Accessor<boolean>;
  featuredIds: Accessor<readonly string[]>;
  deferInteractions: Accessor<boolean>;
};

export type DriveSelection = Pick<
  DriveState,
  'location' | 'scope' | 'sort' | 'search' | 'facets'
>;

export type DriveFolderMetadata = DriveFolder & { userId: string };

export type DriveSidebarSource = {
  folders: Accessor<DriveFolderMetadata[]>;
  favorites: Accessor<Favorite[]>;
  foldersLoading: Accessor<boolean>;
  foldersError: Accessor<boolean>;
  retryFolders: () => Promise<void>;
};
