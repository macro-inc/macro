import { ViewBreadcrumbs } from '@app/components/view-shell';
import type { ComposeTaskProps } from '@app/features/task-composer/core/types';
import { useNavigate } from '@app/lib/split-router';
import { usePending } from '@app/observability/flow';
import {
  projectDetailRoute,
  projectTaskRoute,
  tasksSplitRoute,
} from '@app/routes/routes';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  useSplitDisplayName,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { EntityIcon } from '@core/component/EntityIcon';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { Match, Show, Suspense, Switch } from 'solid-js';
import type { TaskCreateOptions } from '../tasks-view/types';
import { ProjectContentSkeleton } from './components/project-skeletons';
import {
  type ProjectSource,
  type ProjectsContext,
  useProjectsContext,
} from './context/projects-context';
import {
  canDiscussProject,
  canEditProject,
  type ProjectSection,
} from './core/project';
import type { ProjectRoute } from './core/route';
import { ProjectDiscussion } from './project-collaboration';
import { ProjectDescription } from './project-description';
import { useProjectShareModal } from './project-share';
import { ProjectUnavailable } from './project-unavailable';
import { Projects } from './projects';
import { MobileProjectDetailHeader } from './views/mobile/project-detail-header';
import { ProjectDetailHeader } from './views/project-detail-header';
import { ProjectWorkspace } from './views/project-workspace';

type ProjectBreadcrumbProps = {
  entry: {
    value: string;
    data: { type: 'initiative'; id: string; fallbackName?: string };
  };
  order: number;
};

function ProjectBreadcrumbContent(props: ProjectBreadcrumbProps) {
  const source = useProjectsContext().createProjectSource(
    () => props.entry.data.id
  );
  const name = () =>
    source.project()?.name ?? props.entry.data.fallbackName ?? 'Project';
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
              appearance={source.project()?.appearance}
              size="xs"
            />
            <span class="truncate">{name()}</span>
          </ViewBreadcrumbs.Button>
        </div>
      )}
    </ViewBreadcrumbs.Item>
  );
}

export function ProjectBreadcrumb(props: ProjectBreadcrumbProps) {
  return (
    <Projects>
      <ProjectBreadcrumbContent {...props} />
    </Projects>
  );
}

export type ProjectDetailHeaderProps = {
  source: ProjectSource;
  commands: ReturnType<ProjectsContext['createCommands']>;
  section: ProjectSection;
  onSectionChange(section: ProjectSection): void;
  onShare(): void;
  onDelete(): void;
  hotkeyScope: string;
};

type ProjectDetailProps = {
  route: ProjectRoute;
  navigationRequest?: number;
  breadcrumb?: ProjectBreadcrumbProps;
  onDelete?(): void;
  onSectionChange?(section: ProjectSection): void;
};
function ProjectDetailHost(props: ProjectDetailProps) {
  const context = useProjectsContext();
  const source = context.createProjectSource(() => props.route.id);
  usePending('project.detail', source.loading);
  useSplitDisplayName(() => source.project()?.name ?? 'Project');
  const commands = context.createCommands();
  const openShare = useProjectShareModal(source.project, commands);
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const navigate = useNavigate();
  const section = (section: ProjectSection) => {
    if (props.onSectionChange) return props.onSectionChange(section);
    return navigate({
      route: projectDetailRoute,
      params: { projectId: props.route.id, section },
    });
  };
  const createTask = (options?: TaskCreateOptions) => {
    const projectId = props.route.id;
    layout.popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: {
        createTask: (
          ...args: Parameters<NonNullable<ComposeTaskProps['createTask']>>
        ) => commands.createTask(projectId, ...args),
        initialProjectId: projectId,
        initialDueDate: options?.dueDate,
        composerContext: options?.composerContext,
        onSuccess: () => section('tasks'),
      },
    });
  };
  const header: ProjectDetailHeaderProps = {
    source,
    commands,
    get section() {
      return props.route.section;
    },
    onSectionChange: section,
    onShare: openShare,
    onDelete:
      props.onDelete ??
      (() => navigate({ route: tasksSplitRoute, params: {} })),
    hotkeyScope: panel.splitHotkeyScope,
  };
  return (
    <>
      <Show when={props.breadcrumb}>
        {(breadcrumb) => <ProjectBreadcrumbContent {...breadcrumb()} />}
      </Show>
      <Show
        when={isTouchDevice()}
        fallback={<ProjectDetailHeader {...header} />}
      >
        <MobileProjectDetailHeader {...header} />
      </Show>
      <div class="relative min-h-0 min-w-0 flex-1 touch:[--mobile-content-inset-top:0px]">
        <Suspense
          fallback={<ProjectContentSkeleton section={props.route.section} />}
        >
          <Switch>
            <Match when={source.loading() && !source.project()}>
              <ProjectContentSkeleton section={props.route.section} />
            </Match>
            <Match when={source.project()}>
              {(project) => (
                <ProjectWorkspace
                  project={project()}
                  source={source}
                  commands={commands}
                  section={props.route.section}
                  onOpenTask={(task, options) => {
                    const event = options?.event;
                    if (
                      !isTouchDevice() &&
                      !(
                        event?.shiftKey ||
                        event?.metaKey ||
                        event?.ctrlKey ||
                        event?.altKey
                      )
                    ) {
                      fireAndForget(
                        navigate({
                          route: projectTaskRoute,
                          params: {
                            projectId: props.route.id,
                            section: props.route.section,
                            taskId: task.id,
                          },
                        }),
                        'project-detail'
                      );
                      return true;
                    }
                    layout.openWithSplit(
                      { type: 'md', id: task.id },
                      { preferNewSplit: options?.event?.shiftKey }
                    );
                    return true;
                  }}
                  onCreateTask={createTask}
                  description={
                    <ProjectDescription
                      projectId={project().id}
                      canEdit={canEditProject(project())}
                    />
                  }
                  discussion={
                    <ProjectDiscussion
                      projectId={project().id}
                      canWrite={canDiscussProject(project())}
                      targetId={props.route.discussionId}
                      targetRequestKey={props.navigationRequest}
                    />
                  }
                />
              )}
            </Match>
            <Match when={true}>
              <ProjectUnavailable
                projectId={props.route.id}
                section={props.route.section}
                onRetry={source.refresh}
              />
            </Match>
          </Switch>
        </Suspense>
      </div>
    </>
  );
}

export function ProjectDetail(props: ProjectDetailProps) {
  return (
    <Projects>
      <ProjectDetailHost {...props} />
    </Projects>
  );
}
