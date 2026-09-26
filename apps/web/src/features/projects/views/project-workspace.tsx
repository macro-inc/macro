import { SidePanel } from '@components/app/side-panel';
import { EntityDetailsGrid } from '@components/app/side-panel/EntityDetailsGrid';
import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import { PropertyValuePill } from '@property/component/PropertyValuePill';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { EntityPropertiesSection } from '@property/side-panel/properties/EntityPropertiesSection';
import { Button, Dialog } from '@ui';
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
  onDelete(): void;
  onOpenTask: ProjectTasksListProps['onOpenTask'];
  onCreateTask(): void;
  discussion: JSX.Element;
  description: JSX.Element;
}) {
  const definitions = useProjectsContext().createPropertyDefinitionsSource();
  const [deleting, setDeleting] = createSignal(false);
  const [adding, setAdding] = createSignal(false);
  const [selected, setSelected] = createSignal(new Set<string>());
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
  const assign = () =>
    run(async () => {
      const results = await props.commands.assignTasks(props.project.id, [
        ...selected(),
      ]);
      const failed = results.filter((item) => item.error);
      setSelected(new Set(failed.map((item) => item.taskId)));
      if (failed.length)
        setError(
          `${failed.length} tasks could not be added. ${failed[0].error}`
        );
      else setAdding(false);
    });

  return (
    <SidePanel.Layout headerToggle={false}>
      <SidePanel.Section id="details" title="Details" defaultOpen order={0}>
        <EntityDetailsGrid
          ownerId={props.project.ownerId}
          createdAt={props.project.createdAt}
          updatedAt={props.project.updatedAt}
        />
      </SidePanel.Section>
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
      <Show when={props.project.access === 'owner'}>
        <SidePanel.Section id="actions" title="Actions" order={3}>
          <Button
            size="sm"
            onClick={() => {
              setError(undefined);
              setDeleting(true);
            }}
          >
            Delete project
          </Button>
        </SidePanel.Section>
      </Show>
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
                onAddExistingTasks={
                  canEdit()
                    ? () => {
                        setError(undefined);
                        setSelected(new Set<string>());
                        setAdding(true);
                      }
                    : undefined
                }
              />
            </Match>
          </Switch>
        </div>
      </div>
      <Show when={adding()}>
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !props.commands.pending()) setAdding(false);
          }}
          class="max-w-lg"
        >
          <div class="flex flex-col gap-4 p-5">
            <Dialog.Title>Add tasks to project</Dialog.Title>
            <PropertyEntitySelector
              config={{
                isMultiSelect: true,
                specificEntityType: 'TASK',
                placeholder: 'Search tasks',
              }}
              selectedOptions={selected}
              setSelectedOptions={setSelected}
            />
            <Show when={error()}>
              {(message) => (
                <p role="alert" class="text-sm text-failure">
                  {message()}
                </p>
              )}
            </Show>
            <div class="flex justify-end gap-2">
              <Button
                disabled={props.commands.pending()}
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
              <Button
                variant="cta"
                disabled={props.commands.pending() || !selected().size}
                onClick={() => void assign()}
              >
                Add tasks
              </Button>
            </div>
          </div>
        </Dialog>
      </Show>
      <Show when={deleting()}>
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !props.commands.pending()) setDeleting(false);
          }}
          class="max-w-md"
        >
          <div class="flex flex-col gap-4 p-5">
            <Dialog.Title>Delete project?</Dialog.Title>
            <p class="text-sm text-ink-muted">
              The project and its activity will be deleted. Its tasks will
              remain in your workspace.
            </p>
            <Show when={error()}>
              {(message) => (
                <p role="alert" class="text-sm text-failure">
                  {message()}
                </p>
              )}
            </Show>
            <div class="flex justify-end gap-2">
              <Button
                disabled={props.commands.pending()}
                onClick={() => setDeleting(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={props.commands.pending()}
                onClick={() =>
                  void run(async () => {
                    await props.commands.delete(props.project.id);
                    props.onDelete();
                  })
                }
              >
                Delete project
              </Button>
            </div>
          </div>
        </Dialog>
      </Show>
    </SidePanel.Layout>
  );
}
