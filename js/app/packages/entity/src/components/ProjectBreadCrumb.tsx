import FolderIcon from '@icon/regular/folder-simple.svg';
import { useProjectPreviewQuery } from '@queries/storage/project-preview';
import { cn, Tooltip } from '@ui';
import { Show, Suspense } from 'solid-js';
import type { ProjectContainedEntity, ProjectEntity } from '../types/entity';
import { truncatedPath } from '../utils/path';

const MAX_PATH_LENGTH = 30;

function Path(props: { path: string[] }) {
  const fullPath = () => props.path.join('/');
  const displayPath = () => {
    return truncatedPath(props.path, MAX_PATH_LENGTH);
  };
  const truncated = () => displayPath().length < fullPath().length;

  return (
    <Show
      when={truncated()}
      fallback={<div class="truncate">{displayPath()}</div>}
    >
      <Tooltip label={fullPath()}>
        <div class="truncate">{displayPath()}</div>
      </Tooltip>
    </Show>
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
        fallback={<div class="h-1 w-10 bg-ink-placeholder animate-pulse" />}
      >
        <Show when={projectQuery.data}>
          {(data) => <Path path={data().path} />}
        </Show>
      </Suspense>
    </a>
  );
}
