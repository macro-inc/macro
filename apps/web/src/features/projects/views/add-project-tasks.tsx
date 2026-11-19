import { fireAndForget } from '@core/util/fireAndForget';
import ListPlusIcon from '@icon/system/regular/list-plus.svg';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { Button, Dropdown } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import { useProjectsContext } from '../context/projects-context';
import type { ProjectDetail } from '../core/project';
import {
  type AddProjectTasksError,
  createAddProjectTasks,
} from '../primitives/add-project-tasks';

function errorText(error: AddProjectTasksError) {
  return match(error)
    .with(
      { kind: 'partial' },
      ({ count, reason }) =>
        `${count} ${count === 1 ? 'task could' : 'tasks could'} not be added. ${reason}`
    )
    .with(
      { kind: 'request' },
      ({ message }) => message ?? 'Could not add tasks. Try again.'
    )
    .exhaustive();
}

export function AddProjectTasksMenu(props: { project: ProjectDetail }) {
  const commands = useProjectsContext().createCommands();
  const picker = createAddProjectTasks({
    project: () => props.project,
    assignTasks: commands.assignTasks,
  });
  const [open, setOpen] = createSignal(false);
  const close = () => {
    if (!picker.saving()) setOpen(false);
  };
  const add = async () => {
    if (await picker.add()) setOpen(false);
  };

  return (
    <Dropdown
      open={open()}
      onOpenChange={(nextOpen) => {
        if (picker.saving()) return;
        if (nextOpen) picker.reset();
        setOpen(nextOpen);
      }}
      placement="bottom-end"
    >
      <Dropdown.Trigger variant="secondary" size="md">
        <ListPlusIcon class="size-4" />
        Add existing tasks
      </Dropdown.Trigger>
      <Show when={open()}>
        <EditorPopover onClose={close}>
          <div
            inert={picker.saving()}
            classList={{ 'opacity-50': picker.saving() }}
          >
            <Suspense fallback={<p role="status">Loading tasks…</p>}>
              <PropertyEntitySelector
                config={{
                  specificEntityType: 'TASK',
                  isMultiSelect: true,
                  placeholder: 'Search tasks…',
                  excludedIds: picker.excludedIds,
                }}
                selectedOptions={picker.selected}
                setSelectedOptions={picker.select}
                onClose={close}
              />
            </Suspense>
          </div>
          <Show when={picker.error()}>
            {(error) => (
              <p role="alert" class="px-3 pb-2 text-sm text-failure">
                {errorText(error())}
              </p>
            )}
          </Show>
          <div
            class="flex justify-end gap-2 border-t border-edge-muted p-2"
            onKeyDown={(event) => {
              // The selector owns document-level list navigation; footer buttons
              // keep their native Enter behavior without toggling another task.
              if (['Enter', 'ArrowUp', 'ArrowDown'].includes(event.key))
                event.stopPropagation();
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              disabled={picker.saving()}
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={picker.saving() || !picker.selected().size}
              onClick={() => fireAndForget(add(), 'projects')}
            >
              {picker.saving()
                ? 'Adding tasks…'
                : `Add ${picker.selected().size || ''} ${picker.selected().size === 1 ? 'task' : 'tasks'}`}
            </Button>
          </div>
        </EditorPopover>
      </Show>
    </Dropdown>
  );
}
