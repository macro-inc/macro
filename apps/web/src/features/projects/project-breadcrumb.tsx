import { ViewBreadcrumbs } from '@app/components/view-shell';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { EntityIcon } from '@core/component/EntityIcon';
import { enableEntityAppearance } from '@core/constant/featureFlags';
import { Show } from 'solid-js';
import { EntityAppearanceTrigger } from '../entity-appearance/entity-appearance';
import { useProjectsContext } from './context/projects-context';
import { canEditProject, type ProjectIdentity } from './core/project';
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
    project: ProjectIdentity | undefined;
  }
) {
  const appearanceFlag = useFeatureFlag(enableEntityAppearance);
  const editableProject = () => {
    const project = props.project;
    return project && canEditProject(project) && appearanceFlag().enabled
      ? project
      : undefined;
  };
  const name = () =>
    props.project?.name ??
    props.entry.data.fallbackName ??
    t('tabs.projectFallbackName');
  return (
    <ViewBreadcrumbs.Item
      value={props.entry.value}
      metadata={props.entry.data}
      order={props.order}
    >
      {(item) => (
        <div class="flex min-w-0 items-center">
          <Show when={editableProject()}>
            {(project) => (
              <EntityAppearanceTrigger
                entity={{
                  type: 'initiative',
                  id: project().id,
                  name: project().name,
                  ownerId: project().ownerId,
                  appearance: project().appearance,
                }}
                editable
              />
            )}
          </Show>
          <ViewBreadcrumbs.Button
            class="gap-1.5"
            isActive={item.isActive()}
            onClick={item.onSelect}
            tooltip={name()}
          >
            <Show when={!editableProject()}>
              <EntityIcon
                targetType="initiative"
                appearance={props.project?.appearance}
                size="xs"
              />
            </Show>
            <span class="truncate">{name()}</span>
          </ViewBreadcrumbs.Button>
        </div>
      )}
    </ViewBreadcrumbs.Item>
  );
}

/**
 * A route's breadcrumb, mounted beside whichever project view the route shows.
 * It reads only identity and access, so the project's full read stays the view's.
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
