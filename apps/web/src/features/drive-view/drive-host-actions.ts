import {
  type EntityDetailTarget,
  entityDetailTarget,
} from '@app/components/entity-detail/entity-detail-target';
import { makeShareAction } from '@app/features/next-soup/actions';
import {
  markRowNotificationsSeenOnOpen,
  openEntityInNewTab,
  openEntityInSplitFromUnifiedList,
} from '@app/features/next-soup/utils';
import { globalSplitManager } from '@app/signal/splitLayout';
import { favoriteBlockName, favoriteSplitContent } from '@app/util/favorites';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  handleFileFolderDrop,
  handleFolderSelect,
  openFilePicker,
  openFolderPicker,
} from '@core/util/upload';
import type { EntityData } from '@entity';
import type { Accessor } from 'solid-js';
import type { DriveHostActions } from './context/drive-context';
import { useDriveDetailNavigation } from './drive-detail-navigation';
import { detailTargetFromRoute } from './primitives/drive-detail-trail';
import { driveDocumentFromContent } from './primitives/drive-route';

function inlineDetailTarget(
  entity: EntityData
): EntityDetailTarget | undefined {
  if (entity.type === 'document') {
    return entityDetailTarget.document({
      id: entity.id,
      fileType: entity.fileType,
      subType: entity.subType,
      fallbackName: entity.name,
    });
  }
  if (entity.type === 'database' || entity.type === 'form') {
    return entityDetailTarget.fromSelection(
      { type: entity.type, id: entity.id },
      entity.name
    );
  }
}

/** App-specific navigation, upload and sharing adapters for the Drive workspace. */
export function createDriveHostActions(options: {
  projectId: Accessor<string | undefined>;
  selectFolder: (id: string | null) => void;
}): DriveHostActions {
  const panel = useSplitPanelOrThrow();

  const layout = useSplitLayout();

  const navigation = useDriveDetailNavigation();

  const notificationSource = useGlobalNotificationSource();

  const share = makeShareAction();

  const upload = useHandleFileUpload({
    get projectId() {
      return options.projectId();
    },
  });

  return {
    userId: useUserId(),

    canOpenNewSplit: () =>
      !isTouchDevice() && !!globalSplitManager()?.canAppendSplit(),

    openEntity(entity, event, location, newSplit = false) {
      const openInNewSplit = newSplit || event?.shiftKey === true;

      // Nested project/content targets reach this adapter. The main row
      // consumes Cmd/Ctrl itself for selection.
      if (event?.metaKey || event?.ctrlKey) {
        markRowNotificationsSeenOnOpen(entity, notificationSource);
        openEntityInNewTab({ entity, location });

        return;
      }

      if (entity.type === 'project' && !openInNewSplit && !event?.altKey) {
        options.selectFolder(entity.id);

        return;
      }

      markRowNotificationsSeenOnOpen(entity, notificationSource);

      const target =
        openInNewSplit || location ? undefined : inlineDetailTarget(entity);
      if (target && navigation.openRoot(target, { event })) return;

      fireAndForget(
        openEntityInSplitFromUnifiedList(entity, {
          splitHandle: panel.handle,
          referredFrom: 'documents',
          openInNewSplit,
          location,
          notificationSource,
        }),
        'open-entity-in-split'
      );
    },

    openFavorite(favorite, name, event) {
      if (favorite.entityType === 'project' && !event.shiftKey) {
        options.selectFolder(favorite.entityId);

        return;
      }

      if (favorite.entityType === 'document') {
        const block = favoriteBlockName(favorite);
        let subType:
          | { type: 'task'; is_completed: boolean }
          | { type: 'snippet' | 'skill' }
          | undefined;
        if (block === 'task') {
          subType = { type: block, is_completed: false };
        } else if (block === 'snippet' || block === 'skill') {
          subType = { type: block };
        }

        const target = entityDetailTarget.document({
          id: favorite.entityId,
          fileType: favorite.fileType ?? undefined,
          subType,
          fallbackName: name,
        });

        if (
          navigation.openRoot(target, {
            event,
            location: { kind: 'tab', tab: 'owned' },
          })
        )
          return;
      }

      if (
        (favorite.entityType === 'database' ||
          favorite.entityType === 'form') &&
        navigation.openRoot(
          entityDetailTarget.fromSelection(
            { type: favorite.entityType, id: favorite.entityId },
            name
          ),
          { event, location: { kind: 'tab', tab: 'owned' } }
        )
      )
        return;

      const result = layout.openWithSplit(favoriteSplitContent(favorite), {
        referredFrom: 'sidebar',
        preferNewSplit: event.shiftKey,
      });
      if (result.status === 'reused' && result.owner !== result.sourceOwner) {
        toast.alert('Content already open');
      }
    },

    openCreated({ blockName, id }) {
      const target =
        blockName === 'database' || blockName === 'form'
          ? { type: blockName, id }
          : detailTargetFromRoute(
              driveDocumentFromContent({ type: blockName, id })
            );

      return target !== undefined && navigation.openRoot(target);
    },

    openFolderInNewSplit: (folder) => {
      layout.openWithSplit(
        { type: 'project', id: folder.id },
        {
          preferNewSplit: true,
          referredFrom: 'entity-actions-menu',
        }
      );
    },

    shareFolder: (folder) => {
      fireAndForget(share.execute(folder), 'drive-view');
    },

    uploadFiles: () =>
      openFilePicker({ multiple: true }, async (files) => {
        await upload(files, false);
      }),

    uploadFolder: () =>
      openFolderPicker({}, async (files) => {
        await handleFolderSelect(files, async (entries) => {
          await upload(entries, false);
        });
      }),

    dropFiles: (files, folders) => {
      fireAndForget(handleFileFolderDrop(files, folders, upload), 'drive-view');
    },
  };
}
