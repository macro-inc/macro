import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import FolderIcon from '@icon/system/regular/folder-simple.svg';
import { useProjectPreviewQuery } from '@queries/storage/project-preview';
import { buttonClasses, cn, HoverCard } from '@ui';
import { Show, Suspense } from 'solid-js';
import type { ProjectContainedEntity, ProjectEntity } from '../types/entity';
import { truncatedPath } from '../utils/path';

const MAX_PATH_LENGTH = 30;

export function ProjectBreadCrumb(props: {
  entity: ProjectContainedEntity;
  onClick?: (entity: ProjectEntity, event: MouseEvent) => void;
  collapsed?: boolean;
}) {
  const projectQuery = useProjectPreviewQuery(() => props.entity.projectId);
  const fullPath = () =>
    projectQuery.data?.path.join('/') || projectQuery.data?.name;

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    if (!projectQuery.isSuccess) return;
    e.stopPropagation();

    const data = projectQuery.data;
    const projectEntity: ProjectEntity = {
      type: 'project',
      id: data.id,
      name: data.name,
      ownerId: data.owner,
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
          'min-w-0 max-w-full gap-1 border-0 font-normal text-link not-data-disabled:hover:text-link-hover not-data-disabled:active:text-link-hover popup-open:text-link-hover',
          props.collapsed ? 'size-6 p-0 touch:size-9' : 'h-auto px-2 py-0.5'
        ),
      })}
      contentClass="menu-surface p-1.5 px-3"
      disabled={!projectQuery.isSuccess}
      content={
        <div class="min-w-48 max-w-72">
          <div class="mb-1.5 flex items-center gap-2 border-b border-edge pb-1.5 text-ink-muted">
            <FolderIcon class="size-3.5 shrink-0 text-link" />
            <span class="text-xs">{t('create.folderLabel')}</span>
          </div>
          <div class="px-2 py-0.5 text-xs leading-5 text-ink-muted wrap-anywhere">
            {fullPath()}
          </div>
        </div>
      }
    >
      <FolderIcon class="size-[1em] shrink-0" />
      <Show when={!props.collapsed}>
        <Suspense fallback={<ListSkeleton.Bar class="h-2 w-10" />}>
          <Show when={projectQuery.data}>
            {(data) => (
              <div class="truncate">
                {truncatedPath(data().path, MAX_PATH_LENGTH)}
              </div>
            )}
          </Show>
        </Suspense>
      </Show>
    </HoverCard>
  );
}
