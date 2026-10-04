import CaretDownIcon from '@phosphor/caret-down.svg';
import StackIcon from '@phosphor/stack.svg';
import { useEntityPropertiesQuery } from '@queries/properties/entity';
import { Button, Tooltip } from '@ui';
import { type Accessor, createSignal, Show } from 'solid-js';
import { useTaskProjectReference } from '../queries/project-identity';
import { taskProjectId } from '../queries/task-project';
import { ProjectAssignment } from './project-assignment';

/** The task's Project property, rendered alongside its other properties. */
export function TaskProjectProperty(props: {
  taskId: string;
  canEdit: boolean;
  userId: Accessor<string | undefined>;
}) {
  const properties = useEntityPropertiesQuery(
    () => 'TASK',
    () => props.taskId,
    false
  );
  const reference = useTaskProjectReference(
    () => taskProjectId(properties.data ?? []),
    props.userId
  );
  const [open, setOpen] = createSignal(false);
  const label = () => {
    const project = reference();
    if (properties.error) return 'Could not load project';
    if (properties.isLoading || !project) return 'Loading project…';
    if (project.state === 'visible') return project.name;
    if (project.state === 'unavailable') return 'Unavailable project';
    return 'No project';
  };

  return (
    <>
      <Tooltip label={`Project: ${label()}`}>
        <Button
          size="sm"
          variant="ghost"
          class="max-w-full gap-1.5 rounded-full border border-edge bg-surface-2 px-2 py-1 text-xs font-normal"
          aria-label={`Project: ${label()}`}
          disabled={!props.canEdit}
          onClick={() => setOpen(true)}
        >
          <StackIcon class="size-3 shrink-0" />
          <span class="max-w-48 truncate">{label()}</span>
          <Show when={props.canEdit}>
            <CaretDownIcon class="size-3 shrink-0" />
          </Show>
        </Button>
      </Tooltip>
      <Show when={open() && props.canEdit}>
        <ProjectAssignment
          taskIds={[props.taskId]}
          onClose={() => setOpen(false)}
        />
      </Show>
    </>
  );
}
