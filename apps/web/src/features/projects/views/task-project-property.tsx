import CaretDownIcon from '@phosphor/caret-down.svg';
import StackIcon from '@phosphor/stack.svg';
import { Button, Tooltip } from '@ui';
import { createSignal, Show } from 'solid-js';
import { useProjectsContext } from '../context/projects-context';
import { ProjectAssignment } from './project-assignment';

/** Project membership is a task relation, rendered alongside its properties. */
export function TaskProjectProperty(props: {
  taskId: string;
  canEdit: boolean;
}) {
  const references = useProjectsContext().createReferencesSource(() => [
    props.taskId,
  ]);
  const [open, setOpen] = createSignal(false);
  const reference = () => references.references().get(props.taskId);
  const label = () => {
    const project = reference();
    if (project?.state === 'visible') return project.name;
    if (project?.state === 'unavailable') return 'Unavailable project';
    if (references.loading()) return 'Loading project…';
    if (references.error()) return 'Could not load project';
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
