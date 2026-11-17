import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { toastMovedToFolder } from '@app/features/entity/bulk-edit/moved-to-folder-toast';
import {
  makeCopyAction,
  makeCopyEntityIdAction,
  makeCopyLinkAction,
  makeDeleteAction,
  makeFavoriteAction,
  makeMuteAction,
  makeShareAction,
} from '@app/features/next-soup/actions';
import { t } from '@app/lib/i18n';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  CopyMenuItem,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ProjectEntity } from '@entity';
import ShareIcon from '@icon/share.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import PencilIcon from '@icon/system/regular/pencil-line.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import { NotificationMuteMenu } from '@notifications/components/NotificationMuteMenu';
import { invalidateProjects } from '@queries/storage/projects';
import { Show } from 'solid-js';
import type { DriveFolderMetadata } from './context/drive-source';

/** App wiring for sidebar folder actions using the shared list dialogs and mutations. */
export function DriveFolderActions(props: { folder: DriveFolderMetadata }) {
  const userId = useUserId();

  const entity = (): ProjectEntity => ({
    type: 'project',
    id: props.folder.id,
    name: props.folder.name,
    ownerId: props.folder.userId,
    projectId: props.folder.parentId ?? undefined,
  });

  const favorite = makeFavoriteAction();

  const copyLink = makeCopyLinkAction({ silent: true });
  const copyEntityId = makeCopyEntityIdAction({ silent: true });
  const duplicate = makeCopyAction();
  const share = makeShareAction();
  const notificationSource = useGlobalNotificationSource();
  const mute = makeMuteAction({
    notificationSource: () => notificationSource,
  });

  const deleteFolder = makeDeleteAction({
    userId,

    onDeleted: () => fireAndForget(invalidateProjects(), 'drive-view'),
  });

  const editFolder = (view: 'rename' | 'moveToProject') => {
    openBulkEditModal({
      view,
      entities: [entity()],

      onFinish: () => {
        fireAndForget(invalidateProjects(), 'drive-view');
        if (view === 'rename') toast.success(t('entityActions.toastRenamed'));
      },

      onMoved: (folder) => toastMovedToFolder(1, folder.id),

      onError: () => toast.failure(t('entityActions.toastFolderUpdateFailed')),
    });
  };

  return (
    <>
      <MenuSeparator />
      <Show when={entity().ownerId === userId()}>
        <MenuItem
          text={t('entityActions.rename')}
          icon={PencilIcon}
          onClick={() => editFolder('rename')}
        />
      </Show>
      <MenuItem
        text={
          favorite.isFavorited(entity())
            ? t('entityActions.unfavorite')
            : t('entityActions.favorite')
        }
        icon={StarIcon}
        onClick={() =>
          fireAndForget(favorite.execute([entity()]), 'drive-view')
        }
      />
      <Show when={mute.canExecute(entity())}>
        <NotificationMuteMenu {...mute.menu([entity()])} />
      </Show>
      <Show when={entity().ownerId === userId()}>
        <MenuItem
          text={t('entityActions.moveToFolder')}
          icon={FolderIcon}
          onClick={() => editFolder('moveToProject')}
        />
      </Show>
      <Show when={duplicate.canExecute(entity())}>
        <MenuItem
          text={t('entityActions.duplicate')}
          icon={CopyIcon}
          onClick={() =>
            fireAndForget(duplicate.execute([entity()]), 'drive-view')
          }
        />
      </Show>
      <CopyMenuItem
        text={t('entityActions.copyLink')}
        icon={LinkIcon}
        onCopy={() => copyLink.execute([entity()])}
      />
      <CopyMenuItem
        text={t('entityActions.copyId')}
        icon={CopyIcon}
        onCopy={() => copyEntityId.executeById(entity().id)}
      />
      <MenuItem
        text={t('entityActions.share')}
        icon={ShareIcon}
        onClick={() => fireAndForget(share.execute([entity()]), 'drive-view')}
      />
      <Show when={deleteFolder.canExecute(entity())}>
        <MenuSeparator />
        <MenuItem
          text={t('entityActions.delete')}
          icon={TrashIcon}
          class="text-failure-ink"
          onClick={() =>
            fireAndForget(deleteFolder.execute([entity()]), 'drive-view')
          }
        />
      </Show>
    </>
  );
}
