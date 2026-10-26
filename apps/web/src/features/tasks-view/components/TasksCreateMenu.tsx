import { CreateMenuItem } from '@app/components/view-shell/CreateMenuItem';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import StackIcon from '@icon/system/regular/stack.svg';
import TagIcon from '@icon/system/regular/tag.svg';
import SubtaskIcon from '@icon/system/regular/tree-structure.svg';
import { Dropdown } from '@ui';
import { Show } from 'solid-js';

export function TasksCreateMenu(props: {
  presentation: 'sidebar' | 'toolbar';
  onCreateTask: () => void;
  onCreateSubtask: () => void;
  onCreateProject?: () => void;
  onCreateTag: () => void;
}) {
  let selectedAction: (() => void) | undefined;
  return (
    <Dropdown
      placement={
        props.presentation === 'sidebar' ? 'bottom-start' : 'bottom-end'
      }
    >
      <Dropdown.Trigger
        as={ViewCreateButton}
        presentation={props.presentation}
        aria-label={
          props.onCreateProject
            ? 'New task, subtask, project, or tag'
            : 'New task, subtask, or tag'
        }
        menu
      />
      <Dropdown.Content
        class="w-80 max-w-[calc(100vw-2rem)]"
        onCloseAutoFocus={(event) => {
          if (!selectedAction) return;
          event.preventDefault();
          queueMicrotask(selectedAction);
          selectedAction = undefined;
        }}
      >
        <Dropdown.Group>
          <CreateMenuItem
            icon={CheckSquareIcon}
            title="Task"
            description="Track a standalone piece of work."
            onSelect={() => {
              selectedAction = props.onCreateTask;
            }}
          />
          <CreateMenuItem
            icon={SubtaskIcon}
            title="Subtask"
            description="Choose a parent task and break its work into a smaller step."
            onSelect={() => {
              selectedAction = props.onCreateSubtask;
            }}
          />
          <Show when={props.onCreateProject}>
            {(createProject) => (
              <CreateMenuItem
                icon={StackIcon}
                title="Project"
                description="Group related tasks around a shared goal."
                onSelect={() => {
                  selectedAction = createProject();
                }}
              />
            )}
          </Show>
          <CreateMenuItem
            icon={TagIcon}
            title="Tag"
            description="Label work so you can organize and filter it across projects."
            onSelect={() => {
              selectedAction = props.onCreateTag;
            }}
          />
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
