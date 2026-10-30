import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
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
import { MenuItem, MenuSeparator } from '@core/component/ContextMenu';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ProjectEntity } from '@entity';
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

  const copyLink = makeCopyLinkAction();
  const copyEntityId = makeCopyEntityIdAction();
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
        toast.success(
          view === 'rename'
            ? t('entityActions.toastRenamed')
            : t('entityActions.toastMovedToFolder')
        );
      },

      onError: () => toast.failure(t('entityActions.toastFolderUpdateFailed')),
    });
  };

  return (
    <>
      <MenuSeparator />
      <Show when={entity().ownerId === userId()}>
        <MenuItem
          text={t('entityActions.rename')}
          onClick={() => editFolder('rename')}
        />
      </Show>
      <MenuItem
        text={
          favorite.isFavorited(entity())
            ? t('entityActions.unfavorite')
            : t('entityActions.favorite')
        }
        onClick={() =>
          fireAndForget(favorite.execute([entity()]), 'drive-view')
        }
      />
      <Show when={mute.canExecute(entity())}>
        <MenuItem
          text={t('entityActions.snoozeNotifications')}
          onClick={() => mute.snooze([entity()])}
        />
        <MenuItem
          text={
            mute.isMuted(entity())
              ? t('entityActions.unmuteNotifications')
              : t('entityActions.muteNotifications')
          }
          onClick={() => fireAndForget(mute.execute([entity()]), 'drive-view')}
        />
      </Show>
      <Show when={entity().ownerId === userId()}>
        <MenuItem
          text={t('entityActions.moveToFolder')}
          onClick={() => editFolder('moveToProject')}
        />
      </Show>
      <Show when={duplicate.canExecute(entity())}>
        <MenuItem
          text={t('entityActions.duplicate')}
          onClick={() =>
            fireAndForget(duplicate.execute([entity()]), 'drive-view')
          }
        />
      </Show>
      <MenuItem
        text={t('entityActions.copyLink')}
        onClick={() =>
          fireAndForget(copyLink.execute([entity()]), 'drive-view')
        }
      />
      <MenuItem
        text={t('entityActions.copyId')}
        onClick={() =>
          fireAndForget(copyEntityId.executeById(entity().id), 'drive-view')
        }
      />
      <MenuItem
        text={t('entityActions.share')}
        onClick={() => fireAndForget(share.execute(entity()), 'drive-view')}
      />
      <Show when={deleteFolder.canExecute(entity())}>
        <MenuSeparator />
        <MenuItem
          text={t('entityActions.delete')}
          class="text-failure-ink"
          onClick={() =>
            fireAndForget(deleteFolder.execute([entity()]), 'drive-view')
          }
        />
      </Show>
    </>
  );
}
