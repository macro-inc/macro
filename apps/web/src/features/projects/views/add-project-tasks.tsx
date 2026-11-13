import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import ListPlusIcon from '@icon/system/regular/list-plus.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { Dropdown, Hotkey, PillButton } from '@ui';
import { Show } from 'solid-js';
import type { AddProjectTasksViewProps } from '../add-project-tasks';

export function AddProjectTasksView(props: AddProjectTasksViewProps) {
  return (
    <Dropdown
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="bottom-end"
    >
      <Show
        when={props.inline}
        fallback={
          <Dropdown.Trigger variant="secondary" size="md">
            <PlusIcon class="size-4" />
            {props.canCreate ? 'Add task' : 'Add existing tasks'}
            <CaretDownIcon class="size-4" />
          </Dropdown.Trigger>
        }
      >
        <Dropdown.Trigger as={PillButton} tone="cta" icon={PlusIcon}>
          Add task <CaretDownIcon class="size-4" />
        </Dropdown.Trigger>
      </Show>
      <Show when={props.open}>
        <Show
          when={props.mode === 'choices'}
          fallback={
            <EditorPopover onClose={props.close}>
              {props.picker()}
            </EditorPopover>
          }
        >
          <Dropdown.Content
            onKeyDown={(event) => {
              if (event.ctrlKey || event.metaKey || event.altKey) return;
              if (event.key.toLowerCase() !== 'c') return;
              event.preventDefault();
              event.stopPropagation();
              props.createTask();
            }}
          >
            <Dropdown.Group>
              <Dropdown.Item aria-label="New task" onSelect={props.createTask}>
                <PlusIcon class="size-4" /> New task
                <Hotkey shortcut="c" theme="clear" class="ml-auto" />
              </Dropdown.Item>
              <Dropdown.Item
                closeOnSelect={false}
                onSelect={props.chooseExisting}
              >
                <ListPlusIcon class="size-4" /> Add existing tasks
              </Dropdown.Item>
            </Dropdown.Group>
          </Dropdown.Content>
        </Show>
      </Show>
    </Dropdown>
  );
}
