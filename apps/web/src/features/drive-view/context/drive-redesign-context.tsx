import type { EntityData, ProjectEntity } from '@entity';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { DriveInlineEditState } from '../primitives/drive-inline-edit';
import type { DriveInspectorState } from '../primitives/drive-inspector';
import type { DriveUndoManager } from '../primitives/drive-undo';
import type { DriveViewPreferences } from '../primitives/drive-view-preferences';
import type { DriveAgentsInfo } from '../primitives/use-drive-agents';
import type { DriveShareProvenanceSource } from '../queries/drive-share-provenance';
import type { DriveTrashSource } from '../queries/drive-trash';
import type { DriveListSource } from './drive-source';

export type DriveRedesignHostActions = {
  /** Creates a folder inline (optional parentId) and refreshes folder lists. */
  createFolderInline: (
    name: string,
    parentId: string | null
  ) => Promise<string | undefined>;
  /** Opens the full "New folder with files…" composer dialog. */
  openCreateFolderWithFiles: (parentId: string | null) => void;
  /** Renames a single entity inline and records an Undo entry. */
  renameEntityInline: (
    entity: EntityData,
    nextName: string
  ) => Promise<boolean>;
  /** Moves one or more entities into destinationFolderId (null = My Drive root) with Undo. */
  moveEntitiesWithUndo: (
    entities: readonly EntityData[],
    destinationFolderId: string | null,
    destinationName: string
  ) => Promise<boolean>;
  /** Opens the Move to folder picker modal, recording Undo when completed. */
  openMoveDialog: (entities: readonly EntityData[]) => void;
  /** Moves items to Trash immediately (with Undo toast + Cmd+Z) when supported. */
  trashEntitiesWithUndo: (entities: readonly EntityData[]) => Promise<boolean>;
  /** Toggles favorite/star state on one or more entities. */
  toggleStarEntities: (entities: readonly EntityData[]) => Promise<void>;
  /** Checks whether an entity is currently starred/favorited. */
  isStarred: (entity: Pick<EntityData, 'id' | 'type'>) => boolean;
  /** Removes a favorite entry directly (used on the Starred view). */
  unstarFavorite: (favorite: Favorite) => Promise<void>;
  /** Duplicates one or more entities. */
  duplicateEntities: (entities: readonly EntityData[]) => Promise<void>;
  /** Shares one or more entities. */
  shareEntities: (entities: readonly EntityData[]) => void;
  /** Copies an entity's link to the clipboard. */
  copyLink: (entity: EntityData) => Promise<void>;
  /** Creates a new entity (document, database, form, etc.), filing databases/forms into the open folder. */
  createNewItem: (blockName: string) => void;
  /** Runs the latest undo entry (Cmd+Z) and surfaces user feedback. */
  undoLatestWithToast: () => Promise<void>;
  /** Returns whether the current user owns / can rename or trash this entity. */
  canMutateEntity: (entity: EntityData) => boolean;
  /** Opens a folder in a new split when available. */
  openFolderInNewSplit: (folder: ProjectEntity) => void;
  /** Opens Macro AI contextualized to selected items, active folder, or search query. */
  askAi: (context?: {
    selected?: readonly EntityData[];
    folder?: ProjectEntity;
    searchQuery?: string;
  }) => Promise<void>;
};

export type DriveRedesignContextValue = {
  preferences: DriveViewPreferences;
  inlineEdit: DriveInlineEditState;
  inspector: DriveInspectorState;
  undo: DriveUndoManager;
  trash: DriveTrashSource;
  host: DriveRedesignHostActions;
  /** Viewer's team agent teammates for People/Agent filters. */
  agents?: DriveAgentsInfo;
  /** Viewer-relative share provenance map for Shared with me grouping & badges. */
  shareProvenance?: DriveShareProvenanceSource;
  /** Creates a live folder contents source for inline expansion & Miller columns. */
  createFolderContents: (folderId: Accessor<string | null>) => DriveListSource;
  /** Currently inspected entity (derived from list/grid/column focus or selection). */
  inspectedEntity: Accessor<EntityData | undefined>;
  setInspectedEntity: (entity: EntityData | undefined) => void;
  /** Currently selected entities across the active view for Inspector multi-select summary. */
  selectedEntities: Accessor<EntityData[]>;
  setSelectedEntities: (entities: EntityData[]) => void;
  /** Clears selection in the active browser view. */
  clearActiveSelection: () => void;
  registerClearSelection: (handler: () => void) => () => void;
  /** Focuses the header search bar. */
  focusSearch: () => void;
  registerFocusSearch: (handler: () => void) => () => void;
};

const Context = createContext<DriveRedesignContextValue>();

export const DriveRedesignProvider = Context.Provider;

export function useOptionalDriveRedesign():
  | DriveRedesignContextValue
  | undefined {
  return useContext(Context);
}

export function useDriveRedesign(): DriveRedesignContextValue {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('DriveRedesignProvider is required');
  return ctx;
}
