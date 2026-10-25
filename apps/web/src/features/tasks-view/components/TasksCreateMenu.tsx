import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import CheckSquareIcon from '@phosphor/check-square.svg';
import StackIcon from '@phosphor/stack.svg';
import TagIcon from '@phosphor/tag.svg';
import { Dropdown } from '@ui';
import { Show } from 'solid-js';

export function TasksCreateMenu(props: {
  presentation: 'sidebar' | 'toolbar';
  onCreateTask: () => void;
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
            ? 'New task, project, or tag'
            : 'New task or tag'
        }
        menu
      />
      <Dropdown.Content
        class="min-w-48"
        onCloseAutoFocus={(event) => {
          if (!selectedAction) return;
          event.preventDefault();
          queueMicrotask(selectedAction);
          selectedAction = undefined;
        }}
      >
        <Dropdown.Item
          onSelect={() => {
            selectedAction = props.onCreateTask;
          }}
        >
          <CheckSquareIcon class="size-4" />
          <span>Task</span>
        </Dropdown.Item>
        <Show when={props.onCreateProject}>
          {(createProject) => (
            <Dropdown.Item
              onSelect={() => {
                selectedAction = createProject();
              }}
            >
              <StackIcon class="size-4" />
              <span>Project</span>
            </Dropdown.Item>
          )}
        </Show>
        <Dropdown.Item
          onSelect={() => {
            selectedAction = props.onCreateTag;
          }}
        >
          <TagIcon class="size-4" />
          <span>Tag</span>
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown>
  );
}
