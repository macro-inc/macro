import { MobileDiscussion } from '@app/components/discussion/mobile-discussion';
import { useTouchTopBarsFloat } from '@app/components/view-shell';
import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import type { ComposeTaskProps } from '@app/features/task-composer/core/types';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { useNavigate } from '@app/lib/split-router';
import { usePending } from '@app/observability/flow';
import {
  projectDetailRoute,
  projectTaskRoute,
  tasksSplitRoute,
} from '@app/routes/routes';
import { useSplitHeaderScope } from '@components/app/SplitHeaderScope';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  useSplitDisplayName,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { enableTimeTracking } from '@core/constant/featureFlags';
import { createOpenTracker } from '@core/internal/open-tracker';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, Match, Show, Suspense, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
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
  type ProjectDetail as ProjectDetailData,
  type ProjectSection,
  projectSections,
  shownProjectSection,
} from './core/project';
import type { ProjectRoute } from './core/route';
import { NewProjectTaskPill } from './new-project-task';
import { openProjectTask } from './open-project-task';
import {
  ProjectBreadcrumbItem,
  type ProjectBreadcrumbProps,
} from './project-breadcrumb';
import { ProjectDiscussion } from './project-collaboration';
import { ProjectDescription } from './project-description';
import { useProjectShareModal } from './project-share';
import { ProjectUnavailable } from './project-unavailable';
import { Projects } from './projects';
import { MobileProjectDetailHeader } from './views/mobile/project-detail-header';
import { MobileProjectWorkspace } from './views/mobile/project-workspace';
import { ProjectDetailHeader } from './views/project-detail-header';
import { ProjectWorkspace } from './views/project-workspace';

export type ProjectDetailHeaderProps = {
  source: ProjectSource;
  commands: ReturnType<ProjectsContext['createCommands']>;
  sections: readonly ProjectSection[];
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
/** Register project commands without replacing the task list's own commands. */
function ProjectEntityCommands(props: {
  projectId: string;
  project: Accessor<ProjectDetailData | undefined>;
  scopeId: string;
}) {
  useBlockEntityCommands({
    id: props.projectId,
    scopeId: props.scopeId,
    resolveEntity: () => {
      const project = props.project();
      if (!project) return undefined;
      return {
        type: 'initiative',
        id: project.id,
        name: project.name,
        ownerId: project.ownerId,
        appearance: project.appearance,
      };
    },
  });
  return null;
}

function ProjectDetailHost(props: ProjectDetailProps) {
  const context = useProjectsContext();
  const source = context.createProjectSource(() => props.route.id);
  usePending('project.detail', source.loading);
  createOpenTracker('initiative', () => source.project()?.id);
  useSplitDisplayName(
    () => source.project()?.name ?? t('tabs.projectFallbackName')
  );
  const commands = context.createCommands();
  const openShare = useProjectShareModal(source.project, commands);
  const barFloats = useTouchTopBarsFloat();
  const hostedHeader = useSplitHeaderScope();
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const navigate = useNavigate();
  const timeFlag = useFeatureFlag(enableTimeTracking);
  const sections = () => projectSections(timeFlag().enabled);
  const shownSection = () =>
    shownProjectSection(props.route.section, timeFlag());
  const section = (section: ProjectSection) => {
    if (props.onSectionChange) return props.onSectionChange(section);
    // Router navigation pushes history and records the navigation interaction.
    fireAndForget(
      navigate({
        route: projectDetailRoute,
        params: { projectId: props.route.id, section },
      }),
      'project-detail'
    );
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
        onSuccess: () => {
          if (!isMobile()) section('tasks');
        },
      },
    });
  };
  const canCreateTask = () => {
    const project = source.project();
    return project !== undefined && canEditProject(project);
  };
  const header: ProjectDetailHeaderProps = {
    source,
    commands,
    get sections() {
      return sections();
    },
    get section() {
      return shownSection();
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
      {/* Phones own one combined task menu in their one-page workspace.
          Tablets still need creation from Overview, outside the task list. */}
      <Show
        when={isTouchDevice() && !isMobile() && shownSection() === 'overview'}
      >
        <NewProjectTaskPill
          onCreateTask={canCreateTask() ? createTask : undefined}
        />
      </Show>
      {/* The one-page phone view always mounts task-row commands. Keep their
          shared scope intact; only a separate Overview registers the project. */}
      <Show
        when={
          !isMobile() && shownSection() === 'overview'
            ? source.project()?.id
            : undefined
        }
        keyed
      >
        {(projectId) => (
          <ProjectEntityCommands
            projectId={projectId}
            project={source.project}
            scopeId={panel.splitHotkeyScope}
          />
        )}
      </Show>
      <Show when={props.breadcrumb}>
        {(breadcrumb) => (
          <ProjectBreadcrumbItem {...breadcrumb()} project={source.project()} />
        )}
      </Show>
      <Show
        when={isTouchDevice()}
        fallback={<ProjectDetailHeader {...header} />}
      >
        <MobileProjectDetailHeader {...header} />
      </Show>
      <div
        class="relative min-h-0 min-w-0 flex-1"
        classList={{
          'touch:[--mobile-content-inset-top:0px]':
            !isMobile() || (!!hostedHeader && !barFloats()),
        }}
      >
        <Suspense
          fallback={<ProjectContentSkeleton section={shownSection()} />}
        >
          <Switch>
            <Match when={source.loading() && !source.project()}>
              <ProjectContentSkeleton section={shownSection()} />
            </Match>
            <Match when={source.project()}>
              {(project) => (
                <Dynamic
                  component={
                    isMobile() ? MobileProjectWorkspace : ProjectWorkspace
                  }
                  project={project()}
                  source={source}
                  commands={commands}
                  section={shownSection()}
                  onOpenTask={(task, options) =>
                    openProjectTask(task.id, options, {
                      touch: isTouchDevice(),
                      showInProject: (taskId) =>
                        fireAndForget(
                          navigate({
                            route: projectTaskRoute,
                            params: {
                              projectId: props.route.id,
                              section: shownSection(),
                              taskId,
                            },
                          }),
                          'project-detail'
                        ),
                      openInSplit: (content, splitOptions) =>
                        layout.openWithSplit(content, splitOptions),
                    })
                  }
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
                      children={
                        isMobile()
                          ? (conversation) => (
                              <MobileDiscussion
                                conversation={conversation}
                                parent={{
                                  type: 'initiative',
                                  id: project().id,
                                }}
                                canWrite={canDiscussProject(project())}
                              />
                            )
                          : undefined
                      }
                    />
                  }
                />
              )}
            </Match>
            <Match when={true}>
              <ProjectUnavailable
                projectId={props.route.id}
                section={shownSection()}
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
