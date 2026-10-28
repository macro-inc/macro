import { createTaskWithProperties } from '@app/features/block-md/util/taskComposerProperties';
import { TagEditorDialog } from '@app/features/property/tags/TagEditorDialog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { fetchEntityProperties } from '@queries/properties/entity';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { Dialog } from '@ui';
import { createSignal } from 'solid-js';
import { TasksCreateMenu } from './components/TasksCreateMenu';

/** Task and project composers plus the shared tag editor, owned by this view. */
export function TasksCreateAction(props: {
  presentation: 'sidebar' | 'toolbar';
  projectsEnabled: boolean;
}) {
  const layout = useSplitLayout();
  const team = useCurrentTeamQuery();
  const [creatingTag, setCreatingTag] = createSignal(false);

  const [parentPickerOpen, setParentPickerOpen] = createSignal(false);
  const createSubtask = (parentId: string) => {
    setParentPickerOpen(false);
    const create: typeof createTaskWithProperties = async (
      title,
      content,
      values,
      definitions,
      history,
      options
    ) => {
      const created = await createTaskWithProperties(
        title,
        content,
        [
          ...values.filter(([id]) => id !== SYSTEM_PROPERTY_IDS.PARENT_TASK),
          [
            SYSTEM_PROPERTY_IDS.PARENT_TASK,
            {
              valueType: 'ENTITY',
              refs: [{ entity_id: parentId, entity_type: EntityType.TASK }],
            },
          ],
        ],
        definitions,
        history,
        options
      );
      if (created) {
        const properties = await fetchEntityProperties(
          'TASK',
          created.documentId
        ).catch(() => undefined);
        const parent = properties?.find(
          (property) =>
            property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PARENT_TASK
        );
        if (
          !(
            parent?.valueType === 'ENTITY' &&
            parent.value?.some(
              (ref) =>
                ref.entity_id === parentId &&
                ref.entity_type === EntityType.TASK
            )
          )
        ) {
          toast.failure(
            'Task created, but its parent could not be confirmed. Open the task to set its parent; do not create it again.'
          );
        }
      }
      return created;
    };
    layout.popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: { createTask: create },
    });
  };
  return (
    <>
      <TasksCreateMenu
        presentation={props.presentation}
        onCreateTask={() =>
          layout.popoverSplit({ type: 'component', id: 'task-compose' })
        }
        onCreateProject={
          props.projectsEnabled
            ? () =>
                layout.popoverSplit({
                  type: 'component',
                  id: 'project-compose',
                })
            : undefined
        }
        onCreateSubtask={() => setParentPickerOpen(true)}
        onCreateTag={() => setCreatingTag(true)}
      />
      <Dialog
        open={parentPickerOpen()}
        onOpenChange={setParentPickerOpen}
        class="w-96 max-w-[calc(100vw-2rem)] p-4"
      >
        <Dialog.Title class="mb-3 text-base font-semibold">
          Choose a parent task
        </Dialog.Title>
        <PropertyEntitySelector
          config={{
            isMultiSelect: false,
            specificEntityType: EntityType.TASK,
            placeholder: 'Search tasks',
          }}
          onClose={() => setParentPickerOpen(false)}
          selectedOptions={() => new Set<string>()}
          setSelectedOptions={(ids) => {
            const id = ids.values().next().value;
            if (id) createSubtask(id);
          }}
        />
      </Dialog>
      <TagEditorDialog
        open={creatingTag()}
        mode={{ type: 'create', initialScope: 'user' }}
        teamAvailable={team.isSuccess && Boolean(team.data?.team)}
        onClose={() => setCreatingTag(false)}
      />
    </>
  );
}
