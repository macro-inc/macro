import { EntityDetailTopBar } from '@app/components/entity-detail/EntityDetailTopBar';
import { ViewBreadcrumbs } from '@app/components/view-shell';
import {
  type DestinationTaskComposer,
  registerCreateDestination,
} from '@app/features/command/create-destination';
import { useNavigate } from '@app/lib/split-router';
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
import { TabsInset } from '@core/component/TabsInset';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import StackIcon from '@phosphor/stack.svg';
import { Button } from '@ui';
import { Match, onCleanup, Show, Switch } from 'solid-js';
import { ProjectComposerChip } from './components/project-chip';
import {
  type ProjectsContext,
  useProjectsContext,
} from './context/projects-context';
import {
  canDiscussProject,
  canEditProject,
  type ProjectDetail as ProjectDetailData,
  type ProjectSection,
  projectDisplayName,
} from './core/project';
import type { ProjectRoute } from './core/route';
import { createProjectDestination } from './primitives/project-destination';
import { ProjectDiscussion } from './project-collaboration';
import { ProjectDescription } from './project-description';
import { useProjectShareModal } from './project-share';
import { Projects } from './projects';
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
        <ViewBreadcrumbs.Button
          class="gap-1.5"
          isActive={item.isActive()}
          onClick={item.onSelect}
          tooltip={name()}
        >
          <StackIcon class="size-3 shrink-0" />
          <span class="truncate">{name()}</span>
        </ViewBreadcrumbs.Button>
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

type ProjectDetailProps = {
  route: ProjectRoute;
  breadcrumb?: ProjectBreadcrumbProps;
  onDelete?(): void;
};

function ProjectShareTrigger(props: {
  project: ProjectDetailData;
  commands: ReturnType<ProjectsContext['createCommands']>;
}) {
  const panel = useSplitPanelOrThrow();
  const openShare = useProjectShareModal(() => props.project, props.commands);
  return (
    <ShareTrigger
      onClick={openShare}
      id={props.project.id}
      blockType="initiative"
      hotkeyScope={panel.splitHotkeyScope}
    />
  );
}

type CreateProjectTask = ReturnType<
  ProjectsContext['createCommands']
>['createTask'];

/** Task composer props that add the new task to the project and say so. */
function projectTaskComposer(
  project: ProjectDetailData,
  createTask: CreateProjectTask
): DestinationTaskComposer {
  const name = projectDisplayName(project);
  return {
    createTask: (...args) => createTask(project.id, ...args),
    leadingChip: () => <ProjectComposerChip name={name} />,
  };
}

function ProjectCreateDestinationHost(props: { projectId: string }) {
  const context = useProjectsContext();
  const source = context.createProjectSource(() => props.projectId);
  const { createTask } = context.createCommands();
  const panel = useSplitPanelOrThrow();
  onCleanup(
    registerCreateDestination(
      panel.handle.id,
      createProjectDestination(source.project, (project) =>
        projectTaskComposer(project, createTask)
      )
    )
  );
  return null;
}

/**
 * Scopes the create menu's Task (`c` then `t`) to this project for as long as
 * its route is open in the split, including a task opened from the project.
 */
export function ProjectCreateDestination(props: { projectId: string }) {
  return (
    <Projects>
      <ProjectCreateDestinationHost projectId={props.projectId} />
    </Projects>
  );
}

function ProjectDetailHost(props: ProjectDetailProps) {
  const context = useProjectsContext();
  const source = context.createProjectSource(() => props.route.id);
  useSplitDisplayName(() => source.project()?.name ?? 'Project');
  const commands = context.createCommands();
  const layout = useSplitLayout();
  const navigate = useNavigate();
  const section = (section: ProjectSection) =>
    navigate({
      route: projectDetailRoute,
      params: { projectId: props.route.id, section },
    });
  const createTask = () => {
    const project = source.project();
    if (!project) return;
    layout.popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: {
        ...projectTaskComposer(project, commands.createTask),
        // The new row appears in the list this button sits above, so skip the
        // toast. Success lands after the composer has closed, so it must not
        // navigate either: the user may have moved on.
        onSuccess: () => {},
      },
    });
  };
  return (
    <>
      <Show when={props.breadcrumb}>
        {(breadcrumb) => <ProjectBreadcrumbContent {...breadcrumb()} />}
      </Show>
      <EntityDetailTopBar
        navigation={
          <Show when={source.project()}>
            <TabsInset
              list={[
                { value: 'overview', label: 'Overview' },
                { value: 'tasks', label: 'Tasks' },
              ]}
              value={props.route.section}
              onChange={(value) => section(value as ProjectSection)}
              aria-label="Project sections"
              class="shrink-0 whitespace-nowrap"
            />
          </Show>
        }
      >
        <Show when={source.project()}>
          {(project) => (
            <ProjectShareTrigger project={project()} commands={commands} />
          )}
        </Show>
      </EntityDetailTopBar>
      <div class="relative min-h-0 min-w-0 flex-1">
        <Switch>
          <Match when={source.loading() && !source.project()}>
            <p role="status" class="p-6 text-ink-muted">
              Loading project…
            </p>
          </Match>
          <Match when={source.project()}>
            {(project) => (
              <ProjectWorkspace
                project={project()}
                source={source}
                commands={commands}
                section={props.route.section}
                onDelete={
                  props.onDelete ??
                  (() => navigate({ route: tasksSplitRoute, params: {} }))
                }
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
                    navigate({
                      route: projectTaskRoute,
                      params: {
                        projectId: props.route.id,
                        section: props.route.section,
                        taskId: task.id,
                      },
                    });
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
                    documentId={project().descriptionDocumentId}
                    canEdit={canEditProject(project())}
                  />
                }
                discussion={
                  <ProjectDiscussion
                    projectId={project().id}
                    canWrite={canDiscussProject(project())}
                    targetId={props.route.discussionId}
                  />
                }
              />
            )}
          </Match>
          <Match when={true}>
            <div role="alert" class="p-6">
              <p>
                Project unavailable. It may have been deleted, or you may no
                longer have access.
              </p>
              <Button onClick={() => void source.refresh()}>Try again</Button>
            </div>
          </Match>
        </Switch>
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
