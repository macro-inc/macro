import { EntityDetailTopBar } from '@app/components/entity-detail/EntityDetailTopBar';
import { ViewBreadcrumbs } from '@app/components/view-shell';
import {
  projectDetailRoute,
  projectTaskRoute,
  tasksSplitRoute,
} from '@app/features/tasks-view/route';
import { useNavigate } from '@app/lib/split-router';
import type { ComposeTaskProps } from '@block-md/component/ComposeTask';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { getPermissions } from '@core/component/SharePermissions';
import { TabsInset } from '@core/component/TabsInset';
import { toast } from '@core/component/Toast/Toast';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName, tryMacroId } from '@core/user';
import StackIcon from '@phosphor/stack.svg';
import { Button } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { ProjectCollaborators } from './components/project-collaborators';
import {
  type ProjectsContext,
  useProjectsContext,
} from './context/projects-context';
import {
  canDiscussProject,
  canEditProject,
  type ProjectDetail as ProjectDetailData,
  type ProjectSection,
} from './core/project';
import type { ProjectRoute } from './core/route';
import { ProjectDiscussion } from './project-collaboration';
import { ProjectDescription } from './project-description';
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

const userName = (id: string) => getDisplayName(tryMacroId(id));

/** The standard Share menu; collaborators are the project's direct grants. */
function ProjectShareTrigger(props: {
  project: ProjectDetailData;
  commands: ReturnType<ProjectsContext['createCommands']>;
}) {
  const panel = useSplitPanelOrThrow();
  const setMembers = async (ids: string[]) => {
    try {
      await props.commands.setMembers(props.project.id, ids);
    } catch (error) {
      toast.failure('Could not update collaborators', {
        subtext: 'Please try again',
      });
      throw error;
    }
  };
  // Stable, so the open dialog keeps the picker's draft across refreshes.
  const Collaborators = () => (
    <ProjectCollaborators
      project={props.project}
      getUserName={userName}
      pending={props.commands.pending()}
      onMembers={setMembers}
    />
  );
  const openShare = useShareModal(() => ({
    id: props.project.id,
    blockAlias: 'initiative',
    itemType: 'initiative',
    name: props.project.name,
    owner: props.project.ownerId,
    userPermissions: getPermissions(props.project.access),
    people: Collaborators,
    hasDirectShares: props.project.memberIds.some(
      (id) => id !== props.project.ownerId
    ),
  }));
  return (
    <ShareTrigger
      onClick={openShare}
      id={props.project.id}
      blockType="initiative"
      hotkeyScope={panel.splitHotkeyScope}
    />
  );
}

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
    const projectId = props.route.id;
    layout.popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: {
        createTask: (
          ...args: Parameters<NonNullable<ComposeTaskProps['createTask']>>
        ) => commands.createTask(projectId, ...args),
        onSuccess: () => section('tasks'),
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
