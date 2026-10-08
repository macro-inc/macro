import { EntityDetailTopBar } from '@app/components/entity-detail/EntityDetailTopBar';
import { ViewBreadcrumbs } from '@app/components/view-shell';
import {
  makeCopyEntityIdAction,
  makeCopyLinkAction,
} from '@app/features/next-soup/actions';
import { useNavigate } from '@app/lib/split-router';
import {
  projectDetailRoute,
  projectTaskRoute,
  tasksSplitRoute,
} from '@app/routes/routes';
import { globalSplitManager } from '@app/signal/splitLayout';
import type { ComposeTaskProps } from '@block-md/component/ComposeTask';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  useSplitDisplayName,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { TabsInset } from '@core/component/TabsInset';
import { toast } from '@core/component/Toast/Toast';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import StackIcon from '@phosphor/stack.svg';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import { Button } from '@ui';
import { createSignal, Match, Show, Suspense, Switch } from 'solid-js';
import { DeleteProjectsDialog } from './components/delete-projects-dialog';
import { ProjectMenuDropdown } from './components/project-row-menu';
import { ProjectContentSkeleton } from './components/project-skeletons';
import { RenameProjectDialog } from './components/rename-project-dialog';
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
} from './core/project';
import { type ProjectRoute, projectRouteId } from './core/route';
import { openProject } from './open-project';
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

function ProjectTitleMenu(props: {
  project: ProjectDetailData;
  source: ProjectSource;
  commands: ReturnType<ProjectsContext['createCommands']>;
  section: ProjectSection;
  onShare(): void;
  onDelete(): void;
}) {
  const definitions = useProjectsContext().createPropertyDefinitionsSource();
  const layout = useSplitLayout();
  const copyLink = makeCopyLinkAction();
  const copyId = makeCopyEntityIdAction();
  const [renaming, setRenaming] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const definition = (id: string) =>
    definitions
      .properties()
      .find((property) => property.propertyDefinitionId === id);
  const ownValue = (property: Property) =>
    props.source
      .properties()
      .find(
        (current) =>
          current.propertyDefinitionId === property.propertyDefinitionId
      ) ?? property;
  const setOption = async (property: Property, optionId: string) => {
    try {
      await props.commands.saveProperty(props.project.id, ownValue(property), {
        valueType: 'SELECT_STRING',
        values: [optionId],
      });
    } catch (error) {
      console.error('Failed to update project', error);
      toast.failure(`Could not update ${property.displayName.toLowerCase()}`);
    }
  };
  const deleteProject = async () => {
    setError(undefined);
    try {
      await props.commands.delete(props.project.id);
      props.onDelete();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not delete project.'
      );
    }
  };
  return (
    <>
      <ProjectMenuDropdown
        targets={() => [
          { project: props.project, properties: props.source.properties() },
        ]}
        status={definition(SYSTEM_PROPERTY_IDS.STATUS)}
        priority={definition(SYSTEM_PROPERTY_IDS.PRIORITY)}
        canOpenInNewSplit={globalSplitManager()?.canAppendSplit() ?? false}
        onOpenInNewSplit={(row) =>
          openProject(layout, row.project.id, {
            section: props.section,
            newSplit: true,
          })
        }
        onRename={() => setRenaming(true)}
        onSetOption={(_, property, optionId) =>
          void setOption(property, optionId)
        }
        onCopyLink={(row) =>
          void copyLink.executeByBlock(
            projectRouteId({ id: row.project.id, section: 'overview' }),
            'component'
          )
        }
        onCopyId={(row) => void copyId.executeById(row.project.id)}
        onShare={props.onShare}
        onDelete={() => {
          setError(undefined);
          setDeleting(true);
        }}
      />
      <Show when={renaming()}>
        <RenameProjectDialog
          name={props.project.name}
          onOpenChange={setRenaming}
          onRename={(name) => props.commands.rename(props.project.id, name)}
        />
      </Show>
      <Show when={deleting()}>
        <DeleteProjectsDialog
          count={1}
          pending={props.commands.pending()}
          error={error()}
          onOpenChange={setDeleting}
          onDelete={() => void deleteProject()}
        />
      </Show>
    </>
  );
}

function ProjectDetailHost(props: ProjectDetailProps) {
  const context = useProjectsContext();
  const source = context.createProjectSource(() => props.route.id);
  useSplitDisplayName(() => source.project()?.name ?? 'Project');
  const commands = context.createCommands();
  const openShare = useProjectShareModal(source.project, commands);
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const navigate = useNavigate();
  const section = (section: ProjectSection) =>
    navigate({
      route: projectDetailRoute,
      params: { projectId: props.route.id, section },
    });
  const createTask = (dueDate?: Date) => {
    const projectId = props.route.id;
    layout.popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: {
        createTask: (
          ...args: Parameters<NonNullable<ComposeTaskProps['createTask']>>
        ) => commands.createTask(projectId, ...args),
        initialProjectId: projectId,
        initialDueDate: dueDate,
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
        titleMenu={
          <Show when={source.project()}>
            {(project) => (
              <ProjectTitleMenu
                project={project()}
                source={source}
                commands={commands}
                section={props.route.section}
                onShare={openShare}
                onDelete={
                  props.onDelete ??
                  (() => navigate({ route: tasksSplitRoute, params: {} }))
                }
              />
            )}
          </Show>
        }
        navigation={
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
        }
      >
        <Show when={source.project()}>
          {(project) => (
            <ShareTrigger
              onClick={openShare}
              id={project().id}
              blockType="initiative"
              hotkeyScope={panel.splitHotkeyScope}
            />
          )}
        </Show>
      </EntityDetailTopBar>
      <div class="relative min-h-0 min-w-0 flex-1">
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
                      projectId={project().id}
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
