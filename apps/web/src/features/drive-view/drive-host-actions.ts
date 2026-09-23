import { entityDetailTarget } from '@app/components/entity-detail/EntityDetailNavigationStack';
import { makeShareAction } from '@app/features/next-soup/actions';
import {
  markReminderSeenOnOpen,
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
import {
  handleFileFolderDrop,
  handleFolderSelect,
  openFilePicker,
  openFolderPicker,
} from '@core/util/upload';
import type { Accessor } from 'solid-js';
import type { DriveHostActions } from './context/drive-context';
import { useDriveDetailNavigation } from './drive-detail-navigation';

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
        markReminderSeenOnOpen(entity, notificationSource);
        openEntityInNewTab({ entity, location });

        return;
      }

      if (entity.type === 'project' && !openInNewSplit && !event?.altKey) {
        options.selectFolder(entity.id);

        return;
      }

      markReminderSeenOnOpen(entity, notificationSource);

      if (entity.type === 'document' && !openInNewSplit && !location) {
        const target = entityDetailTarget.document({
          id: entity.id,
          fileType: entity.fileType,
          subType: entity.subType,
          fallbackName: entity.name,
        });

        if (navigation.navigate(target, { event })) return;
      }

      void openEntityInSplitFromUnifiedList(entity, {
        splitHandle: panel.handle,
        referredFrom: 'documents',
        openInNewSplit,
        location,
        notificationSource,
      });
    },

    openFavorite(favorite, name, event) {
      if (favorite.entityType === 'project' && !event.shiftKey) {
        options.selectFolder(favorite.entityId);

        return;
      }

      if (favorite.entityType === 'document') {
        const block = favoriteBlockName(favorite);

        const target = entityDetailTarget.document({
          id: favorite.entityId,
          fileType: favorite.fileType ?? undefined,
          subType:
            block === 'snippet' || block === 'skill'
              ? { type: block }
              : undefined,
          fallbackName: name,
        });

        if (navigation.navigate(target, { event })) return;
      }

      const result = layout.openWithSplit(favoriteSplitContent(favorite), {
        referredFrom: 'sidebar',
        preferNewSplit: event.shiftKey,
      });
      if (result.status === 'reused' && result.owner !== result.sourceOwner) {
        toast.alert('Content already open');
      }
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
      void share.execute(folder);
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
      void handleFileFolderDrop(files, folders, upload);
    },
  };
}
