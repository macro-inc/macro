import { ViewBreadcrumbs } from '@app/components/view-shell';
import { EntityIcon } from '@core/component/EntityIcon';
import { useProjectsContext } from './context/projects-context';
import type { ProjectIdentity } from './core/project';
import { Projects } from './projects';

export type ProjectBreadcrumbProps = {
  entry: {
    value: string;
    data: { type: 'initiative'; id: string; fallbackName?: string };
  };
  order: number;
};

export function ProjectBreadcrumbItem(
  props: ProjectBreadcrumbProps & {
    project: Pick<ProjectIdentity, 'name' | 'appearance'> | undefined;
  }
) {
  const name = () =>
    props.project?.name ?? props.entry.data.fallbackName ?? 'Project';
  return (
    <ViewBreadcrumbs.Item
      value={props.entry.value}
      metadata={props.entry.data}
      order={props.order}
    >
      {(item) => (
        <div class="flex min-w-0 items-center">
          <ViewBreadcrumbs.Button
            class="gap-1.5"
            isActive={item.isActive()}
            onClick={item.onSelect}
            tooltip={name()}
          >
            <EntityIcon
              targetType="initiative"
              appearance={props.project?.appearance}
              size="xs"
            />
            <span class="truncate">{name()}</span>
          </ViewBreadcrumbs.Button>
        </div>
      )}
    </ViewBreadcrumbs.Item>
  );
}

/**
 * A route's breadcrumb, mounted beside whichever project view the route shows.
 * It reads only the name and icon, so the project's full read stays the view's.
 */
export function ProjectBreadcrumb(props: ProjectBreadcrumbProps) {
  return (
    <Projects>
      <ProjectRouteBreadcrumb {...props} />
    </Projects>
  );
}

function ProjectRouteBreadcrumb(props: ProjectBreadcrumbProps) {
  const identity = useProjectsContext().createProjectIdentitySource(
    () => props.entry.data.id
  );
  return <ProjectBreadcrumbItem {...props} project={identity.project()} />;
}
