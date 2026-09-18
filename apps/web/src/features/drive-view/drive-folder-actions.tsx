import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import {
  makeCopyLinkAction,
  makeDeleteAction,
  makeFavoriteAction,
} from '@app/features/next-soup/actions';
import { MenuItem, MenuSeparator } from '@core/component/ContextMenu';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import type { ProjectEntity } from '@entity';
import { invalidateProjects } from '@queries/storage/projects';
import type { Project } from '@service-storage/generated/schemas/project';
import { Show } from 'solid-js';

/** App wiring for sidebar folder actions using the shared list dialogs and mutations. */
export function DriveFolderActions(props: { folder: Project }) {
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
  const deleteFolder = makeDeleteAction({
    userId,
    onDeleted: () => void invalidateProjects(),
  });

  const editFolder = (view: 'rename' | 'moveToProject') => {
    openBulkEditModal({
      view,
      entities: [entity()],
      onFinish: () => {
        void invalidateProjects();
        toast.success(view === 'rename' ? 'Renamed' : 'Moved to folder');
      },
      onError: () => toast.failure('Failed to update folder'),
    });
  };

  return (
    <>
      <MenuSeparator />
      <Show when={entity().ownerId === userId()}>
        <MenuItem text="Rename" onClick={() => editFolder('rename')} />
      </Show>
      <MenuItem
        text={favorite.isFavorited(entity()) ? 'Unfavorite' : 'Favorite'}
        onClick={() => void favorite.execute([entity()])}
      />
      <MenuItem
        text="Move to folder"
        onClick={() => editFolder('moveToProject')}
      />
      <MenuItem
        text="Copy Link"
        onClick={() => void copyLink.execute([entity()])}
      />
      <Show when={deleteFolder.canExecute(entity())}>
        <MenuSeparator />
        <MenuItem
          text="Delete"
          class="text-failure-ink"
          onClick={() => void deleteFolder.execute([entity()])}
        />
      </Show>
    </>
  );
}
