import { SidePanel } from '@components/app/side-panel';
import { EntityMetadata } from '@components/app/side-panel/EntityMetadata';
import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import { PropertyValuePill } from '@property/component/PropertyValuePill';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { EntityPropertiesSection } from '@property/side-panel/properties/EntityPropertiesSection';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import {
  type ProjectSource,
  type ProjectsContext,
  useProjectsContext,
} from '../context/projects-context';
import {
  canEditProject,
  type ProjectDetail,
  type ProjectSection,
} from '../core/project';
import { AddProjectTasks } from './add-project-tasks';
import {
  ProjectTasksList,
  type ProjectTasksListProps,
} from './project-tasks-list';

const PROJECT_PROPERTY_ORDER = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
];

/** Native project content inside the same detail layout used by tasks. */
export function ProjectWorkspace(props: {
  project: ProjectDetail;
  source: ProjectSource;
  commands: ReturnType<ProjectsContext['createCommands']>;
  section: ProjectSection;
  onOpenTask: ProjectTasksListProps['onOpenTask'];
  onCreateTask(): void;
  discussion: JSX.Element;
  description: JSX.Element;
}) {
  const definitions = useProjectsContext().createPropertyDefinitionsSource();
  const [error, setError] = createSignal<string>();
  const canEdit = () => canEditProject(props.project);
  const run = async (action: () => Promise<void>) => {
    setError(undefined);
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not save project.'
      );
    }
  };

  return (
    <SidePanel.Layout headerToggle={false} floating defaultOpen={false}>
      <SidePanel.Footer>
        <EntityMetadata
          ownerId={props.project.ownerId}
          createdAt={props.project.createdAt}
          updatedAt={props.project.updatedAt}
        />
      </SidePanel.Footer>
      <SidePanel.Section
        id="properties"
        title="Properties"
        defaultOpen
        order={1}
      >
        <Show when={props.project.id} keyed>
          {(projectId) => (
            <EntityPropertiesSection
              entityId={projectId}
              entityType="INITIATIVE"
              canEdit={canEdit()}
              documentName={props.project.name}
              showTags={false}
              defaultProperties={() => [...definitions.properties()]}
              requiredPropertyDefinitionIds={PROJECT_PROPERTY_ORDER}
              pinnedPropertyDefinitionOrder={PROJECT_PROPERTY_ORDER}
              onPropertiesChanged={props.source.refresh}
            />
          )}
        </Show>
      </SidePanel.Section>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <Show when={error()}>
          {(message) => (
            <p role="alert" class="px-6 py-2 text-sm text-failure">
              {message()}
            </p>
          )}
        </Show>
        <Show when={props.source.error()}>
          <p role="status" class="px-6 py-2 text-sm text-ink-muted">
            Could not refresh this project.
          </p>
        </Show>
        <div class="min-h-0 flex-1">
          <Switch>
            <Match when={props.section === 'overview'}>
              <div class="h-full overflow-y-auto px-6 pb-8 pt-12 touch:pt-6">
                <div class="mx-auto max-w-3xl">
                  <Show
                    when={canEdit()}
                    fallback={
                      <h1 class="text-2xl font-semibold">
                        {props.project.name}
                      </h1>
                    }
                  >
                    <InlineTitleEditor
                      value={props.project.name}
                      placeholder="Project name"
                      ariaLabel="Project name"
                      class="w-full text-2xl"
                      onRename={(name) =>
                        void run(() =>
                          props.commands.rename(props.project.id, name)
                        )
                      }
                    />
                  </Show>
                  <div
                    class="mb-6 mt-3 flex flex-wrap items-center gap-2"
                    aria-label="Project properties"
                  >
                    <For each={props.source.properties()}>
                      {(property) => (
                        <PropertyValuePill
                          property={property}
                          canEdit={canEdit()}
                          onSave={(property, value) =>
                            props.commands.saveProperty(
                              props.project.id,
                              property,
                              value
                            )
                          }
                          onRefresh={props.source.refresh}
                          entitySelfFilter={{
                            blockId: props.project.id,
                            entityType: 'INITIATIVE',
                          }}
                        />
                      )}
                    </For>
                  </div>
                  <div aria-label="Project description">
                    {props.description}
                  </div>
                  {props.discussion}
                </div>
              </div>
            </Match>
            <Match when={props.section === 'tasks'}>
              <ProjectTasksList
                projectId={props.project.id}
                onOpenTask={props.onOpenTask}
                onCreateTask={canEdit() ? props.onCreateTask : undefined}
                addTasksAction={
                  <Show when={canEdit()}>
                    <AddProjectTasks project={props.project} />
                  </Show>
                }
              />
            </Match>
          </Switch>
        </div>
      </div>
    </SidePanel.Layout>
  );
}
