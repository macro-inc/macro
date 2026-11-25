import {
  type CreatableName,
  runCreateAction,
} from '@app/features/command/Launcher';
import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { createMoveEntitiesToFolder } from '@app/features/entity/bulk-edit/move-entities-to-folder';
import {
  makeCopyAction,
  makeCopyLinkAction,
  makeDeleteAction,
  makeFavoriteAction,
  makeShareAction,
} from '@app/features/next-soup/actions';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  createBulkRemoveFromProjectDssEntityMutation,
  createRenameDssEntityMutation,
  type EntityData,
  getEntityProjectId,
} from '@entity';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import { useRemoveFavoriteMutation } from '@queries/favorites/favorites';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { invalidateDeletedItems } from '@queries/storage/deleted';
import {
  moveEntity,
  restoreEntity,
  trashEntity,
} from '@queries/storage/entity-mutations';
import { refreshActiveGraphqlFoldersQueries } from '@queries/storage/graphql-folders';
import { createProject } from '@queries/storage/projects';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { EntityRefInput } from '@service-storage/graphql/generated/graphql';
import type { Accessor } from 'solid-js';
import type { DriveHostActions } from './context/drive-context';
import type { DriveRedesignHostActions } from './context/drive-redesign-context';
import type { DriveFolderMetadata } from './context/drive-source';
import type {
  MoveUndoItem,
  UndoableEntityRef,
  UndoableEntityType,
} from './core/drive-undo';
import { driveCreateDestinationLabel } from './core/location-label';
import {
  createDriveUndoManager,
  type DriveUndoManager,
} from './primitives/drive-undo';

function toUndoableType(
  type: EntityData['type']
): UndoableEntityType | undefined {
  if (
    type === 'document' ||
    type === 'project' ||
    type === 'chat' ||
    type === 'email' ||
    type === 'database' ||
    type === 'form'
  ) {
    return type;
  }
  return undefined;
}

function toGraphqlTrashRef(
  entity: Pick<UndoableEntityRef, 'id' | 'type'>
): EntityRefInput | undefined {
  if (entity.type === 'document') return { type: 'DOCUMENT', id: entity.id };
  if (entity.type === 'project') return { type: 'PROJECT', id: entity.id };
  if (entity.type === 'chat') return { type: 'CHAT', id: entity.id };
  return undefined;
}

function toGraphqlMoveRef(
  entity: Pick<UndoableEntityRef, 'id' | 'type'>
): EntityRefInput | undefined {
  if (entity.type === 'document') return { type: 'DOCUMENT', id: entity.id };
  if (entity.type === 'project') return { type: 'PROJECT', id: entity.id };
  if (entity.type === 'chat') return { type: 'CHAT', id: entity.id };
  if (entity.type === 'email') return { type: 'EMAIL_THREAD', id: entity.id };
  return undefined;
}

export function createDriveRedesignHost(options: {
  userId: Accessor<string | undefined>;
  projectId: Accessor<string | undefined>;
  folders: Accessor<DriveFolderMetadata[]>;
  items?: Accessor<readonly { entity: EntityData }[]>;
  baseActions: DriveHostActions;
  onFolderCreated?: (folderId: string, parentId: string | null) => void;
  onTrashCompleted?: (ids: readonly string[]) => void;
}): { host: DriveRedesignHostActions; undo: DriveUndoManager } {
  const moveEntities = createMoveEntitiesToFolder('drive_redesign');
  const removeFromProject = createBulkRemoveFromProjectDssEntityMutation();
  const renameMutation = createRenameDssEntityMutation();
  const favoriteAction = makeFavoriteAction();
  const removeFavoriteMutation = useRemoveFavoriteMutation();
  const duplicateAction = makeCopyAction();
  const shareAction = makeShareAction();
  const copyLinkAction = makeCopyLinkAction({ silent: false });
  const fallbackDeleteAction = makeDeleteAction({
    userId: options.userId,
    onDeleted: () => {
      fireAndForget(refreshActiveGraphqlFoldersQueries(), 'drive-redesign');
    },
  });

  const refreshDriveQueries = async (includeFolders: boolean) => {
    await Promise.allSettled([
      refreshActiveGraphqlSoupQueries(),
      includeFolders ? refreshActiveGraphqlFoldersQueries() : Promise.resolve(),
    ]);
  };

  const showUndoToast = (
    message: string,
    undoId: string,
    onUndo: (id: string) => Promise<void>
  ) => {
    const toastId = toast.success(message, {
      dismissStyle: 'icon',
      actionLayout: 'inline',
      duration: 10_000,
      actions: [
        {
          label: t('entityActions.undo'),
          icon: ArrowCounterClockwiseIcon,
          onClick: () => {
            if (toastId != null) toast.dismiss(toastId);
            fireAndForget(onUndo(undoId), 'drive-redesign-undo');
          },
        },
      ],
    });
  };

  const currentObservedState = (
    entity: Pick<UndoableEntityRef, 'id' | 'type'>
  ): { name: string; projectId: string | null } | undefined => {
    if (entity.type === 'project') {
      const folder = options.folders().find((f) => f.id === entity.id);
      if (folder) {
        return { name: folder.name, projectId: folder.parentId ?? null };
      }
    }
    const row = options.items?.().find((item) => item.entity.id === entity.id);
    if (row) {
      return {
        name: row.entity.name,
        projectId: getEntityProjectId(row.entity) || null,
      };
    }
    return undefined;
  };

  const undo = createDriveUndoManager({
    undoMove: async (
      items: readonly MoveUndoItem[],
      destinationFolderId: string | null
    ) => {
      const failedItems: MoveUndoItem[] = [];
      let movedAny = false;
      let skippedAny = false;
      let touchedFolders = false;
      for (const item of items) {
        const observed = currentObservedState(item.entity);
        if (observed && observed.projectId !== destinationFolderId) {
          skippedAny = true;
          continue;
        }
        if (item.entity.type === 'project') touchedFolders = true;
        const ref = toGraphqlMoveRef(item.entity);
        if (ref) {
          try {
            await moveEntity(ref, item.previousProjectId);
            movedAny = true;
          } catch {
            failedItems.push(item);
          }
          continue;
        }
        // Databases and forms use the DSS folder mutations.
        const stub = {
          id: item.entity.id,
          type: item.entity.type,
          name: item.entity.name,
        } as EntityData;
        try {
          if (item.previousProjectId) {
            await moveEntities([stub], {
              id: item.previousProjectId,
              name:
                options
                  .folders()
                  .find((folder) => folder.id === item.previousProjectId)
                  ?.name ?? item.previousProjectId,
            });
          } else {
            await removeFromProject.mutateAsync({
              entities: [{ ...stub, name: stub.name || stub.id }],
            });
          }
          movedAny = true;
        } catch {
          failedItems.push(item);
        }
      }
      if (movedAny) {
        await refreshDriveQueries(touchedFolders);
      }
      return {
        failedItems,
        skipped: !movedAny && skippedAny && failedItems.length === 0,
      };
    },

    undoTrash: async (items: readonly UndoableEntityRef[]) => {
      const pairs = items.flatMap((item) => {
        const ref = toGraphqlTrashRef(item);
        return ref ? [{ item, ref }] : [];
      });
      if (pairs.length === 0) return false;
      const outcomes = await Promise.allSettled(
        pairs.map(({ ref }) => restoreEntity(ref))
      );
      const failedItems: UndoableEntityRef[] = [];
      let restoredAny = false;
      outcomes.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') restoredAny = true;
        else failedItems.push(pairs[index].item);
      });
      if (restoredAny) {
        await Promise.allSettled([
          invalidateDeletedItems(),
          refreshDriveQueries(items.some((item) => item.type === 'project')),
        ]);
      }
      return { failedItems };
    },

    undoRename: async (
      entity: UndoableEntityRef,
      previousName: string,
      expectedCurrentName: string
    ) => {
      const observed = currentObservedState(entity);
      if (observed && observed.name !== expectedCurrentName) {
        return 'skipped';
      }
      try {
        const result = await renameMutation.mutateAsync({
          entity: {
            id: entity.id,
            type: entity.type,
            name: entity.name,
          } as EntityData,
          newName: previousName,
        });
        await refreshDriveQueries(entity.type === 'project');
        return result.success;
      } catch {
        return false;
      }
    },
  });

  const reportUndoOutcome = (
    result: Awaited<ReturnType<DriveUndoManager['undoLatest']>>
  ) => {
    if (result.status === 'skipped') {
      toast.alert(t('drive.toastUndoSkipped'));
      return;
    }
    if (result.status === 'failed') {
      toast.failure(t('drive.toastUndoFailed'));
      return;
    }
    if (result.status !== 'undone') return;
    const action = result.action;
    if (action.kind === 'move') {
      toast.success(t('drive.toastMoveUndone', { count: action.items.length }));
    } else if (action.kind === 'trash') {
      toast.success(t('drive.toastRestored', { count: action.items.length }));
    } else {
      toast.success(t('drive.toastRenameUndone'));
    }
  };

  const runUndoById = async (id: string) => {
    const result = await undo.undoById(id);
    reportUndoOutcome(result);
  };

  const canMutateEntity = (entity: EntityData): boolean => {
    const viewer = options.userId();
    if (!viewer) return false;
    if (entity.type === 'database') return entity.grant === 'owner';
    if (entity.type === 'form') return entity.ownerId === viewer;
    return entity.ownerId === viewer;
  };

  const createFolderInline = async (
    name: string,
    parentId: string | null
  ): Promise<string | undefined> => {
    const trimmed = name.trim();
    if (!trimmed) return undefined;
    try {
      const id = await createProject({
        name: trimmed,
        parentId: parentId ?? undefined,
        source: 'drive_redesign_inline',
      });
      if (!id) {
        toast.failure(t('drive.toastFolderCreateFailed'));
        return undefined;
      }
      await refreshDriveQueries(true);
      options.onFolderCreated?.(id, parentId);
      return id;
    } catch {
      toast.failure(t('drive.toastFolderCreateFailed'));
      return undefined;
    }
  };

  const openCreateFolderWithFiles = (parentId: string | null) => {
    const destination = driveCreateDestinationLabel(
      parentId ?? undefined,
      options.folders()
    );
    runCreateAction('project', {
      projectId: parentId ?? undefined,
      source: 'drive',
      destination,
      openCreated: options.baseActions.openCreated,
    });
  };

  const renameEntityInline = async (
    entity: EntityData,
    nextName: string
  ): Promise<boolean> => {
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === entity.name) return true;
    const previousName = entity.name;
    try {
      const result = await renameMutation.mutateAsync({
        entity,
        newName: trimmed,
      });
      if (!result.success) return false;
      await refreshDriveQueries(entity.type === 'project');
      const undoType = toUndoableType(entity.type);
      if (undoType) {
        const undoId = undo.recordRename({
          entity: { id: entity.id, type: undoType, name: trimmed },
          previousName,
          nextName: trimmed,
        });
        showUndoToast(t('entityActions.toastRenamed'), undoId, runUndoById);
      } else {
        toast.success(t('entityActions.toastRenamed'));
      }
      return true;
    } catch {
      return false;
    }
  };

  const moveEntitiesWithUndo = async (
    entities: readonly EntityData[],
    destinationFolderId: string | null,
    destinationName: string
  ): Promise<boolean> => {
    if (entities.length === 0) return false;
    const mutable = [...entities];
    const succeededUndoItems: MoveUndoItem[] = [];
    let movedCount = 0;
    let failedCount = 0;
    let movedAnyFolder = false;

    // Execute per item through Macro's shared move/remove mutations so every
    // entity type (documents, folders, chats, emails, databases, forms) keeps
    // full GraphQL + REST Soup cache invalidation AND preserves per-item Undo
    // even when a mixed batch partially fails.
    const outcomes = await Promise.allSettled(
      mutable.map(async (entity) => {
        if (destinationFolderId === null) {
          await removeFromProject.mutateAsync({
            entities: [{ ...entity, name: entity.name || entity.id }],
          });
        } else {
          await moveEntities([entity], {
            id: destinationFolderId,
            name: destinationName,
          });
        }
        return entity;
      })
    );

    outcomes.forEach((outcome, index) => {
      if (outcome.status !== 'fulfilled') {
        failedCount += 1;
        return;
      }
      const entity = mutable[index];
      movedCount += 1;
      if (entity.type === 'project') movedAnyFolder = true;
      const undoType = toUndoableType(entity.type);
      const previousProjectId = getEntityProjectId(entity) || null;
      if (undoType && previousProjectId !== destinationFolderId) {
        succeededUndoItems.push({
          entity: { id: entity.id, type: undoType, name: entity.name },
          previousProjectId,
        });
      }
    });

    if (movedCount > 0) {
      await refreshDriveQueries(movedAnyFolder);
      const message =
        destinationFolderId === null
          ? t('drive.toastMovedToRoot', { count: movedCount })
          : t('drive.toastMoved', {
              count: movedCount,
              destination: destinationName,
            });
      if (succeededUndoItems.length > 0) {
        const undoId = undo.recordMove({
          items: succeededUndoItems,
          destinationFolderId,
          destinationName,
        });
        showUndoToast(message, undoId, runUndoById);
      } else {
        toast.success(message);
      }
    }

    if (failedCount > 0) {
      toast.failure(t('entityActions.toastMoveToFolderFailed'));
    }

    return movedCount > 0;
  };

  const openMoveDialog = (entities: readonly EntityData[]) => {
    if (entities.length === 0) return;
    const snapshot = [...entities];
    const undoItems: MoveUndoItem[] = snapshot.flatMap((entity) => {
      const undoType = toUndoableType(entity.type);
      if (!undoType) return [];
      return [
        {
          entity: { id: entity.id, type: undoType, name: entity.name },
          previousProjectId: getEntityProjectId(entity) || null,
        },
      ];
    });
    openBulkEditModal({
      view: 'moveToProject',
      entities: snapshot,
      onFinish: () => {
        fireAndForget(
          refreshDriveQueries(
            snapshot.some((entity) => entity.type === 'project')
          ),
          'drive-redesign-move'
        );
      },
      onMoved: (folder) => {
        const changedUndoItems = undoItems.filter(
          (item) => item.previousProjectId !== folder.id
        );
        const message = t('drive.toastMoved', {
          count: changedUndoItems.length || snapshot.length,
          destination: folder.name,
        });
        if (changedUndoItems.length > 0) {
          const undoId = undo.recordMove({
            items: changedUndoItems,
            destinationFolderId: folder.id,
            destinationName: folder.name,
          });
          showUndoToast(message, undoId, runUndoById);
        } else {
          toast.success(message);
        }
      },
      onError: () => toast.failure(t('entityActions.toastMoveToFolderFailed')),
    });
  };

  const trashEntitiesWithUndo = async (
    entities: readonly EntityData[]
  ): Promise<boolean> => {
    if (entities.length === 0) return false;
    const softTrashable: { entity: EntityData; ref: EntityRefInput }[] = [];
    const fallback: EntityData[] = [];

    for (const entity of entities) {
      const undoType = toUndoableType(entity.type);
      const ref = undoType
        ? toGraphqlTrashRef({ id: entity.id, type: undoType })
        : undefined;
      if (ref && canMutateEntity(entity)) {
        softTrashable.push({ entity, ref });
      } else {
        fallback.push(entity);
      }
    }

    let trashedCount = 0;
    const trashedRefs: UndoableEntityRef[] = [];

    if (softTrashable.length > 0) {
      const outcomes = await Promise.allSettled(
        softTrashable.map(({ ref }) => trashEntity(ref))
      );
      outcomes.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') {
          const entity = softTrashable[index].entity;
          const undoType = toUndoableType(entity.type);
          trashedCount += 1;
          if (undoType) {
            trashedRefs.push({
              id: entity.id,
              type: undoType,
              name: entity.name,
            });
          }
        }
      });

      if (trashedCount > 0) {
        await Promise.allSettled([
          invalidateDeletedItems(),
          refreshDriveQueries(
            trashedRefs.some((item) => item.type === 'project')
          ),
        ]);
        options.onTrashCompleted?.(trashedRefs.map((item) => item.id));
        const undoId = undo.recordTrash(trashedRefs);
        showUndoToast(
          t('drive.toastTrashed', { count: trashedCount }),
          undoId,
          runUndoById
        );
      } else {
        toast.failure(t('drive.toastTrashFailed'));
      }
    }

    if (fallback.length > 0) {
      await fallbackDeleteAction.execute(fallback);
    }

    return trashedCount > 0 || fallback.length > 0;
  };

  const createNewItem = (blockName: string) => {
    const activeFolderId = options.projectId();
    const destination = driveCreateDestinationLabel(
      activeFolderId,
      options.folders()
    );

    runCreateAction(blockName as CreatableName, {
      projectId: activeFolderId,
      source: 'drive',
      destination,
      openCreated: (created) => {
        // Databases and forms start at root on creation; automatically move
        // them into the open folder so "New -> Database/Form" works everywhere.
        if (
          activeFolderId &&
          (created.blockName === 'database' || created.blockName === 'form')
        ) {
          const stub = {
            id: created.id,
            type: created.blockName,
            name: created.blockName,
          } as EntityData;
          const fileCreated = async () => {
            try {
              await moveEntities([stub], {
                id: activeFolderId,
                name: destination,
              });
              toast.success(
                t('drive.toastDatabaseMovedToFolder', { destination })
              );
            } catch {
              // Keep the newly created item open even if filing fails.
            }
          };
          fireAndForget(fileCreated(), 'drive-redesign-file-created');
        }
        return options.baseActions.openCreated(created);
      },
    });
  };

  return {
    undo,
    host: {
      createFolderInline,
      openCreateFolderWithFiles,
      renameEntityInline,
      moveEntitiesWithUndo,
      openMoveDialog,
      trashEntitiesWithUndo,
      toggleStarEntities: async (entities) => {
        await favoriteAction.execute([...entities]);
      },
      isStarred: (entity) => favoriteAction.isFavorited(entity as EntityData),
      unstarFavorite: async (favorite: Favorite) => {
        try {
          await removeFavoriteMutation.mutateAsync({
            entityType: favorite.entityType,
            entityId: favorite.entityId,
          });
          toast.success(t('entityActions.toastRemovedFromFavorites'));
        } catch {
          toast.failure(t('entityActions.toastFavoritesUpdateFailed'));
        }
      },
      duplicateEntities: async (entities) => {
        await duplicateAction.execute([...entities]);
        await refreshDriveQueries(
          entities.some((entity) => entity.type === 'project')
        );
      },
      shareEntities: (entities) => {
        fireAndForget(shareAction.execute([...entities]), 'drive-redesign');
      },
      copyLink: async (entity) => {
        await copyLinkAction.execute([entity]);
      },
      createNewItem,
      undoLatestWithToast: async () => {
        const result = await undo.undoLatest();
        reportUndoOutcome(result);
      },
      canMutateEntity,
      openFolderInNewSplit: options.baseActions.openFolderInNewSplit,
    },
  };
}
