import type { OpenCreatedItem } from '@app/features/command/types';
import type { EntityData, ProjectEntity, SearchLocation } from '@entity';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { DriveListState } from '../primitives/drive-list';
import type { createDriveState } from '../primitives/drive-state';
import type { DriveListSource, DriveSidebarSource } from './drive-source';

export type DriveHostActions = {
  userId: Accessor<string | undefined>;
  canOpenNewSplit: Accessor<boolean>;
  openEntity: (
    entity: EntityData,
    event?: MouseEvent,
    location?: SearchLocation,
    newSplit?: boolean
  ) => void;
  openFavorite: (favorite: Favorite, name: string, event: MouseEvent) => void;
  openCreated: OpenCreatedItem;
  openFolderInNewSplit: (folder: ProjectEntity) => void;
  shareFolder: (folder: ProjectEntity) => void;
  uploadFiles: () => void;
  uploadFolder: () => void;
  dropFiles: (
    files: FileSystemFileEntry[],
    folders: FileSystemDirectoryEntry[]
  ) => void;
};

export type DriveContext = {
  state: ReturnType<typeof createDriveState>;
  source: DriveListSource;
  list: DriveListState;
  sidebar: DriveSidebarSource;
  actions: DriveHostActions;
};

const Context = createContext<DriveContext>();

export const DriveProvider = Context.Provider;

export function useOptionalDriveView(): DriveContext | undefined {
  return useContext(Context);
}

export function useDriveView(): DriveContext {
  const context = useOptionalDriveView();

  if (!context) throw new Error('DriveProvider is required');

  return context;
}
