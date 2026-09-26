import { EntityDetailTopBar } from '@app/components/entity-detail/EntityDetailTopBar';
import { ViewBreadcrumbs } from '@app/components/view-shell';
import {
  projectDetailRoute,
  projectTaskRoute,
  tasksSplitRoute,
} from '@app/features/tasks-view/route';
import { useNavigate } from '@app/lib/split-router';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName, tryMacroId } from '@core/user';
import { buildSimpleEntityUrl } from '@core/util/url';
import StackIcon from '@phosphor/stack.svg';
import { Button, Tabs } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { useProjectsContext } from './context/projects-context';
import {
  canDiscussProject,
  canEditProject,
  type ProjectSection,
} from './core/project';
import { type ProjectRoute, projectRouteId } from './core/route';
import { createProjectTaskComposerCallbacks } from './primitives/project-task-composer';
import { ProjectDiscussion } from './project-collaboration';
import { ProjectDescription } from './project-description';
import { ProjectShareHost } from './project-share-host';
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

function ProjectDetailHost(props: ProjectDetailProps) {
  const context = useProjectsContext();
  const source = context.createProjectSource(() => props.route.id);
  const commands = context.createCommands();
  const layout = useSplitLayout();
  const navigate = useNavigate();
  const section = (section: ProjectSection) =>
    navigate({
      route: projectDetailRoute,
      params: { projectId: props.route.id, section },
    });
  const createTask = () => {
    const callbacks = createProjectTaskComposerCallbacks({
      projectId: props.route.id,
      assignTasks: commands.assignTasks,
      openProjectTasks: () => section('tasks'),
      reportFailure: toast.failure,
    });
    layout.popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: callbacks,
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
            <Tabs
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
            <ProjectShareHost
              project={project()}
              url={buildSimpleEntityUrl({
                type: 'component',
                id: projectRouteId(props.route),
              })}
              pending={commands.pending()}
              getUserName={(id) => getDisplayName(tryMacroId(id))}
              onShare={(patch) => commands.share(props.route.id, patch)}
              onMembers={(ids) => commands.setMembers(props.route.id, ids)}
            />
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
