import { Show, Suspense } from 'solid-js';
import { Tooltip } from '@core/component/Tooltip';
import type { ProjectEntity, ProjectContainedEntity } from '../types/entity';
import { useProjectPreviewQuery } from '@queries/storage/project-preview';
import { truncatedPath } from '../utils/path';
import FolderIcon from '@icon/regular/folder-simple.svg';
import { cn } from '@ui';

const MAX_PATH_LENGTH = 30;

function Path(props: { path: string[] }) {
  const fullPath = () => props.path.join('/');
  const displayPath = () => {
    return truncatedPath(props.path, MAX_PATH_LENGTH);
  };
  const truncated = () => displayPath().length < fullPath().length;

  return (
    <Tooltip tooltip={fullPath()} hide={!truncated()}>
      <div class="truncate">{displayPath()}</div>
    </Tooltip>
  );
}

export function ProjectBreadCrumb(props: {
  entity: ProjectContainedEntity;
  onClick?: (entity: ProjectEntity, event: MouseEvent) => void;
}) {
  const projectQuery = useProjectPreviewQuery(() => props.entity.projectId);

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
    <a
      onClick={handleClick}
      class={cn('flex gap-1 items-center min-w-0 cursor-default', {
        'hover:text-accent': projectQuery.isSuccess,
      })}
    >
      <FolderIcon class="size-[1em]" />
      <Suspense
        fallback={<div class="h-1 w-10 bg-ink-placeholder/20 animate-pulse" />}
      >
        <Show when={projectQuery.data}>
          {(data) => <Path path={data().path} />}
        </Show>
      </Suspense>
    </a>
  );
}
