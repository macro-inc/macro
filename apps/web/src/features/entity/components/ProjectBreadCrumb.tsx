import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import FolderIcon from '@icon/system/regular/folder-simple.svg';
import { queryReadyGate } from '@queries/gate';
import { useProjectPreviewQuery } from '@queries/storage/project-preview';
import { buttonClasses, cn, HoverCard } from '@ui';
import { createMemo, Show } from 'solid-js';
import { useKnownFolders } from '../context/known-folders';
import type { ProjectContainedEntity, ProjectEntity } from '../types/entity';
import { knownFolderPath } from '../utils/folder-path';
import { truncatedPath } from '../utils/path';

const MAX_PATH_LENGTH = 30;

export function ProjectBreadCrumb(props: {
  entity: ProjectContainedEntity;
  onClick?: (entity: ProjectEntity, event: MouseEvent) => void;
  collapsed?: boolean;
}) {
  // A folder the host already loaded (Drive's folder list) needs no request;
  // only folders it doesn't hold ask the server, batched across rows.
  const knownFolders = useKnownFolders();
  const known = createMemo(() =>
    knownFolders
      ? knownFolderPath(knownFolders(), props.entity.projectId)
      : undefined
  );
  const projectQuery = useProjectPreviewQuery(
    () => props.entity.projectId,
    () => !known()
  );
  const folder = () => {
    const knownPath = known();
    if (knownPath) return { ...knownPath, updatedAt: undefined };
    if (!queryReadyGate(projectQuery)) return undefined;
    const data = projectQuery.data;
    return { ...data, ownerId: data.owner };
  };
  const loading = () => !known() && projectQuery.isPending;
  const fullPath = () => {
    const data = folder();
    return data ? data.path.join('/') || data.name : undefined;
  };

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    const data = folder();
    if (!data) return;
    e.stopPropagation();

    const projectEntity: ProjectEntity = {
      type: 'project',
      id: data.id,
      name: data.name,
      ownerId: data.ownerId,
      updatedAt: data.updatedAt,
    };

    props.onClick?.(projectEntity, e);
  };

  return (
    <HoverCard
      as="button"
      triggerAriaLabel={fullPath()}
      triggerOnClick={handleClick}
      triggerClass={buttonClasses({
        variant: 'ghost',
        size: 'xs',
        class: cn(
          'min-w-0 max-w-full gap-1 border-0 font-normal',
          props.collapsed ? 'size-6 p-0 touch:size-9' : 'h-auto px-2 py-0.5'
        ),
      })}
      contentClass="menu-surface p-1.5 px-3"
      disabled={!folder()}
      content={
        <div class="min-w-48 max-w-72">
          <div class="mb-1.5 flex items-center gap-2 border-b border-edge pb-1.5 text-ink-muted">
            <FolderIcon class="size-3.5 shrink-0" />
            <span class="text-xs">{t('create.folderLabel')}</span>
          </div>
          <div class="px-2 py-0.5 text-xs leading-5 text-ink-muted wrap-anywhere">
            {fullPath()}
          </div>
        </div>
      }
    >
      <FolderIcon class="size-4 shrink-0 mobile:size-5" />
      <Show when={!props.collapsed}>
        <Show
          when={folder()}
          fallback={
            loading() ? <ListSkeleton.Bar class="h-2 w-10" /> : undefined
          }
        >
          {(data) => (
            <div class="truncate">
              {truncatedPath(data().path, MAX_PATH_LENGTH)}
            </div>
          )}
        </Show>
      </Show>
    </HoverCard>
  );
}
